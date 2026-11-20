// Zápis ligového zápasu: pravidla legu 501 s double out, průměry a křížky. Bez závislosti na Firebase.
//
// Datový model legu (obyčejný objekt, ukládá se do Firestore):
//   { starter: "our"|"opp", visits: [...], cur: [...], winner: null|"our"|"opp", end: null|"checkout"|"bull" }
// visit (jedno kolo = nejvýš 3 šipky jednoho hráče):
//   { by: "our"|"opp", darts?: [{n,m}], score, rem, used, bust?, out? }
//   score = body za kolo (u přehozeného kola 0), rem = kolik zbývá po kole, used = počet hozených šipek.
// Naše šipky se zapisují jednotlivě, u soupeře se zadává jen to, kolik mu zbývá, a body za kolo se dopočítají.

export const START = 501;
export const MAX_ROUNDS = 15;

// 3 šipkami nejdou hodit tyto součty
const IMPOSSIBLE_SCORES = new Set([163, 166, 169, 172, 173, 175, 176, 178, 179]);
// ze zbytku 159, 162, 163, 165, 166, 168 a 169 se třemi šipkami zavřít nedá
const BOGEY = new Set([159, 162, 163, 165, 166, 168, 169]);

export const MISS = { n: 0, m: 1 };
export const BULL = { n: 25, m: 1 };
export const BULLSEYE = { n: 25, m: 2 };

export const other = (s) => (s === "our" ? "opp" : "our");
export const dartValue = (d) => d.n * d.m;
export function dartLabel(d) {
  if (!d.n) return "0";
  if (d.n === 25) return d.m === 2 ? "50" : "25";
  return (d.m === 3 ? "T" : d.m === 2 ? "D" : "") + d.n;
}
export const canFinish = (r) => r >= 2 && r <= 170 && !BOGEY.has(r);

const clone = (x) => JSON.parse(JSON.stringify(x));

export function newLeg(starter) {
  return { starter, visits: [], cur: [], winner: null, end: null };
}

export function remaining(leg, side) {
  for (let i = leg.visits.length - 1; i >= 0; i--) if (leg.visits[i].by === side) return leg.visits[i].rem;
  return START;
}
// Kdo je na tahu. Kola se střídají od hráče, který leg začal.
export function turnOf(leg) {
  if (leg.winner) return null;
  return leg.visits.length % 2 === 0 ? leg.starter : other(leg.starter);
}
export const needsBull = (leg) => !leg.winner && leg.visits.length >= 2 * MAX_ROUNDS;
export const curTotal = (leg) => leg.cur.reduce((s, d) => s + dartValue(d), 0);
export const curRemaining = (leg) => remaining(leg, "our") - curTotal(leg);

// Naše šipka. Vrací nový leg (původní se nemění).
export function addDart(leg, dart) {
  if (leg.winner || turnOf(leg) !== "our" || needsBull(leg)) return leg;
  const L = clone(leg);
  const before = remaining(L, "our");
  const cur = [...L.cur, { n: dart.n, m: dart.m }];
  const total = cur.reduce((s, d) => s + dartValue(d), 0);
  const after = before - total;
  const bust = after < 0 || after === 1 || (after === 0 && dart.m !== 2);
  if (bust) {
    // přehozeno: kolo se nepočítá a zbytek zůstává, počítáme všechny tři šipky
    L.visits.push({ by: "our", darts: cur, score: 0, rem: before, used: 3, bust: true });
    L.cur = [];
  } else if (after === 0) {
    L.visits.push({ by: "our", darts: cur, score: before, rem: 0, used: cur.length, out: true });
    L.cur = [];
    L.winner = "our";
    L.end = "checkout";
  } else if (cur.length === 3) {
    L.visits.push({ by: "our", darts: cur, score: total, rem: after, used: 3 });
    L.cur = [];
  } else {
    L.cur = cur;
  }
  return L;
}

// Kontrola zadaného zbytku soupeře. Vrací { ok, score } nebo { ok:false, error }.
export function checkOpp(leg, rem) {
  if (leg.winner || turnOf(leg) !== "opp" || needsBull(leg)) return { ok: false, error: "Teď nehraje soupeř." };
  const prev = remaining(leg, "opp");
  if (!Number.isInteger(rem) || rem < 0) return { ok: false, error: "Zadej, kolik soupeři zbývá." };
  if (rem > prev) return { ok: false, error: `Soupeři zbývalo ${prev}, víc být nemůže.` };
  if (rem === 1) return { ok: false, error: "Zbytek 1 nejde (double out)." };
  const score = prev - rem;
  if (score > 180 || IMPOSSIBLE_SCORES.has(score)) return { ok: false, error: `Hod ${score} se třemi šipkami nedá hodit.` };
  if (rem === 0 && !canFinish(prev)) return { ok: false, error: `Ze zbytku ${prev} se zavřít nedá.` };
  return { ok: true, score, prev };
}

