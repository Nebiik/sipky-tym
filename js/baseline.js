// Starší zápasy z doby před aplikací (třeba z Pechtiku). Jsou uložené jako souhrn za hráče a za kolo,
// protože se u nich nezachovaly jednotlivé šipky. Tady je kontrola vloženého souboru a spojení se
// statistikou ze zápasů zapsaných v aplikaci.
import { BETON_FINE } from "./scoring.js";

export const BASELINE_MAX = 60;

const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= 100000;
const isStr = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max;

// Zkontroluje text vloženého souboru. Vrací { ok: true, data } nebo { ok: false, error }.
export function parseBaselineText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: "Tohle není platný JSON. Vlož celý obsah souboru." }; }
  if (!raw || typeof raw !== "object" || raw.version !== 1) return { ok: false, error: "Neznámý formát importu (čekám verzi 1)." };
  if (!Array.isArray(raw.rounds) || !Array.isArray(raw.players)) return { ok: false, error: "V importu chybí seznam kol nebo hráčů." };
  if (raw.rounds.length > BASELINE_MAX || raw.players.length > BASELINE_MAX) return { ok: false, error: `Import je moc velký (nejvýš ${BASELINE_MAX} kol a ${BASELINE_MAX} hráčů).` };

  const rounds = [];
  for (const [i, r] of raw.rounds.entries()) {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || "") || isNaN(new Date(`${r.date}T12:00:00`))) return { ok: false, error: `Kolo ${i + 1}: špatné datum (čekám RRRR-MM-DD).` };
    if (!isStr(r.opponent, 80)) return { ok: false, error: `Kolo ${i + 1}: chybí soupeř.` };
    if (!isCount(r.ourWins) || !isCount(r.oppWins)) return { ok: false, error: `Kolo ${i + 1}: špatný výsledek.` };
    rounds.push({ date: r.date, opponent: r.opponent.trim(), home: r.home === true, ourWins: r.ourWins, oppWins: r.oppWins });
  }

  const players = [];
  const seen = new Set();
  for (const [i, p] of raw.players.entries()) {
    if (!p || !isStr(p.key, 40)) return { ok: false, error: `Hráč ${i + 1}: chybí jméno.` };
    if (seen.has(p.key)) return { ok: false, error: `Hráč ${p.key} je v importu dvakrát.` };
    seen.add(p.key);
    for (const k of ["won", "lost", "legsW", "legsL", "c95", "c133", "c170", "beton"]) {
      if (!isCount(p[k])) return { ok: false, error: `Hráč ${p.key}: špatná hodnota ${k}.` };
    }
    if (typeof p.avg !== "number" || !(p.avg >= 0 && p.avg <= 180)) return { ok: false, error: `Hráč ${p.key}: špatný průměr.` };
    players.push({
      key: p.key.trim(), name: p.key.trim(), uid: null,
      won: p.won, lost: p.lost, legsW: p.legsW, legsL: p.legsL,
      avg: Math.round(p.avg * 10) / 10, c95: p.c95, c133: p.c133, c170: p.c170, beton: p.beton,
      ...(p.avgApprox === true ? { avgApprox: true } : {})
    });
  }
  const source = isStr(raw.source, 60) ? raw.source.trim() : "Starší zápasy";
  return { ok: true, data: { source, rounds, players } };
}

const emptyRow = (id, name) => ({ id, name, matches: 0, won: 0, lost: 0, legsW: 0, legsL: 0, points: 0, darts: 0, c95: 0, c133: 0, c170: 0, n180: 0, beton: 0, avg: 0, fine: 0 });

// Přidá starší zápasy k hráčům ze zápasů v aplikaci. Hráč s uid se spojí s členem týmu, bez uid je
// samostatný řádek. Průměr se spojuje váženě podle odehraných legů (u starších zápasů není počet šipek).
export function mergeBaseline(rows, baseline) {
  const out = rows.map((r) => ({ ...r }));
  if (!baseline?.players?.length) return out;
  const byId = new Map(out.map((r) => [r.id, r]));
  for (const b of baseline.players) {
    const played = b.won + b.lost;
    if (!played && !b.beton && !(b.c95 + b.c133 + b.c170)) continue;
    let r = b.uid ? byId.get(b.uid) : null;
    if (!r) {
      r = emptyRow(b.uid || `b:${b.key}`, b.name || b.key);
      out.push(r);
      if (b.uid) byId.set(b.uid, r);
    }
    const aLegs = r.legsW + r.legsL;
    const bLegs = b.legsW + b.legsL;
    r.avg = aLegs + bLegs ? (r.avg * aLegs + b.avg * bLegs) / (aLegs + bLegs) : 0;
    r.matches += played; r.won += b.won; r.lost += b.lost;
    r.legsW += b.legsW; r.legsL += b.legsL;
    r.c95 += b.c95; r.c133 += b.c133; r.c170 += b.c170;
    r.beton += b.beton; r.fine = r.beton * BETON_FINE;
  }
  return out;
}

// Součty týmu z řádků hráčů (průměr vážený počtem legů).
export function sumPlayers(rows) {
  const sum = (k) => rows.reduce((s, p) => s + (p[k] || 0), 0);
  const legs = rows.reduce((s, p) => s + p.legsW + p.legsL, 0);
  return {
    played: sum("matches"), won: sum("won"), lost: sum("lost"), legsW: sum("legsW"), legsL: sum("legsL"),
    avg: legs ? rows.reduce((s, p) => s + p.avg * (p.legsW + p.legsL), 0) / legs : 0,
    c95: sum("c95"), c133: sum("c133"), c170: sum("c170"), n180: sum("n180"), beton: sum("beton"), fine: sum("fine")
  };
}
