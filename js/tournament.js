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

// Rozpis metodou kruhu: v každém kole hraje každý nejvýš jednou, každá dvojice se potká právě jednou.
// Při lichém počtu hráčů má v každém kole někdo volno. Odveta přidá druhou polovinu s prohozenými stranami.
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
  return rounds.flatMap((rd, ri) =>
    rd.map(([a, b], mi) => ({ id: `r${ri + 1}m${mi + 1}`, r: ri + 1, a, b })));
}

export function computeStandings(players, matches, results) {
  const rows = new Map(players.map((p) => [p.id, {
    id: p.id, name: p.name, played: 0, wins: 0, losses: 0, legsFor: 0, legsAgainst: 0, points: 0
  }]));
  let anyLegs = false;
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
    if (Number.isInteger(res.legsA) && Number.isInteger(res.legsB)) {
      anyLegs = true;
      a.legsFor += res.legsA; a.legsAgainst += res.legsB;
      b.legsFor += res.legsB; b.legsAgainst += res.legsA;
    }
  }
  const list = [...rows.values()].sort((x, y) =>
    y.points - x.points
    || (y.legsFor - y.legsAgainst) - (x.legsFor - x.legsAgainst)
    || y.legsFor - x.legsFor
    || x.name.localeCompare(y.name, "cs"));
  const same = (x, y) => x.points === y.points
    && (x.legsFor - x.legsAgainst) === (y.legsFor - y.legsAgainst) && x.legsFor === y.legsFor;
  list.forEach((row, i) => { row.rank = i > 0 && same(list[i - 1], row) ? list[i - 1].rank : i + 1; });
  return { rows: list, anyLegs };
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