// Kolo soupeře: zadáváme, kolik mu zbývá. used = počet šipek, jen když zavřel.
export function addOpp(leg, rem, used = 3) {
  const chk = checkOpp(leg, rem);
  if (!chk.ok) return leg;
  const L = clone(leg);
  const out = rem === 0;
  L.visits.push({ by: "opp", score: chk.score, rem, used: out ? Math.min(3, Math.max(1, used)) : 3, ...(out ? { out: true } : {}) });
  if (out) { L.winner = "opp"; L.end = "checkout"; }
  return L;
}

// Rozhodnutí legu mimo hru (hod na střed po 15. kole, oprava).
export function endLeg(leg, winner, end = "bull") {
  if (leg.winner) return leg;
  const L = clone(leg);
  L.cur = [];
  L.winner = winner;
  L.end = end;
  return L;
}

// Vrátit poslední krok: šipku, nebo celé kolo soupeře.
export function undo(leg) {
  const L = clone(leg);
  if (L.cur.length) { L.cur.pop(); return L; }
  if (!L.visits.length) return L;
  const last = L.visits.pop();
  L.winner = null;
  L.end = null;
  if (last.by === "our" && last.darts) {
    L.cur = last.darts.slice(0, -1);
  }
  return L;
}
// Leg bez jediného kroku (jen vybraný začínající) lze celý zrušit.
export const isEmptyLeg = (leg) => !leg.visits.length && !leg.cur.length && !leg.winner;

/* ---------- statistiky ---------- */

export function crossOf(score) {
  return score >= 170 ? 3 : score >= 133 ? 2 : score >= 95 ? 1 : 0;
}

export function sideStats(legs, side) {
  const s = { points: 0, darts: 0, visits: 0, avg: 0, c95: 0, c133: 0, c170: 0, n180: 0, highest: 0, highOut: 0, legsWon: 0, bestLeg: null };
  for (const leg of legs) {
    let legDarts = 0;
    for (const v of leg.visits) {
      if (v.by !== side) continue;
      s.points += v.score; s.darts += v.used; s.visits++; legDarts += v.used;
      if (v.score > s.highest) s.highest = v.score;
      if (v.score === 180) s.n180++;
      const c = crossOf(v.score);
      if (c === 1) s.c95++; else if (c === 2) s.c133++; else if (c === 3) s.c170++;
      if (v.out && v.score > s.highOut) s.highOut = v.score;
    }
    if (leg.winner === side) {
      s.legsWon++;
      if (s.bestLeg === null || legDarts < s.bestLeg) s.bestLeg = legDarts;
    }
  }
  s.avg = s.darts ? (s.points / s.darts) * 3 : 0;
  return s;
}

export function tally(legs) {
  return { our: legs.filter((l) => l.winner === "our").length, opp: legs.filter((l) => l.winner === "opp").length };
}
export function matchState(m) {
  const t = tally(m.legs || []);
  const need = m.legsToWin || 1;
  const decided = t.our >= need || t.opp >= need;
  return { ...t, need, decided, winner: decided ? (t.our > t.opp ? "our" : "opp") : null };
}

// Souhrn kola: kolik zápasů vyhráli naši a kolik soupeř. Týmovka a kriket se počítají také.
export function roundSummary(matches) {
  let ourWins = 0, oppWins = 0, played = 0;
  for (const m of matches) {
    if (m.status !== "done") continue;
    played++;
    const r = m.result || { our: 0, opp: 0 };
    if (r.our > r.opp) ourWins++; else if (r.opp > r.our) oppWins++;
  }
  return { ourWins, oppWins, played };
}

// Součty našich hráčů přes všechny jejich zápasy v kole.
export function playerTotals(matches) {
  const map = new Map();
  for (const m of matches) {
    if (m.kind !== "single" || !(m.legs || []).length) continue;
    if (!map.has(m.ourId)) map.set(m.ourId, { id: m.ourId, name: m.ourName, matches: 0, won: 0, lost: 0, legsW: 0, legsL: 0, points: 0, darts: 0, c95: 0, c133: 0, c170: 0, n180: 0 });
    const p = map.get(m.ourId);
    const st = sideStats(m.legs, "our");
    const t = tally(m.legs);
    p.matches++; p.legsW += t.our; p.legsL += t.opp;
    p.points += st.points; p.darts += st.darts;
    p.c95 += st.c95; p.c133 += st.c133; p.c170 += st.c170; p.n180 += st.n180;
    if (m.status === "done") { if ((m.result?.our ?? 0) > (m.result?.opp ?? 0)) p.won++; else if ((m.result?.opp ?? 0) > (m.result?.our ?? 0)) p.lost++; }
  }
  return [...map.values()].map((p) => ({ ...p, avg: p.darts ? (p.points / p.darts) * 3 : 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "cs"));
}
