import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, collectionGroup, doc, getDoc, setDoc, addDoc,
  updateDoc, deleteDoc, deleteField, onSnapshot, query, orderBy, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, TEAM_NAME } from "./firebase-config.js";
import { VERSION, CHANGELOG } from "./changelog.js";
import {
  GAMES, MAX_PLAYERS, POINTS_PER_WIN, drawSchedule, computeStandings, tournamentStatus
} from "./tournament.js";

/* ---------- základ ---------- */

document.title = TEAM_NAME;
const $app = document.getElementById("app");
const $dlg = document.getElementById("dlg");
const $toast = document.getElementById("toast");

const TYPES = {
  training: { label: "Trénink", icon: "🎯" },
  match:    { label: "Zápas",   icon: "🏆" },
  party:    { label: "Akce",    icon: "🎉" },
  other:    { label: "Jiné",    icon: "📌" }
};

const state = {
  user: null,          // Firebase Auth uživatel
  me: null,            // můj dokument z kolekce users
  users: new Map(),    // uid -> dokument
  private: new Map(),  // uid -> {email}, jen pro správce
  events: [],          // seřazeno podle startsAt
  tournaments: [],     // nejnovější první
  tid: null,           // otevřený turnaj
  rsvps: new Map(),    // eventId -> Map(uid -> {status, note})
  view: "events",
  showPast: false,
  expanded: new Set(),
  pendingName: null,
  dataOn: false,
  ready: { users: false, events: false, rsvps: false, tournaments: false },
  privChecked: false,
  creating: false
};

let auth, db;
let authUnsubs = [];
let dataUnsubs = [];
let privUnsub = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const isMemberRole = (r) => r === "member" || r === "admin";
const byName = (a, b) => a.displayName.localeCompare(b.displayName, "cs");

function toast(msg) {
  if (!msg) return;
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove("show"), 3800);
}

function errMsg(e) {
  const c = e?.code || "";
  if (c.includes("permission-denied")) return "Na tohle nemáš oprávnění.";
  if (c.includes("unavailable") || c.includes("network")) return "Chybí připojení. Zkus to za chvíli.";
  return "Něco se nepovedlo: " + (e?.message || c || "neznámá chyba");
}

function authMsg(e) {
  const c = e?.code || "";
  if (c.includes("popup-closed") || c.includes("cancelled-popup")) return "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "Špatný e-mail nebo heslo.";
  if (c.includes("email-already-in-use")) return "Tenhle e-mail už má účet. Zkus se přihlásit.";
  if (c.includes("weak-password")) return "Heslo musí mít aspoň 6 znaků.";
  if (c.includes("invalid-email")) return "E-mail nemá správný tvar.";
  if (c.includes("unauthorized-domain"))
    return "Tuhle doménu přidej ve Firebase: Authentication, Settings, Authorized domains.";
  if (c.includes("operation-not-allowed")) return "Tenhle způsob přihlášení není ve Firebase zapnutý.";
  if (c.includes("too-many-requests")) return "Moc pokusů. Zkus to za chvíli.";
  return "Přihlášení se nepovedlo: " + (e?.message || c);
}

/* ---------- datum a čas ---------- */

const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const defaultStart = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d;
};
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
function daysUntil(d) {
  const b = new Date(d);
  b.setHours(0, 0, 0, 0);
  return Math.round((b - startOfToday()) / 86400000);
}
function untilText(n) {
  if (n === 0) return "Dnes";
  if (n === 1) return "Zítra";
  if (n >= 2 && n <= 4) return `Za ${n} dny`;
  if (n > 4) return `Za ${n} dní`;
  return "Proběhlo";
}
const weekdayShort = (d) => d.toLocaleDateString("cs-CZ", { weekday: "short" });
const weekdayLong = (d) => d.toLocaleDateString("cs-CZ", { weekday: "long" });
const timeText = (d) => `${d.getHours()}:${pad(d.getMinutes())}`;

/* ---------- start ---------- */

