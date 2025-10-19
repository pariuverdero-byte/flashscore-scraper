// Flashscore.mobi scraper – robust odds parsing (anchors + text + /odds fallback)
// Salvează HTML de debug pentru primele 10 meciuri fără cote.

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
      // Accept simplu ca să evităm variante ciudate
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function toAbsUrlWithDay(href, offset) {
  const abs = new URL(href, BASE);
  if (!abs.searchParams.has("d")) abs.searchParams.set("d", String(offset));
  return abs.toString();
}

function cleanTeams(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!/ - /.test(t)) return null;
  t = t.replace(/\s+-:-.*$/, "").trim();
  if (t.length > 80) return null;
  return t;
}

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

    // strict textul <a>
    const teams = cleanTeams($(el).text());
    if (!teams) { skippedNoTeams++; return; }

    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] d=${offset} -> matches: ${rows.length} (skipped w/o clean teams: ${skippedNoTeams})`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  [${i}] ${r.teams} -> ${r.url}`));
  return rows.slice(0, MAX_MATCHES);
}

/* ================== PARSING ODDS ================== */

function toOddsSubpage(matchUrl, offset) {
  const id = (/\/match\/([^/]+)\//i.exec(matchUrl) || [])[1];
  return id ? `${BASE}/match/${id}/odds/?d=${offset}` : null;
}

function asTriplet(match, odds, url) {
  const out = [];
  if (odds.o1) out.push({ id: match.id, teams: match.teams, market: "1", odd: odds.o1, url });
  if (odds.ox) out.push({ id: match.id, teams: match.teams, market: "X", odd: odds.ox, url });
  if (odds.o2) out.push({ id: match.id, teams: match.teams, market: "2", odd: odds.o2, url });
  return out;
}

function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);

  // 1) Cel mai sigur: <p class="odds-detail"> cu 3 <a> înăuntru
  const ps = $("p.odds-detail");
  for (let i = 0; i < ps.length; i++) {
    const anchors = $(ps[i]).find("a").map((_, a) => $(a).text().trim()).toArray();
    if (anchors.length >= 3) {
      const nums = anchors.slice(0, 3)
        .map(s => Number(s.replace(",", ".")))
        .filter(n => n > 1.01 && n < 100);
      if (nums.length >= 2) return { o1: nums[0] ?? null, ox: nums[1] ?? null, o2: nums[2] ?? null };
    }
    // 1b) dacă nu are 3 <a>, ia textul (poate e "2.58|3.59|2.86")
    const txt = $(ps[i]).text().trim();
    const viaPipe = txt.split("|").map(s => s.trim()).filter(Boolean);
    if (viaPipe.length >= 3) {
      const [a,b,c] = viaPipe.map(s => Number(s.replace(",", ".")));
      if ([a,b,c].every(v => v > 1.01 && v < 100)) return { o1: a, ox: b, o2: c };
    }
    const nums2 = (txt.match(/\d+(?:[.,]\d+)?/g) || [])
      .map(s => Number(s.replace(",", ".")))
      .filter(n => n > 1.01 && n < 100);
    if (nums2.length >= 3) return { o1: nums2[0], ox: nums2[1], o2: nums2[2] };
  }

  // 2) fallback: <h5>Odds/Cote</h5> -> primul <p> după
  const h5 = $("h5").filter((_, el) => /Odds|Cote/i.test($(el).text())).first();
  if (h5.length) {
    const p = h5.nextAll("p").first();
    const anchors = p.find("a").map((_, a) => $(a).text().trim()).toArray();
    if (anchors.length >= 3) {
      const nums = anchors.slice(0,3).map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);
      if (nums.length >= 2) return { o1: nums[0] ?? null, ox: nums[1] ?? null, o2: nums[2] ?? null };
    }
    const txt = p.text().trim();
    const viaPipe = txt.split("|").map(s => s.trim()).filter(Boolean);
    if (viaPipe.length >= 3) {
      const [a,b,c] = viaPipe.map(s => Number(s.replace(",", ".")));
      if ([a,b,c].every(v => v > 1.01 && v < 100)) return { o1: a, ox: b, o2: c };
    }
    const nums2 = (txt.match(/\d+(?:[.,]\d+)?/g) || [])
      .map(s => Number(s.replace(",", ".")))
      .filter(n => n > 1.01 && n < 100);
    if (nums2.length >= 3) return { o1: nums2[0], ox: nums2[1], o2: nums2[2] };
  }

  // 3) fallback final: caută în jurul cuvintelor cheie
  const KEYS = ["1X2", "Odds", "Cote", "Full Time", "Full-Time", "Rezultat final"];
  let idx = -1;
  for (const k of KEYS) {
    idx = html.search(new RegExp(k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i"));
    if (idx >= 0) break;
  }
  const scope = idx >= 0 ? html.slice(idx, idx + 2000) : html;
  let m = /\b(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)\b/.exec(scope);
  if (m) return { o1: Number(m[1].replace(",", ".")), ox: Number(m[2].replace(",", ".")), o2: Number(m[3].replace(",", ".")) };
  const nums3 = (scope.match(/\d+(?:[.,]\d+)?/g) || [])
    .map(s => Number(s.replace(",", ".")))
    .filter(n => n > 1.01 && n < 100);
  if (nums3.length >= 3) return { o1: nums3[0], ox: nums3[1], o2: nums3[2] };

  return null;
}

/* ================== SCRAPE MATCH ================== */

async function scrapeMatch(match, i, dumpHtml = true, missingCounter) {
  // 1) pagina principală a meciului
  let html = await fetchText(match.url);
  if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");
  let odds = parseOddsFromHtml(html);
  if (odds) {
    console.log(`[odds] ${match.id} ${match.teams} -> ${odds.o1}/${odds.ox}/${odds.o2} [main]`);
    return asTriplet(match, odds, match.url);
  }

  // 2) fallback: subpagina /odds/
  const oddsUrl = toOddsSubpage(match.url, DAY_OFFSET);
  if (oddsUrl) {
    html = await fetchText(oddsUrl);
    if (dumpHtml && i < 10 && missingCounter.count < 10) {
      await fs.writeFile(`match-${i + 1}-${match.id}-odds.html`, html, "utf8");
    }
    odds = parseOddsFromHtml(html);
    if (odds) {
      console.log(`[odds] ${match.id} ${match.teams} -> ${odds.o1}/${odds.ox}/${odds.o2} [/odds]`);
      return asTriplet(match, odds, oddsUrl);
    }
  }

  if (missingCounter.count < 10) {
    // salvează și main-ul dacă nu l-am salvat (în cazurile i >= 3)
    if (dumpHtml && i >= 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");
    missingCounter.count++;
  }
  console.log(`[odds] none for ${match.id} (${match.teams})`);
  return [];
}

/* ================== MAIN ================== */

(async () => {
  try {
    const matches = await listMatches(DAY_OFFSET);
    await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

    const all = [];
    const missingCounter = { count: 0 };

    for (let i = 0; i < matches.length; i++) {
      try {
        const rows = await scrapeMatch(matches[i], i, true, missingCounter);
        all.push(...rows);
        await new Promise(r => setTimeout(r, 200));
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
