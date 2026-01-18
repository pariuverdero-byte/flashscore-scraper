// generate_tickets_claudiuhood.js
// FIXED VERSION — Row-by-row table extraction (keeps Claudiu bet + odds) + Flashscore mapping
// Still supports fallback to generate_tickets.js and "either ticket is ok"

import fs from "fs/promises";
import * as cheerio from "cheerio";
import { execSync } from "child_process";

const MATCHES_JSON = "matches.json";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);

const RO_MONTH = [
  "ianuarie","februarie","martie","aprilie","mai","iunie",
  "iulie","august","septembrie","octombrie","noiembrie","decembrie"
];

const log = (msg) => console.log(`[claudiu][DEBUG] ${msg}`);

function fallback(reason) {
  log(`FALLBACK TRIGGERED → ${reason}`);
  execSync("node generate_tickets.js", { stdio: "inherit" });
  process.exit(0);
}

// ---------------- DATE + URL ----------------
function buildDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return {
    day: d.getDate(),
    dd: String(d.getDate()).padStart(2,"0"),
    mm: String(d.getMonth()+1).padStart(2,"0"),
    monthName: RO_MONTH[d.getMonth()],
    year: d.getFullYear()
  };
}

function buildUrls() {
  const { day, dd, mm, monthName, year } = buildDate(DAY_OFFSET);

  const safeMonth = monthName
    .normalize("NFKD")
    .replace(/[^\w]/g, "")
    .toLowerCase();

  const urls = {
    cota2: `https://www.claudiuhood.ro/cota-2-zilnica-${day}-${safeMonth}-${year}/`,
    zi: `https://www.claudiuhood.ro/biletul-zilei-${dd}-${mm}-${year}/`
  };

  log(`Using URLs: ${JSON.stringify(urls)}`);
  return urls;
}

