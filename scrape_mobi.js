// Scraper flashscore.mobi (fără browser) – robustizat pentru "Odds: a | b | c"
import fs from "fs";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);  // 0=azi, 1=maine, 2=poimaine
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 50);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function absUrl(href) {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

// 1) Lista meciurilor pentru ziua offset
async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  const seen = new Set();
  const rows = [];
  $('a[href^="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // link absolut + păstrează offset-ul d=
    const full = absUrl(href.includes("?") ? `${href}&d=${offset}` : `${href}?d=${offset}`);
    const m = /\/match\/([^/]+)\//i.exec(full || "");
    const id = m ? m[1] : null;
    if (!id || seen.has(id)) return;

    const txt = $(el).text().trim().replace(/\s+/g, " ");
    if (!txt.includes(" - ")) return; // ne asigurăm că e "Home - Away"

    seen.add(id);
    rows.push({ id, url: full, teams: txt });
  });

  // log scurt pentru debug
  console.log(`[list] found ${rows.length} matches for d=${offset}`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  [${i}] ${r.teams} -> ${r.url}`));

  return rows.slice(0, MAX_MATCHES);
}

// 2) Parsează “Odds: 2.19 | 3.53 | 3.43” din HTML-ul unei pagini de meci
function parseOddsFromMatchHtml(html) {
  // în mod normal există linia "Odds" urmată de trei valori separate de |
  const blockRe = /Odds[\s\S]{0,500}?(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)/i;
  const m = blockRe.exec(html);
  if (m) {
    const o1 = Number(m[1].replace(",", "."));
    const ox = Number(m[2].replace(",", "."));
    const o2 = Number(m[3].replace(",", "."));
    return { o1, ox, o2 };
  }

  // fallback: ia primele 3 numere după cuvântul Odds
  const idx = html.search(/>?\s*Odds\s*<?/i);
  if (idx >= 0) {
    const tail = html.slice(idx, idx + 800);
    const nums = (tail.match(/\b\d+(?:[.,]\d+)?\b/g) || [])
      .map((s) => Number(s.replace(",", ".")))
      .filter((n) => n > 1.01 && n < 100);
    if (nums.length >= 2) {
      return { o1: nums[0] ?? null, ox: nums[1] ?? null, o2: nums[2] ?? null };
    }
  }
  return null;
}

async function scrapeMatch(match) {
  const html = await fetchText(match.url);
  const odds = parseOddsFromMatchHtml(html);
  if (!odds) {
    console.log(`[odds] none for ${match.id} (${match.teams})`);
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
    fs.writeFileSync("matches.json", JSON.stringify(matches, null, 2));

    const all = [];
    for (const m of matches) {
      try {
        const rows = await scrapeMatch(m);
        all.push(...rows);
        await new Promise((r) => setTimeout(r, 250)); // mic throttle
      } catch (e) {
        console.error("[MATCH FAIL]", m.url, e.message);
      }
    }

    fs.writeFileSync("odds.json", JSON.stringify({ events: all }, null, 2));
    console.log(`[OK] Saved odds.json with ${all.length} rows (d=${DAY_OFFSET})`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
