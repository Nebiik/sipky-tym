// Logika turnajů: losování "každý s každým" a výpočet tabulky. Bez závislosti na Firebase.

export const GAMES = {
  "501-do": "501 DO",
  "501-dido": "501 DI/DO",
  "301-do": "301 DO",
  "301-dido": "301 DI/DO",
  "kriket": "Kriket"
};
export const MAX_PLAYERS = 16;
export const POINTS_PER_WIN = 2;

export function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rozpis metodou kruhu: každá dvojice se potká právě jednou, při lichém počtu hráčů má v každém
// kole někdo volno. Odveta přidá druhou polovinu s prohozenými stranami. V aplikaci se zápasy ukazují
// jako jeden seznam, kola slouží jen k tomu, aby hráči měli mezi zápasy co nejrovnoměrnější pauzy.
export function drawSchedule(playerIds, double = false, rnd = Math.random) {
  const ids = shuffle(playerIds, rnd);
  if (ids.length < 2) return [];
  const arr = ids.length % 2 ? [...ids, null] : [...ids];
  const m = arr.length;
  const rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i];
      const b = arr[m - 1 - i];
      if (a === null || b === null) continue;
      // první dvojice se střídá, ať jeden hráč nezačíná pořád
      pairs.push(i === 0 && r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(shuffle(pairs, rnd));
    arr.splice(1, 0, arr.pop());
  }
  if (double) rounds.push(...rounds.map((rd) => rd.map(([a, b]) => [b, a])));

  // Na přechodu mezi koly, pokud to jde, nezačínat zápasem, ve kterém hraje někdo z předchozího zápasu.
  for (let r = 1; r < rounds.length; r++) {
    const prevRound = rounds[r - 1];
    const last = prevRound[prevRound.length - 1];
    const cur = rounds[r];
    if (!last || cur.length < 2) continue;
    const clash = (p) => p.includes(last[0]) || p.includes(last[1]);
    if (clash(cur[0])) {
      const j = cur.findIndex((p) => !clash(p));
      if (j > 0) [cur[0], cur[j]] = [cur[j], cur[0]];
    }
  }

  return rounds.flatMap((rd, ri) =>
    rd.map(([a, b], mi) => ({ id: `r${ri + 1}m${mi + 1}`, r: ri + 1, a, b })));
}

// Pořadí: 1. body, 2. body ze vzájemných zápasů hráčů se stejným počtem bodů. Když ani to nerozhodne,
// mají hráči stejné místo (rozhodne rozstřel mimo aplikaci).
export function computeStandings(players, matches, results) {
  const rows = new Map(players.map((p) => [p.id, {
    id: p.id, name: p.name, played: 0, wins: 0, losses: 0, points: 0, h2h: 0
  }]));
  const decided = [];
  for (const m of matches) {
    const res = results?.[m.id];
    if (!res || !res.winner) continue;
    const a = rows.get(m.a);
    const b = rows.get(m.b);
    if (!a || !b) continue;
    a.played++; b.played++;
    const win = res.winner === m.a ? a : b;
    const lose = win === a ? b : a;
    win.wins++; lose.losses++;
    win.points += POINTS_PER_WIN;
    decided.push({ a: m.a, b: m.b, winner: win.id });
  }
  // vzájemné zápasy jen uvnitř skupiny se stejným počtem bodů
  const groups = new Map();
  for (const r of rows.values()) {
    if (!groups.has(r.points)) groups.set(r.points, []);
    groups.get(r.points).push(r.id);
  }
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const set = new Set(ids);
    for (const d of decided) {
      if (set.has(d.a) && set.has(d.b)) rows.get(d.winner).h2h += POINTS_PER_WIN;
    }
  }
  const list = [...rows.values()].sort((x, y) =>
    y.points - x.points || y.h2h - x.h2h || x.name.localeCompare(y.name, "cs"));
  const same = (x, y) => x.points === y.points && x.h2h === y.h2h;
  list.forEach((row, i) => { row.rank = i > 0 && same(list[i - 1], row) ? list[i - 1].rank : i + 1; });
  return { rows: list };
}

