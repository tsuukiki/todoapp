/* ================================================================
   Ma To-Do — logique de l'application (frontend)
   - Taches ponctuelles en localStorage (hors-ligne, privees sur l'appareil)
   - Routine du jour : taches fixes qui se remettent a zero chaque jour
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
  const STORAGE_DEVICE = "todo.deviceId.v1";
  const STORAGE_ROUTINE = "todo.routine.v1"; // modeles de taches fixes
  const STORAGE_ROUTINE_STATE = "todo.routineState.v1"; // { date, done:{id:true} }

  let tasks = [];
  let routine = []; // [{ id, label }]
  let routineState = { date: "", done: {} };
  let currentFilter = "all";
  let vapidPublicKey = null;

  // 5 taches fixes d'exemple (a renommer/garder selon tes envies)
  const DEFAULT_ROUTINE = [
    "Boire un grand verre d'eau",
    "10 minutes de lecture",
    "Faire le lit",
    "Marcher 30 minutes",
    "Verifier les e-mails pro",
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
    void t.offsetWidth; // forcer le reflow pour rejouer la transition
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.classList.add("hidden"), 300);
    }, 2600);
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
  // Dates
  // ----------------------------------------------------------------
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }

  function isToday(ts) {
    return startOfDay(ts) === startOfDay(new Date());
  }

  function isLate(task) {
    return task.remindAt && !task.done && task.remindAt < Date.now();
  }

  // cle du jour "YYYY-MM-DD" (heure locale)
  function todayKey() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  // Persistance
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

  function loadRoutine() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_ROUTINE) || "null");
      if (Array.isArray(stored)) {
        routine = stored;
      } else {
        // premiere fois : on installe les 5 taches d'exemple
        routine = DEFAULT_ROUTINE.map((label) => ({ id: uid(), label }));
        saveRoutine();
      }
    } catch {
      routine = DEFAULT_ROUTINE.map((label) => ({ id: uid(), label }));
    }
  }

  function saveRoutine() {
    localStorage.setItem(STORAGE_ROUTINE, JSON.stringify(routine));
  }

  function loadRoutineState() {
    try {
      routineState = JSON.parse(
        localStorage.getItem(STORAGE_ROUTINE_STATE) || "null"
      ) || { date: "", done: {} };
    } catch {
      routineState = { date: "", done: {} };
    }
    ensureRoutineToday();
  }

  function saveRoutineState() {
    localStorage.setItem(STORAGE_ROUTINE_STATE, JSON.stringify(routineState));
  }

  // remet la routine a zero si on a change de jour
  function ensureRoutineToday() {
    const key = todayKey();
    if (routineState.date !== key) {
      routineState = { date: key, done: {} };
      saveRoutineState();
    }
  }

  // ----------------------------------------------------------------
  // Routine du jour : rendu + actions
  // ----------------------------------------------------------------
  function renderRoutine() {
    ensureRoutineToday();
    const list = $("#daily-list");
    list.innerHTML = "";

    routine.forEach((item) => {
      const done = !!routineState.done[item.id];
      const li = document.createElement("li");
      li.className = "daily-item" + (done ? " done" : "");
      li.dataset.id = item.id;

      const check = document.createElement("button");
      check.type = "button";
      check.className = "daily-check" + (done ? " checked" : "");
      check.innerHTML = "&#10003;";
      check.setAttribute("aria-label", done ? "Decocher" : "Cocher");
      check.addEventListener("click", () => toggleRoutine(item.id));

      const label = document.createElement("span");
      label.className = "daily-label";
      label.textContent = item.label;
      // double-clic / clic sur le texte = renommer
      label.addEventListener("click", () => startRenameRoutine(item.id, li));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "daily-del";
      del.innerHTML = "&#128465;";
      del.setAttribute("aria-label", "Supprimer cette tache fixe");
      del.addEventListener("click", () => deleteRoutine(item.id));

      li.append(check, label, del);
      list.appendChild(li);
    });

    // progression
    const total = routine.length;
    const doneCount = routine.filter((i) => routineState.done[i.id]).length;
    const prog = $("#daily-progress");
    prog.textContent = `${doneCount}/${total}`;
    prog.classList.toggle("complete", total > 0 && doneCount === total);
  }

  function toggleRoutine(id) {
    ensureRoutineToday();
    if (routineState.done[id]) delete routineState.done[id];
    else routineState.done[id] = true;
    saveRoutineState();
    renderRoutine();
  }

  function addRoutine(label) {
    const text = label.trim();
    if (!text) return;
    routine.push({ id: uid(), label: text });
    saveRoutine();
    renderRoutine();
  }

  function deleteRoutine(id) {
    routine = routine.filter((i) => i.id !== id);
    delete routineState.done[id];
    saveRoutine();
    saveRoutineState();
    renderRoutine();
  }

  function startRenameRoutine(id, li) {
    const item = routine.find((i) => i.id === id);
    if (!item || li.querySelector(".daily-rename")) return;

    const label = li.querySelector(".daily-label");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "daily-rename";
    input.maxLength = 80;
    input.value = item.label;
    label.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    const commit = () => {
      const val = input.value.trim();
      if (val) {
        item.label = val;
        saveRoutine();
      }
      renderRoutine();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        renderRoutine();
      }
    });
  }

  // ----------------------------------------------------------------
  // Taches ponctuelles : rendu
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
    renderRoutine();
    renderHeader();

    const list = $("#task-list");
    list.innerHTML = "";
    const visible = sortTasks(tasks.filter(matchesFilter));
    $("#empty-state").classList.toggle("hidden", visible.length > 0);
    for (const task of visible) list.appendChild(renderTask(task));
  }

  function renderTask(task) {
    const li = document.createElement("li");
    li.className = "task";
    li.dataset.id = task.id;
    if (task.done) li.classList.add("done");
    else if (isLate(task)) li.classList.add("task-late");
    else if (task.remindAt && isToday(task.remindAt)) li.classList.add("task-today");

    const check = document.createElement("button");
    check.type = "button";
    check.className = "check";
    check.innerHTML = "&#10003;";
    check.setAttribute("aria-label", task.done ? "Marquer non faite" : "Marquer faite");
    check.addEventListener("click", () => toggleDone(task.id));

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
    $("#today-label").textContent = new Date().toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

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

  // ----------------------------------------------------------------
  // Taches ponctuelles : actions
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

      showToast("Notifications activees");
      updateNotifBanner();

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
  // ----------------------------------------------------------------
  async function syncReminder(task, force = false) {
    if (!task.remindAt || task.done) return;
    if (!notifSupported() || Notification.permission !== "granted") return;
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
  // Service worker + config
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
    // ajout d'une tache ponctuelle
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

    // ajout d'une tache fixe (routine)
    $("#daily-add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#daily-input");
      addRoutine(input.value);
      input.value = "";
      input.focus();
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

    // rafraichir badges/retards + reset routine a minuit, periodiquement
    setInterval(() => {
      if (!document.hidden) render();
    }, 30_000);

    // au retour au premier plan, recalculer (changement de jour possible)
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) render();
    });
  }

  // ----------------------------------------------------------------
  // Ecran d'accueil : citation de motivation (5s bloquees puis clic)
  // ----------------------------------------------------------------
  const QUOTES = [
    { text: "Le succes, c'est tomber sept fois et se relever huit.", author: "Proverbe japonais" },
    { text: "La meilleure facon de predire l'avenir, c'est de le creer.", author: "Peter Drucker" },
    { text: "Ne comptez pas les jours, faites que les jours comptent.", author: "Mohamed Ali" },
    { text: "Votre temps est limite, ne le gachez pas a vivre la vie de quelqu'un d'autre.", author: "Steve Jobs" },
    { text: "Le seul endroit ou le succes precede le travail, c'est dans le dictionnaire.", author: "Vidal Sassoon" },
    { text: "Les opportunites ne se presentent pas, c'est vous qui les creez.", author: "Chris Grosser" },
    { text: "Commence par faire le necessaire, puis le possible, et tu realiseras l'impossible.", author: "Francois d'Assise" },
    { text: "La discipline est le pont entre les objectifs et les accomplissements.", author: "Jim Rohn" },
    { text: "Le risque le plus grand est de ne prendre aucun risque.", author: "Mark Zuckerberg" },
    { text: "Fais de ta vie un reve, et d'un reve une realite.", author: "Antoine de Saint-Exupery" },
    { text: "Ce qui ne se mesure pas ne s'ameliore pas.", author: "Peter Drucker" },
    { text: "Travaille dur en silence, laisse le succes faire le bruit.", author: "Frank Ocean" },
    { text: "L'action est la cle fondamentale de tout succes.", author: "Pablo Picasso" },
    { text: "Si tu veux aller vite, marche seul ; si tu veux aller loin, marchons ensemble.", author: "Proverbe africain" },
    { text: "N'ayez pas peur d'abandonner le bon pour atteindre le grand.", author: "John D. Rockefeller" },
    { text: "Le pessimiste voit la difficulte dans chaque opportunite, l'optimiste voit l'opportunite dans chaque difficulte.", author: "Winston Churchill" },
    { text: "La motivation vous lance, l'habitude vous fait continuer.", author: "Jim Ryun" },
    { text: "Un objectif sans plan n'est qu'un souhait.", author: "Antoine de Saint-Exupery" },
    { text: "Ce n'est pas la montagne que nous conquerons, mais nous-memes.", author: "Edmund Hillary" },
    { text: "Reve grand, commence petit, mais surtout : commence.", author: "Simon Sinek" },
    { text: "La qualite n'est jamais un accident, c'est toujours le resultat d'un effort intelligent.", author: "John Ruskin" },
    { text: "Tomber n'est pas un echec, l'echec c'est de rester la ou l'on est tombe.", author: "Socrate" },
    { text: "Les gens qui reussissent agissent avant d'etre prets.", author: "Richard Branson" },
    { text: "Chaque expert a un jour ete un debutant.", author: "Helen Hayes" },
    { text: "Concentre-toi sur l'etre productif plutot que sur l'etre occupe.", author: "Tim Ferriss" },
    { text: "Le succes n'est pas final, l'echec n'est pas fatal : c'est le courage de continuer qui compte.", author: "Winston Churchill" },
    { text: "Fais aujourd'hui ce que les autres ne veulent pas, tu vivras demain comme les autres ne peuvent pas.", author: "Anonyme" },
    { text: "La perfection n'est pas atteignable, mais en la cherchant on atteint l'excellence.", author: "Vince Lombardi" },
  ];

  const Splash = {
    start() {
      const el = $("#splash");
      if (!el) return;

      // citation aleatoire a chaque lancement
      const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      $("#splash-quote").textContent = "« " + q.text + " »";
      $("#splash-author").textContent = q.author ? "— " + q.author : "";

      // demarre la barre de progression (5s) en synchro avec le minuteur
      el.classList.add("counting");

      let ready = false;
      const unlock = () => {
        ready = true;
        el.classList.add("ready");
        $("#splash-hint").textContent = "Touchez l'ecran pour continuer";
      };
      const timer = setTimeout(unlock, 5000);

      const dismiss = () => {
        if (!ready) return; // bloque tant que les 5s ne sont pas ecoulees
        clearTimeout(timer);
        el.classList.add("closing");
        el.removeEventListener("click", dismiss);
        setTimeout(() => el.classList.add("hidden"), 350);
      };
      el.addEventListener("click", dismiss);
    },
  };

  // ----------------------------------------------------------------
  // Demarrage
  // ----------------------------------------------------------------
  function start() {
    Splash.start();
    loadTasks();
    loadRoutine();
    loadRoutineState();
    bindEvents();
    render();
    registerSW();
    loadConfig();
    updateNotifBanner();
  }

  document.addEventListener("DOMContentLoaded", start);
})();
