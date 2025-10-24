// scrape_betexplorer.js — pull 1X2 odds from BetExplorer (HTML) with 429-safe backoff.
// If scraping fails, the script logs a warning, writes odds_betexplorer.debug.json and exits 0
// so the rest of the pipeline (tickets, WP) still runs.

import fs from "fs/promises";
import * as cheerio from "cheerio";

// --------------- Config ---------------
const BETEXPLORER_URL = "https://www.betexplorer.com/next/soccer/";

// Rotate a few common desktop UA strings to avoid trivial fingerprinting
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
];

function pickUA() { return UAS[Math.floor(Math.random() * UAS.length)]; }

const BASE_HEADERS = () => ({
  "User-Agent": pickUA(),
  "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: "https://www.betexplorer.com/",
});

// --------------- Helpers ---------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, { tries = 6, baseDelay = 1200 } = {}) {
  let lastErr = null;
  let cookie = "";

  // Warm-up: visit homepage to pick up basic cookies (best-effort)
  try {
    const warm = await fetch("https://www.betexplorer.com/", { headers: BASE_HEADERS() });
    const setCookie = warm.headers.get("set-cookie");
    if (setCookie) cookie = setCookie;
  } catch {
    /* ignore warm-up errors */
  }

  for (let i = 0; i < tries; i++) {
    const delay = Math.round(baseDelay * Math.pow(1.8, i) + Math.random() * 400);
    try {
      const buster = (url.includes("?") ? "&" : "?") + "rnd=" + Date.now();
      const r = await fetch(url + buster, {
        headers: { ...BASE_HEADERS(), ...(cookie ? { Cookie: cookie } : {}) },
      });

      // Handle 429 / 5xx with backoff
      if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
        lastErr = new Error(`HTTP ${r.status}`);
        await sleep(delay);
        continue;
      }
      if (!r.ok) {
        lastErr = new Error(`HTTP ${r.status}`);
        break;
      }

      const html = await r.text();
      return html;
    } catch (e) {
      lastErr = e;
      await sleep(delay);
    }
  }
  throw lastErr || new Error("fetch failed");
}

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
function pairKey(home, away) { return `${normName(home)}__${normName(away)}`; }
function softMatch(a, b) {
  const A = normName(a), B = normName(b);
  if (!A || !B) return false;
  if (A === B) return true;
  if (A.length > 3 && B.includes(A)) return true;
  if (B.length > 3 && A.includes(B)) return true;
  return false;
}
function samePair(fsHome, fsAway, beHome, beAway) {
  if (softMatch(fsHome, beHome) && softMatch(fsAway, beAway)) return true;
  if (softMatch(fsHome, beAway) && softMatch(fsAway, beHome)) return true;
  return false;
}

// --------------- Scrape BetExplorer ---------------
async function scrapeBetExplorerSoccer() {
  const html = await fetchWithRetry(BETEXPLORER_URL).catch((e) => {
    throw new Error(`BetExplorer fetch failed: ${e.message}`);
  });
  await fs.writeFile("list-betexplorer.html", html, "utf8");

  const $ = cheerio.load(html);
  const out = [];

  $("a[href*='/match/']").each((_, a) => {
    const link = $(a);
    const href = link.attr("href") || "";
    const full = new URL(href, "https://www.betexplorer.com").toString();

    let teamsTxt = link.text().trim();
    if (!teamsTxt || !teamsTxt.includes(" - ")) {
      const near = link.closest("tr, div, li");
      const maybe = near.text().replace(/\s+/g, " ").trim();
      const m = maybe.match(/([^\n]+ - [^\n]+)/);
      if (m) teamsTxt = m[1].trim();
    }
    if (!teamsTxt || !teamsTxt.includes(" - ")) return;

    const [home, away] = teamsTxt.split(" - ").map((s) => s.trim());

    const row = link.closest("tr").length ? link.closest("tr") : link.parent();
    const oddsCandidates = [];
    row.find("td, span, a").each((__, el2) => {
      const t = $(el2).text().trim();
      if (/^\d+(?:[.,]\d+)$/.test(t)) oddsCandidates.push(t.replace(",", "."));
    });

    const uniq = [];
    for (const v of oddsCandidates) {
      if (!uniq.includes(v)) uniq.push(v);
      if (uniq.length >= 3) break;
    }
    if (uniq.length < 2) return;

    const o1 = Number(uniq[0] || NaN);
    const ox = uniq[2] ? Number(uniq[1]) : Number.NaN;
    const o2 = Number(uniq[2] || uniq[1] || NaN);

    const ok1 = Number.isFinite(o1) && o1 >= 1.1;
    const ok2 = Number.isFinite(o2) && o2 >= 1.1;
    const okx = Number.isFinite(ox) && ox >= 1.1;
    if (!ok1 || !ok2) return;

    let time = "";
    const timeSpan = row.find("span, small").filter((i, el) => /^\d{1,2}:\d{2}$/.test($(el).text().trim())).first();
    if (timeSpan.length) time = timeSpan.text().trim();

    out.push({ be_url: full, home, away, time, o1, ox: okx ? ox : null, o2 });
  });

  return out;
}

