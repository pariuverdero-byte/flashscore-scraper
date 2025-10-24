// scrape_betexplorer.js — pull 1X2 odds from BetExplorer (HTML) and map onto matches.json
// Outputs:
//   - odds_betexplorer.json  (raw odds keyed by pair)
//   - odds.json              (same schema your generator already uses)

import fs from "fs/promises";
import * as cheerio from "cheerio";

// ---------- Config ----------
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: "https://www.betexplorer.com/",
};

// We’ll scrape soccer only (your ticket engine is mainly soccer now).
const BETEXPLORER_URL = "https://www.betexplorer.com/next/soccer/";

// ---------- Helpers ----------
function normName(s = "") {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&amp;/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(fc|cf|afc|sc|club|u19|u20|u21|w|women|the|de|da|do|la|el|los|las)\b/g, " ")
    .replace(/\b(st\.|st)\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}
function pairKey(home, away) {
  return `${normName(home)}__${normName(away)}`;
}
function softMatch(a, b) {
  const A = normName(a), B = normName(b);
  if (!A || !B) return false;
  if (A === B) return true;
  // containments
  if (A.length > 3 && B.includes(A)) return true;
  if (B.length > 3 && A.includes(B)) return true;
  return false;
}
function samePair(fsHome, fsAway, beHome, beAway) {
  // direct
  if (softMatch(fsHome, beHome) && softMatch(fsAway, beAway)) return true;
  // swapped (bookmakers sometimes reverse order)
  if (softMatch(fsHome, beAway) && softMatch(fsAway, beHome)) return true;
  return false;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

// ---------- Scrape BetExplorer (soccer) ----------
async function scrapeBetExplorerSoccer() {
  const html = await fetchText(BETEXPLORER_URL);
  await fs.writeFile("list-betexplorer.html", html, "utf8");

  const $ = cheerio.load(html);
  const out = [];

  // BetExplorer “Next” has multiple blocks; a safe approach is:
  //  - find rows that contain a link to a match and 3 odds (1/X/2)
  //  - team names usually appear like "Home – Away"
  //  - we keep robust fallback parsing
  $("a[href*='/match/']").each((_, a) => {
    const link = $(a);
    const href = link.attr("href") || "";
    const full = new URL(href, "https://www.betexplorer.com").toString();

    // Try to read teams text from the anchor or nearby container
    let teamsTxt = link.text().trim();
    if (!teamsTxt || !teamsTxt.includes(" - ")) {
      const near = link.closest("tr, div, li");
      const maybe = near.text().replace(/\s+/g, " ").trim();
      const m = maybe.match(/([^\n]+ - [^\n]+)/);
      if (m) teamsTxt = m[1].trim();
    }
    if (!teamsTxt || !teamsTxt.includes(" - ")) return;

    const [home, away] = teamsTxt.split(" - ").map((s) => s.trim());

    // Find odds near the link: typical in same row (three cells)
    // Flexible search: look ahead for numbers that look like decimal odds
    const row = link.closest("tr").length ? link.closest("tr") : link.parent();
    const oddsCandidates = [];
    row.find("td, span, a").each((__, el2) => {
      const t = $(el2).text().trim();
      if (/^\d+(?:\.\d+|,\d+)$/.test(t)) oddsCandidates.push(t.replace(",", "."));
    });

    // Keep first 3 distinct numbers as 1/X/2
    const uniq = [];
    for (const v of oddsCandidates) {
      if (!uniq.includes(v)) uniq.push(v);
      if (uniq.length >= 3) break;
    }
    if (uniq.length < 2) return; // need at least 1 & 2; X is optional on some books

    const o1 = Number(uniq[0] || NaN);
    const ox = uniq[2] ? Number(uniq[1]) : Number.NaN; // heuristic: some layouts are 1, X, 2
    const o2 = Number(uniq[2] || uniq[1] || NaN);

    // Sanity: odds must be >=1.1 and finite
    const ok1 = Number.isFinite(o1) && o1 >= 1.1;
    const ok2 = Number.isFinite(o2) && o2 >= 1.1;
    const okx = Number.isFinite(ox) && ox >= 1.1;

    if (!ok1 || !ok2) return;

    // Extract time if visible (optional)
    let time = "";
    const timeSpan = row.find("span, small").filter((i, el) => /^\d{1,2}:\d{2}$/.test($(el).text().trim())).first();
    if (timeSpan.length) time = timeSpan.text().trim();

    out.push({
      be_url: full,
      home,
      away,
      time,
      o1,
      ox: okx ? ox : null,
      o2,
    });
  });

  return out;
}

// ---------- Map to Flashscore matches & write odds.json ----------
async function main() {
  // Load Flashscore matches (already produced by scrape_mobi.js)
  const matchesRaw = await fs.readFile("matches.json", "utf8").catch(() => null);
  if (!matchesRaw) {
    console.log("No matches.json present. Nothing to map.");
    process.exit(0);
  }
  const matches = JSON.parse(matchesRaw);

  // Scrape BetExplorer soccer odds
  const be = await scrapeBetExplorerSoccer();
  await fs.writeFile("odds_betexplorer.json", JSON.stringify(be, null, 2), "utf8");
  console.log(`[betexplorer] parsed ${be.length} odds rows`);

  // Index BetExplorer by normalized pair (both directions)
  const beIndex = new Map();
  for (const r of be) {
    const k1 = pairKey(r.home, r.away);
    const k2 = pairKey(r.away, r.home);
    if (!beIndex.has(k1)) beIndex.set(k1, []);
    if (!beIndex.has(k2)) beIndex.set(k2, []);
    beIndex.get(k1).push(r);
    beIndex.get(k2).push(r);
  }

  // Map onto Flashscore matches (Fotbal only)
  const events = [];
  for (const m of matches) {
    const sport = (m.sport || "Fotbal").toLowerCase();
    if (sport !== "fotbal" && sport !== "football" && sport !== "soccer") continue;

    const [home, away] = String(m.teams || "").split(" - ").map((s) => s.trim());
    if (!home || !away) continue;

    // Try direct normalized key first
    const direct = beIndex.get(pairKey(home, away));
    let candidate = direct && direct[0];

    // If not found, scan for soft match
    if (!candidate) {
      for (const r of be) {
        if (samePair(home, away, r.home, r.away)) { candidate = r; break; }
      }
    }

    if (!candidate) continue;

    // Build odds rows in your expected format
    if (candidate.o1) events.push({ id: m.id, teams: m.teams, market: "1", odd: candidate.o1, url: m.url });
    if (candidate.ox) events.push({ id: m.id, teams: m.teams, market: "X", odd: candidate.ox, url: m.url });
    if (candidate.o2) events.push({ id: m.id, teams: m.teams, market: "2", odd: candidate.o2, url: m.url });
  }

  // If we found anything, overwrite odds.json; otherwise leave existing file (if any)
  if (events.length) {
    await fs.writeFile("odds.json", JSON.stringify({ events }, null, 2), "utf8");
    console.log(`✔ odds.json written with ${events.length} rows (from BetExplorer)`);
  } else {
    console.log("⚠ No matches mapped to BetExplorer odds. Check list-betexplorer.html & odds_betexplorer.json");
  }
}

(async () => {
  try {
    await main();
  } catch (e) {
    console.error("❌ scrape_betexplorer fatal:", e.message);
    process.exit(1);
  }
})();
