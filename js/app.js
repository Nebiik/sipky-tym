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
  GAMES, MAX_PLAYERS, POINTS_PER_WIN, drawSchedule, computeStandings, tournamentStatus,
  tournamentWinners, playerRanking, headToHead
} from "./tournament.js";
import {
  START, other, dartLabel, newLeg, remaining, turnOf, needsBull,
  checkEntry, addOur, addOpp, endLeg, undoVisit, isEmptyLeg, crossOf, sideStats, tally, matchState,
  roundSummary, playerTotals, visitBetons, BETON_FINE,
  roundOutcome, opponentTotals, teamTotals
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
  tview: "list",        // v záložce Turnaje: "list" nebo "stats"
  h2h: null,           // vybraná dvojice pro vzájemné skóre {a, b}
  rounds: [],          // ligová kola, nejnovější první
  rid: null,           // otevřené kolo
  matches: new Map(),  // zápasy otevřeného kola: číslo zápasu -> dokument
  mslot: null,         // otevřený zápas
  mview: "rounds",      // v záložce Zápasy: "rounds" (zápisy) nebo "liga"
  liga: { status: "idle", data: null, error: "" },
  ligaAll: false,      // zobrazit všechny sloupce tabulky ligy
  allMatches: [],      // zápasy ze všech kol (statistiky za celou sezónu)
  allMatchesStatus: "idle",
  statSort: "wins",    // řazení hráčů ve statistikách zápasů
  padInput: "",        // zbytek, který se právě píše na klávesnici
  padBeton: 0,         // počet betonů vybraný pro kolo našeho hráče
  padUsed: 3,          // šipek na zavření (jen náš hráč)
  rsvps: new Map(),    // eventId -> Map(uid -> {status, note})
  comments: [],        // komentáře ke všem událostem {id, eventId, uid, text, createdAt, editedAt}
  expandedComments: new Set(),
  view: "events",
  showPast: false,
  expanded: new Set(),
  pendingName: null,
  dataOn: false,
  ready: { users: false, events: false, rsvps: false, tournaments: false, rounds: false, matches: false, comments: false },
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

  dataUnsubs.push(onSnapshot(collectionGroup(db, "comments"), (s) => {
    state.comments = s.docs.map((d) => ({ id: d.id, eventId: d.ref.parent.parent.id, ...d.data({ serverTimestamps: "estimate" }) }));
    state.ready.comments = true;
    render();
  }, () => {
    // kdyby chyběla nová pravidla ve Firebase, události dál fungují jen bez komentářů
    state.comments = [];
    state.ready.comments = true;
    render();
    toast("Komentáře se nepodařilo načíst. Zkontroluj nová pravidla ve Firebase.");
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
  state.comments = [];
  state.tid = null;
  state.rounds = [];
  closeRound();
  stopAllMatches();
  state.ready = { users: false, events: false, rsvps: false, tournaments: false, rounds: false, matches: false, comments: false };
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
// Barvy koleček. Každý si může vybrat svou, kdo nevybere, dostane barvu podle jména.
const COLORS = {
  red: "Červená", orange: "Oranžová", gold: "Zlatá", green: "Zelená",
  teal: "Tyrkysová", blue: "Modrá", purple: "Fialová", pink: "Růžová"
};
const COLOR_KEYS = Object.keys(COLORS);
const hue = (name) => {
  let h = 0;
  for (const c of name || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % COLOR_KEYS.length;
};
const colorOf = (name, color) => (COLORS[color] ? color : COLOR_KEYS[hue(name)]);
const avatar = (name, color) => `<span class="av k-${colorOf(name, color)}" aria-hidden="true">${esc(initials(name))}</span>`;
const avatarOf = (uid, name) => avatar(name, state.users.get(uid)?.color);
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
        <button class="avbtn" data-action="profile" aria-label="Upravit profil, ${esc(state.me.displayName)}">${avatar(state.me.displayName, state.me.color)}</button>
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

// Sestava, náhradníci a občerstvení u zápasu. Každý má značku podle toho, jak hlasoval.
function lineupBlock(ev, votes) {
  if (ev.type !== "match") return "";
  const known = (list) => (list || []).filter((u) => state.users.has(u));
  const lineup = known(ev.lineup);
  const subs = known(ev.subs);
  const catering = known(ev.catering);
  const person = (uid) => {
    const u = state.users.get(uid);
    const v = votes.get(uid)?.status;
    const [cls, mark, label] = v === "yes" ? ["yes", "✓", "Můžu"] : v === "no" ? ["no", "✗", "Nemůžu"] : ["none", "?", "Nehlasoval"];
    return `<li class="lp ${cls}">${avatarOf(uid, u.displayName)}<span>${esc(u.displayName)}</span><span class="vote" title="${label}" aria-label="${label}">${mark}</span></li>`;
  };
  let html = "";
  if (lineup.length) html += `<p class="lu-title">Základní sestava</p><ul class="lu">${lineup.map(person).join("")}</ul>`;
  if (subs.length) html += `<p class="lu-title">Náhradníci</p><ul class="lu subs">${subs.map(person).join("")}</ul>`;
  if (!lineup.length && !subs.length) html += `<p class="muted nolineup">Sestava zatím není zadaná.</p>`;
  if (ev.home) {
    html += `<p class="homeline">🏠 Domácí zápas, 🍺 občerstvení: ${catering.length ? `<strong>${catering.map((u) => esc(state.users.get(u).displayName)).join(", ")}</strong>` : `<span class="muted">zatím nikdo</span>`}</p>`;
  }
  return `<div class="lineup">${html}</div>`;
}

/* ----- komentáře k události ----- */

const COMMENT_MAX = 300;
const COMMENTS_SHOWN = 3;

function commentTime(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  if (!d) return "právě teď";
  const hm = `${d.getHours()}:${pad(d.getMinutes())}`;
  const now = new Date();
  if (sameDay(d, now)) return `dnes ${hm}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, yesterday)) return `včera ${hm}`;
  return `${d.getDate()}. ${d.getMonth() + 1}. ${hm}`;
}

// Komentáře události od nejstaršího. Starší poznámky k hlasování se ukážou jako komentáře jejich autorů.
function eventComments(ev, votes) {
  const list = state.comments.filter((c) => c.eventId === ev.id).map((c) => ({ ...c }));
  for (const [uid, v] of votes) {
    if (v.note) list.push({ id: `note-${uid}`, legacy: true, uid, text: v.note, createdAt: v.updatedAt });
  }
  const ms = (c) => (c.createdAt?.toDate ? c.createdAt.toDate().getTime() : Infinity);
  return list.sort((a, b) => ms(a) - ms(b));
}

function commentsBlock(ev, votes, upcoming) {
  const all = eventComments(ev, votes);
  if (!all.length && !upcoming) return "";
  const expanded = state.expandedComments.has(ev.id);
  const hidden = expanded ? 0 : Math.max(0, all.length - COMMENTS_SHOWN);
  const shown = hidden ? all.slice(-COMMENTS_SHOWN) : all;
  const admin = state.me.role === "admin";

  const item = (c) => {
    const u = state.users.get(c.uid);
    const name = u?.displayName || "Bývalý člen";
    const mine = c.uid === state.user.uid;
    const actions = [];
    if (c.legacy) {
      if (mine) actions.push(`<button class="link" data-action="comment-legacy-del" data-id="${ev.id}">Smazat</button>`);
    } else {
      if (mine) actions.push(`<button class="link" data-action="comment-edit" data-id="${ev.id}" data-cid="${esc(c.id)}">Upravit</button>`);
      if (mine || admin) actions.push(`<button class="link danger" data-action="comment-del" data-id="${ev.id}" data-cid="${esc(c.id)}">Smazat</button>`);
    }
    return `
      <li class="cm">
        ${u ? avatarOf(c.uid, name) : avatar(name)}
        <div class="cm-body">
          <p class="cm-meta"><strong>${esc(name)}</strong> <span class="muted">${esc(commentTime(c.createdAt))}${c.editedAt ? ", upraveno" : ""}</span></p>
          <p class="cm-text">${esc(c.text)}</p>
          ${actions.length ? `<p class="cm-actions">${actions.join("")}</p>` : ""}
        </div>
      </li>`;
  };

  return `
    <div class="comments">
      <div class="cm-head">
        ${all.length ? `<h4>Komentáře (${all.length})</h4>` : "<span></span>"}
        <button class="link" data-action="comment-new" data-id="${ev.id}">Přidat komentář</button>
      </div>
      ${hidden ? `<button class="link cm-more" data-action="comments-more" data-id="${ev.id}">Starší komentáře (${hidden})</button>` : ""}
      ${shown.length ? `<ul class="cm-list">${shown.map(item).join("")}</ul>` : ""}
      ${expanded && all.length > COMMENTS_SHOWN ? `<button class="link cm-more" data-action="comments-more" data-id="${ev.id}">Skrýt starší komentáře</button>` : ""}
    </div>`;
}

function openCommentDialog(eid, cid) {
  const ev = state.events.find((e) => e.id === eid);
  const c = cid ? state.comments.find((x) => x.id === cid) : null;
  $dlg.innerHTML = `
    <form id="commentForm" class="stack" data-eid="${eid}" data-cid="${cid || ""}">
      <h2>${c ? "Upravit komentář" : "Nový komentář"}</h2>
      <p class="muted">${esc(ev?.title || "")}. Komentář uvidí všichni v týmu a bude u něj tvoje jméno.</p>
      <label>Komentář<textarea name="text" rows="4" maxlength="${COMMENT_MAX}" required placeholder="Např. přijdu až v 16:30" autofocus>${esc(c?.text || "")}</textarea></label>
      <div class="actions">
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">${c ? "Uložit změny" : "Přidat komentář"}</button>
      </div>
    </form>`;
  $dlg.showModal();
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

  const person = (u) => `<li>${esc(u.displayName)}</li>`;
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
    ${ev.notes ? `<p class="notes">${esc(ev.notes)}</p>` : ""}
    ${lineupBlock(ev, votes)}`;

  const edit = canEdit ? `<button class="link edit" data-action="edit-event" data-id="${ev.id}">Upravit</button>` : "";

  if (hero) {
    return `
      <article class="event hero t-${esc(ev.type)}">
        <p class="until">${untilText(n)}</p>
        <div class="head"><h2 class="title">${t.icon} ${esc(title)}</h2>${edit}</div>
        ${details}
        ${rsvp}
        ${tally}
        ${commentsBlock(ev, votes, true)}
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
        ${commentsBlock(ev, votes, n >= 0)}
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
  if (state.tview === "stats") return viewTourStats();
  let html = `${tournamentSeg()}<div class="bar"><h1>Turnaje</h1><button class="btn primary" data-action="tour-new">Nový turnaj</button></div>`;
  if (!state.tournaments.length) {
    html += `<div class="empty"><p><strong>Zatím žádný turnaj.</strong></p><p>Založ turnaj, vyber hráče a hru a appka je nalosuje každý s každým.</p></div>`;
  } else {
    const open = state.tournaments.filter((t) => tournamentStatus(t).state !== "finished");
    const done = state.tournaments.filter((t) => tournamentStatus(t).state === "finished");
    if (open.length) html += `<h2 class="first">Probíhá a příprava</h2><div class="list">${open.map(tourCard).join("")}</div>`;
    if (done.length) html += `<h2 ${open.length ? "" : 'class="first"'}>Dokončené</h2><div class="list">${done.map(tourCard).join("")}</div>`;
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

const memberName = (w) => (w.uid && state.users.get(w.uid)?.displayName) || w.name;

function winnerLine(t) {
  const ws = tournamentWinners(t);
  if (!ws.length) return "";
  return `<span class="winnerline"><span class="trophy" aria-hidden="true">🏆</span>
    <span class="wnames">${ws.map((w) => `<span class="wn">${w.uid ? avatarOf(w.uid, memberName(w)) : avatar(w.name)}<strong>${esc(memberName(w))}</strong></span>`).join("")}</span>
    ${ws.length > 1 ? `<small class="muted">shoda na prvním místě</small>` : ""}</span>`;
}

function tourCard(t) {
  const st = tournamentStatus(t);
  const label = st.state === "draft" ? "Příprava, čeká na losování" : `Probíhá, odehráno ${st.played} z ${st.total}`;
  const pct = st.total ? Math.round((st.played / st.total) * 100) : 0;
  return `
    <button class="tour ${st.state}" data-action="tour-open" data-id="${t.id}">
      <span class="tour-head"><strong class="tour-name">${esc(t.name)}</strong><span class="gamechip">${esc(GAMES[t.game] || t.game)}</span></span>
      <span class="muted">${dateText(t.date)}, ${(t.players || []).length} hráčů</span>
      ${st.state === "finished" ? winnerLine(t) : `<span class="tour-state">${esc(label)}</span>`}
      ${st.total && st.state !== "finished" ? `<span class="meter" aria-hidden="true"><i class="y" style="flex-grow:${pct}"></i><i style="flex-grow:${100 - pct}"></i></span>` : ""}
    </button>`;
}

function viewTourStats() {
  const ts = state.tournaments;
  const ranking = playerRanking(ts);
  const finished = ts.filter((t) => tournamentStatus(t).state === "finished").length;
  let html = `${tournamentSeg()}<div class="bar"><h1>Statistiky</h1></div>`;
  if (!ranking.length) {
    return html + `<div class="empty"><p><strong>Zatím není z čeho počítat.</strong></p><p>Statistiky se naplní, jakmile se v turnajích zapíšou první výsledky.</p></div>`;
  }
  const nameOf = (r) => state.users.get(r.uid)?.displayName || r.name;
  html += `<h2 class="first">Žebříček</h2>
    <div class="tablewrap"><table class="standings small ranking">
      <thead><tr><th>#</th><th>Hráč</th><th>🏆</th><th>Turn.</th><th>V:P</th><th>%</th></tr></thead>
      <tbody>${ranking.map((r) => `
        <tr><td>${r.rank}.</td><td class="nm"><span class="who">${avatarOf(r.uid, nameOf(r))}<span>${esc(nameOf(r))}</span></span></td>
        <td>${r.titles ? `<b>${r.titles}</b>` : "0"}</td><td>${r.tournaments}</td><td>${r.won}:${r.lost}</td><td>${r.pct === null ? "–" : `${Math.round(r.pct * 100)} %`}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted legend">🏆 vyhrané turnaje, Turn. odehrané dokončené turnaje (dokončených je ${finished}), V:P výhry a prohry v zápasech, % úspěšnost v zápasech. Počítají se jen členové týmu.</p>`;

  html += `<h2>Vzájemné skóre</h2>`;
  const ids = ranking.map((r) => r.uid);
  if (ids.length < 2) return html + `<p class="muted">Na porovnání jsou potřeba aspoň dva hráči se zápasy.</p>`;

  let pair = state.h2h;
  if (!pair || !ids.includes(pair.a) || !ids.includes(pair.b) || pair.a === pair.b) {
    const a = ids.includes(state.user.uid) ? state.user.uid : ids[0];
    const best = ids.filter((i) => i !== a)
      .map((o) => ({ o, n: headToHead(ts, a, o).matches.length }))
      .sort((x, y) => y.n - x.n)[0];
    pair = { a, b: best.o };
    state.h2h = pair;
  }
  const h = headToHead(ts, pair.a, pair.b);
  const byUid = new Map(ranking.map((r) => [r.uid, r]));
  const nm = (uid) => nameOf(byUid.get(uid));
  const opts = (sel) => [...ranking].sort((x, y) => nameOf(x).localeCompare(nameOf(y), "cs"))
    .map((r) => `<option value="${esc(r.uid)}" ${r.uid === sel ? "selected" : ""}>${esc(nameOf(r))}</option>`).join("");

  html += `
    <div class="h2hpick">
      <select data-action="h2h" data-side="a" aria-label="První hráč">${opts(pair.a)}</select>
      <span class="vs">vs</span>
      <select data-action="h2h" data-side="b" aria-label="Druhý hráč">${opts(pair.b)}</select>
    </div>
    <div class="result">
      <span class="rname ${h.a > h.b ? "win" : ""}">${esc(nm(pair.a))}</span>
      <span class="rnum">${h.a} : ${h.b}</span>
      <span class="rname ${h.b > h.a ? "win" : ""}">${esc(nm(pair.b))}</span>
    </div>`;
  if (!h.matches.length) {
    html += `<p class="muted">Tihle dva spolu zatím nehráli.</p>`;
  } else {
    html += `<div class="tablewrap h2hlist"><table class="standings small">
      <thead><tr><th>Datum</th><th>Turnaj</th><th>Vyhrál</th></tr></thead>
      <tbody>${h.matches.map((m) => `<tr><td>${dateText(m.date)}</td><td class="nm">${esc(m.tournament)}</td><td class="nm"><b>${esc(nm(m.winner))}</b></td></tr>`).join("")}</tbody>
    </table></div>`;
  }
  return html;
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
      ? `<ul class="plist">${players.map((p) => `<li>${p.uid ? avatarOf(p.uid, p.name) : avatar(p.name)}<span>${esc(p.name)}${p.uid ? "" : ` <small class="muted">host</small>`}</span></li>`).join("")}</ul>`
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
const LEGS_TO_WIN = 2; // v lize se vždy hraje na dva vítězné legy
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
  resetPad();
  state.ready.matches = false;
}

function viewMatches() {
  if (state.rid && !curRound()) closeRound();   // kolo mezitím někdo smazal
  if (!state.rid) return state.mview === "liga" ? viewLiga() : state.mview === "stats" ? viewSeasonStats() : viewRounds();
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
  let html = `${segControl()}<div class="bar"><h1>Zápasy</h1><button class="btn primary" data-action="round-new">Nové kolo</button></div>`;
  if (!state.rounds.length) {
    html += `<div class="empty"><p><strong>Zatím žádné ligové kolo.</strong></p><p>Založ kolo, vyber naše hráče a zapisuj zápasy šipku po šipce. Křížky a průměry se spočítají samy.</p></div>`;
  } else {
    html += `<div class="list">${state.rounds.map(roundCard).join("")}</div>`;
  }
  return html;
}

const OUTCOME = {
  win: { label: "🏆 Výhra", banner: "🏆 Vyhráli jsme!" },
  loss: { label: "Prohra", banner: "Tentokrát to nevyšlo" },
  draw: { label: "Remíza", banner: "Remíza" }
};

function roundCard(r) {
  const played = r.played || 0;
  const pct = Math.round((played / SLOT_COUNT) * 100);
  const out = roundOutcome(r);
  return `
    <button class="tour ${played >= SLOT_COUNT ? "finished" : played ? "running" : "draft"} ${out ? `result-${out}` : ""}" data-action="round-open" data-id="${r.id}">
      <span class="tour-head"><strong class="tour-name">${esc(TEAM_NAME)} vs. ${esc(r.opponent)}</strong>${out ? `<span class="outcome ${out}">${OUTCOME[out].label}</span>` : ""}</span>
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
  const outcome = roundOutcome({ ...sum, played: sum.played });
  const manage = canManageRound(r);
  const nextN = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).find((n) => !state.matches.get(n));

  let html = `
    <p class="crumb"><button class="link" data-action="round-back">‹ Všechna kola</button></p>
    <div class="bar">
      <div><h1>vs. ${esc(r.opponent)}</h1><p class="muted meta">${dateText(r.date)}</p></div>
      ${manage ? `<button class="btn" data-action="round-edit" data-id="${r.id}">Upravit</button>` : ""}
    </div>
    <div class="roundscore ${outcome || ""}">
      <span class="rs-team">${esc(TEAM_NAME)}</span>
      <span class="rs-num">${sum.ourWins} : ${sum.oppWins}</span>
      <span class="rs-team">${esc(r.opponent)}</span>
    </div>
    ${outcome ? `<p class="outcomebar ${outcome}">${OUTCOME[outcome].banner}</p>` : ""}
    <h2>Zápasy</h2>
    <div class="slots">${Array.from({ length: SLOT_COUNT }, (_, i) => slotRow(i + 1, nextN)).join("")}</div>`;

  const singles = all.filter((m) => m.kind === "single" && (m.legs || []).length)
    .sort((a, b) => a.slot - b.slot);
  if (singles.length) {
    const totals = playerTotals(all);
    const tt = teamTotals(all);
    const oppRows = opponentTotals(all);
    html += `<h2>Naši hráči</h2>
      <div class="tablewrap"><table class="standings small">
        <thead><tr><th>Hráč</th><th>Zápasy</th><th>Legy</th><th>Průměr</th><th>95+</th><th>133+</th><th>170+</th><th>180</th><th>Betony</th><th>Pokuta</th></tr></thead>
        <tbody>${totals.map((p) => `<tr><td class="nm">${esc(p.name)}</td><td>${p.won}:${p.lost}</td><td>${p.legsW}:${p.legsL}</td><td>${fmtAvg(p.avg)}</td><td>${p.c95}</td><td>${p.c133}</td><td>${p.c170}</td><td>${p.n180}</td><td>${p.beton}</td><td>${p.fine} Kč</td></tr>`).join("")}</tbody>
        <tfoot><tr><td class="nm">Celkem</td><td>${tt.won}:${tt.lost}</td><td>${tt.legsW}:${tt.legsL}</td><td>${fmtAvg(tt.avg)}</td><td>${tt.c95}</td><td>${tt.c133}</td><td>${tt.c170}</td><td>${tt.n180}</td><td>${tt.beton}</td><td>${tt.fine} Kč</td></tr></tfoot>
      </table></div>
      <p class="fine">Pokuty za betony v tomto kole: <strong>${tt.fine} Kč</strong></p>
      <h2>Hráči soupeře</h2>
      <p class="muted">U soupeře se sleduje jen výsledek a křížky.</p>
      <div class="tablewrap"><table class="standings small">
        <thead><tr><th>Hráč</th><th>Zápasy</th><th>Legy</th><th>95+</th><th>133+</th><th>170+</th></tr></thead>
        <tbody>${oppRows.map((p) => `<tr><td class="nm">${esc(p.name)}</td><td>${p.won}:${p.lost}</td><td>${p.legsW}:${p.legsL}</td><td>${p.c95}</td><td>${p.c133}</td><td>${p.c170}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td class="nm">Celkem</td><td>${tt.opp.won}:${tt.opp.lost}</td><td>${tt.opp.legsW}:${tt.opp.legsL}</td><td>${tt.opp.c95}</td><td>${tt.opp.c133}</td><td>${tt.opp.c170}</td></tr></tfoot>
      </table></div>
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

/* ----- statistiky zápasů za všechna kola ----- */

let allMatchesUnsub = null;

function startAllMatches() {
  if (allMatchesUnsub) return;
  state.allMatchesStatus = "loading";
  allMatchesUnsub = onSnapshot(collectionGroup(db, "matches"), (snap) => {
    state.allMatches = snap.docs.map((d) => ({ id: d.id, roundId: d.ref.parent.parent.id, ...d.data() }));
    state.allMatchesStatus = "ok";
    render();
  }, () => {
    allMatchesUnsub = null;
    state.allMatchesStatus = "error";
    render();
  });
}

function stopAllMatches() {
  if (allMatchesUnsub) { allMatchesUnsub(); allMatchesUnsub = null; }
  state.allMatches = [];
  state.allMatchesStatus = "idle";
}

const STAT_SORTS = {
  wins: ["Výhry", (a, b) => b.won - a.won || b.avg - a.avg],
  avg: ["Průměr", (a, b) => b.avg - a.avg],
  cross: ["Křížky", (a, b) => (b.c95 + b.c133 + b.c170) - (a.c95 + a.c133 + a.c170) || b.avg - a.avg],
  beton: ["Betony", (a, b) => b.beton - a.beton]
};

function viewSeasonStats() {
  const head = segControl();
  if (state.allMatchesStatus === "idle") {
    setTimeout(startAllMatches, 0);
    return `${head}<p class="muted">Načítám statistiky…</p>`;
  }
  if (state.allMatchesStatus === "loading") return `${head}<p class="muted">Načítám statistiky…</p>`;
  if (state.allMatchesStatus === "error") {
    return `${head}<div class="empty"><p><strong>Statistiky se nepodařilo načíst.</strong></p>
      <p>Zkontroluj, jestli jsou ve Firebase zveřejněná nejnovější pravidla (soubor firestore.rules).</p></div>
      <p><button class="btn" data-action="stats-reload">Zkusit znovu</button></p>`;
  }

  const all = state.allMatches;
  const t = teamTotals(all);
  const nameOf = (p) => state.users.get(p.id)?.displayName || p.name;
  const players = playerTotals(all).sort(STAT_SORTS[state.statSort]?.[1] || STAT_SORTS.wins[1]);

  const outcomes = state.rounds.map((r) => roundOutcome(r));
  const rw = outcomes.filter((o) => o === "win").length;
  const rd = outcomes.filter((o) => o === "draw").length;
  const rl = outcomes.filter((o) => o === "loss").length;

  let html = `${head}<div class="bar"><h1>Statistiky</h1></div>`;
  if (!all.some((m) => (m.legs || []).length) && !state.rounds.length) {
    return html + `<div class="empty"><p><strong>Zatím není z čeho počítat.</strong></p><p>Statistiky se naplní, jakmile se zapíše první zápas v nějakém kole.</p></div>`;
  }

  const tile = (label, value, note) => `<div class="tile"><span class="tl">${label}</span><strong>${value}</strong>${note ? `<small class="muted">${note}</small>` : ""}</div>`;
  html += `<div class="tiles">
    ${tile("Kola", `${rw}–${rd}–${rl}`, "výhry, remízy, prohry")}
    ${tile("Zápasy", `${t.won}:${t.lost}`, `jednotlivci, legy ${t.legsW}:${t.legsL}`)}
    ${tile("Průměr týmu", fmtAvg(t.avg), "ze všech zápasů")}
    ${tile("Naše křížky", `${t.c95} / ${t.c133} / ${t.c170}`, "95+ / 133+ / 170+")}
    ${tile("Křížky soupeřů", `${t.opp.c95} / ${t.opp.c133} / ${t.opp.c170}`, "95+ / 133+ / 170+")}
    ${tile("Betony", t.beton, `pokuty ${t.fine} Kč`)}
  </div>`;

  html += `<h2>Naši hráči</h2>
    <label class="sortpick">Řadit podle
      <select data-action="stat-sort" aria-label="Řazení hráčů">${Object.entries(STAT_SORTS).map(([k, [label]]) => `<option value="${k}" ${state.statSort === k ? "selected" : ""}>${label}</option>`).join("")}</select>
    </label>`;
  if (!players.length) {
    html += `<p class="muted">Zatím tu nejsou žádné zapsané zápasy hráčů.</p>`;
  } else {
    html += `<div class="tablewrap"><table class="standings small seasontable">
      <thead><tr><th>Hráč</th><th>Hrál</th><th>V:P</th><th>Legy</th><th>Průměr</th><th>95+</th><th>133+</th><th>170+</th><th>180</th><th>Betony</th><th>Pokuta</th></tr></thead>
      <tbody>${players.map((p) => `<tr><td class="nm"><span class="who">${p.id && state.users.has(p.id) ? avatarOf(p.id, nameOf(p)) : avatar(nameOf(p))}<span>${esc(nameOf(p))}</span></span></td><td>${p.matches}</td><td>${p.won}:${p.lost}</td><td>${p.legsW}:${p.legsL}</td><td>${fmtAvg(p.avg)}</td><td>${p.c95}</td><td>${p.c133}</td><td>${p.c170}</td><td>${p.n180}</td><td>${p.beton}</td><td>${p.fine} Kč</td></tr>`).join("")}</tbody>
      <tfoot><tr><td class="nm">Celkem</td><td>${t.played}</td><td>${t.won}:${t.lost}</td><td>${t.legsW}:${t.legsL}</td><td>${fmtAvg(t.avg)}</td><td>${t.c95}</td><td>${t.c133}</td><td>${t.c170}</td><td>${t.n180}</td><td>${t.beton}</td><td>${t.fine} Kč</td></tr></tfoot>
    </table></div>
    <p class="muted legend">Hrál = zápasy se zapsanými šipkami, V:P výhry a prohry v jednotlivcích. Průměr je z celku (všechny body děleno všemi šipkami). Týmovka a kriket se nezapisují po šipkách, takže v nich nejsou.</p>`;
  }

  if (state.rounds.length) {
    html += `<h2>Kola</h2><div class="slots">${state.rounds.map((r) => {
      const out = roundOutcome(r);
      return `<button class="slot ${out === "win" ? "won" : out === "loss" ? "lost" : ""}" data-action="round-open" data-id="${r.id}">
        <span class="no" aria-hidden="true">${out === "win" ? "🏆" : out === "loss" ? "✗" : out === "draw" ? "=" : "…"}</span>
        <span class="slot-name">vs. ${esc(r.opponent)} <span class="muted">${dateText(r.date)}</span></span>
        <span class="slot-res">${r.ourWins || 0} : ${r.oppWins || 0}</span></button>`;
    }).join("")}</div>`;
  }
  return html;
}

/* ----- liga ze sipky.org ----- */

const normTeam = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const pointsWord = (n) => (n === 1 ? "bod" : n >= 2 && n <= 4 ? "body" : "bodů");

function seg(items, active, action) {
  return `<div class="seg" role="group" aria-label="Zobrazení">${items.map(([v, label]) =>
    `<button class="${active === v ? "on" : ""}" data-action="${action}" data-v="${v}" aria-pressed="${active === v}">${label}</button>`).join("")}</div>`;
}
const segControl = () => seg([["rounds", "Zápisy"], ["liga", "Liga"], ["stats", "Statistiky"]], state.mview, "mview");
const tournamentSeg = () => seg([["list", "Turnaje"], ["stats", "Statistiky"]], state.tview, "tview");

async function loadLiga() {
  state.liga = { status: "loading", data: null, error: "" };
  render();
  try {
    const res = await fetch("data/liga.json", { cache: "no-cache" });
    if (res.status === 404) {
      state.liga = { status: "missing", data: null, error: "" };
    } else if (!res.ok) {
      throw new Error(`Server vrátil chybu ${res.status}.`);
    } else {
      const data = await res.json();
      if (!Array.isArray(data.standings) || !Array.isArray(data.fixtures || [])) throw new Error("Soubor s ligou nemá správný tvar.");
      state.liga = { status: "ok", data, error: "" };
    }
  } catch (e) {
    state.liga = { status: "error", data: null, error: e.message || String(e) };
  }
  render();
}

function fixtureRow(f, i, d, ours) {
  const us = normTeam(d.team);
  const homeUs = normTeam(f.home) === us;
  const awayUs = normTeam(f.away) === us;
  const fdate = new Date(`${f.date}T12:00:00`);
  const dateTxt = isNaN(fdate) ? esc(f.date) : `${esc(weekdayShort(fdate))} ${fdate.getDate()}. ${fdate.getMonth() + 1}.`;
  let action = "";
  if (ours) {
    const opp = homeUs ? f.away : f.home;
    const existing = state.rounds.find((r) => !isNaN(fdate) && sameDay(r.date.toDate(), fdate) && normTeam(r.opponent) === normTeam(opp));
    // událost Zápas ve stejný den (zakládat je z rozpisu smí jen správce)
    const event = state.events.find((e) => e.type === "match" && !isNaN(fdate) && sameDay(e.startsAt.toDate(), fdate));
    const eventBtn = state.me.role !== "admin" ? ""
      : event
        ? `<button class="btn" data-action="liga-edit-event" data-id="${event.id}">Upravit událost</button>`
        : `<button class="btn" data-action="liga-new-event" data-i="${i}">Založit událost</button>`;
    const roundBtn = existing
      ? `<button class="btn" data-action="round-open" data-id="${existing.id}">Otevřít kolo</button>`
      : `<button class="btn primary" data-action="liga-new-round" data-i="${i}">Založit kolo</button>`;
    action = eventBtn + roundBtn;
  }
  return `
    <div class="fxrow ${ours ? "ours" : ""}">
      <div class="fxdate"><strong>${dateTxt}</strong><span class="muted">${esc(f.time || "")}${f.round ? `, kolo ${f.round}` : ""}</span></div>
      <div class="fxmatch">
        <span class="${homeUs ? "us" : ""}">${esc(f.home)}</span> <span class="muted">vs.</span> <span class="${awayUs ? "us" : ""}">${esc(f.away)}</span>
        ${f.venue ? `<small class="muted">${esc(f.venue)}</small>` : ""}
      </div>
      ${action ? `<div class="fxact">${action}</div>` : ""}
    </div>`;
}

function viewLiga() {
  const L = state.liga;
  const head = segControl();
  if (L.status === "idle") {
    setTimeout(loadLiga, 0);
    return `${head}<p class="muted">Načítám ligu…</p>`;
  }
  if (L.status === "loading") return `${head}<p class="muted">Načítám ligu…</p>`;
  if (L.status === "missing") {
    return `${head}<div class="empty"><p><strong>Data ligy se ještě nenačetla.</strong></p>
      <p>Stahuje je úloha na GitHubu. Spusť ji ručně: záložka Actions, Liga ze sipky.org, Run workflow. Pak chvíli počkej a dej Obnovit.</p></div>
      <p><button class="btn" data-action="liga-reload">Obnovit</button></p>`;
  }
  if (L.status === "error") {
    return `${head}<div class="empty"><p><strong>Ligu se nepodařilo načíst.</strong></p><p>${esc(L.error)}</p></div>
      <p><button class="btn" data-action="liga-reload">Zkusit znovu</button></p>`;
  }

  const d = L.data;
  const us = d.standings.find((s) => normTeam(s.team) === normTeam(d.team));
  const all = state.ligaAll;
  // odehraná utkání se neukazují, ani kdyby rozpis zrovna zastaral
  const today = startOfToday();
  const idxs = (d.fixtures || []).map((f, i) => i).filter((i) => {
    const day = new Date(`${d.fixtures[i].date}T12:00:00`);
    return isNaN(day) || day >= today;
  });
  const isOurs = (f) => [normTeam(f.home), normTeam(f.away)].includes(normTeam(d.team));
  const oursIdx = idxs.filter((i) => isOurs(d.fixtures[i]));
  const otherIdx = idxs.filter((i) => !isOurs(d.fixtures[i]));
  const safeUrl = /^https:\/\/www\.sipky\.org\//.test(d.sourceUrl || "") ? d.sourceUrl : "";

  let html = `${head}
    <div class="bar">
      <div><h1>Liga</h1><p class="muted meta">${esc(d.group || "")}${d.season ? `, sezóna ${esc(d.season)}` : ""}</p></div>
      <button class="btn" data-action="liga-reload">Obnovit</button>
    </div>`;

  if (us) {
    html += `<div class="ligahero"><span class="lh-rank">${us.rank}.</span>
      <span><strong>${esc(d.team)}</strong><br><span class="muted">${us.points} ${pointsWord(us.points)} po ${us.played} ${us.played === 1 ? "kole" : "kolech"}</span></span></div>`;
  }

  html += `<div class="tablewrap"><table class="standings ligatable small">
    <thead><tr><th>#</th><th>Družstvo</th><th>Kol</th><th>V</th>${all ? "<th>VP</th>" : ""}<th>R</th>${all ? "<th>PP</th>" : ""}<th>P</th>${all ? "<th>K</th>" : ""}<th>Skóre</th>${all ? "<th>Legy</th>" : ""}<th>Body</th></tr></thead>
    <tbody>${d.standings.map((s) => `
      <tr class="${normTeam(s.team) === normTeam(d.team) ? "ours" : ""}">
        <td>${s.rank}.</td><td class="nm">${esc(s.team)}</td><td>${s.played}</td><td>${s.v}</td>${all ? `<td>${s.vp}</td>` : ""}<td>${s.r}</td>${all ? `<td>${s.pp}</td>` : ""}<td>${s.p}</td>${all ? `<td>${s.k}</td>` : ""}
        <td>${s.scoreFor}:${s.scoreAgainst}</td>${all ? `<td>${s.legsFor}:${s.legsAgainst}</td>` : ""}<td><b>${s.points}</b></td>
      </tr>`).join("")}</tbody></table></div>
    <p><button class="link" data-action="liga-cols">${all ? "Méně sloupců" : "Všechny sloupce"}</button></p>`;

  html += `<h2>Naše další utkání</h2>`;
  if (d.fixturesStatus === "unreadable") {
    html += `<p class="muted">Rozpis utkání se z webu ligy teď nepodařilo přečíst${oursIdx.length ? ", ukazuju poslední známý" : ""}. Tabulka je aktuální.</p>`;
  }
  html += oursIdx.length
    ? `<div class="fxlist">${oursIdx.map((i) => fixtureRow(d.fixtures[i], i, d, true)).join("")}</div>`
    : d.fixturesStatus === "unreadable" ? "" : `<p class="muted">V rozpisu teď žádné naše utkání není.</p>`;

  if (otherIdx.length) {
    html += `<details class="otherfx"><summary>Ostatní utkání v lize (${otherIdx.length})</summary>
      <div class="fxlist">${otherIdx.map((i) => fixtureRow(d.fixtures[i], i, d, false)).join("")}</div></details>`;
  }

  html += `<p class="muted legend">Zdroj: ${safeUrl ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener">sipky.org</a>` : "sipky.org"}.
    Zkontrolováno ${esc(fmtDateTime(d.checkedAt))}${d.sourceSync ? `, stav na webu ligy z ${esc(d.sourceSync)}` : ""}.
    Zkratky sloupců jsou stejné jako na webu ligy.</p>`;
  return html;
}

/* ----- zápis jednoho zápasu ----- */

function visitsTable(leg) {
  const bySide = {
    our: leg.visits.filter((v) => v.by === "our"),
    opp: leg.visits.filter((v) => v.by === "opp")
  };
  const n = Math.max(bySide.our.length, bySide.opp.length);
  if (!n) return "";
  // kdo leg začal, má sloupce vlevo, stejně jako skóre na tabuli
  const left = leg.starter === "opp" ? "opp" : "our";
  const order = [left, other(left)];
  const cell = (v) => v
    ? `<td>${v.bust ? `<span class="bust">přehozeno</span>` : v.score}${v.bust ? "" : crossMark(v.score)}${visitBetons(v) ? ` <span class="bet">beton${visitBetons(v) > 1 ? ` ×${visitBetons(v)}` : ""}</span>` : ""}${v.by === "our" && v.darts ? `<small class="muted darts">${v.darts.map(dartLabel).join(" ")}</small>` : ""}</td><td class="rm">${v.rem}</td>`
    : `<td></td><td></td>`;
  let rows = "";
  for (let i = n - 1; i >= 0; i--) rows += `<tr><td class="rn">${i + 1}</td>${order.map((side) => cell(bySide[side][i])).join("")}</tr>`;
  return `<div class="tablewrap"><table class="visits">
    <thead><tr><th>Kolo</th>${order.map((side) => `<th class="h-${side}">${side === "our" ? "Naše" : "Soupeř"}</th><th>Zbývá</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

const UNDO_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`;

function resetPad() {
  state.padInput = "";
  state.padBeton = 0;
  state.padUsed = 3;
}

// Zápis kola jedné strany: píše se jen to, kolik hráči po kole zbývá. Body, průměr a křížky se dopočítají.
function entryPad(leg, side) {
  const prev = remaining(leg, side);
  const raw = state.padInput;
  const val = raw === "" ? null : Number(raw);
  const chk = val === null ? null : checkEntry(leg, side, val);
  const ours = side === "our";
  let preview = `<span class="muted">Zadej, kolik ${ours ? "mu" : "soupeři"} zbývá po kole.</span>`;
  if (chk && chk.ok) {
    preview = val === 0
      ? `${ours ? "Zavřeno" : "Soupeř zavřel"} z ${prev}.${ours && state.padBeton ? ` <span class="muted">Beton se při zavření nepočítá.</span>` : ""}`
      : `${ours ? "Hodil" : "Soupeř hodil"} <strong>${chk.score}</strong>${crossMark(chk.score)}`;
  } else if (chk) {
    preview = `<span class="err">${esc(chk.error)}</span>`;
  }
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => `<button class="num" data-action="pad-key" data-k="${k}">${k}</button>`).join("");
  const betonRow = ours ? `
    <div class="betonrow">
      <span class="lbl">Beton</span>
      ${[1, 2, 3, 4].map((n) => `<button class="${state.padBeton === n ? "on" : ""}" data-action="pad-beton" data-n="${n}" aria-pressed="${state.padBeton === n}">${n}×</button>`).join("")}
    </div>` : "";
  const usedRow = ours && raw === "0"
    ? `<div class="usedrow"><span>Šipek na zavření</span>${[1, 2, 3].map((u) => `<button class="mult ${state.padUsed === u ? "on" : ""}" data-action="pad-used" data-u="${u}">${u}</button>`).join("")}</div>` : "";
  return `
    <div class="oppdisp">
      <span class="was">bylo ${prev}</span>
      <span class="val">${raw === "" ? "–" : esc(raw)}</span>
    </div>
    <p class="preview">${preview}</p>
    ${usedRow}${betonRow}
    <div class="keypad">
      ${keys}
      <button class="num" data-action="pad-del" aria-label="Smazat číslici">⌫</button>
      <button class="num" data-action="pad-key" data-k="0">0</button>
      <button class="num ok" data-action="pad-ok" ${chk && chk.ok ? "" : "disabled"}>Uložit</button>
    </div>
    <button class="btn wide ghost" data-action="pad-same">Beze změny (přehozeno nebo vedle)</button>`;
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
  const remShow = (side) => (fresh ? START : remaining(last, side));
  const nm = (side) => (side === "our" ? m.ourName : m.oppName);
  const legWord = (n) => (n === 1 ? "vítězný leg" : n < 5 ? "vítězné legy" : "vítězných legů");

  let status = "";
  if (inLeg) status = `Leg ${legs.length}, začíná ${esc(nm(last.starter))}.`;
  else if (last) status = `Leg ${legs.length} vyhrál ${esc(nm(last.winner))}.`;

  // Kdo začíná leg, má skóre vlevo (jako budík na automatu). Mezi legy je vlevo ten, kdo má začínat podle střídání.
  const leftSide = fresh ? (last ? other(last.starter) : "our") : last.starter;
  const sideOrder = leftSide === "opp" ? ["opp", "our"] : ["our", "opp"];
  const board = `
    <div class="board">
      ${sideOrder.map((side) => `
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
  } else {
    // zapisuje se kolo našeho hráče (zelený panel) nebo soupeře (červený panel)
    const side = turn;
    panel = `
      <div class="panel side-${side}">
        <div class="opphead">
          <span class="sidetag ${side}">${side === "our" ? "Náš hráč" : "Soupeř"}</span>
          <h2>${esc(nm(side))}, kolik zbývá?</h2>
          <button class="undo" data-action="match-undo" aria-label="Vrátit poslední kolo">${UNDO_ICON}</button>
        </div>
        ${entryPad(last, side)}
      </div>`;
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

  let html = `<div class="bar"><h1>Tým</h1><button class="btn" data-action="profile">Upravit profil</button></div>`;

  if (admin && pending.length) {
    html += `<h2>Čekají na schválení</h2><div class="rows">${pending.map((u) => `
      <div class="row">
        <div class="who">${avatar(u.displayName, u.color)}<div><strong>${esc(u.displayName)}</strong>${mail(u) ? `<br><small class="muted">${esc(mail(u))}</small>` : ""}</div></div>
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
          ${avatar(u.displayName, u.color)}
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

const MAX_LINEUP = 4;

// Kolikrát je kdo už zapsaný na občerstvení u domácích zápasů (bez právě upravované události).
function cateringCounts(excludeId) {
  const m = new Map();
  for (const e of state.events) {
    if (e.id === excludeId || e.type !== "match" || !e.home) continue;
    for (const u of e.catering || []) m.set(u, (m.get(u) || 0) + 1);
  }
  return m;
}

function updateLineupCounts(form) {
  if (!form) return;
  const n = form.querySelectorAll("input[name=lineup]:checked").length;
  const m = form.querySelectorAll("input[name=subs]:checked").length;
  const l = form.querySelector("#lcount");
  const sc = form.querySelector("#scount");
  if (l) l.textContent = `(${n} ze ${MAX_LINEUP})`;
  if (sc) sc.textContent = m ? `(${m})` : "";
}

function openEventDialog(id, preset) {
  const ev = id ? state.events.find((e) => e.id === id) : null;
  const d = ev ? ev.startsAt.toDate() : preset?.date || defaultStart();
  const curType = ev?.type || preset?.type || "training";
  const isHome = ev ? !!ev.home : !!preset?.home;
  const members = [...state.users.values()].filter((u) => isMemberRole(u.role)).sort(byName);
  const counts = cateringCounts(id);
  const chips = (name, set, extra) => members.map((u) => `
    <label class="chip"><input type="checkbox" name="${name}" value="${esc(u.id)}" ${set.has(u.id) ? "checked" : ""}><span>${esc(u.displayName)}${extra ? extra(u) : ""}</span></label>`).join("");
  const lineupSel = new Set(ev?.lineup || []);
  const subsSel = new Set(ev?.subs || []);
  const cateringSel = new Set(ev?.catering || []);
  $dlg.innerHTML = `
    <form id="evForm" class="stack" data-id="${id || ""}">
      <h2>${ev ? "Upravit událost" : "Nová událost"}</h2>
      <fieldset class="types">
        <legend>Druh</legend>
        ${Object.entries(TYPES).map(([k, t]) => `
          <label class="chip"><input type="radio" name="type" value="${k}" ${k === curType ? "checked" : ""}><span>${t.icon} ${t.label}</span></label>`).join("")}
      </fieldset>
      <label>Název<input name="title" maxlength="80" placeholder="Např. Trénink na automatu" value="${esc(ev ? ev.title || "" : preset?.title || "")}"></label>
      <label>Kdy<input type="datetime-local" name="when" required value="${toLocalInput(d)}"></label>
      <label>Kde<input name="location" maxlength="120" placeholder="Např. Podchod klub, Brno" value="${esc(ev ? ev.location || "" : preset?.location || "")}"></label>
      <div id="matchFields" class="matchfields" ${curType === "match" ? "" : "hidden"}>
        <label class="check"><input type="checkbox" name="home" ${isHome ? "checked" : ""}><span>Domácí zápas</span></label>
        <fieldset class="players">
          <legend>Základní sestava <span id="lcount" class="muted"></span></legend>
          <div class="chips">${chips("lineup", lineupSel)}</div>
        </fieldset>
        <fieldset class="players">
          <legend>Náhradníci <span id="scount" class="muted"></span></legend>
          <div class="chips">${chips("subs", subsSel)}</div>
        </fieldset>
        <fieldset class="players" id="cateringBox" ${isHome ? "" : "hidden"}>
          <legend>Kdo dělá občerstvení</legend>
          <div class="chips">${chips("catering", cateringSel, (u) => (counts.get(u.id) ? ` <small class="muted">${counts.get(u.id)}×</small>` : ""))}</div>
          <p class="muted hint">Číslo ukazuje, kolikrát už je u domácích zápasů zapsaný na občerstvení.</p>
        </fieldset>
      </div>
      <label>Poznámka<textarea name="notes" rows="3" maxlength="500" placeholder="Co přinést, na co myslet…">${esc(ev ? ev.notes || "" : preset?.notes || "")}</textarea></label>
      <div class="actions">
        ${ev ? `<button type="button" class="btn danger" data-dlg="delete" data-id="${ev.id}">Smazat událost</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">Uložit událost</button>
      </div>
    </form>`;
  $dlg.showModal();
  updateLineupCounts($dlg.querySelector("#evForm"));
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

function openRoundDialog(id, preset) {
  const r = id ? state.rounds.find((x) => x.id === id) : null;
  dlgGuests = r ? (r.ourPlayers || []).filter((p) => !p.uid).map((p) => ({ id: p.id, name: p.name })) : [];
  const selected = new Set(r ? (r.ourPlayers || []).filter((p) => p.uid).map((p) => p.uid) : preset?.members || []);
  const members = [...state.users.values()].filter((u) => isMemberRole(u.role)).sort(byName);
  const d = r ? r.date.toDate() : preset?.date || new Date();
  const dateVal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  $dlg.innerHTML = `
    <form id="roundForm" class="stack" data-id="${r?.id || ""}">
      <h2>${r ? "Upravit kolo" : "Nové ligové kolo"}</h2>
      <label>Soupeř<input name="opponent" required maxlength="60" placeholder="Např. Double Trouble Brno B" value="${esc(r?.opponent || preset?.opponent || "")}"></label>
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

function openProfileDialog() {
  const cur = colorOf(state.me.displayName, state.me.color);
  $dlg.innerHTML = `
    <form id="profileForm" class="stack">
      <h2>Můj profil</h2>
      <div class="avpreview">${avatar(state.me.displayName, cur).replace('class="av ', 'class="av big ').replace('<span', '<span id="avPreview"')}</div>
      <label>Jméno v týmu<input name="name" required maxlength="40" value="${esc(state.me.displayName)}"></label>
      <fieldset class="colors">
        <legend>Barva kolečka</legend>
        ${COLOR_KEYS.map((k) => `
          <label class="swatch"><input type="radio" name="color" value="${k}" ${k === cur ? "checked" : ""} aria-label="${COLORS[k]}"><span class="sw av k-${k}" aria-hidden="true"></span></label>`).join("")}
      </fieldset>
      <div class="actions">
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="close">Zrušit</button>
        <button type="submit" class="btn primary">Uložit profil</button>
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
  for (const c of state.comments.filter((x) => x.eventId === id)) await deleteDoc(doc(db, "events", id, "comments", c.id));
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
  resetPad();
  render();
  window.scrollTo(0, 0);
}

const actStartLeg = (who) => mutateMatch(state.mslot, (legs) => { legs.push(newLeg(who)); });

// Zápis kola: side je null, když se má vzít ta strana, která je na tahu.
async function actEntry(side, value) {
  let accepted = true;
  await mutateMatch(state.mslot, (legs) => {
    const leg = lastLegOf(legs);
    if (!leg) { accepted = false; return false; }
    const who = side || turnOf(leg);
    const chk = checkEntry(leg, who, value);
    if (!chk.ok) { toast(chk.error); accepted = false; return false; }
    legs[legs.length - 1] = who === "our" ? addOur(leg, value, state.padUsed, state.padBeton) : addOpp(leg, value);
  });
  if (accepted) { resetPad(); render(); }
}

async function actUndo() {
  resetPad();
  await mutateMatch(state.mslot, (legs) => {
    const leg = lastLegOf(legs);
    if (!leg) return false;
    if (isEmptyLeg(leg)) { legs.pop(); return; }
    legs[legs.length - 1] = undoVisit(leg);
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
  resetPad();
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
      case "comment-new": openCommentDialog(id); break;
      case "comment-edit": openCommentDialog(id, t.dataset.cid); break;
      case "comment-del":
        if (!confirm("Smazat komentář?")) break;
        await deleteDoc(doc(db, "events", id, "comments", t.dataset.cid));
        toast("Komentář je smazaný.");
        break;
      case "comment-legacy-del":
        if (!confirm("Smazat tvoji starou poznámku k hlasování?")) break;
        await updateDoc(doc(db, "events", id, "rsvps", state.user.uid), { note: "", updatedAt: serverTimestamp() });
        break;
      case "comments-more":
        state.expandedComments.has(id) ? state.expandedComments.delete(id) : state.expandedComments.add(id);
        render();
        break;
      case "profile": openProfileDialog(); break;
      case "changelog": openChangelogDialog(); break;
      case "tview": state.tview = t.dataset.v === "stats" ? "stats" : "list"; render(); window.scrollTo(0, 0); break;
      case "mview": state.mview = ["liga", "stats"].includes(t.dataset.v) ? t.dataset.v : "rounds"; render(); window.scrollTo(0, 0); break;
      case "stats-reload": stopAllMatches(); render(); break;
      case "liga-reload": state.liga = { status: "idle", data: null, error: "" }; render(); break;
      case "liga-cols": state.ligaAll = !state.ligaAll; render(); break;
      case "liga-new-event": {
        if (state.me.role !== "admin") break;
        const d = state.liga.data;
        const f = d?.fixtures?.[Number(t.dataset.i)];
        if (!f) break;
        const homeUs = normTeam(f.home) === normTeam(d.team);
        const time = /^\d{1,2}:\d{2}$/.test(f.time || "") ? f.time.padStart(5, "0") : "15:00";
        const when = new Date(`${f.date}T${time}:00`);
        openEventDialog(null, {
          type: "match",
          title: `Zápas s ${homeUs ? f.away : f.home}`,
          date: isNaN(when) ? undefined : when,
          location: f.venue || "",
          notes: [f.round ? `${f.round}. kolo` : "", d.group || ""].filter(Boolean).join(", "),
          home: homeUs
        });
        break;
      }
      case "liga-edit-event": if (state.me.role === "admin") openEventDialog(id); break;
      case "liga-new-round": {
        const d = state.liga.data;
        const f = d?.fixtures?.[Number(t.dataset.i)];
        if (!f) break;
        const homeUs = normTeam(f.home) === normTeam(d.team);
        const when = new Date(`${f.date}T12:00:00`);
        // když existuje událost Zápas ve stejný den, vezme se z ní sestava a náhradníci
        const ev = isNaN(when) ? null : state.events.find((e) => e.type === "match" && sameDay(e.startsAt.toDate(), when));
        const members = ev ? [...(ev.lineup || []), ...(ev.subs || [])].filter((u) => state.users.has(u)) : [];
        openRoundDialog(null, { opponent: homeUs ? f.away : f.home, date: isNaN(when) ? undefined : when, members });
        break;
      }
      case "round-new": openRoundDialog(); break;
      case "round-edit": openRoundDialog(id); break;
      case "round-open": openRound(id); window.scrollTo(0, 0); break;
      case "round-back": closeRound(); render(); window.scrollTo(0, 0); break;
      case "slot": handleSlot(Number(t.dataset.n)); break;
      case "match-back": state.mslot = null; resetPad(); render(); window.scrollTo(0, 0); break;
      case "leg-start": await actStartLeg(who); break;
      case "leg-win": await actLegWin(who); break;
      case "pad-key":
        if (state.padInput.length < 3) {
          state.padInput = (state.padInput === "0" ? "" : state.padInput) + t.dataset.k;
          render();
        }
        break;
      case "pad-del": state.padInput = state.padInput.slice(0, -1); render(); break;
      case "pad-used": state.padUsed = Number(t.dataset.u); render(); break;
      case "pad-beton": { const n = Number(t.dataset.n); state.padBeton = state.padBeton === n ? 0 : n; render(); break; }
      case "pad-ok": await actEntry(null, Number(state.padInput)); break;
      case "pad-same": {
        const legs = state.matches.get(state.mslot)?.legs || [];
        const leg = legs[legs.length - 1];
        const who = leg ? turnOf(leg) : null;
        if (who) await actEntry(who, remaining(leg, who));
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

document.addEventListener("change", (e) => {
  const ss = e.target.closest("[data-action='stat-sort']");
  if (ss) { state.statSort = ss.value; render(); return; }
  const sel = e.target.closest("[data-action='h2h']");
  if (!sel) return;
  const prev = state.h2h || {};
  const next = { ...prev, [sel.dataset.side]: sel.value };
  if (next.a === next.b) {
    // vybral jsi stejného hráče jako na druhé straně, tak se dva prohodí
    next[sel.dataset.side === "a" ? "b" : "a"] = prev[sel.dataset.side];
  }
  state.h2h = next;
  render();
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

document.addEventListener("change", (e) => {
  if (e.target.name === "color" && e.target.closest("#profileForm")) {
    const pv = document.getElementById("avPreview");
    if (pv) pv.className = `av big k-${e.target.value}`;
  }
});

document.addEventListener("change", (e) => {
  const f = e.target.closest("#evForm");
  if (!f) return;
  const { name } = e.target;
  if (name === "type") f.querySelector("#matchFields").hidden = e.target.value !== "match";
  if (name === "home") f.querySelector("#cateringBox").hidden = !e.target.checked;
  if (name === "lineup" || name === "subs") {
    if (e.target.checked) {
      // hráč je buď v sestavě, nebo mezi náhradníky
      const other = name === "lineup" ? "subs" : "lineup";
      const twin = f.querySelector(`input[name=${other}][value="${CSS.escape(e.target.value)}"]`);
      if (twin) twin.checked = false;
      if (name === "lineup" && f.querySelectorAll("input[name=lineup]:checked").length > MAX_LINEUP) {
        e.target.checked = false;
        toast(`V základní sestavě je nejvíc ${MAX_LINEUP} hráči.`);
      }
    }
    updateLineupCounts(f);
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
      // sestava, domácí zápas a občerstvení mají smysl jen u zápasu, u ostatních druhů se vyprázdní
      const isMatch = type === "match";
      const home = isMatch && fd.get("home") === "on";
      const lineup = isMatch ? fd.getAll("lineup") : [];
      if (lineup.length > MAX_LINEUP) { toast(`V základní sestavě je nejvíc ${MAX_LINEUP} hráči.`); return; }
      const data = {
        type,
        title: (fd.get("title") || "").trim() || TYPES[type].label,
        startsAt: Timestamp.fromDate(when),
        location: (fd.get("location") || "").trim(),
        notes: (fd.get("notes") || "").trim(),
        lineup,
        subs: isMatch ? fd.getAll("subs").filter((u) => !lineup.includes(u)) : [],
        home,
        catering: home ? fd.getAll("catering") : []
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

    if (f.id === "commentForm") {
      const text = (fd.get("text") || "").trim().slice(0, COMMENT_MAX);
      if (!text) { toast("Napiš komentář."); return; }
      const eid = f.dataset.eid;
      const cid = f.dataset.cid;
      if (cid) {
        await updateDoc(doc(db, "events", eid, "comments", cid), { text, editedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, "events", eid, "comments"), { uid: state.user.uid, text, createdAt: serverTimestamp() });
      }
      closeDialog();
      toast(cid ? "Komentář je upravený." : "Komentář je přidaný.");
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
        legsToWin: LEGS_TO_WIN, legs: [], status: "playing", result: { our: 0, opp: 0 },
        createdBy: state.user.uid
      };
      const id = `m${slot}`;
      state.matches.set(slot, { id, ...data });
      state.mslot = slot;
      resetPad();
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

    if (f.id === "profileForm") {
      const name = (fd.get("name") || "").trim().slice(0, 40);
      const color = fd.get("color");
      if (!name) return;
      const data = { displayName: name };
      if (COLORS[color]) data.color = color;
      await updateDoc(doc(db, "users", state.user.uid), data);
      closeDialog();
      toast("Profil je uložený.");
    }
  } catch (err) {
    console.error(err);
    toast(errMsg(err));
  } finally {
    if (btn) btn.disabled = false;
  }
});
