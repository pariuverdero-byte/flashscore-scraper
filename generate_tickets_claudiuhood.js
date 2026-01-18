// generate_tickets_claudiuhood.js
// FINAL VERSION — Flashscore-driven team detection + Claudiu text markets
// with SINGLE-TEAM fallback + relaxed fallback condition

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

// ---------------- EXTRACT VIA FLASHScore ----------------
function extractFromText(html, matches) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").toLowerCase();

  log(`Extracted text length: ${text.length}`);

  const results = [];

  function detectMarketAndOdd(text) {
    // 1️⃣ goal-based markets FIRST (priority)
    if (/minim\s*2\s*goluri|peste\s*1\.5/.test(text)) {
      const odd = text.match(/cota[: ]+([\d.]+)/i)?.[1];
      return odd ? { market: "peste 1.5", odd: Number(odd) } : null;
    }

    if (/minim\s*3\s*goluri|peste\s*2\.5/.test(text)) {
      const odd = text.match(/cota[: ]+([\d.]+)/i)?.[1];
      return odd ? { market: "peste 2.5", odd: Number(odd) } : null;
    }

    if (/sub\s*2\.5/.test(text)) {
      const odd = text.match(/cota[: ]+([\d.]+)/i)?.[1];
      return odd ? { market: "sub 2.5", odd: Number(odd) } : null;
    }

    // 2️⃣ result markets LAST
    if (/\bcota\b/.test(text)) {
      const odd = text.match(/cota[: ]+([\d.]+)/i)?.[1];
      if (!odd) return null;

      if (/\bcastiga\b|\bvictorie\b/.test(text)) {
        return { market: "win", odd: Number(odd) };
      }
    }

    return null;
  }

  for (const match of matches) {
    if (!match.teams) continue;

    const [teamA, teamB] = match.teams.split(" - ").map(t => t?.trim());
    if (!teamA || !teamB) continue;

    const na = normalize(teamA);
    const nb = normalize(teamB);

    if (!text.includes(na) && !text.includes(nb)) continue;

    const mo = detectMarketAndOdd(text);
    if (!mo) continue;

    log(`CLAUDIU BET → ${teamA} - ${teamB} | ${mo.market} | ${mo.odd}`);

    results.push({
      teamA,
      teamB,
      market_raw: mo.market,
      odd: mo.odd
    });
  }

  log(`Total matches detected via Claudiu text: ${results.length}`);
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

// ---------------- BUILD TICKETS ----------------
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

    // 🔑 KEEP CLAUDIU MARKET + ODD AS-IS
    log(
      `✅ MAPPED (Claudiu odds kept) → ${match.teams} | ${s.market_raw} @ ${s.odd}`
    );

    mapped.push({
      id: match.id,
      teams: match.teams,
      market: s.market_raw,   // ⬅ KEEP EXACT CLAUDIU MARKET
      odd: s.odd,             // ⬅ KEEP EXACT CLAUDIU ODD
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

  const selC2 = extractFromText(htmlC2, matches);
  const selZi = extractFromText(htmlZi, matches);

  if (!selC2.length && !selZi.length)
    fallback("No valid Claudiu tickets generated");

  const mapC2 = mapToFlashscore(selC2.slice(0,2), matches);
  const mapZi = mapToFlashscore(selZi.slice(0,4), matches);

  // ✅ relaxed condition: allow either ticket
  if (!mapC2.length && !mapZi.length)
    fallback("No mapped tickets after extraction");

  const tickets = {
    date: new Date().toISOString().slice(0,10),
    source: "claudiuhood",
    bilet_cota2: mapC2,
    biletul_zilei: mapZi
  };

  await fs.writeFile("tickets.json", JSON.stringify(tickets,null,2));
  log("SUCCESS → tickets.json written from ClaudiuHood");
})();
