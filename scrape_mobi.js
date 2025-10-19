// Flashscore.mobi scraper – extrage cote direct din <p class="odds-detail">
import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 50);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function absUrl(href) {
  try { return new URL(href, BASE).toString(); } catch { return null; }
}

// 1️⃣ Listare meciuri pentru ziua offset
async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  await fs.writeFile("list.html", html, "utf8");

  const $ = cheerio.load(html);
  const rows = [];
  const seen = new Set();

  $('a[href^="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const full = absUrl(href.includes("?") ? `${href}&d=${offset}` : `${href}?d=${offset}`);
    const m = /\/match\/([^/]+)\//i.exec(full || "");
    const id = m ? m[1] : null;
    if (!id || seen.has(id)) return;

    let teams = $(el).text().trim().replace(/\s+/g, " ");
    if (!teams.includes(" - ")) {
      const parentTxt = $(el).parent().text().trim().replace(/\s+/g, " ");
      if (parentTxt.includes(" - ")) teams = parentTxt;
    }

    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] found ${rows.length} matches for d=${offset}`);
  return rows.slice(0, MAX_MATCHES);
}

// 2️⃣ Extrage 1X2 odds din HTML
function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);
  const oddsEl = $("p.odds-detail").first();

  if (!oddsEl.length) return null;

  const odds = oddsEl.text().match(/\d+(?:[.,]\d+)?/g);
  if (!odds || odds.length < 3) return null;

  return {
    o1: parseFloat(odds[0].replace(",", ".")),
    ox: parseFloat(odds[1].replace(",", ".")),
    o2: parseFloat(odds[2].replace(",", ".")),
  };
}

// 3️⃣ Parsează fiecare meci
async function scrapeMatch(match, i, dumpHtml = false) {
  const html = await fetchText(match.url);
  if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");

  const odds = parseOddsFromHtml(html);
  if (!odds) {
    console.log(`[odds] none for ${match.teams}`);
    return [];
  }

  const out = [
    { id: match.id, teams: match.teams, market: "1", odd: odds.o1, url: match.url },
    { id: match.id, teams: match.teams, market: "X", odd: odds.ox, url: match.url },
    { id: match.id, teams: match.teams, market: "2", odd: odds.o2, url: match.url },
  ];

  return out;
}

// 4️⃣ Main
(async () => {
  const matches = await listMatches(DAY_OFFSET);
  await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

  const all = [];
  for (let i = 0; i < matches.length; i++) {
    try {
      const rows = await scrapeMatch(matches[i], i, true);
      all.push(...rows);
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error("[match fail]", matches[i].url, e.message);
    }
  }

  await fs.writeFile("odds.json", JSON.stringify({ events: all }, null, 2), "utf8");
  console.log(`[OK] Saved odds.json with ${all.length} rows (d=${DAY_OFFSET})`);
})();
