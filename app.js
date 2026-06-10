/* ================================================================
   Ma To-Do — logique de l'application (frontend)
   - Habitudes en groupes (Matin / Journee / Notifications)
     -> cases a cocher qui se remettent a zero chaque jour
   - Graphique de reussite des habitudes (Matin + Journee)
   - Notifications push iOS (PWA) : abonnement + bouton de test
   ================================================================ */

(() => {
  "use strict";

  // ----------------------------------------------------------------
  // Petits utilitaires
  // ----------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);

  const STORAGE_DEVICE = "todo.deviceId.v1";
  const STORAGE_GROUPS = "todo.groups.v2"; // { matin:[{id,label}], journee:[...], notifications:[...] }
  const STORAGE_GROUPS_STATE = "todo.groupsState.v2"; // { date, done:{ id:true } }
  const STORAGE_HABIT_HISTORY = "todo.habitHistory.v2"; // { "YYYY-MM-DD": { done, total } }
  const STORAGE_ROUTINE_HISTORY_OLD = "todo.routineHistory.v1"; // ancien historique (migration)

  const HABIT_DAYS = 7; // jours affiches dans le graphique
  const HISTORY_KEEP_DAYS = 90;

  // Definition des groupes. countsForHabits = compte dans le % de reussite.
  const GROUPS = [
    { key: "matin", countsForHabits: true },
    { key: "journee", countsForHabits: true },
    { key: "notifications", countsForHabits: false },
  ];

  // Contenu par defaut (premier lancement)
  const DEFAULT_GROUPS = {
    matin: [
      "Leve a 7h",
      "Verre d'eau",
      "Mobilite a jeun",
      "5min dehors",
      "0 Reseaux sociaux",
      "Sport",
    ],
    journee: ["15min mur", "Habitudes DeepWork", "Pas de scroll en journee"],
    notifications: [
      "Notification 1",
      "Notification 2",
      "Notification 3",
      "Notification 4",
      "Notification 5",
    ],
  };

  let groups = { matin: [], journee: [], notifications: [] };
  let groupsState = { date: "", done: {} };
  let habitHistory = {};
  let vapidPublicKey = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

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
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.classList.add("hidden"), 300);
    }, 2600);
  }

  function todayKey() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ----------------------------------------------------------------
  // Persistance : groupes + etat du jour + historique
  // ----------------------------------------------------------------
  function loadGroups() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_GROUPS) || "null");
      if (stored && typeof stored === "object") {
        for (const g of GROUPS) {
          groups[g.key] = Array.isArray(stored[g.key]) ? stored[g.key] : [];
        }
        return;
      }
    } catch {
      /* on retombe sur les valeurs par defaut */
    }
    // premier lancement : on installe le contenu par defaut
    for (const g of GROUPS) {
      groups[g.key] = (DEFAULT_GROUPS[g.key] || []).map((label) => ({ id: uid(), label }));
    }
    saveGroups();
  }

  function saveGroups() {
    localStorage.setItem(STORAGE_GROUPS, JSON.stringify(groups));
  }

  function loadGroupsState() {
    try {
      groupsState =
        JSON.parse(localStorage.getItem(STORAGE_GROUPS_STATE) || "null") || {
          date: "",
          done: {},
        };
    } catch {
      groupsState = { date: "", done: {} };
    }
    ensureGroupsToday();
  }

  function saveGroupsState() {
    localStorage.setItem(STORAGE_GROUPS_STATE, JSON.stringify(groupsState));
  }

  // remet toutes les cases a zero si on a change de jour
  function ensureGroupsToday() {
    const key = todayKey();
    if (groupsState.date !== key) {
      groupsState = { date: key, done: {} };
      saveGroupsState();
      recordHabitToday();
    }
  }

  function loadHistory() {
    try {
      habitHistory = JSON.parse(localStorage.getItem(STORAGE_HABIT_HISTORY) || "null") || {};
    } catch {
      habitHistory = {};
    }
    // migration : reprendre l'ancien historique si le nouveau est vide
    if (Object.keys(habitHistory).length === 0) {
      try {
        const old = JSON.parse(localStorage.getItem(STORAGE_ROUTINE_HISTORY_OLD) || "null");
        if (old && typeof old === "object") {
          habitHistory = old;
          saveHistory();
        }
      } catch {
        /* rien */
      }
    }
  }

  function saveHistory() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_KEEP_DAYS);
    const min = cutoff.toISOString().slice(0, 10);
    for (const k of Object.keys(habitHistory)) {
      if (k < min) delete habitHistory[k];
    }
    localStorage.setItem(STORAGE_HABIT_HISTORY, JSON.stringify(habitHistory));
  }

  // total des habitudes qui comptent (Matin + Journee)
  function habitTotals() {
    let total = 0;
    let done = 0;
    for (const g of GROUPS) {
      if (!g.countsForHabits) continue;
      for (const item of groups[g.key]) {
        total++;
        if (groupsState.done[item.id]) done++;
      }
    }
    return { done, total };
  }

  function recordHabitToday() {
    const { done, total } = habitTotals();
    habitHistory[todayKey()] = { done, total };
    saveHistory();
  }

  // ----------------------------------------------------------------
  // Rendu des groupes (listes a cocher)
  // ----------------------------------------------------------------
  function renderGroups() {
    ensureGroupsToday();
    for (const g of GROUPS) renderGroupList(g.key);
  }

  function renderGroupList(key) {
    const ul = document.querySelector(`[data-list="${key}"]`);
    if (!ul) return;
    ul.innerHTML = "";

    for (const item of groups[key]) {
      const done = !!groupsState.done[item.id];
      const li = document.createElement("li");
      li.className = "daily-item" + (done ? " done" : "");
      li.dataset.id = item.id;

      const check = document.createElement("button");
      check.type = "button";
      check.className = "daily-check" + (done ? " checked" : "");
      check.innerHTML = "&#10003;";
      check.setAttribute("aria-label", done ? "Decocher" : "Cocher");
      check.addEventListener("click", () => toggleItem(item.id));

      const label = document.createElement("span");
      label.className = "daily-label";
      label.textContent = item.label;
      label.addEventListener("click", () => startRename(key, item.id, li));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "daily-del";
      del.innerHTML = "&#128465;";
      del.setAttribute("aria-label", "Supprimer");
      del.addEventListener("click", () => deleteItem(key, item.id));

      li.append(check, label, del);
      ul.appendChild(li);
    }

    // progression du groupe
    const total = groups[key].length;
    const doneCount = groups[key].filter((i) => groupsState.done[i.id]).length;
    const prog = document.querySelector(`[data-progress="${key}"]`);
    if (prog) {
      prog.textContent = `${doneCount}/${total}`;
      prog.classList.toggle("complete", total > 0 && doneCount === total);
    }
  }

  function toggleItem(id) {
    ensureGroupsToday();
    if (groupsState.done[id]) delete groupsState.done[id];
    else groupsState.done[id] = true;
    saveGroupsState();
    recordHabitToday();
    renderGroups();
    renderHabits();
  }

  function addItem(key, label) {
    const text = label.trim();
    if (!text) return;
    groups[key].push({ id: uid(), label: text });
    saveGroups();
    recordHabitToday();
    renderGroups();
    renderHabits();
  }

  function deleteItem(key, id) {
    groups[key] = groups[key].filter((i) => i.id !== id);
    delete groupsState.done[id];
    saveGroups();
    saveGroupsState();
    recordHabitToday();
    renderGroups();
    renderHabits();
  }

  function startRename(key, id, li) {
    const item = groups[key].find((i) => i.id === id);
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
        saveGroups();
      }
      renderGroups();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        renderGroups();
      }
    });
  }

  // ----------------------------------------------------------------
  // Graphique des habitudes (derniers jours en barres)
  // ----------------------------------------------------------------
  function renderHabits() {
    const chart = $("#habit-chart");
    if (!chart) return;
    chart.innerHTML = "";

    const dayLabels = ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"];
    const pad = (n) => String(n).padStart(2, "0");
    const today = todayKey();
    const pcts = [];

    for (let i = HABIT_DAYS - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const entry = habitHistory[key];
      const hasData = entry && entry.total > 0;
      const pct = hasData ? Math.round((entry.done / entry.total) * 100) : 0;
      if (hasData) pcts.push(pct);

      const col = document.createElement("div");
      col.className = "habit-col" + (hasData ? "" : " empty") + (key === today ? " today" : "");

      const pctEl = document.createElement("div");
      pctEl.className = "habit-pct";
      pctEl.textContent = hasData ? pct + "%" : "–";

      const wrap = document.createElement("div");
      wrap.className = "habit-barwrap";
      const track = document.createElement("div");
      track.className = "habit-track";
      const bar = document.createElement("div");
      bar.className = "habit-bar";
      requestAnimationFrame(() => {
        bar.style.height = hasData ? pct + "%" : "0%";
      });
      track.appendChild(bar);
      wrap.appendChild(track);

      const dayEl = document.createElement("div");
      dayEl.className = "habit-day";
      dayEl.textContent = dayLabels[d.getDay()];

      col.append(pctEl, wrap, dayEl);
      chart.appendChild(col);
    }

    const avgEl = $("#habits-avg");
    if (pcts.length) {
      const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
      avgEl.textContent = "Moy. " + avg + "%";
      avgEl.classList.toggle("complete", avg === 100);
    } else {
      avgEl.textContent = "—";
      avgEl.classList.remove("complete");
    }
  }

  function renderHeader() {
    $("#today-label").textContent = new Date().toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  function render() {
    renderHeader();
    renderGroups();
    renderHabits();
  }

  // ----------------------------------------------------------------
  // Notifications push : abonnement + test
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
    const testBtn = $("#test-notif");

    const granted = notifSupported() && Notification.permission === "granted";
    testBtn.classList.toggle("hidden", !granted);

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
    } catch (err) {
      console.error(err);
      showToast("Echec de l'activation des notifications");
    } finally {
      updateNotifBanner();
    }
  }

  async function testNotification() {
    if (!notifSupported() || Notification.permission !== "granted") {
      showToast("Active d'abord les notifications");
      return;
    }
    const btn = $("#test-notif");
    btn.disabled = true;
    showToast("Envoi du test...");
    try {
      const res = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: deviceId() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showToast("Push envoye ! Verrouille l'ecran pour le voir arriver.");
      } else {
        showToast("Echec : " + (data.error || data.status || res.status));
      }
    } catch (err) {
      console.error(err);
      showToast("Erreur reseau (pas de connexion ?)");
    } finally {
      btn.disabled = false;
    }
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

      const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      $("#splash-quote").textContent = "« " + q.text + " »";
      $("#splash-author").textContent = q.author ? "— " + q.author : "";

      el.classList.add("counting");

      let ready = false;
      const unlock = () => {
        ready = true;
        el.classList.add("ready");
        $("#splash-hint").textContent = "Touchez l'ecran pour continuer";
      };
      const timer = setTimeout(unlock, 5000);

      const dismiss = () => {
        if (!ready) return;
        clearTimeout(timer);
        el.classList.add("closing");
        el.removeEventListener("click", dismiss);
        setTimeout(() => el.classList.add("hidden"), 350);
      };
      el.addEventListener("click", dismiss);
    },
  };

  // ----------------------------------------------------------------
  // Branchement des evenements
  // ----------------------------------------------------------------
  function bindEvents() {
    // formulaires d'ajout de chaque groupe
    document.querySelectorAll(".daily-add").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const key = form.dataset.add;
        const input = form.querySelector(".daily-input");
        addItem(key, input.value);
        input.value = "";
        input.focus();
      });
    });

    // notifications
    $("#enable-notif").addEventListener("click", enableNotifications);
    $("#test-notif").addEventListener("click", testNotification);

    // recalcul periodique + au retour au premier plan (changement de jour)
    setInterval(() => {
      if (!document.hidden) render();
    }, 30_000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) render();
    });
  }

  // ----------------------------------------------------------------
  // Demarrage
  // ----------------------------------------------------------------
  function start() {
    Splash.start();
    loadGroups();
    loadHistory();
    loadGroupsState();
    recordHabitToday();
    bindEvents();
    render();
    registerSW();
    loadConfig();
    updateNotifBanner();
  }

  document.addEventListener("DOMContentLoaded", start);
})();