// ---------------- FETCH ----------------
async function fetchHtml(url) {
  log(`Fetching URL: ${url}`);
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8"
    }
  });
  log(`HTTP status: ${r.status}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  log(`Fetched HTML size: ${html.length} bytes`);
  return html;
}

// ---------------- NORMALIZE ----------------
function normalize(s="") {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOddCell(txt) {
  // examples: "Cotă 1.33", "Cota 2.30"
  const m = String(txt || "").match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return NaN;
  return Number(m[1].replace(",", "."));
}

function splitTeamsFromCell(txt) {
  // teams are written with EN DASH in the page: "PSG – Lille"
  const t = String(txt || "").trim();
  if (!t) return [null, null];

  const parts =
    t.split("–").map(x => x.trim()).filter(Boolean).length >= 2
      ? t.split("–").map(x => x.trim())
      : t.split(" - ").map(x => x.trim());

  if (parts.length < 2) return [null, null];
  return [parts[0], parts.slice(1).join(" - ")];
}

// Map Claudiu bet text -> a stable "market_raw" label we keep in tickets.json
function marketFromBetText(betTextRaw) {
  const bet = String(betTextRaw || "").toLowerCase().replace(/\s+/g, " ").trim();

  // Team goals "minim X goluri"
  // "FCSB minim 2 goluri marcate în meci" -> "TEAM_GOALS_MIN_2"
  const mg = bet.match(/minim\s*(\d+)\s*gol/i);
  if (mg) return `TEAM_GOALS_MIN_${mg[1]}`;

  // Over/Under totals
  const over = bet.match(/\b(peste|over)\s*(\d+(?:[.,]\d+)?)\b/);
  if (over) return `O${over[2].replace(",", ".")}`;
  const under = bet.match(/\b(sub|under)\s*(\d+(?:[.,]\d+)?)\b/);
  if (under) return `U${under[2].replace(",", ".")}`;

  // Interval markets (as on Claudiu page)
  // "Interval 1-3 goluri marcate total în prima repriză"
  if (/interval\s*1\s*-\s*3/i.test(bet) && /prima\s*repriz/i.test(bet)) return "INT_1_3_GOALS_1H";
  if (/interval\s*1\s*-\s*3/i.test(bet) && /repriza\s*a\s*doua/i.test(bet)) return "INT_1_3_GOALS_2H";
  if (/interval\s*1\s*-\s*3/i.test(bet) && /meci/i.test(bet)) return "INT_1_3_GOALS_FT";

  // If not recognized, keep raw text (still useful for WP output)
  return `CUSTOM:${betTextRaw.trim()}`;
}

// ---------------- EXTRACT ROW-BY-ROW FROM TABLE ----------------
function extractFromHtmlTables(html) {
  const $ = cheerio.load(html);
  const results = [];

  // We target the actual selection tables; this will also catch wp-block-table tables
  $("table").each((_, table) => {
    $(table).find("tr").each((__, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 3) return;

      const teamsCell = $(tds[0]).text().trim();
      const betCell = $(tds[1]).text().trim();
      const oddCell = $(tds[2]).text().trim();

      // Filter summary rows like "Biletul Zilei ..." / "Unibet" etc.
      if (!teamsCell) return;
      if (/unibet/i.test(teamsCell) || /unibet/i.test(betCell)) return;
      if (/biletul\s*zilei/i.test(teamsCell) || /cota\s*2/i.test(teamsCell)) return;

      const [teamA, teamB] = splitTeamsFromCell(teamsCell);
      if (!teamA || !teamB) return;

      const odd = parseOddCell(oddCell);
      if (!isFinite(odd) || odd <= 1.01 || odd > 100) return;

      const market_raw = marketFromBetText(betCell);

      results.push({
        teamA,
        teamB,
        market_raw,
        odd,
        meta: {
          bet_text: betCell
        }
      });

      log(`ROW → ${teamA} - ${teamB} | ${market_raw} | ${odd} | bet="${betCell}"`);
    });
  });

  log(`Total row-level selections extracted: ${results.length}`);
  return results;
}

// ---------------- BUILD TICKETS (Flashscore mapping only) ----------------
function mapToFlashscore(selections, matches) {
  const mapped = [];

  for (const s of selections) {
    const na = normalize(s.teamA);
    const nb = normalize(s.teamB);

    const match = matches.find(m => {
      const mt = normalize(m.teams || "");
      return mt.includes(na) && mt.includes(nb);
    });

    if (!match) {
      log(`❌ No Flashscore match for ${s.teamA} - ${s.teamB}`);
      continue;
    }

    // KEEP CLAUDIU MARKET + ODD AS-IS
    log(`✅ MAPPED (Claudiu kept) → ${match.teams} | ${s.market_raw} @ ${s.odd}`);

    mapped.push({
      id: match.id,
      teams: match.teams,
      market: s.market_raw,
      odd: s.odd,
      competition: match.competition,
      country: match.country,
      time: match.time,
      url: match.url,
      meta: s.meta || {}
    });
  }

  log(`Total mapped selections: ${mapped.length}`);
  return mapped;
}

// ---------------- MAIN ----------------
(async () => {
  const urls = buildUrls();

  let matches = [];
  try {
    const raw = await fs.readFile(MATCHES_JSON, "utf8");
    matches = JSON.parse(raw).matches || [];
    log(`Flashscore matches loaded: ${matches.length}`);
  } catch {
    fallback("matches.json missing or invalid");
  }

  if (!matches.length) fallback("No Flashscore matches for this day");

  let htmlC2, htmlZi;
  try {
    htmlC2 = await fetchHtml(urls.cota2);
    htmlZi = await fetchHtml(urls.zi);
    await fs.writeFile("claudiu_cota2.html", htmlC2);
    await fs.writeFile("claudiu_zi.html", htmlZi);
  } catch (e) {
    fallback(`Claudiu fetch failed: ${e.message}`);
  }

  // Extract row-by-row from tables (correct granularity)
  const selC2 = extractFromHtmlTables(htmlC2);
  const selZi = extractFromHtmlTables(htmlZi);

  if (!selC2.length && !selZi.length)
    fallback("No row-level selections found in Claudiu pages");

  // Keep first 2 for Cota2 and first 4 for Biletul Zilei
  const mapC2 = mapToFlashscore(selC2.slice(0, 2), matches);
  const mapZi = mapToFlashscore(selZi.slice(0, 4), matches);

  // relaxed: allow either ticket
  if (!mapC2.length && !mapZi.length)
    fallback("No mapped tickets after extraction");

  const tickets = {
    date: new Date().toISOString().slice(0,10),
    source: "claudiuhood",
    bilet_cota2: mapC2,
    biletul_zilei: mapZi
  };

  await fs.writeFile("tickets.json", JSON.stringify(tickets, null, 2));
  log("SUCCESS → tickets.json written from ClaudiuHood");
})();