export function tournamentStatus(t) {
  const total = (t.matches || []).length;
  const played = (t.matches || []).filter((m) => t.results?.[m.id]?.winner).length;
  if (!total) return { state: "draft", played: 0, total: 0 };
  return { state: played === total ? "finished" : "running", played, total };
}

export function roundsOf(matches) {
  const map = new Map();
  matches.forEach((m, i) => {
    if (!map.has(m.r)) map.set(m.r, []);
    map.get(m.r).push({ ...m, no: i + 1 });
  });
  return map;
}

/* ---------- vítězové a statistiky napříč turnaji ---------- */

// Vítězové dokončeného turnaje (první místo, při shodě jich může být víc). Rozpracovaný turnaj nemá vítěze.
export function tournamentWinners(t) {
  if (tournamentStatus(t).state !== "finished") return [];
  const { rows } = computeStandings(t.players || [], t.matches || [], t.results || {});
  const byId = new Map((t.players || []).map((p) => [p.id, p]));
  return rows.filter((r) => r.rank === 1).map((r) => ({ id: r.id, name: r.name, uid: byId.get(r.id)?.uid || null }));
}

const dateMs = (d) => (d?.toDate ? d.toDate().getTime() : new Date(d).getTime() || 0);

// Žebříček členů týmu přes všechny turnaje. Hosté bez účtu (bez uid) se nepočítají.
//  titles = vyhrané turnaje (jen dokončené, shoda na prvním místě se počítá každému),
//  tournaments = dokončené turnaje, kterých se člen zúčastnil,
//  won/lost = rozhodnuté zápasy ze všech turnajů (i z právě probíhajících).
export function playerRanking(tournaments) {
  const map = new Map();
  const get = (p) => {
    if (!map.has(p.uid)) map.set(p.uid, { uid: p.uid, name: p.name, tournaments: 0, titles: 0, won: 0, lost: 0 });
    return map.get(p.uid);
  };
  for (const t of tournaments) {
    const members = new Map((t.players || []).filter((p) => p.uid).map((p) => [p.id, p]));
    if (tournamentStatus(t).state === "finished") {
      for (const p of members.values()) get(p).tournaments++;
      for (const w of tournamentWinners(t)) if (w.uid) get(w).titles++;
    }
    for (const m of t.matches || []) {
      const winner = t.results?.[m.id]?.winner;
      if (!winner) continue;
      for (const side of ["a", "b"]) {
        const p = members.get(m[side]);
        if (p) { const s = get(p); if (winner === m[side]) s.won++; else s.lost++; }
      }
    }
  }
  const list = [...map.values()].map((s) => ({ ...s, pct: s.won + s.lost ? s.won / (s.won + s.lost) : null }));
  list.sort((x, y) => y.titles - x.titles || (y.pct ?? -1) - (x.pct ?? -1) || y.won - x.won || x.name.localeCompare(y.name, "cs"));
  const same = (x, y) => x.titles === y.titles && x.won === y.won && x.lost === y.lost;
  list.forEach((r, i) => { r.rank = i > 0 && same(list[i - 1], r) ? list[i - 1].rank : i + 1; });
  return list;
}

// Vzájemné skóre dvou členů přes všechny turnaje. Nejnovější zápasy jsou první.
export function headToHead(tournaments, uidA, uidB) {
  let a = 0, b = 0;
  const matches = [];
  if (!uidA || !uidB || uidA === uidB) return { a, b, matches }; // hosté bez účtu se nepárují
  for (const t of tournaments) {
    const players = t.players || [];
    const ia = players.find((p) => p.uid === uidA)?.id;
    const ib = players.find((p) => p.uid === uidB)?.id;
    if (!ia || !ib) continue;
    (t.matches || []).forEach((m, i) => {
      if (!((m.a === ia && m.b === ib) || (m.a === ib && m.b === ia))) return;
      const w = t.results?.[m.id]?.winner;
      if (!w) return;
      const winner = w === ia ? uidA : uidB;
      if (winner === uidA) a++; else b++;
      matches.push({ tid: t.id, tournament: t.name, game: t.game, date: t.date, no: i + 1, winner });
    });
  }
  matches.sort((x, y) => dateMs(y.date) - dateMs(x.date) || y.no - x.no);
  return { a, b, matches };
}
