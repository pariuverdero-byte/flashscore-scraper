// Scraper flashscore.mobi – fără browser, pentru GitHub Actions
// - Listează meciurile din ?d=<offset>
// - Intră pe fiecare pagină de meci și extrage 1/X/2 din secțiunea "Odds"
// Output: odds.json { events: [{id, teams, market, odd, url}] }

import fs from "fs";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0); // 0 azi, 1 mâine, 2 poimâine
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 50);
const UA = "Mozilla/5.0 (PariuVerdeBot/1.0)";

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function absUrl(href) {
  try { return new URL(href, BASE).toString(); } catch { return null; }
}

// Parse listă: ia linkurile către meciuri și numele echipelor din textul linkului
async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  // linkurile către meciuri sunt de forma /match/<ID>/...; textul linkului e "Home - Away"
  const links = new Set();
  const rows = [];
  $('a[href^="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    // păstrează același offset în link (d=offset) dacă nu există deja
    const full = absUrl(href.includes("?") ? href : `${href}?d=${offset}`);
    const id = (/\/match\/([^/]+)\//i.exec(full || "") || [])[1];
    if (!full || !id || links.has(id)) return;
    links.add(id);
    const teams = $(el).text().trim().replace(/\s+/g, " ");
    // ignoră linkurile ce nu au ambele echipe (fără " - ")
    if (!teams.includes(" - ")) return;
    rows.push({ id, url: full, teams });
  });

  return rows.slice(0, MAX_MATCHES);
}

// Din pagina meciului, extrage linia cu "Odds" și trei valori (1 | X | 2)
function parseOddsFromMatchHtml(html) {
  // 1) caută secțiunea "Odds" (apare ca header roșu), apoi primele 3 numere după ea
  const afterOdds = html.split(/>Odds<|> Cote <|>Cote</i)[1] || "";
  const nums = (afterOdds.match(/\b\d+(?:[.,]\d+)?\b/g) || [])
    .map(s => Number(s.replace(",", ".")))
    .filter(n => n > 1.01 && n < 100)
    .slice(0, 3);
  if (nums.length < 2) return null; // minim 1 și X

  return { o1: nums[0] ?? null, ox: nums[1] ?? null, o2: nums[2] ?? null };
}

async function scrapeMatch(match) {
  const html = await fetchText(match.url);
  const odds = parseOddsFromMatchHtml(html);
  if (!odds) return [];

  const out = [];
  if (odds.o1) out.push({ id: match.id, teams: match.teams, market: "1", odd: odds.o1, url: match.url });
  if (odds.ox) out.push({ id: match.id, teams: match.teams, market: "X", odd: odds.ox, url: match.url });
  if (odds.o2) out.push({ id: match.id, teams: match.teams, market: "2", odd: odds.o2, url: match.url });
  return out;
}

(async () => {
  try {
    const matches = await listMatches(DAY_OFFSET);
    const all = [];
    for (const m of matches) {
      try {
        const rows = await scrapeMatch(m);
        all.push(...rows);
        // mic throttle
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.error("[MATCH FAIL]", m.url, e.message);
      }
    }
    fs.writeFileSync("odds.json", JSON.stringify({ events: all }, null, 2));
    console.log(`[OK] Saved odds.json with ${all.length} rows (offset d=${DAY_OFFSET})`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