// --------------- Map to matches.json & write odds.json ---------------
async function main() {
  // Load matches from Flashscore step
  const matchesRaw = await fs.readFile("matches.json", "utf8").catch(() => null);
  if (!matchesRaw) {
    console.warn("⚠ BetExplorer: matches.json missing, skipping.");
    return;
  }
  const matches = JSON.parse(matchesRaw);

  let be = [];
  try {
    be = await scrapeBetExplorerSoccer();
  } catch (e) {
    console.warn("⚠ BetExplorer scraper warning:", e.message);
    await fs.writeFile(
      "odds_betexplorer.debug.json",
      JSON.stringify({ error: e.message, when: new Date().toISOString() }, null, 2),
      "utf8"
    );
    // Exit 0 so the pipeline continues
    return;
  }

  await fs.writeFile("odds_betexplorer.json", JSON.stringify(be, null, 2), "utf8");
  console.log(`[betexplorer] parsed ${be.length} odds rows`);

  // Index by normalized pairs (both directions)
  const beIndex = new Map();
  for (const r of be) {
    const k1 = pairKey(r.home, r.away);
    const k2 = pairKey(r.away, r.home);
    if (!beIndex.has(k1)) beIndex.set(k1, []);
    if (!beIndex.has(k2)) beIndex.set(k2, []);
    beIndex.get(k1).push(r);
    beIndex.get(k2).push(r);
  }

  const events = [];
  for (const m of matches) {
    const sport = (m.sport || "Fotbal").toLowerCase();
    if (!["fotbal", "football", "soccer"].includes(sport)) continue;

    const [home, away] = String(m.teams || "").split(" - ").map((s) => s.trim());
    if (!home || !away) continue;

    let candidate = (beIndex.get(pairKey(home, away)) || [])[0];
    if (!candidate) {
      for (const r of be) {
        if (samePair(home, away, r.home, r.away)) { candidate = r; break; }
      }
    }
    if (!candidate) continue;

    if (candidate.o1) events.push({ id: m.id, teams: m.teams, market: "1", odd: candidate.o1, url: m.url });
    if (candidate.ox) events.push({ id: m.id, teams: m.teams, market: "X", odd: candidate.ox, url: m.url });
    if (candidate.o2) events.push({ id: m.id, teams: m.teams, market: "2", odd: candidate.o2, url: m.url });
  }

  if (events.length) {
    await fs.writeFile("odds.json", JSON.stringify({ events }, null, 2), "utf8");
    console.log(`✔ odds.json written with ${events.length} rows (BetExplorer)`);
  } else {
    console.warn("⚠ BetExplorer: no mapped odds; see list-betexplorer.html & odds_betexplorer.json");
  }
}

(async () => {
  try {
    await main();
  } catch (e) {
    // Never fail the workflow
    console.warn("⚠ BetExplorer fatal:", e.message);
    await fs.writeFile(
      "odds_betexplorer.debug.json",
      JSON.stringify({ error: e.message, when: new Date().toISOString() }, null, 2),
      "utf8"
    );
    process.exit(0);
  }
})();
