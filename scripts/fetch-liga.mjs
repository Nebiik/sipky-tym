// Stáhne tabulku a rozpis naší ligové skupiny ze sipky.org a uloží je do data/liga.json.
// Spouští se na GitHubu (viz .github/workflows/liga.yml) a ve skriptu nejsou žádná hesla.
//
// Čte jen veřejné stránky, dva požadavky na jedno spuštění: seznam skupin a stránku naší skupiny.
// Osobní údaje hráčů (statistiky jednotlivců) se záměrně nestahují.

import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REFRESH_HOURS = 20; // bez změny dat se soubor přepíše nejvýš jednou denně

const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
const text = (el) => cheerio.load("<x></x>")(el).text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

function fail(msg) {
  const e = new Error(msg);
  e.fatal = true;
  throw e;
}

/* ---------- čtení stránek (čisté funkce, jdou testovat bez internetu) ---------- */

// Najde odkaz na skupinu podle názvu (začátek názvu, např. "2. liga C" najde "2. liga C (neděle)").
export function findGroupLink($, groupName) {
  const want = norm(groupName);
  const hit = $("a[href*='page=ligova-skupina']").toArray()
    .map((a) => ({ name: $(a).text().replace(/\s+/g, " ").trim(), href: $(a).attr("href") }))
    .find((l) => norm(l.name).startsWith(want) && (norm(l.name).length === want.length || /^\W/.test(norm(l.name).slice(want.length))));
  return hit || null;
}

// Tabulky, které neobsahují další tabulky (stránka používá tabulky i na rozložení).
function leafTables($) {
  return $("table").toArray().filter((t) => $(t).find("table").length === 0);
}

function rowsOf($, table) {
  return $(table).find("tr").toArray().map((tr) => $(tr).children("th,td").toArray().map((c) => $(c).text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()));
}

const int = (v, what) => {
  const n = Number.parseInt(String(v).replace(/\s/g, ""), 10);
  if (!Number.isFinite(n)) fail(`V tabulce chybí číslo (${what}: "${v}"). Struktura stránky se asi změnila.`);
  return n;
};

export function parseStandings($) {
  const table = leafTables($).find((t) => {
    const head = rowsOf($, t)[0]?.map(norm) || [];
    return head.includes("druzstvo") && head.includes("body") && head.includes("kol");
  });
  if (!table) fail("Na stránce skupiny jsem nenašel tabulku družstev. Struktura stránky se asi změnila.");
  const out = [];
  for (const tr of $(table).find("tr").toArray()) {
    const tds = $(tr).children("td").toArray().map((c) => $(c).text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim());
    if (!tds.length) continue; // hlavička
    if (tds.length < 16 || tds[10] !== ":" || tds[13] !== ":") fail(`Řádek tabulky má neočekávanou podobu (${tds.length} buněk). Struktura stránky se asi změnila.`);
    out.push({
      rank: int(tds[0], "pořadí"), team: tds[1], played: int(tds[2], "kol"),
      v: int(tds[3], "V"), vp: int(tds[4], "VP"), r: int(tds[5], "R"), pp: int(tds[6], "PP"), p: int(tds[7], "P"), k: int(tds[8], "K"),
      scoreFor: int(tds[9], "skóre"), scoreAgainst: int(tds[11], "skóre"),
      legsFor: int(tds[12], "legy"), legsAgainst: int(tds[14], "legy"),
      points: int(tds[15], "body")
    });
  }
  if (out.length < 3) fail(`V tabulce jsou jen ${out.length} družstva. To nevypadá správně.`);
  return out;
}

const toIsoDate = (d) => {
  const m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(d);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

export function parseFixtures($) {
  const table = leafTables($).find((t) => {
    const head = rowsOf($, t)[0]?.map(norm) || [];
    return head.includes("domaci") && head.includes("hoste") && head.includes("datum");
  });
  if (!table) return []; // na konci sezóny rozpis nemusí být
  const rows = rowsOf($, table);
  const head = rows[0].map(norm);
  const idx = (name) => head.indexOf(name);
  const need = ["den", "datum", "cas", "kolo", "domaci", "hoste", "hraci misto"].map((n) => [n, idx(n)]);
  const missing = need.filter(([, i]) => i < 0).map(([n]) => n);
  if (missing.length) fail(`V rozpisu chybí sloupce: ${missing.join(", ")}.`);
  const col = Object.fromEntries(need);
  const out = [];
  for (const cells of rows.slice(1)) {
    if (cells.length < head.length - 1) continue;
    const date = toIsoDate(cells[col.datum]);
    if (!date) continue;
    out.push({
      day: cells[col.den], date, time: cells[col.cas], round: Number.parseInt(cells[col.kolo], 10) || null,
      home: cells[col.domaci], away: cells[col.hoste], venue: cells[col["hraci misto"]]
    });
  }
  return out;
}

export function parseMeta($) {
  const body = $("body").text().replace(/\u00a0/g, " ");
  const season = $("option[selected]").toArray().map((o) => $(o).text().trim()).find((t) => /^\d{4}\/\d{4}$/.test(t)) || null;
  const sync = /Poslední synchronizace:\s*(\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2})/.exec(body)?.[1] || null;
  return { season, sourceSync: sync };
}

