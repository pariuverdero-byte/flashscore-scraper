// scrape_claudiu_pool.js
// Build a LARGE pool of selections from ClaudiuHood pages,
// then map each selection to Flashscore matches.json (id + url).
// Output: claudiu_pool.json

import fs from "fs/promises";
import * as cheerio from "cheerio";

const MATCHES_JSON = "matches.json";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const MIN_ODD = Number(process.env.CLAUDIU_MIN_ODD || 1.15);

const UA = "Mozilla/5.0";
const LANG = "ro-RO,ro;q=0.9,en;q=0.8";

const RO_MONTH = [
  "ianuarie","februarie","martie","aprilie","mai","iunie",
  "iulie","august","septembrie","octombrie","noiembrie","decembrie"
];

const log = (msg) => console.log(`[claudiu_pool] ${msg}`);

function buildDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return {
    day: d.getDate(),
    dd: String(d.getDate()).padStart(2, "0"),
    mm: String(d.getMonth() + 1).padStart(2, "0"),
    monthName: RO_MONTH[d.getMonth()],
    year: d.getFullYear(),
    iso: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
  };
}

function safeMonthName(monthName) {
  return monthName.normalize("NFKD").replace(/[^\w]/g, "").toLowerCase();
}

function buildUrls(offset) {
  const { day, dd, mm, monthName, year } = buildDate(offset);
  const m = safeMonthName(monthName);

  // daily pages (date in url)
  const daily = [
    ["cota2", `https://www.claudiuhood.ro/cota-2-zilnica-${day}-${m}-${year}/`],
    ["biletul_zilei", `https://www.claudiuhood.ro/biletul-zilei-${dd}-${mm}-${year}/`],
    ["varianta_rezerva", `https://www.claudiuhood.ro/varianta-rezerva-${dd}-${mm}-${year}/`],
    ["varianta_germania", `https://www.claudiuhood.ro/varianta-germania-${dd}-${mm}-${year}/`],
    ["variante_speciale", `https://www.claudiuhood.ro/variante-speciale-${dd}-${mm}-${year}/`],
    ["evenimente_evidentiate", `https://www.claudiuhood.ro/evenimente-evidentiate-${dd}-${mm}-${year}/`],
  ];

  // static pages (no date in url)
  const staticPages = [
    ["meciul_zilei", "https://www.claudiuhood.ro/meciul-zilei/"],
    ["meciul_noptii", "https://www.claudiuhood.ro/meciul-noptii/"],
  ];

  return { daily, staticPages };
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": LANG }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

function normalize(s="") {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOddCell(txt) {
  const m = String(txt || "").match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return NaN;
  return Number(m[1].replace(",", "."));
}

function splitTeamsFromCell(txt) {
  const t = String(txt || "").trim();
  if (!t) return [null, null];

  // Claudiu uses EN DASH: "PSG – Lille"
  if (t.includes("–")) {
    const parts = t.split("–").map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts.slice(1).join(" - ")];
  }
  if (t.includes(" - ")) {
    const parts = t.split(" - ").map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts.slice(1).join(" - ")];
  }
  return [null, null];
}

// Keep market_raw stable, but semi-structured where possible
function marketFromBetText(betTextRaw) {
  const bet = String(betTextRaw || "").replace(/\s+/g, " ").trim();
  const low = bet.toLowerCase();

  // team goals "minim X goluri"
  const mg = low.match(/minim\s*(\d+)\s*gol/i);
  if (mg) return `TEAM_GOALS_MIN_${mg[1]}`;

  // totals over/under
  const over = low.match(/\b(peste|over)\s*(\d+(?:[.,]\d+)?)\b/);
  if (over) return `O${over[2].replace(",", ".")}`;
  const under = low.match(/\b(sub|under)\s*(\d+(?:[.,]\d+)?)\b/);
  if (under) return `U${under[2].replace(",", ".")}`;

  // interval 1-3 goals in half / match
  if (/interval\s*1\s*-\s*3/i.test(low) && /prima\s*repriz/i.test(low)) return "INT_1_3_GOALS_1H";
  if (/interval\s*1\s*-\s*3/i.test(low) && /repriza\s*a\s*doua/i.test(low)) return "INT_1_3_GOALS_2H";
  if (/interval\s*1\s*-\s*3/i.test(low) && /meci/i.test(low)) return "INT_1_3_GOALS_FT";

  // corners (example)
  if (/cornere/i.test(low)) return `CUSTOM:${bet}`;

  // default
  return `CUSTOM:${bet}`;
}

