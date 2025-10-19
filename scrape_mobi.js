// Flashscore.mobi scraper – FIX: teams curate din <a>, fără fallback "parent",
// și param d adăugat corect (fără dublură). Cotele rămân din <p class="odds-detail">.

import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0); // 0=azi, 1=maine, 2=poimaine
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 50);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

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

function toAbsUrlWithDay(href, offset) {
  // face HREF absolut și adaugă param d=<offset> O SINGURĂ DATĂ
  const abs = new URL(href, BASE);
  if (!abs.searchParams.has("d")) abs.searchParams.set("d", String(offset));
  return abs.toString();
}

function cleanTeams(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  // ținem DOAR forma "Home - Away"
  if (!/ - /.test(t)) return null;
  // uneori apare "Home - Away -:-" -> tăiem din "-:-" încolo
  t = t.replace(/\s+-:-.*$/, "").trim();
  // uneori apar scurtături dubioase; dacă a rămas prea lung, mai filtrăm
  if (t.length > 80) return null; // protecție împotriva ingerării de blocuri mari
  return t;
}

// 1) Listează meciurile din ziua offset
async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  await fs.writeFile("list.html", html, "utf8");

  const $ = cheerio.load(html);
  const seen = new Set();
  const rows = [];
  let skippedNoTeams = 0;

  $('a[href^="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const full = toAbsUrlWithDay(href, offset);
    const id = (/\/match\/([^/]+)\//i.exec(full) || [])[1];
    if (!id || seen.has(id)) return;

    // IMPORTANT: folosim STRICT textul <a>, NU textul părintelui
    const teams = cleanTeams($(el).text());
    if (!teams) { skippedNoTeams++; return; }

    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] d=${offset} -> matches: ${rows.length} (skipped without clean teams: ${skippedNoTeams})`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  [${i}] ${r.teams} -> ${r.url}`));
  return rows.slice(0, MAX_MATCHES);
}

// 2) Cote 1/X/2 direct din <p class="odds-detail">
function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);
  const oddsEl = $("p.odds-detail").first();
  if (!oddsEl.length) return null;

  const nums = (oddsEl.text().match(/\d+(?:[.,]\d+)?/g) || [])
    .map(s => Number(String(s).replace(",", ".")))
    .filter(n => n > 1.01 && n < 100);

  if (nums.length < 2) return null; // minim 1 și X
  return { o1: nums[0] ?? null, ox: nums[1] ?? null, o2: nums[2] ?? null };
}

async function scrapeMatch(match, i, dumpHtml = false) {
  const html = await fetchText(match.url);
  if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");

  const odds = parseOddsFromHtml(html);
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
