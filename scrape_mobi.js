// Flashscore.mobi scraper — minimal, stabil, cu 3 micro-fixuri:
// (1) selectori mai toleranți la linkuri, (2) echipe doar din <a>, (3) odds din <a> / '|' / regex.
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
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
      "Cache-Control": "no-cache"
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function toAbsUrlWithDay(href, offset) {
  // face URL absolut și adaugă param d=<offset> O SINGURĂ DATĂ
  const abs = new URL(href, BASE);
  if (!abs.searchParams.has("d")) abs.searchParams.set("d", String(offset));
  return abs.toString();
}

function cleanTeamsFromAnchorText(raw) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!/ - /.test(t)) return null;               // vrem strict forma "Home - Away"
  return t.replace(/\s+-:-.*$/, "").trim();      // taie " -:-" și ce e după
}

// 1️⃣ Listă meciuri (salvăm list.html pentru debug)
async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  await fs.writeFile("list.html", html, "utf8");

  const $ = cheerio.load(html);
  const seen = new Set();
  const rows = [];
  let skipped = 0;

  // FIX: prindem și href absolute/relative (nu doar ^="/match/")
  $('a[href*="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const full = toAbsUrlWithDay(href, offset);
    const id = (/\/match\/([^/]+)\//i.exec(full) || [])[1];
    if (!id || seen.has(id)) return;

    // FIX: echipe doar din textul <a> (evităm să mâncăm secțiuni întregi)
    const teams = cleanTeamsFromAnchorText($(el).text());
    if (!teams) { skipped++; return; }

    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] d=${offset} -> matches: ${rows.length} (skipped without 'Home - Away': ${skipped})`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  [${i}] ${r.teams} -> ${r.url}`));
  return rows.slice(0, MAX_MATCHES);
}

// 2️⃣ Odds 1/X/2 din <p class="odds-detail"> — întâi <a>, apoi '|' apoi regex
function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);

  const ps = $("p.odds-detail");
  for (let i = 0; i < ps.length; i++) {
    // a) ancore interne: <a>2.58</a>|<a>3.59</a>|<a>2.86</a>
    const anchors = $(ps[i]).find("a").map((_, a) => $(a).text().trim()).toArray();
    if (anchors.length >= 3) {
      const nums = anchors.slice(0,3).map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);
      if (nums.length >= 2) return { o1: nums[0] ?? null, ox: nums[1] ?? null, o2: nums[2] ?? null };
    }
    // b) textul integral, de ex. "2.58|3.59|2.86" (de multe ori fără spații)
    const txt = $(ps[i]).text().trim();
    const viaPipe = txt.split("|").map(s => s.trim()).filter(Boolean);
    if (viaPipe.length >= 3) {
      const [a,b,c] = viaPipe.map(s => Number(s.replace(",", ".")));
      if ([a,b,c].every(v => v > 1.01 && v < 100)) return { o1: a, ox: b, o2: c };
    }
    // c) fallback: primele 3 numere din paragraf
    const nums2 = (txt.match(/\d+(?:[.,]\d+)?/g) || [])
      .map(s => Number(s.replace(",", ".")))
      .filter(n => n > 1.01 && n < 100);
    if (nums2.length >= 3) return { o1: nums2[0], ox: nums2[1], o2: nums2[2] };
  }

  // d) fallback: <h5>Odds/Cote</h5> -> primul <p>
  const h5 = $("h5").filter((_, el) => /Odds|Cote/i.test($(el).text())).first();
  if (h5.length) {
    const p = h5.nextAll("p").first();
    const a = p.find("a").map((_, x) => $(x).text().trim()).toArray()
      .map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);
    if (a.length >= 2) return { o1: a[0] ?? null, ox: a[1] ?? null, o2: a[2] ?? null };

    const txt = p.text().trim();
    const viaPipe = txt.split("|").map(s => s.trim()).filter(Boolean);
    if (viaPipe.length >= 3) {
      const [x,y,z] = viaPipe.map(s => Number(s.replace(",", ".")));
      if ([x,y,z].every(v => v > 1.01 && v < 100)) return { o1: x, ox: y, o2: z };
    }
  }
  return null;
}

// 3️⃣ Scrape 1 meci (salvează HTML pt. primele 3 meciuri)
async function scrapeMatch(match, i, dumpHtml = true) {
  const html = await fetchText(match.url);
  if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");

  const odds = parseOddsFromHtml(html);
  if (!odds) {
    console.log(`[odds] none for ${match.id} (${match.teams}) -> ${match.url}`);
    return [];
  }
  console.log(`[odds] ${match.id} ${match.teams} -> ${odds.o1}/${odds.ox}/${odds.o2}`);

  return [
    { id: match.id, teams: match.teams, market: "1", odd: odds.o1, url: match.url },
    { id: match.id, teams: match.teams, market: "X", odd: odds.ox, url: match.url },
    { id: match.id, teams: match.teams, market: "2", odd: odds.o2, url: match.url }
  ];
}

// 4️⃣ Main
(async () => {
  try {
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
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