const configured = firebaseConfig.apiKey && firebaseConfig.projectId;
if (!configured) {
  renderSetup();
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.languageCode = "cs";
  try {
    // Data se ukládají i do telefonu, takže se při dalším spuštění ukážou hned.
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (e) {
    console.warn("Lokální paměť není k dispozici, jedu bez ní.", e);
    db = getFirestore(app);
  }
  onAuthStateChanged(auth, onAuth);
}

async function onAuth(user) {
  authUnsubs.forEach((u) => u());
  authUnsubs = [];
  stopData();
  state.user = user;
  state.me = null;
  state.privChecked = false;

  if (!user) {
    renderLogin();
    return;
  }
  renderLoading();

  // Žádné čekání na dotazy za sebou: profil se sleduje rovnou a vše ostatní se dělá na pozadí.
  const ref = doc(db, "users", user.uid);
  authUnsubs.push(onSnapshot(ref, (s) => {
    if (!s.exists()) {
      state.me = null;
      if (!s.metadata.fromCache) createProfile(user); // jen když to potvrdil server
      render();
      return;
    }
    state.me = { id: s.id, ...s.data() };
    ensurePrivate(user);
    if (isMemberRole(state.me.role)) startData();
    else stopData();
    syncPrivate();
    render();
  }, (e) => renderFatal("Nepodařilo se načíst tvůj účet. Zkontroluj pravidla Firestore a připojení.", e)));
}

async function createProfile(user) {
  if (state.creating) return;
  state.creating = true;
  try {
    const name = (state.pendingName || user.displayName || (user.email || "").split("@")[0] || "Hráč")
      .trim().slice(0, 40) || "Hráč";
    await setDoc(doc(db, "users", user.uid), {
      displayName: name,
      role: "pending",
      createdAt: serverTimestamp()
    });
    state.pendingName = null;
  } catch (e) {
    renderFatal("Nepodařilo se založit tvůj účet. Zkontroluj pravidla Firestore a připojení.", e);
  } finally {
    state.creating = false;
  }
}

// E-mail je zvlášť, čte ho jen jeho majitel a správce. Děje se na pozadí.
async function ensurePrivate(user) {
  if (state.privChecked || !user.email) return;
  state.privChecked = true;
  try {
    const pref = doc(db, "userPrivate", user.uid);
    const snap = await getDoc(pref);
    if (!snap.exists()) await setDoc(pref, { email: user.email });
  } catch (e) {
    console.warn("Uložení e-mailu se nepovedlo.", e);
  }
}

function startData() {
  if (state.dataOn) return;
  state.dataOn = true;
  const onErr = (e) => toast(errMsg(e));

  dataUnsubs.push(onSnapshot(collection(db, "users"), (s) => {
    state.users = new Map(s.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    state.ready.users = true;
    render();
  }, onErr));

  dataUnsubs.push(onSnapshot(query(collection(db, "events"), orderBy("startsAt")), (s) => {
    state.events = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.ready.events = true;
    render();
  }, onErr));

  dataUnsubs.push(onSnapshot(query(collection(db, "tournaments"), orderBy("date", "desc")), (s) => {
    state.tournaments = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.ready.tournaments = true;
    render();
  }, (e) => {
    // Kdyby chyběla nová pravidla ve Firebase, zbytek aplikace musí dál fungovat.
    state.ready.tournaments = true;
    render();
    toast(errMsg(e));
  }));

  dataUnsubs.push(onSnapshot(collectionGroup(db, "rsvps"), (s) => {
    const m = new Map();
    s.docs.forEach((d) => {
      const eid = d.ref.parent.parent.id;
      if (!m.has(eid)) m.set(eid, new Map());
      m.get(eid).set(d.id, d.data());
    });
    state.rsvps = m;
    state.ready.rsvps = true;
    render();
  }, onErr));
}

function syncPrivate() {
  const admin = state.me?.role === "admin";
  if (admin && !privUnsub) {
    privUnsub = onSnapshot(collection(db, "userPrivate"), (s) => {
      state.private = new Map(s.docs.map((d) => [d.id, d.data()]));
      render();
    }, (e) => toast(errMsg(e)));
  } else if (!admin && privUnsub) {
    privUnsub();
    privUnsub = null;
    state.private = new Map();
  }
}

function stopData() {
  dataUnsubs.forEach((u) => u());
  dataUnsubs = [];
  if (privUnsub) { privUnsub(); privUnsub = null; }
  state.private = new Map();
  state.dataOn = false;
  state.users = new Map();
  state.events = [];
  state.rsvps = new Map();
  state.tournaments = [];
  state.tid = null;
  state.ready = { users: false, events: false, rsvps: false, tournaments: false };
}

/* ---------- vykreslování ---------- */

// Aplikace přidaná na plochu iPhonu: Google okno tu často nefunguje.
const STANDALONE = window.navigator.standalone === true ||
  window.matchMedia("(display-mode: standalone)").matches;

const svgIcon = (inner) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  events: svgIcon('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  tournaments: svgIcon('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M9 20h6M10 17h4"/>'),
  team: svgIcon('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><circle cx="17.2" cy="9.5" r="2.4"/><path d="M17 14.2c2.2.2 3.7 1.6 4.2 4.3"/>')
};

const initials = (name) =>
  (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const hue = (name) => {
  let h = 0;
  for (const c of name || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 4;
};
const avatar = (name) => `<span class="av c${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
const logo = (cls = "", size = 36) =>
  `<img class="logo ${cls}" src="icons/icon.svg" alt="" width="${size}" height="${size}">`;

let raf = 0;
function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}

function draw() {
  if (!state.user) return;
  if (!state.me) return renderLoading();
  if (!isMemberRole(state.me.role)) return renderPending();
  const y = window.scrollY;
  const r = state.ready;
  const ok = state.view === "team" ? r.users
    : state.view === "tournaments" ? r.users && r.tournaments
    : r.users && r.events && r.rsvps;
  const body = ok
    ? (state.view === "team" ? viewTeam() : state.view === "tournaments" ? viewTournaments() : viewEvents())
    : `<p class="muted">Načítám…</p>`;
  $app.innerHTML = shell(body);
  window.scrollTo(0, y);
}

function renderSetup() {
  $app.innerHTML = `
    <main class="center">
      ${logo("big-logo", 88)}
      <h1>${esc(TEAM_NAME)}</h1>
      <p>Chybí propojení s Firebase. Doplň údaje do souboru <code>js/firebase-config.js</code>. Postup je v souboru README.md.</p>
    </main>`;
}

function renderLoading() {
  $app.innerHTML = `<main class="center">${logo("big-logo", 88)}<p class="muted">Načítám…</p></main>`;
}

function renderFatal(msg, e) {
  console.error(e);
  $app.innerHTML = `
    <main class="center">
      <h1>Něco se pokazilo</h1>
      <p>${esc(msg)}</p>
      <p class="muted">${esc(e?.message || "")}</p>
      <button class="btn" data-action="logout">Odhlásit se</button>
    </main>`;
}

function renderLogin(mode = "login", message = "") {
  const reg = mode === "register";
  $app.innerHTML = `
    <main class="login">
      ${logo("big-logo", 96)}
      <h1 class="big">${esc(TEAM_NAME)}</h1>
      <p class="lead">Události, zápasy a turnaje na jednom místě. Přihlas se, ať víme, kdo jsi.</p>
      ${STANDALONE
        ? `<p class="note">V aplikaci z plochy se přihlas e-mailem a heslem, Google okno se tu na iPhonu často nepovede. Máš účet přes Google? Napiš svůj e-mail a zkus „Zapomenuté heslo“, přijde odkaz na nastavení hesla.</p>`
        : `<button class="btn primary wide" data-action="google">Přihlásit se přes Google</button>
           <p class="or">nebo e-mailem</p>`}
      <form id="emailForm" class="stack" data-mode="${mode}">
        ${reg ? `<label>Jméno<input name="name" required maxlength="40" autocomplete="name" placeholder="Jak ti říkají v týmu"></label>` : ""}
        <label>E-mail<input type="email" name="email" required autocomplete="email" autocapitalize="off"></label>
        <label>Heslo<input type="password" name="password" required minlength="6" autocomplete="${reg ? "new-password" : "current-password"}"></label>
        <button class="btn ${STANDALONE ? "primary" : ""} wide" type="submit">${reg ? "Vytvořit účet" : "Přihlásit se"}</button>
      </form>
      <div class="switch">
        ${reg
          ? `<span>Už máš účet?</span> <button class="link" data-action="mode" data-mode="login">Přihlásit se</button>`
          : `<span>Nemáš účet?</span> <button class="link" data-action="mode" data-mode="register">Vytvořit účet</button>
             <button class="link" data-action="reset">Zapomenuté heslo</button>`}
      </div>
      <p class="error" id="loginError" role="alert">${esc(message)}</p>
    </main>`;
}

function renderPending() {
  $app.innerHTML = `
    <main class="center">
      ${logo("big-logo", 88)}
      <h1>Čekáš na schválení</h1>
      <p>Ahoj ${esc(state.me.displayName)}, účet máš založený. Správce týmu tě ještě musí pustit dál.</p>
      <p class="muted">Jakmile to udělá, stránka se sama obnoví.</p>
      <button class="btn" data-action="logout">Odhlásit se</button>
    </main>`;
}

function shell(inner) {
  const admin = state.me.role === "admin";
  const pending = admin ? [...state.users.values()].filter((u) => u.role === "pending").length : 0;
  const tab = (v, label) => `
    <button class="tab ${state.view === v ? "on" : ""}" data-action="nav" data-view="${v}" ${state.view === v ? 'aria-current="page"' : ""}>
      <span class="tab-ic">${ICONS[v]}${v === "team" && pending ? `<span class="badge" aria-label="${pending} čeká na schválení">${pending}</span>` : ""}</span>
      <span>${label}</span>
    </button>`;
  return `
    <header class="top">
      <div class="top-in">
        ${logo("", 36)}
        <div class="brand">${esc(TEAM_NAME)}</div>
        <span title="${esc(state.me.displayName)}">${avatar(state.me.displayName)}</span>
      </div>
    </header>
    <main>${inner}</main>
    <nav class="tabbar" aria-label="Hlavní menu"><div class="tabbar-in">
      ${tab("events", "Události")}${tab("tournaments", "Turnaje")}${tab("team", "Tým")}
    </div></nav>`;
}

/* ----- události ----- */

function viewEvents() {
  const t0 = startOfToday();
  const upcoming = state.events.filter((e) => e.startsAt.toDate() >= t0);
  const past = state.events.filter((e) => e.startsAt.toDate() < t0).reverse();

  let html = `<div class="bar"><h1>Události</h1><button class="btn primary" data-action="new-event">Nová událost</button></div>`;

  if (!upcoming.length) {
    html += `<div class="empty"><p><strong>Zatím nic v plánu.</strong></p><p>Vytvoř trénink, zápas nebo třeba oslavu a tým si pro ni hned odhlasuje, kdo může.</p></div>`;
  } else {
    html += eventCard(upcoming[0], true);
    if (upcoming.length > 1) {
      html += `<h2>Další události</h2><div class="list">${upcoming.slice(1).map((e) => eventCard(e)).join("")}</div>`;
    }
  }

  if (past.length) {
    html += `<p class="past-toggle"><button class="link" data-action="toggle-past">${state.showPast ? "Skrýt proběhlé" : `Zobrazit proběhlé (${past.length})`}</button></p>`;
    if (state.showPast) html += `<div class="list past">${past.map((e) => eventCard(e)).join("")}</div>`;
  }
  return html;
}

function eventCard(ev, hero = false) {
  const t = TYPES[ev.type] || TYPES.other;
  const d = ev.startsAt.toDate();
  const members = [...state.users.values()].filter((u) => isMemberRole(u.role)).sort(byName);
  const votes = state.rsvps.get(ev.id) || new Map();
  const yes = members.filter((u) => votes.get(u.id)?.status === "yes");
  const no = members.filter((u) => votes.get(u.id)?.status === "no");
  const none = members.filter((u) => !votes.has(u.id));
  const mine = votes.get(state.user.uid);
  const canEdit = state.me.role === "admin" || ev.createdBy === state.user.uid;
  const open = state.expanded.has(ev.id);
  const n = daysUntil(d);
  const title = ev.title || t.label;

  const person = (u) => {
    const note = votes.get(u.id)?.note;
    return `<li>${esc(u.displayName)}${note ? ` <small>${esc(note)}</small>` : ""}</li>`;
  };
  const group = (label, list, cls) =>
    `<div class="grp ${cls}"><h4>${label} (${list.length})</h4>${list.length ? `<ul>${list.map(person).join("")}</ul>` : `<p class="muted">Nikdo.</p>`}</div>`;

  const dateTile = `
    <div class="date" aria-hidden="true">
      <span class="dow">${esc(weekdayShort(d))}</span>
      <span class="day">${d.getDate()}</span>
      <span class="mon">${d.getMonth() + 1}.</span>
    </div>`;

  const rsvp = `
    <div class="rsvp">
      <button class="btn yes ${mine?.status === "yes" ? "on" : ""}" data-action="rsvp" data-id="${ev.id}" data-status="yes" aria-pressed="${mine?.status === "yes"}">Můžu</button>
      <button class="btn no ${mine?.status === "no" ? "on" : ""}" data-action="rsvp" data-id="${ev.id}" data-status="no" aria-pressed="${mine?.status === "no"}">Nemůžu</button>
      ${mine ? `<button class="btn ghost" data-action="note" data-id="${ev.id}">${mine.note ? "Upravit poznámku" : "Přidat poznámku"}</button>` : ""}
    </div>`;

  const meter = `
    <div class="meter" aria-hidden="true">
      <i class="y" style="flex-grow:${yes.length}"></i><i class="n" style="flex-grow:${no.length}"></i>
    </div>`;

  const tally = `
    ${meter}
    <button class="tally" data-action="toggle" data-id="${ev.id}" aria-expanded="${open}">
      <span class="ty">Můžou <b>${yes.length}</b></span>
      <span class="tn">Nemůžou <b>${no.length}</b></span>
      <span>Nehlasovali <b>${none.length}</b></span>
      <span class="more">${open ? "Skrýt" : "Kdo přesně"}</span>
    </button>
    ${open ? `<div class="voters">${group("Můžou", yes, "yes")}${group("Nemůžou", no, "no")}${group("Nehlasovali", none, "none")}</div>` : ""}`;

  const details = `
    <p class="when">${esc(weekdayLong(d))} ${d.getDate()}. ${d.getMonth() + 1}. v ${timeText(d)}</p>
    ${ev.location ? `<p class="where">📍 ${esc(ev.location)}</p>` : ""}
    ${ev.notes ? `<p class="notes">${esc(ev.notes)}</p>` : ""}`;

  const edit = canEdit ? `<button class="link edit" data-action="edit-event" data-id="${ev.id}">Upravit</button>` : "";

  if (hero) {
    return `
      <article class="event hero t-${esc(ev.type)}">
        <p class="until">${untilText(n)}</p>
        <div class="head"><h2 class="title">${t.icon} ${esc(title)}</h2>${edit}</div>
        ${details}
        ${rsvp}
        ${tally}
      </article>`;
  }
  return `
    <article class="event t-${esc(ev.type)} ${n < 0 ? "gone" : ""}">
      ${dateTile}
      <div class="body">
        <div class="head"><h3 class="title">${t.icon} ${esc(title)}</h3>${edit}</div>
        ${details}
        ${n >= 0 ? rsvp : ""}
        ${tally}
      </div>
    </article>`;
}

/* ----- turnaje ----- */

const canManageTour = (t) => state.me.role === "admin" || t.createdBy === state.user.uid;
const dateText = (ts) => {
  const d = ts.toDate();
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
};

function viewTournaments() {
  if (state.tid) {
    const t = state.tournaments.find((x) => x.id === state.tid);
    if (t) return viewTournament(t);
    state.tid = null;
  }
  let html = `<div class="bar"><h1>Turnaje</h1><button class="btn primary" data-action="tour-new">Nový turnaj</button></div>`;
  if (!state.tournaments.length) {
    html += `<div class="empty"><p><strong>Zatím žádný turnaj.</strong></p><p>Založ turnaj, vyber hráče a hru a appka je nalosuje každý s každým.</p></div>`;
  } else {
    html += `<div class="list">${state.tournaments.map(tourCard).join("")}</div>`;
  }
  return html;
}

function winnersOf(t) {
  const { rows } = computeStandings(t.players || [], t.matches || [], t.results || {});
  return rows.filter((r) => r.rank === 1).map((r) => r.name);
}
const joinNames = (names) => names.length > 2
  ? `${names.slice(0, -1).join(", ")} a ${names[names.length - 1]}`
  : names.join(" a ");

function tourCard(t) {
  const st = tournamentStatus(t);
  const label = st.state === "draft" ? "Příprava, čeká na losování"
    : st.state === "running" ? `Probíhá, odehráno ${st.played} z ${st.total}`
    : `Dokončeno, vítěz ${joinNames(winnersOf(t))}`;
  const pct = st.total ? Math.round((st.played / st.total) * 100) : 0;
  return `
    <button class="tour ${st.state}" data-action="tour-open" data-id="${t.id}">
      <span class="tour-head"><strong class="tour-name">${esc(t.name)}</strong><span class="gamechip">${esc(GAMES[t.game] || t.game)}</span></span>
      <span class="muted">${dateText(t.date)}, ${(t.players || []).length} hráčů</span>
      <span class="tour-state">${st.state === "finished" ? "🏆 " : ""}${esc(label)}</span>
      ${st.total ? `<span class="meter" aria-hidden="true"><i class="y" style="flex-grow:${pct}"></i><i style="flex-grow:${100 - pct}"></i></span>` : ""}
    </button>`;
}

function viewTournament(t) {
  const players = t.players || [];
  const matches = t.matches || [];
  const results = t.results || {};
  const st = tournamentStatus(t);
  const manage = canManageTour(t);
  const names = new Map(players.map((p) => [p.id, p.name]));

  let html = `
    <p class="crumb"><button class="link" data-action="tour-back">‹ Všechny turnaje</button></p>
    <div class="bar">
      <div>
        <h1>${esc(t.name)}</h1>
        <p class="meta"><span class="gamechip">${esc(GAMES[t.game] || t.game)}</span> <span class="muted">${dateText(t.date)}${t.double ? ", s odvetami" : ""}</span></p>
      </div>
      ${manage ? `<button class="btn" data-action="tour-edit" data-id="${t.id}">Upravit</button>` : ""}
    </div>`;

  if (st.state === "draft") {
    html += `<h2>Hráči (${players.length})</h2>`;
    html += players.length
      ? `<ul class="plist">${players.map((p) => `<li>${avatar(p.name)}<span>${esc(p.name)}${p.uid ? "" : ` <small class="muted">host</small>`}</span></li>`).join("")}</ul>`
      : `<div class="empty"><p>Zatím tu nejsou žádní hráči.</p></div>`;
    if (manage) {
      html += players.length < 2
        ? `<p class="muted">Přidej aspoň dva hráče, pak jde turnaj nalosovat. Hráče upravíš tlačítkem Upravit.</p>`
        : `<p class="draw-row"><button class="btn primary wide" data-action="tour-draw" data-id="${t.id}">Nalosovat turnaj</button></p>
           <p class="muted">Rozpis se vylosuje náhodně. Každý hraje s každým${t.double ? " dvakrát (odveta)" : ""}.</p>`;
    } else {
      html += `<p class="muted">Turnaj se ještě nelosoval.</p>`;
    }
    return html;
  }

  // tabulka
  const { rows } = computeStandings(players, matches, results);
  if (st.state === "finished") {
    const w = winnersOf(t);
    html += `<p class="champion">🏆 ${w.length > 1 ? "Shoda na prvním místě" : "Vítěz turnaje"}: <strong>${esc(joinNames(w))}</strong></p>`;
  }
  html += `<h2>Tabulka</h2>
    <div class="tablewrap"><table class="standings">
      <thead><tr><th>#</th><th>Hráč</th><th>Z</th><th>V</th><th>P</th><th>Body</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr class="${r.rank === 1 && st.state === "finished" ? "first" : ""}">
          <td>${st.played ? `${r.rank}.` : "–"}</td><td class="nm">${esc(r.name)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td><b>${r.points}</b></td>
        </tr>`).join("")}</tbody>
    </table></div>
    <p class="muted legend">Z zápasy, V výhry, P prohry. Výhra = ${POINTS_PER_WIN} body. Při shodě bodů rozhoduje vzájemný zápas.</p>`;

  // zápasy jeden za druhým
  html += `<h2>Zápasy</h2><p class="muted">Odehráno ${st.played} z ${st.total}.${manage ? " Klepnutím na zápas zadáš vítěze." : ""}</p><div class="matches">`;
  matches.forEach((m, i) => {
    const res = results[m.id];
    const done = !!res?.winner;
    const aWin = done && res.winner === m.a;
    const bWin = done && res.winner === m.b;
    const inner = `
      <span class="no">${i + 1}</span>
      <span class="side a ${aWin ? "win" : done ? "lose" : ""}">${esc(names.get(m.a) || "?")}</span>
      <span class="score">${done ? "✓" : "vs"}</span>
      <span class="side b ${bWin ? "win" : done ? "lose" : ""}">${esc(names.get(m.b) || "?")}</span>`;
    html += manage
      ? `<button class="match ${done ? "done" : ""}" data-action="match" data-id="${t.id}" data-mid="${m.id}">${inner}</button>`
      : `<div class="match ${done ? "done" : ""}">${inner}</div>`;
  });
  html += `</div>`;
  if (manage) {
    html += `<p class="redraw"><button class="link" data-action="tour-draw" data-id="${t.id}">Nalosovat znovu</button></p>`;
  }
  return html;
}

/* ----- tým ----- */

function viewTeam() {
  const all = [...state.users.values()];
  const members = all.filter((u) => isMemberRole(u.role)).sort(byName);
  const pending = all.filter((u) => u.role === "pending").sort(byName);
  const admin = state.me.role === "admin";
  const mail = (u) => state.private.get(u.id)?.email || "";

  let html = `<div class="bar"><h1>Tým</h1><button class="btn" data-action="rename">Změnit jméno</button></div>`;

  if (admin && pending.length) {
    html += `<h2>Čekají na schválení</h2><div class="rows">${pending.map((u) => `
      <div class="row">
        <div class="who">${avatar(u.displayName)}<div><strong>${esc(u.displayName)}</strong>${mail(u) ? `<br><small class="muted">${esc(mail(u))}</small>` : ""}</div></div>
        <div class="row-actions">
          <button class="btn primary" data-action="approve" data-uid="${u.id}">Schválit</button>
          <button class="btn" data-action="reject" data-uid="${u.id}">Odmítnout</button>
        </div>
      </div>`).join("")}</div>`;
  }

  html += `<h2>Členové (${members.length})</h2><div class="rows">${members.map((u) => {
    const self = u.id === state.user.uid;
    return `
      <div class="row">
        <div class="who">
          ${avatar(u.displayName)}
          <div>
            <strong>${esc(u.displayName)}</strong>${self ? ` <small class="muted">(ty)</small>` : ""}
            ${admin && mail(u) ? `<br><small class="muted">${esc(mail(u))}</small>` : ""}
          </div>
        </div>
        <div class="row-actions">
          ${admin && !self
            ? `<select data-action="set-role" data-uid="${u.id}" aria-label="Role: ${esc(u.displayName)}">
                 <option value="member" ${u.role === "member" ? "selected" : ""}>Člen</option>
                 <option value="admin" ${u.role === "admin" ? "selected" : ""}>Správce</option>
               </select>
               <button class="link danger" data-action="remove" data-uid="${u.id}">Odebrat</button>`
            : `<span class="role ${u.role}">${u.role === "admin" ? "Správce" : "Člen"}</span>`}
        </div>
      </div>`;
  }).join("")}</div>
  <p class="logout"><button class="btn" data-action="logout">Odhlásit se</button></p>
  <p class="version"><button class="link" data-action="changelog">Verze ${esc(VERSION)}, co je nového</button></p>`;

  return html;
}

/* ---------- dialogy ---------- */

function closeDialog() {
  if ($dlg.open) $dlg.close();
}
$dlg.addEventListener("click", (e) => {
  if (e.target === $dlg) closeDialog();
});

function openEventDialog(id) {
  const ev = id ? state.events.find((e) => e.id === id) : null;
  const d = ev ? ev.startsAt.toDate() : defaultStart();
  const curType = ev?.type || "training";
  $dlg.innerHTML = `
    <form id="evForm" class="stack" data-id="${id || ""}">
      <h2>${ev ? "Upravit událost" : "Nová událost"}</h2>
      <fieldset class="types">
        <legend>Druh</legend>
        ${Object.entries(TYPES).map(([k, t]) => `
          <label class="chip"><input type="radio" name="type" value="${k}" ${k === curType ? "checked" : ""}><span>${t.icon} ${t.label}</span></label>`).join("")}
      </fieldset>
      <label>Název<input name="title" maxlength="80" placeholder="Např. Trénink na automatu" value="${esc(ev?.title || "")}"></label>
      <label>Kdy<input type="datetime-local" name="when" required value="${toLocalInput(d)}"></label>
      <label>Kde<input name="location" maxlength="120" placeholder="Např. Podchod klub, Brno" value="${esc(ev?.location || "")}"></label>
      <label>Poznámka<textarea name="notes" rows="3" maxlength="500" placeholder="Co přinést, kdo dělá občerstvení…">${esc(ev?.notes || "")}</textarea></label>
      <div class="actions">
        ${ev ? `<button type="button" class="btn danger" data-dlg="delete" data-id="${ev.id}">Smazat událost</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">Uložit událost</button>
      </div>
    </form>`;
  $dlg.showModal();
}

function openNoteDialog(id) {
  const cur = state.rsvps.get(id)?.get(state.user.uid);
  $dlg.innerHTML = `
    <form id="noteForm" class="stack" data-id="${id}">
      <h2>Poznámka k hlasování</h2>
      <label>Poznámka<input name="note" maxlength="200" placeholder="Např. dorazím později" value="${esc(cur?.note || "")}" autofocus></label>
      <div class="actions">
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">Uložit poznámku</button>
      </div>
    </form>`;
  $dlg.showModal();
}

let dlgGuests = [];

function updatePlayerCount() {
  const el = document.getElementById("pcount");
  if (!el) return;
  const n = document.querySelectorAll("#tourForm input[name=member]:checked").length + dlgGuests.length;
  el.textContent = `(${n} z ${MAX_PLAYERS})`;
}

function renderGuests() {
  const el = document.getElementById("guestList");
  if (!el) return;
  el.innerHTML = dlgGuests.map((g) =>
    `<span class="gchip">${esc(g.name)} <small class="muted">host</small><button type="button" data-dlg="rmguest" data-gid="${esc(g.id)}" aria-label="Odebrat hosta ${esc(g.name)}">×</button></span>`).join("");
  updatePlayerCount();
}

function addGuest() {
  const input = document.getElementById("guestName");
  const name = (input?.value || "").trim().slice(0, 30);
  if (!name) return;
  const members = document.querySelectorAll("#tourForm input[name=member]:checked").length;
  if (members + dlgGuests.length >= MAX_PLAYERS) { toast(`Nejvíc ${MAX_PLAYERS} hráčů.`); return; }
  dlgGuests.push({ id: "g" + Date.now().toString(36) + dlgGuests.length, name });
  input.value = "";
  renderGuests();
}

function openTournamentDialog(id) {
  const t = id ? state.tournaments.find((x) => x.id === id) : null;
  const draft = !t || !(t.matches || []).length;
  dlgGuests = t ? (t.players || []).filter((p) => !p.uid).map((p) => ({ id: p.id, name: p.name })) : [];
  const selected = new Set(t ? (t.players || []).filter((p) => p.uid).map((p) => p.uid) : []);
  const members = [...state.users.values()].filter((u) => isMemberRole(u.role)).sort(byName);
  const d = t ? t.date.toDate() : new Date();
  const dateVal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const curGame = t?.game || "501-do";

  $dlg.innerHTML = `
    <form id="tourForm" class="stack" data-id="${t?.id || ""}">
      <h2>${t ? "Upravit turnaj" : "Nový turnaj"}</h2>
      <label>Název<input name="name" maxlength="60" placeholder="Např. Páteční turnaj" value="${esc(t?.name || "")}"></label>
      <fieldset class="types">
        <legend>Hra</legend>
        ${Object.entries(GAMES).map(([k, label]) => `
          <label class="chip"><input type="radio" name="game" value="${k}" ${k === curGame ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}
      </fieldset>
      <label>Datum<input type="date" name="date" required value="${dateVal}"></label>
      ${draft ? `
      <label class="check"><input type="checkbox" name="double" ${t?.double ? "checked" : ""}><span>Odveta (každá dvojice hraje dvakrát)</span></label>
      <fieldset class="players">
        <legend>Hráči <span id="pcount" class="muted"></span></legend>
        <div class="chips">${members.map((u) => `
          <label class="chip"><input type="checkbox" name="member" value="${u.id}" ${selected.has(u.id) ? "checked" : ""}><span>${esc(u.displayName)}</span></label>`).join("")}</div>
        <p class="sel-links"><button type="button" class="link" data-dlg="selall">Vybrat všechny</button> <button type="button" class="link" data-dlg="selnone">Zrušit výběr</button></p>
        <div class="addguest">
          <input id="guestName" maxlength="30" placeholder="Host bez účtu, jméno" aria-label="Jméno hosta">
          <button type="button" class="btn" data-dlg="addguest">Přidat</button>
        </div>
        <div id="guestList" class="chips"></div>
      </fieldset>` : `<p class="muted">Hráče už nejde měnit, turnaj je nalosovaný. Pro změnu hráčů turnaj smaž a založ nový.</p>`}
      <div class="actions">
        ${t ? `<button type="button" class="btn danger" data-dlg="tdelete" data-id="${t.id}">Smazat turnaj</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">${t ? "Uložit turnaj" : "Vytvořit turnaj"}</button>
      </div>
    </form>`;
  $dlg.showModal();
  renderGuests();
}

function openMatchDialog(tid, mid) {
  const t = state.tournaments.find((x) => x.id === tid);
  const m = t?.matches?.find((x) => x.id === mid);
  if (!t || !m) return;
  const names = new Map((t.players || []).map((p) => [p.id, p.name]));
  const res = t.results?.[mid];
  $dlg.innerHTML = `
    <form id="matchForm" class="stack" data-tid="${tid}" data-mid="${mid}">
      <h2>Kdo vyhrál?</h2>
      <p class="muted">${esc(GAMES[t.game] || "")}. Klepni na jméno vítěze.</p>
      <div class="duel">
        <button type="submit" name="winner" value="${esc(m.a)}" class="btn ${res?.winner === m.a ? "primary" : ""}">${esc(names.get(m.a) || "?")}</button>
        <span class="vs">vs</span>
        <button type="submit" name="winner" value="${esc(m.b)}" class="btn ${res?.winner === m.b ? "primary" : ""}">${esc(names.get(m.b) || "?")}</button>
      </div>
      <div class="actions">
        ${res ? `<button type="button" class="btn danger" data-dlg="mclear" data-tid="${tid}" data-mid="${mid}">Smazat výsledek</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zavřít</button>
      </div>
    </form>`;
  $dlg.showModal();
}

function openChangelogDialog() {
  $dlg.innerHTML = `
    <div class="changes">
      <h2>Historie verzí</h2>
      ${CHANGELOG.map((v) => `
        <h3>Verze ${esc(v.version)}<span class="date-note">${esc(v.date)}</span></h3>
        <ul>${v.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`).join("")}
      <div class="actions"><span class="spacer"></span><button type="button" class="btn" data-dlg="close">Zavřít</button></div>
    </div>`;
  $dlg.showModal();
}

function openRenameDialog() {
  $dlg.innerHTML = `
    <form id="nameForm" class="stack">
      <h2>Změnit jméno</h2>
      <label>Jméno v týmu<input name="name" required maxlength="40" value="${esc(state.me.displayName)}" autofocus></label>
      <div class="actions">
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">Uložit jméno</button>
      </div>
    </form>`;
  $dlg.showModal();
}

/* ---------- akce ---------- */

async function setRsvp(eventId, status) {
  const ref = doc(db, "events", eventId, "rsvps", state.user.uid);
  const cur = state.rsvps.get(eventId)?.get(state.user.uid);
  if (cur?.status === status) {
    await deleteDoc(ref); // druhé kliknutí hlas zruší
    return;
  }
  await setDoc(ref, { status, note: cur?.note || "", updatedAt: serverTimestamp() });
}

async function deleteEvent(id) {
  if (!confirm("Smazat událost i s hlasováním? Vrátit to nejde.")) return;
  const votes = state.rsvps.get(id);
  if (votes) {
    for (const uid of votes.keys()) await deleteDoc(doc(db, "events", id, "rsvps", uid));
  }
  await deleteDoc(doc(db, "events", id));
  closeDialog();
  toast("Událost je smazaná.");
}

async function drawTournament(id) {
  const t = state.tournaments.find((x) => x.id === id);
  if (!t) return;
  const players = t.players || [];
  if (players.length < 2) { toast("Přidej aspoň dva hráče."); return; }
  if ((t.matches || []).length) {
    const hasRes = Object.keys(t.results || {}).length > 0;
    const q = hasRes ? "Nalosovat znovu? Všechny zadané výsledky se smažou." : "Nalosovat znovu? Rozpis se změní.";
    if (!confirm(q)) return;
  }
  const matches = drawSchedule(players.map((p) => p.id), !!t.double);
  await updateDoc(doc(db, "tournaments", id), { matches, results: {} });
  toast("Turnaj je nalosovaný.");
}

async function deleteTournament(id) {
  if (!confirm("Smazat turnaj i s výsledky? Vrátit to nejde.")) return;
  await deleteDoc(doc(db, "tournaments", id));
  state.tid = null;
  closeDialog();
  toast("Turnaj je smazaný.");
}

document.addEventListener("click", async (e) => {
  const dl = e.target.closest("[data-dlg]");
  if (dl) {
    try {
      if (dl.dataset.dlg === "close") closeDialog();
      if (dl.dataset.dlg === "delete") await deleteEvent(dl.dataset.id);
      if (dl.dataset.dlg === "tdelete") await deleteTournament(dl.dataset.id);
      if (dl.dataset.dlg === "addguest") addGuest();
      if (dl.dataset.dlg === "rmguest") { dlgGuests = dlgGuests.filter((g) => g.id !== dl.dataset.gid); renderGuests(); }
      if (dl.dataset.dlg === "selall" || dl.dataset.dlg === "selnone") {
        const on = dl.dataset.dlg === "selall";
        let free = MAX_PLAYERS - dlgGuests.length;
        document.querySelectorAll("#tourForm input[name=member]").forEach((c) => {
          c.checked = on && free > 0;
          if (c.checked) free--;
        });
        updatePlayerCount();
      }
      if (dl.dataset.dlg === "mclear") {
        await updateDoc(doc(db, "tournaments", dl.dataset.tid), { [`results.${dl.dataset.mid}`]: deleteField() });
        closeDialog();
      }
    } catch (err) { toast(errMsg(err)); }
    return;
  }

  const t = e.target.closest("[data-action]");
  if (!t || t.tagName === "SELECT") return;
  const { action, id, status, view, uid, mode, mid } = t.dataset;

  try {
    switch (action) {
      case "google":
        try {
          await signInWithPopup(auth, new GoogleAuthProvider());
        } catch (err) {
          const m = authMsg(err);
          if (m) renderLogin("login", m);
        }
        break;
      case "mode": renderLogin(mode); break;
      case "reset": {
        const email = document.querySelector("#emailForm [name=email]")?.value.trim();
        if (!email) { renderLogin("login", "Nejdřív napiš e-mail do formuláře, pošleme na něj odkaz."); break; }
        try {
          await sendPasswordResetEmail(auth, email);
          renderLogin("login", "Poslali jsme ti e-mail s odkazem na nové heslo.");
        } catch (err) { renderLogin("login", authMsg(err)); }
        break;
      }
      case "logout":
        await signOut(auth);
        break;
      case "nav":
        if (view === "tournaments" && state.view === "tournaments") state.tid = null;
        state.view = view;
        render();
        break;
      case "toggle-past":
        state.showPast = !state.showPast;
        render();
        break;
      case "toggle":
        state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
        render();
        break;
      case "new-event": openEventDialog(); break;
      case "edit-event": openEventDialog(id); break;
      case "rsvp": await setRsvp(id, status); break;
      case "note":
        openNoteDialog(id);
        break;
      case "rename": openRenameDialog(); break;
      case "changelog": openChangelogDialog(); break;
      case "tour-new": openTournamentDialog(); break;
      case "tour-edit": openTournamentDialog(id); break;
      case "tour-open": state.tid = id; render(); window.scrollTo(0, 0); break;
      case "tour-back": state.tid = null; render(); window.scrollTo(0, 0); break;
      case "tour-draw": await drawTournament(id); break;
      case "match": openMatchDialog(id, mid); break;
      case "approve":
        await updateDoc(doc(db, "users", uid), { role: "member" });
        toast("Člen schválený.");
        break;
      case "reject":
      case "remove": {
        const u = state.users.get(uid);
        const q = action === "reject" ? "Odmítnout" : "Odebrat z týmu";
        if (!confirm(`${q}: ${u?.displayName || "uživatel"}?`)) break;
        await deleteDoc(doc(db, "users", uid));
        await deleteDoc(doc(db, "userPrivate", uid));
        break;
      }
    }
  } catch (err) {
    console.error(err);
    toast(errMsg(err));
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target.closest("[data-action='set-role']");
  if (!t) return;
  try {
    await updateDoc(doc(db, "users", t.dataset.uid), { role: t.value });
    toast("Role je změněná.");
  } catch (err) {
    toast(errMsg(err));
    render();
  }
});

document.addEventListener("change", (e) => {
  if (e.target.closest("#tourForm") && e.target.name === "member") {
    const checked = document.querySelectorAll("#tourForm input[name=member]:checked").length;
    if (checked + dlgGuests.length > MAX_PLAYERS) {
      e.target.checked = false;
      toast(`Nejvíc ${MAX_PLAYERS} hráčů.`);
    }
    updatePlayerCount();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "guestName") {
    e.preventDefault();
    addGuest();
  }
});

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  const fd = new FormData(f);
  if (btn) btn.disabled = true;

  try {
    if (f.id === "emailForm") {
      const email = fd.get("email").trim();
      const password = fd.get("password");
      try {
        if (f.dataset.mode === "register") {
          state.pendingName = (fd.get("name") || "").trim();
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          if (state.pendingName) await updateProfile(cred.user, { displayName: state.pendingName });
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
      } catch (err) {
        state.pendingName = null;
        renderLogin(f.dataset.mode, authMsg(err));
      }
      return;
    }

    if (f.id === "evForm") {
      const type = fd.get("type");
      const when = new Date(fd.get("when"));
      if (isNaN(when)) { toast("Zadej platné datum a čas."); return; }
      const data = {
        type,
        title: (fd.get("title") || "").trim() || TYPES[type].label,
        startsAt: Timestamp.fromDate(when),
        location: (fd.get("location") || "").trim(),
        notes: (fd.get("notes") || "").trim()
      };
      const id = f.dataset.id;
      if (id) {
        await updateDoc(doc(db, "events", id), data);
      } else {
        await addDoc(collection(db, "events"), {
          ...data, createdBy: state.user.uid, createdAt: serverTimestamp()
        });
      }
      closeDialog();
      toast("Událost je uložená.");
      return;
    }

    if (f.id === "noteForm") {
      await updateDoc(doc(db, "events", f.dataset.id, "rsvps", state.user.uid), {
        note: (fd.get("note") || "").trim().slice(0, 200),
        updatedAt: serverTimestamp()
      });
      closeDialog();
      return;
    }

    if (f.id === "tourForm") {
      const game = fd.get("game");
      const dv = fd.get("date");
      const when = new Date(`${dv}T12:00:00`);
      if (!GAMES[game] || isNaN(when)) { toast("Zvol hru a datum."); return; }
      const name = (fd.get("name") || "").trim().slice(0, 60)
        || `Turnaj ${when.getDate()}. ${when.getMonth() + 1}.`;
      const base = { name, game, date: Timestamp.fromDate(when) };
      const id = f.dataset.id;
      const hasPlayersUi = !!f.querySelector("input[name=member]") || !!document.getElementById("pcount");
      let extra = {};
      if (hasPlayersUi) {
        const ids = fd.getAll("member");
        const players = [
          ...ids.map((uid) => ({ id: uid, name: state.users.get(uid)?.displayName || "Hráč", uid })),
          ...dlgGuests.map((g) => ({ id: g.id, name: g.name, uid: null }))
        ];
        if (players.length > MAX_PLAYERS) { toast(`Nejvíc ${MAX_PLAYERS} hráčů.`); return; }
        extra = { players, double: fd.get("double") === "on" };
      }
      if (id) {
        await updateDoc(doc(db, "tournaments", id), { ...base, ...extra });
        toast("Turnaj je uložený.");
      } else {
        const ref = await addDoc(collection(db, "tournaments"), {
          ...base, double: false, players: [], ...extra, matches: [], results: {},
          createdBy: state.user.uid, createdAt: serverTimestamp()
        });
        state.view = "tournaments";
        state.tid = ref.id;
        window.scrollTo(0, 0);
        toast("Turnaj je založený.");
      }
      closeDialog();
      return;
    }

    if (f.id === "matchForm") {
      const winner = e.submitter?.value;
      if (!winner) return;
      await updateDoc(doc(db, "tournaments", f.dataset.tid), {
        [`results.${f.dataset.mid}`]: { winner }
      });
      closeDialog();
      return;
    }

    if (f.id === "nameForm") {
      const name = (fd.get("name") || "").trim().slice(0, 40);
      if (!name) return;
      await updateDoc(doc(db, "users", state.user.uid), { displayName: name });
      closeDialog();
      toast("Jméno je uložené.");
    }
  } catch (err) {
    console.error(err);
    toast(errMsg(err));
  } finally {
    if (btn) btn.disabled = false;
  }
});
