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
import {
  START, MISS, other, dartLabel, newLeg, remaining, turnOf, needsBull, curTotal, curRemaining,
  addDart, checkOpp, addOpp, endLeg, undo, isEmptyLeg, crossOf, sideStats, tally, matchState,
  roundSummary, playerTotals, pendingBeton, answerBeton, visitBetons, BETON_FINE
} from "./scoring.js";

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
  rounds: [],          // ligová kola, nejnovější první
  rid: null,           // otevřené kolo
  matches: new Map(),  // zápasy otevřeného kola: číslo zápasu -> dokument
  mslot: null,         // otevřený zápas
  mult: 1,             // zvolený násobek (1 single, 2 double, 3 triple)
  oppInput: "",        // zbytek soupeře, který se právě píše
  rsvps: new Map(),    // eventId -> Map(uid -> {status, note})
  view: "events",
  showPast: false,
  expanded: new Set(),
  pendingName: null,
  dataOn: false,
  ready: { users: false, events: false, rsvps: false, tournaments: false, rounds: false, matches: false },
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

  dataUnsubs.push(onSnapshot(query(collection(db, "rounds"), orderBy("date", "desc")), (s) => {
    state.rounds = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.ready.rounds = true;
    render();
  }, (e) => {
    state.ready.rounds = true;
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
  state.rounds = [];
  closeRound();
  state.ready = { users: false, events: false, rsvps: false, tournaments: false, rounds: false, matches: false };
}

/* ---------- vykreslování ---------- */

// Aplikace přidaná na plochu iPhonu: Google okno tu často nefunguje.
const STANDALONE = window.navigator.standalone === true ||
  window.matchMedia("(display-mode: standalone)").matches;

const svgIcon = (inner) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  events: svgIcon('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  matches: svgIcon('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
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
    : state.view === "matches" ? r.users && r.rounds
    : r.users && r.events && r.rsvps;
  const body = ok
    ? (state.view === "team" ? viewTeam() : state.view === "tournaments" ? viewTournaments() : state.view === "matches" ? viewMatches() : viewEvents())
    : `<p class="muted">Načítám…</p>`;
  document.body.classList.toggle("scoring", ok && state.view === "matches" && isLiveScoring());
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

const isLiveScoring = () => {
  if (state.view !== "matches" || !state.rid || !state.mslot) return false;
  const m = state.matches.get(state.mslot);
  return !!m && m.kind === "single" && m.status !== "done";
};

function shell(inner) {
  if (isLiveScoring()) return `<main class="live">${inner}</main>`;
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
      ${tab("events", "Události")}${tab("tournaments", "Turnaje")}${tab("matches", "Zápasy")}${tab("team", "Tým")}
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

/* ----- zápasy: ligová kola ----- */

const SLOT_COUNT = 18;
const slotKind = (n) => (n === 9 ? "team501" : n === 10 ? "cricket" : "single");
const KIND_LABEL = { team501: "Týmovka 501", cricket: "Kriket" };
const curRound = () => state.rounds.find((x) => x.id === state.rid);
const canManageRound = (r) => state.me.role === "admin" || r.createdBy === state.user.uid;
const fmtAvg = (x) => x.toLocaleString("cs-CZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const crossMark = (score) => { const c = crossOf(score); return c ? ` <span class="xmark">${"✚".repeat(c)}</span>` : ""; };
const crossText = (st) => `${st.c95} / ${st.c133} / ${st.c170}`;

let matchesUnsub = null;

function openRound(id) {
  closeRound();
  state.rid = id;
  state.ready.matches = false;
  matchesUnsub = onSnapshot(collection(db, "rounds", id, "matches"), (s) => {
    state.matches = new Map(s.docs.map((d) => [d.data().slot, { id: d.id, ...d.data() }]));
    state.ready.matches = true;
    render();
  }, (e) => {
    state.ready.matches = true;
    render();
    toast(errMsg(e));
  });
}

function closeRound() {
  if (matchesUnsub) { matchesUnsub(); matchesUnsub = null; }
  state.rid = null;
  state.mslot = null;
  state.matches = new Map();
  state.oppInput = "";
  state.ready.matches = false;
}

function viewMatches() {
  if (state.rid && !curRound()) closeRound();   // kolo mezitím někdo smazal
  if (!state.rid) return viewRounds();
  const r = curRound();
  if (!state.ready.matches) return `<p class="muted">Načítám zápasy…</p>`;
  if (state.mslot) {
    const m = state.matches.get(state.mslot);
    if (m && m.kind === "single") return m.status === "done" ? viewMatchSummary(r, m) : viewScoring(r, m);
    state.mslot = null;
  }
  return viewRound(r);
}

function viewRounds() {
  let html = `<div class="bar"><h1>Zápasy</h1><button class="btn primary" data-action="round-new">Nové kolo</button></div>`;
  if (!state.rounds.length) {
    html += `<div class="empty"><p><strong>Zatím žádné ligové kolo.</strong></p><p>Založ kolo, vyber naše hráče a zapisuj zápasy šipku po šipce. Křížky a průměry se spočítají samy.</p></div>`;
  } else {
    html += `<div class="list">${state.rounds.map(roundCard).join("")}</div>`;
  }
  return html;
}

function roundCard(r) {
  const played = r.played || 0;
  const pct = Math.round((played / SLOT_COUNT) * 100);
  return `
    <button class="tour ${played >= SLOT_COUNT ? "finished" : played ? "running" : "draft"}" data-action="round-open" data-id="${r.id}">
      <span class="tour-head"><strong class="tour-name">${esc(TEAM_NAME)} vs. ${esc(r.opponent)}</strong></span>
      <span class="muted">${dateText(r.date)}</span>
      <span class="round-score">${r.ourWins || 0} : ${r.oppWins || 0}</span>
      <span class="tour-state">Odehráno ${played} z ${SLOT_COUNT}</span>
      <span class="meter" aria-hidden="true"><i class="y" style="flex-grow:${pct}"></i><i style="flex-grow:${100 - pct}"></i></span>
    </button>`;
}

function slotRow(n, nextN) {
  const m = state.matches.get(n);
  const kind = slotKind(n);
  const res = m?.result;
  let name, right, cls = "";
  if (kind !== "single") {
    name = KIND_LABEL[kind];
    right = m ? `${res.our} : ${res.opp}` : `<span class="muted">zapsat výsledek</span>`;
    if (m && res.our > res.opp) cls = "won"; else if (m && res.opp > res.our) cls = "lost";
  } else if (!m) {
    name = `<span class="muted">Volný zápas</span>`;
    right = n === nextN ? `<span class="chipnext">další</span>` : "";
  } else if (m.status === "done") {
    name = `${esc(m.ourName)} <span class="muted">vs.</span> ${esc(m.oppName)}`;
    right = `${res.our} : ${res.opp}`;
    cls = res.our > res.opp ? "won" : res.opp > res.our ? "lost" : "";
  } else {
    const t = tally(m.legs || []);
    name = `${esc(m.ourName)} <span class="muted">vs.</span> ${esc(m.oppName)}`;
    right = `<span class="chiplive">hraje se ${t.our}:${t.opp}</span>`;
  }
  return `
    <button class="slot ${cls} ${n === nextN && !m ? "next" : ""}" data-action="slot" data-n="${n}">
      <span class="no">${n}</span><span class="slot-name">${name}</span><span class="slot-res">${right}</span>
    </button>`;
}

function viewRound(r) {
  const all = [...state.matches.values()];
  const sum = roundSummary(all);
  const manage = canManageRound(r);
  const nextN = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).find((n) => !state.matches.get(n));

  let html = `
    <p class="crumb"><button class="link" data-action="round-back">‹ Všechna kola</button></p>
    <div class="bar">
      <div><h1>vs. ${esc(r.opponent)}</h1><p class="muted meta">${dateText(r.date)}</p></div>
      ${manage ? `<button class="btn" data-action="round-edit" data-id="${r.id}">Upravit</button>` : ""}
    </div>
    <div class="roundscore">
      <span class="rs-team">${esc(TEAM_NAME)}</span>
      <span class="rs-num">${sum.ourWins} : ${sum.oppWins}</span>
      <span class="rs-team">${esc(r.opponent)}</span>
    </div>
    <h2>Zápasy</h2>
    <div class="slots">${Array.from({ length: SLOT_COUNT }, (_, i) => slotRow(i + 1, nextN)).join("")}</div>`;

  const singles = all.filter((m) => m.kind === "single" && (m.legs || []).length)
    .sort((a, b) => a.slot - b.slot);
  if (singles.length) {
    const totals = playerTotals(all);
    html += `<h2>Naši hráči</h2>
      <div class="tablewrap"><table class="standings small">
        <thead><tr><th>Hráč</th><th>Zápasy</th><th>Legy</th><th>Průměr</th><th>95+</th><th>133+</th><th>170+</th><th>180</th><th>Betony</th><th>Pokuta</th></tr></thead>
        <tbody>${totals.map((p) => `<tr><td class="nm">${esc(p.name)}</td><td>${p.won}:${p.lost}</td><td>${p.legsW}:${p.legsL}</td><td>${fmtAvg(p.avg)}</td><td>${p.c95}</td><td>${p.c133}</td><td>${p.c170}</td><td>${p.n180}</td><td>${p.beton}</td><td>${p.fine} Kč</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="fine">Pokuty za betony v tomto kole: <strong>${totals.reduce((sum, p) => sum + p.fine, 0)} Kč</strong></p>
      <h2>Přehled pro zápis do ligy</h2>
      <p class="muted">Křížky obou stran z každého zápasu: 95+, 133+ a 170+.</p>
      <div class="tablewrap"><table class="standings small league">
        <thead>
          <tr><th rowspan="2">#</th><th rowspan="2">Hráč</th><th rowspan="2">Soupeř</th><th rowspan="2">Legy</th><th colspan="3">Naše</th><th colspan="3">Soupeř</th></tr>
          <tr><th>95+</th><th>133+</th><th>170+</th><th>95+</th><th>133+</th><th>170+</th></tr>
        </thead>
        <tbody>${singles.map((m) => {
          const a = sideStats(m.legs, "our"), b = sideStats(m.legs, "opp"), t = tally(m.legs);
          return `<tr><td>${m.slot}</td><td class="nm">${esc(m.ourName)}</td><td class="nm">${esc(m.oppName)}</td><td>${t.our}:${t.opp}</td><td>${a.c95}</td><td>${a.c133}</td><td>${a.c170}</td><td>${b.c95}</td><td>${b.c133}</td><td>${b.c170}</td></tr>`;
        }).join("")}</tbody>
      </table></div>`;
  }
  return html;
}

/* ----- zápis jednoho zápasu ----- */

function visitsTable(leg) {
  const our = leg.visits.filter((v) => v.by === "our");
  const opp = leg.visits.filter((v) => v.by === "opp");
  const n = Math.max(our.length, opp.length);
  if (!n) return "";
  const cell = (v, withDarts) => v
    ? `<td>${v.bust ? `<span class="bust">přehozeno</span>` : v.score}${v.bust ? "" : crossMark(v.score)}${visitBetons(v) ? ` <span class="bet">beton${visitBetons(v) > 1 ? ` ×${visitBetons(v)}` : ""}</span>` : ""}${withDarts && v.darts ? `<small class="muted darts">${v.darts.map(dartLabel).join(" ")}</small>` : ""}</td><td class="rm">${v.rem}</td>`
    : `<td></td><td></td>`;
  let rows = "";
  for (let i = n - 1; i >= 0; i--) rows += `<tr><td class="rn">${i + 1}</td>${cell(our[i], true)}${cell(opp[i], false)}</tr>`;
  return `<div class="tablewrap"><table class="visits">
    <thead><tr><th>Kolo</th><th>Naše</th><th>Zbývá</th><th>Soupeř</th><th>Zbývá</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function dartPad() {
  const mults = [[1, "Single"], [2, "Double"], [3, "Triple"]];
  return `
    <div class="pad">
      <div class="mults">${mults.map(([v, l]) => `<button class="mult ${state.mult === v ? "on" : ""}" data-action="mult" data-v="${v}">${l}</button>`).join("")}</div>
      <div class="nums">${Array.from({ length: 20 }, (_, i) => `<button class="num" data-action="dart" data-dn="${i + 1}">${i + 1}</button>`).join("")}</div>
      <div class="specials">
        <button class="num wide" data-action="dart" data-dn="0" data-dm="1">Vedle</button>
        <button class="num wide" data-action="dart" data-dn="25" data-dm="1">Bull 25</button>
        <button class="num wide" data-action="dart" data-dn="25" data-dm="2">Bullseye 50</button>
      </div>
    </div>`;
}

function oppPad(leg, m) {
  const prev = remaining(leg, "opp");
  const raw = state.oppInput;
  const val = raw === "" ? null : Number(raw);
  const chk = val === null ? null : checkOpp(leg, val);
  let preview = `<span class="muted">Zadej, kolik soupeři zbývá po jeho kole.</span>`;
  if (chk && chk.ok) {
    preview = val === 0
      ? `Soupeř zavřel z ${prev}.`
      : `Soupeř hodil <strong>${chk.score}</strong>${crossMark(chk.score)}`;
  } else if (chk) {
    preview = `<span class="err">${esc(chk.error)}</span>`;
  }
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => `<button class="num" data-action="opp-key" data-k="${k}">${k}</button>`).join("");
  return `
    <div class="oppdisp">
      <span class="was">bylo ${prev}</span>
      <span class="val">${raw === "" ? "–" : esc(raw)}</span>
    </div>
    <p class="preview">${preview}</p>
    <div class="keypad">
      ${keys}
      <button class="num" data-action="opp-del" aria-label="Smazat číslici">⌫</button>
      <button class="num" data-action="opp-key" data-k="0">0</button>
      <button class="num ok" data-action="opp-ok" ${chk && chk.ok ? "" : "disabled"}>Uložit</button>
    </div>
    <button class="btn wide ghost" data-action="opp-same">Beze změny (přehozeno nebo vedle)</button>`;
}

function viewScoring(r, m) {
  const legs = m.legs || [];
  const ms = matchState(m);
  const last = legs[legs.length - 1];
  const inLeg = !!last && !last.winner;
  const fresh = !last || (last.winner && !ms.decided);
  const turn = inLeg ? turnOf(last) : null;
  const so = sideStats(legs, "our");
  const sp = sideStats(legs, "opp");
  const remShow = (side) => fresh ? START
    : inLeg && side === "our" ? curRemaining(last) : remaining(last, side);
  const nm = (side) => (side === "our" ? m.ourName : m.oppName);
  const legWord = (n) => (n === 1 ? "vítězný leg" : n < 5 ? "vítězné legy" : "vítězných legů");

  let status = "";
  if (inLeg) status = `Leg ${legs.length}, začíná ${esc(nm(last.starter))}.`;
  else if (last) status = `Leg ${legs.length} vyhrál ${esc(nm(last.winner))}.`;

  const board = `
    <div class="board">
      ${["our", "opp"].map((side) => `
        <div class="bside ${side} ${turn === side ? "turn" : ""}">
          <div class="bname">${esc(nm(side))}</div>
          <div class="brem">${remShow(side)}</div>
          <div class="bmeta">legy ${side === "our" ? ms.our : ms.opp}${side === "our" ? `, průměr ${fmtAvg(so.avg)}` : ""}</div>
        </div>`).join("")}
    </div>
    <p class="statusline">${status}</p>`;

  let panel = "";
  if (ms.decided && last?.winner) {
    panel = `
      <div class="panel">
        <h2>Zápas vyhrál ${esc(nm(ms.winner))}</h2>
        <p class="muted">Výsledek v legách ${ms.our} : ${ms.opp}. Když je něco špatně, vrať poslední krok.</p>
        <button class="btn primary wide" data-action="match-finish">Uložit zápas</button>
      </div>`;
  } else if (fresh) {
    const suggest = last ? other(last.starter) : null;
    panel = `
      <div class="panel">
        <h2>${last ? "Kdo začíná další leg?" : "Kdo začíná leg?"}</h2>
        <p class="muted">${last ? "Střídá se, předvyplněno je správně." : "Začíná ten, kdo byl blíž středu."}</p>
        <div class="duel">
          <button class="btn ${suggest === "our" ? "primary" : ""}" data-action="leg-start" data-who="our">${esc(nm("our"))}</button>
          <button class="btn ${suggest === "opp" ? "primary" : ""}" data-action="leg-start" data-who="opp">${esc(nm("opp"))}</button>
        </div>
      </div>`;
  } else if (pendingBeton(last)) {
    const pv = pendingBeton(last);
    const bm = pv.bmaybe || 0;
    const bd = pv.bdef || 0;
    panel = `
      <div class="panel">
        <div class="opphead"><h2>Beton?</h2><button class="undo" data-action="match-undo" aria-label="Vrátit poslední kolo"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button></div>
        <p>${esc(nm("our"))} hodil <strong>${pv.score}</strong> (${pv.darts.map(dartLabel).join(", ")}) ze zbytku ${pv.rem + pv.score}. Bylo to zavírání?</p>
        ${bd ? `<p class="muted">${bd}× beton se počítá tak či tak.</p>` : ""}
        <div class="duel">
          <button class="btn" data-action="beton" data-v="0">Zavíral, nepočítat</button>
          <button class="btn primary" data-action="beton" data-v="1">Beton ${bm}×, pokuta ${bm * BETON_FINE} Kč</button>
        </div>
      </div>`;
  } else if (needsBull(last)) {
    panel = `
      <div class="panel">
        <h2>Hází se na středy</h2>
        <p class="muted">Uplynulo ${15} kol. Klepni na vítěze legu.</p>
        <div class="duel">
          <button class="btn" data-action="leg-win" data-who="our">${esc(nm("our"))}</button>
          <button class="btn" data-action="leg-win" data-who="opp">${esc(nm("opp"))}</button>
        </div>
      </div>`;
  } else if (turn === "our") {
    const cur = last.cur;
    panel = `
      <div class="panel">
        <div class="curvisit">
          ${[0, 1, 2].map((i) => `<span class="dart ${cur[i] ? "" : "empty"}">${cur[i] ? dartLabel(cur[i]) : "–"}</span>`).join("")}
          <span class="curtotal">= ${curTotal(last)}</span>
          <button class="undo" data-action="match-undo" aria-label="Vrátit poslední šipku"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
        </div>
        ${dartPad()}
      </div>`;
  } else {
    panel = `<div class="panel"><div class="opphead"><h2>${esc(nm("opp"))}, kolik zbývá?</h2><button class="undo" data-action="match-undo" aria-label="Vrátit poslední krok"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button></div>${oppPad(last, m)}</div>`;
  }

  const hasHistory = legs.length > 0;
  const tools = `
    <div class="tools">
      ${hasHistory ? `<button class="btn" data-action="match-undo">Vrátit poslední</button>` : ""}
      ${inLeg ? `<details class="manual"><summary>Rozhodnout leg ručně</summary>
        <div class="duel">
          <button class="btn" data-action="leg-win" data-who="our">Vyhrál ${esc(nm("our"))}</button>
          <button class="btn" data-action="leg-win" data-who="opp">Vyhrál ${esc(nm("opp"))}</button>
        </div></details>` : ""}
    </div>`;

  const hist = last ? `<h2>Kola ${legs.length > 1 ? `v legu ${legs.length}` : ""}</h2>${visitsTable(last) || `<p class="muted">Zatím nic.</p>`}` : "";

  return `
    <div class="scorebar">
      <button class="link" data-action="match-back" aria-label="Zpět do kola vs. ${esc(r.opponent)}">‹ Kolo</button>
      <strong>Zápas ${m.slot}</strong>
      <span class="muted">na ${m.legsToWin} ${legWord(m.legsToWin)}</span>
    </div>
    ${board}${panel}${tools}${hist}`;
}

function viewMatchSummary(r, m) {
  const legs = m.legs || [];
  const ms = matchState(m);
  const a = sideStats(legs, "our");
  const b = sideStats(legs, "opp");
  const res = m.result || { our: ms.our, opp: ms.opp };
  const winner = res.our > res.opp ? "our" : res.opp > res.our ? "opp" : null;
  const row = (label, x, y) => `<tr><td>${x}</td><th>${label}</th><td>${y}</td></tr>`;
  const dash = (v) => (v === null ? "–" : v);
  const manage = canManageRound(r);
  return `
    <p class="crumb"><button class="link" data-action="match-back">‹ Kolo vs. ${esc(r.opponent)}</button></p>
    <div class="matchhead"><h1>Zápas ${m.slot}</h1><span class="muted">${legs.length} ${legs.length === 1 ? "leg" : legs.length < 5 ? "legy" : "legů"}</span></div>
    <div class="result">
      <span class="rname ${winner === "our" ? "win" : ""}">${esc(m.ourName)}</span>
      <span class="rnum">${res.our} : ${res.opp}</span>
      <span class="rname ${winner === "opp" ? "win" : ""}">${esc(m.oppName)}</span>
    </div>
    <h2>Statistika</h2>
    <div class="tablewrap"><table class="stats">
      <tbody>
        ${row("Legy", ms.our, ms.opp)}
        ${row("Průměr", fmtAvg(a.avg), "–")}
        ${row("Šipky", a.darts, "–")}
        ${row("Nejlepší leg (šipek)", dash(a.bestLeg), "–")}
        ${row("Nejvyšší kolo", a.highest, "–")}
        ${row("Nejvyšší zavření", a.highOut || "–", "–")}
        ${row("180", a.n180, "–")}
        ${row("Křížky 95+ ✚", a.c95, b.c95)}
        ${row("Křížky 133+ ✚✚", a.c133, b.c133)}
        ${row("Křížky 170+ ✚✚✚", a.c170, b.c170)}
        ${row("Betony", a.betonTotal, "–")}
      </tbody>
    </table></div>
    ${a.betonTotal ? `<p class="fine">Pokuta za betony: <strong>${a.fine} Kč</strong>${a.betonLegs ? ` <span class="muted">(z toho ${a.betonLegs} za nezavřený leg)</span>` : ""}</p>` : ""}
    <p class="muted legend">Křížek se počítá za nejvyšší pásmo kola: 95 až 132 jeden, 133 až 169 dva, 170 a víc tři. Beton je kolo s méně než 20 body a každá šipka vedle (mimo zavírání), plus jeden za nezavřený leg. Soupeře sledujeme jen kvůli křížkům.</p>
    <h2>Legy</h2>
    ${legs.map((leg, i) => `
      <details class="legbox">
        <summary>Leg ${i + 1}, vyhrál ${esc(leg.winner === "our" ? m.ourName : m.oppName)}${leg.end === "bull" ? " (středy)" : ""}</summary>
        ${visitsTable(leg)}
      </details>`).join("")}
    <div class="tools">
      <button class="btn" data-action="match-reopen">Znovu otevřít zápis</button>
      ${manage ? `<button class="btn danger" data-action="match-delete">Smazat zápas</button>` : ""}
    </div>`;
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
  const n = document.querySelectorAll("#dlg input[name=member]:checked").length + dlgGuests.length;
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
  const members = document.querySelectorAll("#dlg input[name=member]:checked").length;
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

function openRoundDialog(id) {
  const r = id ? state.rounds.find((x) => x.id === id) : null;
  dlgGuests = r ? (r.ourPlayers || []).filter((p) => !p.uid).map((p) => ({ id: p.id, name: p.name })) : [];
  const selected = new Set(r ? (r.ourPlayers || []).filter((p) => p.uid).map((p) => p.uid) : []);
  const members = [...state.users.values()].filter((u) => isMemberRole(u.role)).sort(byName);
  const d = r ? r.date.toDate() : new Date();
  const dateVal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  $dlg.innerHTML = `
    <form id="roundForm" class="stack" data-id="${r?.id || ""}">
      <h2>${r ? "Upravit kolo" : "Nové ligové kolo"}</h2>
      <label>Soupeř<input name="opponent" required maxlength="60" placeholder="Např. Double Trouble Brno B" value="${esc(r?.opponent || "")}"></label>
      <label>Datum<input type="date" name="date" required value="${dateVal}"></label>
      <fieldset class="players">
        <legend>Naši hráči <span id="pcount" class="muted"></span></legend>
        <div class="chips">${members.map((u) => `
          <label class="chip"><input type="checkbox" name="member" value="${u.id}" ${selected.has(u.id) ? "checked" : ""}><span>${esc(u.displayName)}</span></label>`).join("")}</div>
        <p class="sel-links"><button type="button" class="link" data-dlg="selall">Vybrat všechny</button> <button type="button" class="link" data-dlg="selnone">Zrušit výběr</button></p>
        <div class="addguest">
          <input id="guestName" maxlength="30" placeholder="Náhradník bez účtu, jméno" aria-label="Jméno náhradníka">
          <button type="button" class="btn" data-dlg="addguest">Přidat</button>
        </div>
        <div id="guestList" class="chips"></div>
      </fieldset>
      <label>Hráči soupeře
        <textarea name="opp" rows="6" placeholder="Jeden hráč na řádek, v pořadí. Když nic nevyplníš, použije se H1 až H8.">${esc((r?.oppPlayers || []).map((p) => p.name).join("\n"))}</textarea>
      </label>
      <div class="actions">
        ${r ? `<button type="button" class="btn danger" data-dlg="rdelete" data-id="${r.id}">Smazat kolo</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">${r ? "Uložit kolo" : "Založit kolo"}</button>
      </div>
    </form>`;
  $dlg.showModal();
  renderGuests();
}

function openMatchStartDialog(slot) {
  const r = curRound();
  const our = r.ourPlayers || [];
  const opp = r.oppPlayers || [];
  if (!our.length) { toast("Nejdřív v kole (Upravit) vyber naše hráče."); return; }
  const singles = [...state.matches.values()].filter((x) => x.kind === "single");
  const cnt = (key, id) => singles.filter((x) => x[key] === id).length;
  const lastNeed = singles.sort((a, b) => b.slot - a.slot)[0]?.legsToWin || 1;
  const chip = (name, id, value, key) => {
    const c = cnt(key, id);
    return `<label class="chip"><input type="radio" name="${name}" value="${esc(id)}"><span>${esc(value)}${c ? ` <small class="muted">${c}×</small>` : ""}</span></label>`;
  };
  $dlg.innerHTML = `
    <form id="matchStartForm" class="stack" data-slot="${slot}">
      <h2>Zápas ${slot}</h2>
      <fieldset class="types"><legend>Náš hráč</legend>
        ${our.map((p) => chip("our", p.id, p.name, "ourId")).join("")}
      </fieldset>
      <fieldset class="types"><legend>Soupeř</legend>
        ${opp.map((p) => chip("opp", p.id, p.name, "oppId")).join("")}
      </fieldset>
      <fieldset class="types"><legend>Hraje se na vítězné legy</legend>
        ${[1, 2, 3].map((n) => `<label class="chip"><input type="radio" name="legs" value="${n}" ${n === lastNeed ? "checked" : ""}><span>${n}</span></label>`).join("")}
      </fieldset>
      <div class="actions">
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">Začít zapisovat</button>
      </div>
    </form>`;
  $dlg.showModal();
}

function openTeamDialog(slot) {
  const m = state.matches.get(slot);
  const kind = slotKind(slot);
  $dlg.innerHTML = `
    <form id="teamForm" class="stack" data-slot="${slot}">
      <h2>${KIND_LABEL[kind]}, výsledek</h2>
      <p class="muted">Týmovka a kriket se nezapisují po šipkách, jen výsledek v legách.</p>
      <div class="teamres">
        <label>Naši<input type="number" name="our" min="0" max="9" inputmode="numeric" required value="${m ? m.result.our : ""}"></label>
        <span class="vs">:</span>
        <label>Soupeř<input type="number" name="opp" min="0" max="9" inputmode="numeric" required value="${m ? m.result.opp : ""}"></label>
      </div>
      <div class="actions">
        ${m ? `<button type="button" class="btn danger" data-dlg="teamclear" data-slot="${slot}">Smazat výsledek</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">Uložit výsledek</button>
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

/* ---------- akce: zápasy ---------- */

const matchRef = (m) => doc(db, "rounds", state.rid, "matches", m.id);
const lastLegOf = (legs) => legs[legs.length - 1];

// Změna zápasu: nejdřív hned v paměti (zápis je rychlý i bez signálu), pak do databáze.
async function mutateMatch(slot, fn) {
  const m = state.matches.get(slot);
  if (!m) return;
  const legs = JSON.parse(JSON.stringify(m.legs || []));
  const fields = fn(legs, m);
  if (fields === false) return;
  m.legs = legs;
  Object.assign(m, fields || {});
  render();
  await updateDoc(matchRef(m), { legs, ...(fields || {}), updatedAt: serverTimestamp() });
}

async function syncRound() {
  const r = curRound();
  if (!r) return;
  const sum = roundSummary([...state.matches.values()]);
  if (r.ourWins === sum.ourWins && r.oppWins === sum.oppWins && r.played === sum.played) return;
  await updateDoc(doc(db, "rounds", r.id), sum);
}

function handleSlot(n) {
  if (slotKind(n) !== "single") { openTeamDialog(n); return; }
  if (!state.matches.get(n)) { openMatchStartDialog(n); return; }
  state.mslot = n;
  state.oppInput = "";
  state.mult = 1;
  render();
  window.scrollTo(0, 0);
}

const actStartLeg = (who) => mutateMatch(state.mslot, (legs) => { legs.push(newLeg(who)); });

async function actDart(n, mm) {
  const mult = n === 0 || n === 25 ? mm : state.mult;
  state.mult = 1;
  await mutateMatch(state.mslot, (legs) => {
    const leg = lastLegOf(legs);
    if (!leg || leg.winner) return false;
    const before = leg.visits.length;
    const next = addDart(leg, { n, m: mult });
    if (next === leg) return false;
    legs[legs.length - 1] = next;
    if (next.visits.length > before && next.visits[next.visits.length - 1].bust) toast("Přehozeno, kolo se nepočítá.");
  });
}

async function actOpp(value) {
  const ok = await (async () => {
    let accepted = true;
    await mutateMatch(state.mslot, (legs) => {
      const leg = lastLegOf(legs);
      if (!leg) { accepted = false; return false; }
      const chk = checkOpp(leg, value);
      if (!chk.ok) { toast(chk.error); accepted = false; return false; }
      legs[legs.length - 1] = addOpp(leg, value);
    });
    return accepted;
  })();
  if (ok) { state.oppInput = ""; render(); }
}

const actBeton = (isBeton) => mutateMatch(state.mslot, (legs) => {
  const leg = lastLegOf(legs);
  if (!leg || !pendingBeton(leg)) return false;
  legs[legs.length - 1] = answerBeton(leg, isBeton);
});

async function actUndo() {
  state.oppInput = "";
  await mutateMatch(state.mslot, (legs) => {
    const leg = lastLegOf(legs);
    if (!leg) return false;
    if (isEmptyLeg(leg)) { legs.pop(); return; }
    legs[legs.length - 1] = undo(leg);
  });
}

const actLegWin = (who) => mutateMatch(state.mslot, (legs) => {
  const leg = lastLegOf(legs);
  if (!leg || leg.winner) return false;
  legs[legs.length - 1] = endLeg(leg, who);
});

async function actFinish() {
  const slot = state.mslot;
  await mutateMatch(slot, (legs, m) => {
    const ms = matchState({ legs, legsToWin: m.legsToWin });
    return { status: "done", result: { our: ms.our, opp: ms.opp } };
  });
  state.mslot = null;
  state.oppInput = "";
  render();
  window.scrollTo(0, 0);
  toast("Zápas je uložený.");
  await syncRound();
}

async function actReopen() {
  await mutateMatch(state.mslot, () => ({ status: "playing" }));
  await syncRound();
}

async function actDeleteMatch() {
  const m = state.matches.get(state.mslot);
  if (!m || !confirm("Smazat celý zápas i se zapsanými šipkami? Vrátit to nejde.")) return;
  state.matches.delete(m.slot);
  state.mslot = null;
  render();
  await deleteDoc(matchRef(m));
  await syncRound();
  toast("Zápas je smazaný.");
}

async function deleteRound(id) {
  if (!confirm("Smazat celé kolo i se všemi zápasy? Vrátit to nejde.")) return;
  closeDialog();
  if (state.rid === id) {
    for (const m of state.matches.values()) await deleteDoc(doc(db, "rounds", id, "matches", m.id));
    closeRound();
  }
  await deleteDoc(doc(db, "rounds", id));
  render();
  toast("Kolo je smazané.");
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
        document.querySelectorAll("#dlg input[name=member]").forEach((c) => {
          c.checked = on && free > 0;
          if (c.checked) free--;
        });
        updatePlayerCount();
      }
      if (dl.dataset.dlg === "rdelete") await deleteRound(dl.dataset.id);
      if (dl.dataset.dlg === "teamclear") {
        const slot = Number(dl.dataset.slot);
        const m = state.matches.get(slot);
        if (m) {
          state.matches.delete(slot);
          closeDialog();
          render();
          await deleteDoc(matchRef(m));
          await syncRound();
        }
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
  const { action, id, status, view, uid, mode, mid, who } = t.dataset;

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
        if (view === "matches" && state.view === "matches") closeRound();
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
      case "round-new": openRoundDialog(); break;
      case "round-edit": openRoundDialog(id); break;
      case "round-open": openRound(id); window.scrollTo(0, 0); break;
      case "round-back": closeRound(); render(); window.scrollTo(0, 0); break;
      case "slot": handleSlot(Number(t.dataset.n)); break;
      case "match-back": state.mslot = null; state.oppInput = ""; render(); window.scrollTo(0, 0); break;
      case "mult": { const v = Number(t.dataset.v); state.mult = state.mult === v ? 1 : v; render(); break; }
      case "dart": await actDart(Number(t.dataset.dn), Number(t.dataset.dm || 1)); break;
      case "leg-start": await actStartLeg(who); break;
      case "leg-win": await actLegWin(who); break;
      case "opp-key":
        if (state.oppInput.length < 3) {
          state.oppInput = (state.oppInput === "0" ? "" : state.oppInput) + t.dataset.k;
          render();
        }
        break;
      case "opp-del": state.oppInput = state.oppInput.slice(0, -1); render(); break;
      case "opp-ok": await actOpp(Number(state.oppInput)); break;
      case "beton": await actBeton(t.dataset.v === "1"); break;
      case "opp-same": {
        const legs = state.matches.get(state.mslot)?.legs || [];
        const leg = legs[legs.length - 1];
        if (leg) await actOpp(remaining(leg, "opp"));
        break;
      }
      case "match-undo": await actUndo(); break;
      case "match-finish": await actFinish(); break;
      case "match-reopen": await actReopen(); break;
      case "match-delete": await actDeleteMatch(); break;
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
  if (e.target.closest("#dlg") && e.target.name === "member") {
    const checked = document.querySelectorAll("#dlg input[name=member]:checked").length;
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

    if (f.id === "roundForm") {
      const opponent = (fd.get("opponent") || "").trim().slice(0, 60);
      const when = new Date(`${fd.get("date")}T12:00:00`);
      if (!opponent || isNaN(when)) { toast("Vyplň soupeře a datum."); return; }
      const ourPlayers = [
        ...fd.getAll("member").map((uid) => ({ id: uid, name: state.users.get(uid)?.displayName || "Hráč", uid })),
        ...dlgGuests.map((g) => ({ id: g.id, name: g.name, uid: null }))
      ];
      if (ourPlayers.length > MAX_PLAYERS) { toast(`Nejvíc ${MAX_PLAYERS} hráčů.`); return; }
      let names = String(fd.get("opp") || "").split("\n").map((x) => x.trim().slice(0, 30)).filter(Boolean).slice(0, 12);
      if (!names.length) names = Array.from({ length: 8 }, (_, i) => `H${i + 1}`);
      const oppPlayers = names.map((name, i) => ({ id: `h${i + 1}`, name }));
      const data = { opponent, date: Timestamp.fromDate(when), ourPlayers, oppPlayers };
      const id = f.dataset.id;
      if (id) {
        await updateDoc(doc(db, "rounds", id), data);
        toast("Kolo je uložené.");
      } else {
        const ref = await addDoc(collection(db, "rounds"), {
          ...data, ourWins: 0, oppWins: 0, played: 0, createdBy: state.user.uid, createdAt: serverTimestamp()
        });
        state.view = "matches";
        openRound(ref.id);
        window.scrollTo(0, 0);
        toast("Kolo je založené.");
      }
      closeDialog();
      return;
    }

    if (f.id === "matchStartForm") {
      const r = curRound();
      const slot = Number(f.dataset.slot);
      const our = (r.ourPlayers || []).find((p) => p.id === fd.get("our"));
      const opp = (r.oppPlayers || []).find((p) => p.id === fd.get("opp"));
      if (!our || !opp) { toast("Vyber našeho hráče i soupeře."); return; }
      const data = {
        slot, kind: "single", ourId: our.id, ourName: our.name, oppId: opp.id, oppName: opp.name,
        legsToWin: Number(fd.get("legs")) || 1, legs: [], status: "playing", result: { our: 0, opp: 0 },
        createdBy: state.user.uid
      };
      const id = `m${slot}`;
      state.matches.set(slot, { id, ...data });
      state.mslot = slot;
      state.oppInput = "";
      state.mult = 1;
      closeDialog();
      render();
      window.scrollTo(0, 0);
      await setDoc(doc(db, "rounds", state.rid, "matches", id), { ...data, updatedAt: serverTimestamp() });
      return;
    }

    if (f.id === "teamForm") {
      const slot = Number(f.dataset.slot);
      const our = Number(fd.get("our"));
      const opp = Number(fd.get("opp"));
      if (![our, opp].every((x) => Number.isInteger(x) && x >= 0 && x <= 9)) { toast("Zadej legy jako čísla 0 až 9."); return; }
      const id = `m${slot}`;
      const data = { slot, kind: slotKind(slot), status: "done", result: { our, opp }, legs: [], createdBy: state.user.uid };
      state.matches.set(slot, { id, ...data });
      closeDialog();
      render();
      await setDoc(doc(db, "rounds", state.rid, "matches", id), { ...data, updatedAt: serverTimestamp() });
      await syncRound();
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