// Extract selections row-by-row from any tables in the page
function extractSelectionsFromTables(html, sourceKey) {
  const $ = cheerio.load(html);
  const results = [];

  $("table").each((_, table) => {
    $(table).find("tr").each((__, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 3) return;

      const teamsCell = $(tds[0]).text().trim();
      const betCell   = $(tds[1]).text().trim();
      const oddCell   = $(tds[2]).text().trim();

      if (!teamsCell || !betCell || !oddCell) return;

      // skip summary rows
      if (/unibet/i.test(teamsCell) || /unibet/i.test(betCell)) return;
      if (/biletul\s*zilei/i.test(teamsCell) || /cota\s*2/i.test(teamsCell)) return;

      const [teamA, teamB] = splitTeamsFromCell(teamsCell);
      if (!teamA || !teamB) return;

      const odd = parseOddCell(oddCell);
      if (!isFinite(odd) || odd < MIN_ODD || odd > 100) return;

      const market_raw = marketFromBetText(betCell);

      results.push({
        teamA,
        teamB,
        teams: `${teamA} - ${teamB}`,
        market_raw,
        odd,
        source: sourceKey,
        meta: { bet_text: betCell }
      });
    });
  });

  return results;
}

// Map selection to Flashscore match by team names
function mapToFlashscore(selection, matches) {
  const na = normalize(selection.teamA);
  const nb = normalize(selection.teamB);

  const match = matches.find(m => {
    const mt = normalize(m.teams || "");
    return mt.includes(na) && mt.includes(nb);
  });

  if (!match) return null;

  return {
    match_id: match.id,
    teams: match.teams,
    market_raw: selection.market_raw,
    odd: selection.odd,
    source: selection.source,
    url: match.url,
    competition: match.competition,
    country: match.country,
    time: match.time,
    meta: selection.meta || {}
  };
}

// Dedupe:
// 1) remove duplicates match_id + market_raw (keep higher odd)
// 2) keep max 1 selection per match_id (highest odd)
function dedupeAndOnePerMatch(mapped) {
  // (match_id|market) -> best
  const byKey = new Map();
  for (const s of mapped) {
    const k = `${s.match_id}|${s.market_raw}`;
    if (!byKey.has(k) || s.odd > byKey.get(k).odd) byKey.set(k, s);
  }
  const unique = [...byKey.values()];

  // one per match: keep highest odd
  const byMatch = new Map();
  for (const s of unique) {
    const k = s.match_id;
    if (!byMatch.has(k) || s.odd > byMatch.get(k).odd) byMatch.set(k, s);
  }
  return [...byMatch.values()];
}

(async () => {
  // Load Flashscore matches.json
  let matches = [];
  try {
    const raw = await fs.readFile(MATCHES_JSON, "utf8");
    matches = JSON.parse(raw).matches || [];
  } catch {
    log("❌ matches.json missing/invalid. Run scrape_mobi.js before this script.");
    process.exit(1);
  }

  if (!matches.length) {
    log("❌ No Flashscore matches in matches.json (empty).");
    process.exit(1);
  }

  const date = buildDate(DAY_OFFSET);
  const { daily, staticPages } = buildUrls(DAY_OFFSET);

  const sourcesTried = [];
  const rawSelections = [];

  // Fetch daily pages
  for (const [key, url] of daily) {
    sourcesTried.push(key);
    try {
      const html = await fetchHtml(url);
      await fs.writeFile(`claudiu_${key}.html`, html, "utf8");
      const rows = extractSelectionsFromTables(html, key);
      log(`${key}: extracted ${rows.length} rows`);
      rawSelections.push(...rows);
    } catch (e) {
      log(`${key}: skip (${e.message})`);
    }
  }

  // Fetch static pages
  for (const [key, url] of staticPages) {
    sourcesTried.push(key);
    try {
      const html = await fetchHtml(url);
      await fs.writeFile(`claudiu_${key}.html`, html, "utf8");
      const rows = extractSelectionsFromTables(html, key);
      log(`${key}: extracted ${rows.length} rows`);
      rawSelections.push(...rows);
    } catch (e) {
      log(`${key}: skip (${e.message})`);
    }
  }

  if (!rawSelections.length) {
    log("❌ No selections extracted from any Claudiu pages.");
    // still write output for debugging
    const out = { date: date.iso, day_offset: DAY_OFFSET, sources: sourcesTried, selections: [] };
    await fs.writeFile("claudiu_pool.json", JSON.stringify(out, null, 2), "utf8");
    process.exit(0);
  }

  // Map to Flashscore
  const mapped = [];
  let unmapped = 0;
  for (const s of rawSelections) {
    const ms = mapToFlashscore(s, matches);
    if (!ms) { unmapped++; continue; }
    mapped.push(ms);
  }

  log(`Mapped selections: ${mapped.length} (unmapped: ${unmapped})`);

  // Dedupe and keep one per match
  const finalPool = dedupeAndOnePerMatch(mapped);
  log(`Final pool after dedupe + one-per-match: ${finalPool.length}`);

  const out = {
    date: date.iso,
    day_offset: DAY_OFFSET,
    min_odd: MIN_ODD,
    sources: sourcesTried,
    selections: finalPool
  };

  await fs.writeFile("claudiu_pool.json", JSON.stringify(out, null, 2), "utf8");
  log("✅ claudiu_pool.json written");
})();
