// Flashscore.mobi scraper (fără browser) + debug HTML artefacts
import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);   // 0=azi, 1=maine, 2=poimaine
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 50);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
      "Cache-Control": "no-cache",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function absUrl(href) {
  try { return new URL(href, BASE).toString(); } catch { return null; }
}

// 1) Lista meciurilor pentru ziua offset – salvează list.html pt. debug
async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  await fs.writeFile("list.html", html, "utf8");

  const $ = cheerio.load(html);
  const seen = new Set();
  const rows = [];

  $('a[href^="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // atașăm &d=offset dacă lipsește, ca să rămânem pe aceeași zi
    const full = absUrl(href.includes("?") ? `${href}&d=${offset}` : `${href}?d=${offset}`);
    const m = /\/match\/([^/]+)\//i.exec(full || "");
    const id = m ? m[1] : null;
    if (!id || seen.has(id)) return;

    // 1) încearcă textul linkului (de obicei "Home - Away")
    let teams = $(el).text().trim().replace(/\s+/g, " ");
    // 2) fallback: dacă e gol sau nu conține " - ", ia textul părintelui imediat
    if (!teams || !teams.includes(" - ")) {
      const parentTxt = $(el).parent().text().trim().replace(/\s+/g, " ");
      if (parentTxt.includes(" - ")) teams = parentTxt;
    }

    seen.add(id);
    rows.push({ id, url: full, teams: teams || null });
  });

  console.log(`[list] found ${rows.length} matches for d=${offset}`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  [${i}] ${r.teams || "(no teams)"} -> ${r.url}`));
  return rows.slice(0, MAX_MATCHES);
}

// 2) Parsăm Odds/Cote din HTML de meci – acceptăm mai multe formate
function parseOddsFromMatchHtml(html) {
  // căutăm aproape de cuvintele cheie
  const KEYS = ["Odds", "Cote", "1X2", "Full Time", "Full-Time", "Rezultat final"];
  let idx = -1;
  for (const k of KEYS) {
    idx = html.search(new RegExp(k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i"));
    if (idx >= 0) break;
  }
  const scope = idx >= 0 ? html.slice(idx, idx + 1200) : html; // fereastră de căutare

  // 2.1 Pattern cu pipe-uri: 2.19 | 3.53 | 3.43
  let m = /\b(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)\b/.exec(scope);
  if (m) return { o1: n(m[1]), ox: n(m[2]), o2: n(m[3]) };

  // 2.2 Trei numere apropiate (separate de spațiu / &nbsp; / slash)
  const nums = (scope.match(/\b\d+(?:[.,]\d+)?\b/g) || [])
    .map(n).filter(x => x > 1.01 && x < 100);
  if (nums.length >= 3) return { o1: nums[0], ox: nums[1], o2: nums[2] };

  return null;
}

function n(s) { return Number(String(s).replace(",", ".")); }

async function scrapeMatch(match, i, dumpHtml = false) {
  const html = await fetchText(match.url);
  if (dumpHtml && i < 3) { // salvează primele 3 pagini meci pentru debug
    await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");
  }
  const odds = parseOddsFromMatchHtml(html);
  if (!odds) {
    console.log(`[odds] none for ${match.id} (${match.teams || "?"})`);
    return [];
  }
  const out = [];
  if (odds.o1) out.push({ id: match.id, teams: match.teams, market: "1", odd: odds.o1, url: match.url });
  if (odds.ox) out.push({ id: match.id, teams: match.teams, market: "X", odd: odds.ox, url: match.url });
  if (odds.o2) out.push({ id: match.id, teams: match.teams, market: "2", odd: odds.o2, url: match.url });
  return out;
}

(async () => {
  try {
    const matches = await listMatches(DAY_OFFSET);
    await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

    const all = [];
    for (let i = 0; i < matches.length; i++) {
      try {
        const rows = await scrapeMatch(matches[i], i, true);
        all.push(...rows);
        await new Promise(r => setTimeout(r, 200)); // throttle mic
      } catch (e) {
        console.error("[MATCH FAIL]", matches[i].url, e.message);
      }
    }

    await fs.writeFile("odds.json", JSON.stringify({ events: all }, null, 2), "utf8");
    console.log(`[OK] Saved odds.json with ${all.length} rows (d=${DAY_OFFSET})`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
