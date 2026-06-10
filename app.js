/* ================================================================
   Ma To-Do — logique de l'application (frontend)
   - Verrouillage par code PIN (confidentialite legere, cote client)
   - Taches en localStorage (hors-ligne, privees sur l'appareil)
   - Notifications push iOS (PWA) : abonnement + synchro des rappels
   ================================================================ */

(() => {
  "use strict";

  // ----------------------------------------------------------------
  // Petits utilitaires
  // ----------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const STORAGE_TASKS = "todo.tasks.v1";
  const STORAGE_PIN = "todo.pinHash.v1";
  const STORAGE_PIN_LEN = "todo.pinLen.v1";
  const STORAGE_DEVICE = "todo.deviceId.v1";

  let tasks = [];
  let currentFilter = "all";
  let vapidPublicKey = null;

  function uid() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  // Identifiant d'appareil stable (pour relier l'abonnement push cote serveur)
  function deviceId() {
    let id = localStorage.getItem(STORAGE_DEVICE);
    if (!id) {
      id = uid();
      localStorage.setItem(STORAGE_DEVICE, id);
    }
    return id;
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    // forcer le reflow pour rejouer la transition
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.classList.add("hidden"), 300);
    }, 2600);
  }

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // ----------------------------------------------------------------
  // Dates
  // ----------------------------------------------------------------
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }

  function isToday(ts) {
    const now = new Date();
    return startOfDay(ts) === startOfDay(now);
  }

  function isLate(task) {
    return task.remindAt && !task.done && task.remindAt < Date.now();
  }

  // valeur d'un <input datetime-local> -> timestamp (ms)
  function localInputToTs(value) {
    if (!value) return null;
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? null : ts;
  }

  // timestamp -> valeur pour <input datetime-local> (heure locale)
  function tsToLocalInput(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  function formatDue(ts) {
    const d = new Date(ts);
    const opts = isToday(ts)
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
    const label = d.toLocaleString("fr-FR", opts);
    return isToday(ts) ? "Aujourd'hui " + label : label;
  }

  // ----------------------------------------------------------------
  // Persistance des taches
  // ----------------------------------------------------------------
  function loadTasks() {
    try {
      tasks = JSON.parse(localStorage.getItem(STORAGE_TASKS) || "[]");
    } catch {
      tasks = [];
    }
  }

  function saveTasks() {
    localStorage.setItem(STORAGE_TASKS, JSON.stringify(tasks));
  }

  // ----------------------------------------------------------------
  // Rendu
  // ----------------------------------------------------------------
  function matchesFilter(task) {
    switch (currentFilter) {
      case "today":
        return task.remindAt && isToday(task.remindAt) && !task.done;
      case "late":
        return isLate(task);
      case "done":
        return task.done;
      default:
        return true;
    }
  }

  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1; // faites en bas
      const ra = a.remindAt || Infinity;
      const rb = b.remindAt || Infinity;
      if (ra !== rb) return ra - rb; // par echeance
      return b.createdAt - a.createdAt; // recentes d'abord
    });
  }

  function render() {
    const list = $("#task-list");
    list.innerHTML = "";

    const visible = sortTasks(tasks.filter(matchesFilter));
    $("#empty-state").classList.toggle("hidden", visible.length > 0);

    for (const task of visible) {
      list.appendChild(renderTask(task));
    }

    renderHeader();
  }

  function renderTask(task) {
    const li = document.createElement("li");
    li.className = "task";
    li.dataset.id = task.id;
    if (task.done) li.classList.add("done");
    else if (isLate(task)) li.classList.add("task-late");
    else if (task.remindAt && isToday(task.remindAt)) li.classList.add("task-today");

    // case a cocher
    const check = document.createElement("button");
    check.type = "button";
    check.className = "check";
    check.innerHTML = "&#10003;";
    check.setAttribute("aria-label", task.done ? "Marquer non faite" : "Marquer faite");
    check.addEventListener("click", () => toggleDone(task.id));

    // corps
    const body = document.createElement("div");
    body.className = "task-body";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;
    body.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "task-meta";

    if (task.remindAt) {
      const due = document.createElement("span");
      due.className = "task-tag tag-due";
      if (isLate(task)) due.classList.add("is-late");
      else if (isToday(task.remindAt) && !task.done) due.classList.add("is-today");
      due.innerHTML =
        (isLate(task) ? "&#9888; " : "&#128337; ") + escapeHtml(formatDue(task.remindAt));
      meta.appendChild(due);

      // cloche : rappel synchronise avec le serveur
      if (task.synced && !task.done) {
        const bell = document.createElement("span");
        bell.className = "task-tag tag-bell";
        bell.innerHTML = "&#128276;";
        bell.title = "Rappel push actif";
        meta.appendChild(bell);
      }
    }

    if (task.category) {
      const cat = document.createElement("span");
      cat.className = "task-tag tag-cat";
      cat.textContent = task.category;
      meta.appendChild(cat);
    }

    if (meta.children.length) body.appendChild(meta);

    // actions
    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "mini-btn";
    editBtn.innerHTML = "&#9998;";
    editBtn.setAttribute("aria-label", "Modifier");
    editBtn.addEventListener("click", () => openEdit(task.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "mini-btn del";
    delBtn.innerHTML = "&#128465;";
    delBtn.setAttribute("aria-label", "Supprimer");
    delBtn.addEventListener("click", () => removeTask(task.id));

    actions.append(editBtn, delBtn);
    li.append(check, body, actions);
    return li;
  }

  function renderHeader() {
    // libelle du jour
    const today = new Date().toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    $("#today-label").textContent = today;

    // badges
    const lateCount = tasks.filter((t) => isLate(t)).length;
    const todayCount = tasks.filter(
      (t) => t.remindAt && isToday(t.remindAt) && !t.done && t.remindAt >= Date.now()
    ).length;

    const badges = $("#badges");
    badges.innerHTML = "";
    if (lateCount > 0) {
      const b = document.createElement("span");
      b.className = "badge late";
      b.textContent = `${lateCount} en retard`;
      badges.appendChild(b);
    }
    if (todayCount > 0) {
      const b = document.createElement("span");
      b.className = "badge today";
      b.textContent = `${todayCount} pour aujourd'hui`;
      badges.appendChild(b);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  // ----------------------------------------------------------------
  // Actions sur les taches
  // ----------------------------------------------------------------
  function addTask(title, remindAt, category) {
    const task = {
      id: uid(),
      title: title.trim(),
      remindAt: remindAt || null,
      category: (category || "").trim() || null,
      done: false,
      synced: false,
      createdAt: Date.now(),
    };
    tasks.push(task);
    saveTasks();
    render();
    syncReminder(task);
  }

  function toggleDone(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.done = !task.done;
    saveTasks();
    // une tache faite n'a plus besoin de rappel serveur
    if (task.done) cancelReminder(task);
    else syncReminder(task);
    render();
  }

  function removeTask(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const el = $(`.task[data-id="${id}"]`);
    cancelReminder(task);
    const finish = () => {
      tasks = tasks.filter((t) => t.id !== id);
      saveTasks();
      render();
    };
    if (el) {
      el.classList.add("removing");
      setTimeout(finish, 250);
    } else {
      finish();
    }
  }

  function clearDone() {
    const done = tasks.filter((t) => t.done);
    if (done.length === 0) {
      showToast("Aucune tache faite a supprimer");
      return;
    }
    done.forEach(cancelReminder);
    tasks = tasks.filter((t) => !t.done);
    saveTasks();
    render();
    showToast(`${done.length} tache(s) supprimee(s)`);
  }

  // ----------------------------------------------------------------
  // Modale d'edition
  // ----------------------------------------------------------------
  function openEdit(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    $("#edit-id").value = task.id;
    $("#edit-title").value = task.title;
    $("#edit-due").value = tsToLocalInput(task.remindAt);
    $("#edit-cat").value = task.category || "";
    $("#edit-modal").classList.remove("hidden");
  }

  function closeEdit() {
    $("#edit-modal").classList.add("hidden");
  }

  function saveEdit(e) {
    e.preventDefault();
    const id = $("#edit-id").value;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.title = $("#edit-title").value.trim();
    task.remindAt = localInputToTs($("#edit-due").value);
    task.category = $("#edit-cat").value.trim() || null;
    saveTasks();
    closeEdit();
    render();
    // re-synchroniser le rappel (l'heure a pu changer)
    if (task.remindAt && !task.done) syncReminder(task, true);
    else cancelReminder(task);
  }

  // ----------------------------------------------------------------
  // Notifications push : abonnement
  // ----------------------------------------------------------------
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function notifSupported() {
    return (
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  function updateNotifBanner() {
    const banner = $("#notif-banner");
    const status = $("#notif-status");
    const btn = $("#enable-notif");

    if (!notifSupported()) {
      banner.classList.add("hidden");
      return;
    }

    if (Notification.permission === "granted") {
      banner.classList.add("hidden");
      return;
    }

    banner.classList.remove("hidden");

    // iOS exige le mode "ecran d'accueil" (standalone)
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (iOS && !isStandalone()) {
      status.textContent =
        "Sur iPhone : ajoutez d'abord l'app a l'ecran d'accueil (Partager > Sur l'ecran d'accueil), puis ouvrez-la depuis l'icone.";
      btn.disabled = true;
    } else if (Notification.permission === "denied") {
      status.textContent =
        "Notifications bloquees. Autorisez-les dans les reglages de l'app/du navigateur.";
      btn.disabled = true;
    } else {
      status.textContent = "Activez les rappels meme quand l'app est fermee.";
      btn.disabled = false;
    }
  }

  async function enableNotifications() {
    if (!notifSupported()) {
      showToast("Notifications non supportees sur cet appareil");
      return;
    }
    const btn = $("#enable-notif");
    btn.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        showToast("Permission refusee");
        updateNotifBanner();
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      if (!vapidPublicKey) {
        showToast("Cle VAPID manquante (config serveur)");
        return;
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: deviceId(), subscription: sub }),
      });
      if (!res.ok) throw new Error("subscribe HTTP " + res.status);

      showToast("Notifications activees ✅");
      updateNotifBanner();

      // re-synchroniser tous les rappels en attente
      tasks
        .filter((t) => t.remindAt && !t.done)
        .forEach((t) => syncReminder(t, true));
    } catch (err) {
      console.error(err);
      showToast("Echec de l'activation des notifications");
    } finally {
      updateNotifBanner();
    }
  }

  // ----------------------------------------------------------------
  // Synchronisation des rappels avec le serveur
  // (pour que le push parte meme app fermee)
  // ----------------------------------------------------------------
  async function syncReminder(task, force = false) {
    if (!task.remindAt || task.done) return;
    if (!notifSupported() || Notification.permission !== "granted") return;
    // inutile de renvoyer si deja synchro et pas force
    if (task.synced && !force) return;

    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: deviceId(),
          id: task.id,
          titre: task.title,
          remindAt: task.remindAt,
        }),
      });
      if (res.ok) {
        task.synced = true;
        saveTasks();
        render();
      }
    } catch (err) {
      console.warn("syncReminder echoue (hors-ligne ?)", err);
    }
  }

  async function cancelReminder(task) {
    if (!task.synced) return;
    try {
      await fetch(
        `/api/reminders?deviceId=${encodeURIComponent(
          deviceId()
        )}&id=${encodeURIComponent(task.id)}`,
        { method: "DELETE" }
      );
    } catch (err) {
      console.warn("cancelReminder echoue", err);
    }
    task.synced = false;
    saveTasks();
  }

  // ----------------------------------------------------------------
  // Verrouillage par code PIN
  // ----------------------------------------------------------------
  const Pin = {
    buffer: "",
    mode: "unlock", // "unlock" | "create" | "confirm"
    firstEntry: "",

    async init() {
      const hasPin = !!localStorage.getItem(STORAGE_PIN);
      this.mode = hasPin ? "unlock" : "create";
      this.buffer = "";
      this.firstEntry = "";
      this.show();
      this.refreshLabels();
      this.renderDots();
    },

    show() {
      const ls = $("#lock-screen");
      ls.classList.remove("hidden");
      ls.setAttribute("aria-hidden", "false");
      $("#app").style.display = "none";
    },

    hide() {
      const ls = $("#lock-screen");
      ls.classList.add("hidden");
      ls.setAttribute("aria-hidden", "true");
      $("#app").style.display = "";
    },

    refreshLabels() {
      const title = $("#lock-title");
      const sub = $("#lock-subtitle");
      sub.classList.remove("error");
      if (this.mode === "create") {
        title.textContent = "Creez un code";
        sub.textContent = "4 a 6 chiffres pour proteger l'app";
      } else if (this.mode === "confirm") {
        title.textContent = "Confirmez le code";
        sub.textContent = "Saisissez a nouveau le meme code";
      } else {
        title.textContent = "Entrez votre code";
        sub.textContent = "Code a 4 a 6 chiffres";
      }
    },

    renderDots() {
      const dots = $$("#pin-dots span");
      dots.forEach((d, i) => d.classList.toggle("filled", i < this.buffer.length));
      // en creation/confirmation on autorise jusqu'a 6, bouton valider des 4
      const showValidate =
        this.buffer.length >= 4 &&
        (this.mode === "create" || this.mode === "confirm");
      $("#pin-validate").classList.toggle("hidden", !showValidate);
    },

    press(key) {
      if (key === "del") {
        this.buffer = this.buffer.slice(0, -1);
        this.renderDots();
        return;
      }
      if (key === "cancel") {
        this.buffer = "";
        if (this.mode === "confirm") {
          this.mode = "create";
          this.firstEntry = "";
          this.refreshLabels();
        }
        this.renderDots();
        return;
      }
      if (this.buffer.length >= 6) return;
      this.buffer += key;
      this.renderDots();

      // en mode "unlock", on valide automatiquement des qu'on atteint la
      // longueur du code enregistre (ou 6 par securite).
      if (this.mode === "unlock") {
        const expectedLen = Number(localStorage.getItem(STORAGE_PIN_LEN)) || 6;
        if (this.buffer.length >= expectedLen) this.tryUnlock();
      }
    },

    async tryUnlock() {
      const hash = await sha256(this.buffer);
      const stored = localStorage.getItem(STORAGE_PIN);
      if (hash === stored) {
        this.hide();
      } else {
        this.fail("Code incorrect");
      }
    },

    async validateCreate() {
      if (this.buffer.length < 4) return;
      if (this.mode === "create") {
        this.firstEntry = this.buffer;
        this.buffer = "";
        this.mode = "confirm";
        this.refreshLabels();
        this.renderDots();
      } else if (this.mode === "confirm") {
        if (this.buffer === this.firstEntry) {
          const hash = await sha256(this.buffer);
          localStorage.setItem(STORAGE_PIN, hash);
          localStorage.setItem(STORAGE_PIN_LEN, String(this.buffer.length));
          showToast("Code enregistre ✅");
          this.hide();
        } else {
          this.mode = "create";
          this.firstEntry = "";
          this.buffer = "";
          this.fail("Les codes ne correspondent pas");
        }
      }
    },

    fail(msg) {
      const sub = $("#lock-subtitle");
      sub.textContent = msg;
      sub.classList.add("error");
      this.buffer = "";
      const dots = $("#pin-dots");
      dots.classList.add("shake");
      setTimeout(() => dots.classList.remove("shake"), 400);
      this.renderDots();
      this.refreshLabelsAfterFail();
    },

    refreshLabelsAfterFail() {
      // garder le message d'erreur visible un instant
      setTimeout(() => this.refreshLabels(), 1400);
    },
  };

  function lockNow() {
    Pin.init();
  }

  // ----------------------------------------------------------------
  // Service worker
  // ----------------------------------------------------------------
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch (err) {
      console.warn("SW registration echouee", err);
    }
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const cfg = await res.json();
        vapidPublicKey = cfg.vapidPublicKey || null;
      }
    } catch (err) {
      console.warn("config non chargee", err);
    }
  }

  // ----------------------------------------------------------------
  // Branchement des evenements
  // ----------------------------------------------------------------
  function bindEvents() {
    // formulaire d'ajout
    $("#add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const title = $("#task-title").value;
      if (!title.trim()) return;
      const remindAt = localInputToTs($("#task-due").value);
      const cat = $("#task-cat").value;
      addTask(title, remindAt, cat);
      e.target.reset();
      $("#task-title").focus();
    });

    // filtres
    $("#filters").addEventListener("click", (e) => {
      const btn = e.target.closest(".filter");
      if (!btn) return;
      $$(".filter").forEach((f) => f.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      render();
    });

    // modale d'edition
    $("#edit-form").addEventListener("submit", saveEdit);
    $("#edit-cancel").addEventListener("click", closeEdit);
    $("#edit-modal").addEventListener("click", (e) => {
      if (e.target.id === "edit-modal") closeEdit();
    });

    // nettoyage
    $("#clear-done").addEventListener("click", clearDone);

    // notifications
    $("#enable-notif").addEventListener("click", enableNotifications);

    // verrouillage manuel
    $("#lock-now").addEventListener("click", lockNow);

    // pave PIN
    $("#pin-pad").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-key]");
      if (btn) Pin.press(btn.dataset.key);
    });
    $("#pin-validate").addEventListener("click", () => Pin.validateCreate());

    // re-verrouiller quand l'app passe en arriere-plan longtemps
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (
        localStorage.getItem(STORAGE_PIN) &&
        hiddenAt &&
        Date.now() - hiddenAt > 60_000 // re-verrouille apres 1 min en arriere-plan
      ) {
        Pin.init();
      }
    });

    // rafraichir l'etat des badges / retards periodiquement
    setInterval(() => {
      if (!document.hidden) render();
    }, 30_000);
  }

  // ----------------------------------------------------------------
  // Demarrage
  // ----------------------------------------------------------------
  async function start() {
    loadTasks();
    bindEvents();
    render();
    await Pin.init();
    registerSW();
    loadConfig();
    updateNotifBanner();
  }

  document.addEventListener("DOMContentLoaded", start);
})();
