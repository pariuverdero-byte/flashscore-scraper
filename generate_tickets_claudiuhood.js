// generate_tickets_claudiuhood.js
// FINAL DEBUG VERSION — strict team-pair + single-team fallback

import fs from "fs/promises";
import * as cheerio from "cheerio";
import { execSync } from "child_process";

const MATCHES_JSON = "matches.json";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);

const RO_MONTH = [
  "ianuarie","februarie","martie","aprilie","mai","iunie",
  "iulie","august","septembrie","octombrie","noiembrie","decembrie"
];

// 🚫 Noise / marketing / article words to exclude
const NOISE_PAT =
  /(cota\s*2|biletul\s*zilei|claudiu\s*hood|facebook|unibet|pariuri|pariori|publicitate|reclama|cookie|ads|window\.|document\.|mii\s*de\s*pariori|utilizatori)/i;

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

// ---------------- EXTRACTION ----------------
function extractFromText(html) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  log(`Extracted text length: ${text.length}`);
  log(`TEXT SAMPLE (first 300 chars):`);
  console.log(text.slice(0, 300));

  const results = [];
  let m;

  // ===== STRICT TEAM PAIR =====
  const PAIR_REGEX =
    /\b([A-Z][A-Za-zÀ-ž .'-]{2,})\s*[-–]\s*([A-Z][A-Za-zÀ-ž .'-]{2,})\b.*?(1X|12|X2|1|X|2|Peste\s*\d+\.5|Sub\s*\d+\.5).*?Cota[: ]+([\d.]+)/gi;

  while ((m = PAIR_REGEX.exec(text)) !== null) {
    const teamA = m[1].trim();
    const teamB = m[2].trim();

    if (NOISE_PAT.test(teamA) || NOISE_PAT.test(teamB)) {
      log(`SKIP noise pair → ${teamA} - ${teamB}`);
      continue;
    }

    log(`PAIR MATCH OK → ${teamA} - ${teamB} | ${m[3]} | ${m[4]}`);

    results.push({
      teamA,
      teamB,
      market_raw: m[3].trim(),
      odd: Number(m[4])
    });
  }

  // ===== SINGLE TEAM FALLBACK =====
  if (!results.length) {
    const SINGLE_REGEX =
      /\b([A-Z][A-Za-zÀ-ž .'-]{3,})\b.*?(1X|12|X2|1|X|2|Peste\s*\d+\.5|Sub\s*\d+\.5).*?Cota[: ]+([\d.]+)/gi;

    while ((m = SINGLE_REGEX.exec(text)) !== null) {
      const team = m[1].trim();
      if (NOISE_PAT.test(team)) continue;

      log(`SINGLE TEAM MATCH OK → ${team} | ${m[2]} | ${m[3]}`);

      results.push({
        teamA: team,
        teamB: null,
        market_raw: m[2].trim(),
        odd: Number(m[3])
      });
    }
  }

  log(`Total VALID Claudiu selections: ${results.length}`);
  return results;
}

// ---------------- MARKET NORMALIZATION ----------------
function normalizeMarket(m) {
  if (!m) return null;
  m = m.toLowerCase();
  if (["1","x","2"].includes(m)) return m.toUpperCase();
  if (["1x","x2","12"].includes(m)) return m.toUpperCase();
  if (m.startsWith("peste")) return "O" + m.match(/(\d+\.5)/)?.[1];
  if (m.startsWith("sub")) return "U" + m.match(/(\d+\.5)/)?.[1];
  return null;
}

// ---------------- FLASHScore MAPPING ----------------
function mapToFlashscore(selections, matches) {
  const mapped = [];

  for (const s of selections) {
    const na = normalize(s.teamA);
    const nb = s.teamB ? normalize(s.teamB) : null;

    let candidates = matches.filter(m => {
      const mt = normalize(m.teams || "");
      return nb ? (mt.includes(na) && mt.includes(nb)) : mt.includes(na);
    });

    if (!candidates.length) {
      log(`❌ No Flashscore match for: ${s.teamA}${s.teamB ? " - " + s.teamB : ""}`);
      continue;
    }

    if (!s.teamB && candidates.length > 1) {
      log(`❌ Ambiguous single-team match for: ${s.teamA}`);
      continue;
    }

    const match = candidates[0];
    const market = normalizeMarket(s.market_raw);
    if (!market) {
      log(`❌ Unsupported market: ${s.market_raw}`);
      continue;
    }

    log(`✅ MAPPED → ${match.teams} | ${market} @ ${s.odd}`);

    mapped.push({
      id: match.id,
      teams: match.teams,
      market,
      odd: s.odd,
      competition: match.competition,
      country: match.country,
      time: match.time,
      url: match.url
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

  const selC2 = extractFromText(htmlC2);
  const selZi = extractFromText(htmlZi);

  if (!selC2.length && !selZi.length)
    fallback("No valid Claudiu selections extracted");

  const mapC2 = mapToFlashscore(selC2.slice(0,2), matches);
  const mapZi = mapToFlashscore(selZi.slice(0,4), matches);

  if (mapC2.length < 2 || mapZi.length < 4)
    fallback("Mapping incomplete after extraction");

  const tickets = {
    date: new Date().toISOString().slice(0,10),
    source: "claudiuhood",
    bilet_cota2: mapC2,
    biletul_zilei: mapZi
  };

  await fs.writeFile("tickets.json", JSON.stringify(tickets,null,2));
  log("SUCCESS → tickets.json written from ClaudiuHood");
})();
