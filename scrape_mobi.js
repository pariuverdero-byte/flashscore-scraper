// Flashscore.mobi — scraper simplu (FOOTBALL only)
// - Listează meciurile din pagina /?d=<offset>
// - Pentru fiecare meci, intră pe pagina lui și ia prima secțiune <p class="odds-detail">
// - Extrage 1X2: trei cote (1, X, 2)
// - Output: matches.json și odds.json
//
// ENV:
//   DAY_OFFSET   => ziua (0=today, 1=tomorrow, 2=+2 etc.). default: 0
//   MAX_MATCHES  => limitează câte meciuri procesezi. default: 50
//
// Notă: această variantă NU încearcă sub-tabul “Odds” din pagina meciului.
// E exact schema care ți-a produs rezultate anterior.

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
      "Cache-Control": "no-cache",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function absUrl(href) {
  try { return new URL(href, BASE).toString(); } catch { return null; }
}

function addDayParam(u, d) {
  try {
    const url = new URL(u);
    if (!url.searchParams.has("d")) url.searchParams.set("d", String(d));
    return url.toString();
  } catch {
    return u;
  }
}

// În listă, echipele sunt textul imediat anterior linkului <a href="/match/...">
function getTeamsFromPrevText($, aEl) {
  const parent = aEl.parent;
  if (!parent?.childNodes) return null;
  const nodes = parent.childNodes;
  const idx = nodes.indexOf(aEl);
  for (let i = idx - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type === "text") {
      let t = String(n.data || "").replace(/\s+/g, " ").trim();
      if (t.includes(" - ")) {
        // Taie scorul " -:- " sau " 1:0" la final, dacă apare
        t = t.replace(/\s+-:-.*$/, "").replace(/\s+\d+:\d+.*$/, "").trim();
        if (t.length > 3 && t.length <= 100) return t;
      }
    }
  }
  // fallback: tot textul părintelui
  const parentTxt = cheerio(parent).text().replace(/\s+/g, " ").trim();
  if (parentTxt.includes(" - ")) {
    return parentTxt.replace(/\s+-:-.*$/, "").replace(/\s+\d+:\d+.*$/, "").trim();
  }
  return null;
}

// 1) Listează meciurile pentru ziua cu offset
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
    const fullBase = absUrl(href);
    if (!fullBase) return;
    const full = addDayParam(fullBase, offset);

    const m = /\/match\/([^/]+)\//i.exec(full || "");
    const id = m ? m[1] : null;
    if (!id || seen.has(id)) return;

    const teams = getTeamsFromPrevText($, el);
    if (!teams) return;

    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] found ${rows.length} matches for d=${offset}`);
  return rows.slice(0, MAX_MATCHES);
}

// 2) Extrage 1X2 din <p class="odds-detail"> (prima apariție)
function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);
  const oddsEl = $("p.odds-detail").first();
  if (!oddsEl.length) return null;

  // întâi încearcă valorile din <a>, dacă există
  const anchors = oddsEl.find("a").map((_, a) => $(a).text().trim()).toArray();
  let nums = anchors.map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);

  // fallback: din textul complet (separate de |)
  if (nums.length < 3) {
    const txt = oddsEl.text();
    const hits = txt.match(/\d+(?:[.,]\d+)?/g) || [];
    nums = hits.map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);
  }

  if (nums.length < 3) return null;
  return {
    o1: nums[0],
    ox: nums[1],
    o2: nums[2],
  };
}

// 3) Parsează pagina meciului
async function scrapeMatch(match, i, dumpHtml = true) {
  const html = await fetchText(match.url);
  if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");

  const odds = parseOddsFromHtml(html);
  if (!odds) {
    console.log(`[odds] none for ${match.teams}`);
    return [];
  }

  return [
    { id: match.id, teams: match.teams, market: "1", odd: odds.o1, url: match.url },
    { id: match.id, teams: match.teams, market: "X", odd: odds.ox, url: match.url },
    { id: match.id, teams: match.teams, market: "2", odd: odds.o2, url: match.url },
  ];
}

// 4) Main
(async () => {
  try {
    const matches = await listMatches(DAY_OFFSET);
    await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

    const all = [];
    for (let i = 0; i < matches.length; i++) {
      try {
        const rows = await scrapeMatch(matches[i], i, true);
        all.push(...rows);
        // mic delay ca să nu bombardăm serverul
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error("[match fail]", matches[i]?.url, e.message);
      }
    }

    await fs.writeFile("odds.json", JSON.stringify({ events: all }, null, 2), "utf8");
    console.log(`[OK] Saved odds.json with ${all.length} rows (d=${DAY_OFFSET})`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