/* ---------- stahování ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(buf, contentType) {
  const declared = /charset\s*=\s*([\w-]+)/i.exec(contentType || "")?.[1];
  const tryDecode = (enc) => { try { return new TextDecoder(enc).decode(buf); } catch { return null; } };
  const first = tryDecode(declared || "windows-1250");
  if (first && !first.includes("\ufffd")) return first;
  return tryDecode("windows-1250");
}

export async function get(url, { ua, retries = 3 } = {}) {
  let last;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": ua, "Accept": "text/html", "Accept-Language": "cs" },
        signal: AbortSignal.timeout(30000)
      });
      const body = decode(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type"));
      const botWall = [403, 429, 503].includes(res.status) || (/Just a moment|cf-chl|Attention Required/i.test(body.slice(0, 5000)) && !/Unie šipkových/.test(body));
      if (botWall) fail(`Web odmítl požadavek (HTTP ${res.status}), pravděpodobně ochrana proti robotům. Zkus to později, nebo stahování spusť odjinud.`);
      if (!res.ok) throw new Error(`HTTP ${res.status} u ${new URL(url).pathname}`);
      return body;
    } catch (e) {
      if (e.fatal) throw e;
      last = e;
      if (attempt < retries) await sleep(5000 * attempt);
    }
  }
  throw new Error(`Stažení se nepovedlo: ${last?.message || last}`);
}

export async function run({
  base = process.env.LIGA_BASE_URL || "https://www.sipky.org",
  out = process.env.LIGA_OUT || path.join(here, "..", "data", "liga.json"),
  now = process.env.LIGA_NOW ? new Date(process.env.LIGA_NOW) : new Date(),
  config = JSON.parse(fs.readFileSync(path.join(here, "liga.config.json"), "utf8")),
  pauseMs = 1500,
  log = console.log
} = {}) {
  base = base.replace(/\/$/, "");
  const repo = process.env.GITHUB_REPOSITORY;
  // Hlavičky smí obsahovat jen znaky bez diakritiky.
  const ua = `PodchodKlubR-liga/1.0 (private darts team app; ${repo ? `https://github.com/${repo}` : "contact via app owner"})`;

  const listUrl = `${base}/?region=${config.region}&page=liga`;
  log(`Hledám skupinu "${config.group}"...`);
  const $list = cheerio.load(await get(listUrl, { ua }));
  const link = findGroupLink($list, config.group);
  if (!link) fail(`Skupinu "${config.group}" jsem na stránce ligy nenašel. Zkontroluj název v scripts/liga.config.json.`);
  const groupUrl = new URL(link.href, `${base}/`).href;

  await sleep(pauseMs);
  const $g = cheerio.load(await get(groupUrl, { ua }));
  const standings = parseStandings($g);
  const fixtures = parseFixtures($g);
  const meta = parseMeta($g);

  if (!standings.some((s) => norm(s.team) === norm(config.team))) {
    log(`Pozor: tým "${config.team}" není v tabulce. Zkontroluj název v scripts/liga.config.json.`);
  }

  const data = {
    checkedAt: now.toISOString(),
    sourceSync: meta.sourceSync,
    source: "sipky.org (UŠO, systém Leguan)",
    sourceUrl: groupUrl,
    group: link.name,
    season: meta.season,
    team: config.team,
    standings,
    fixtures
  };

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(out, "utf8")); } catch { /* první spuštění */ }
  const core = (o) => JSON.stringify({ ...o, checkedAt: undefined, sourceSync: undefined });
  const changed = !prev || core(prev) !== core(data);
  const stale = !prev?.checkedAt || now - new Date(prev.checkedAt) > REFRESH_HOURS * 3600 * 1000;
  if (!changed && !stale) {
    log(`Beze změny (${standings.length} družstev, ${fixtures.length} utkání).`);
    return { written: false, data };
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
  log(`${changed ? "Data se změnila" : "Obnoveno po čase"}: ${standings.length} družstev, ${fixtures.length} utkání. Uloženo.`);
  return { written: true, changed, data };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error("CHYBA: " + e.message);
    process.exit(1);
  });
}
