// Flashscore.mobi scraper – parser robust pentru cote 1/X/2
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
  const abs = new URL(href, BASE);
  // nu dubla "d"
  if (!abs.searchParams.has("d")) abs.searchParams.set("d", String(offset));
  return abs.toString();
}

function cleanTeams(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!/ - /.test(t)) return null;
  t = t.replace(/\s+-:-.*$/, "").trim(); // taie “-:-” și după
  if (t.length > 80) return null;        // protecție anti-“perete”
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

    // doooar textul <a> (nu parent)
    const teams = cleanTeams($(el).text());
    if (!teams) { skippedNoTeams++; return; }

    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] d=${offset} -> matches: ${rows.length} (skipped w/o clean teams: ${skippedNoTeams})`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  [${i}] ${r.teams} -> ${r.url}`));
  return rows.slice(0, MAX_MATCHES);
}

/** ====== PARSING ODDS ====== **/

function pick3Numbers(nums) {
  // ia primele 3 numere plauzibile pentru cote
  const arr = (nums || [])
    .map(s => Number(String(s).replace(",", ".")))
    .filter(n => n > 1.01 && n < 100);
  return arr.length >= 2 ? { o1: arr[0] ?? null, ox: arr[1] ?? null, o2: arr[2] ?? null } : null;
}

function parseOddsByStructure($) {
  // 1) h5 Odds/Cote -> p.odds-detail (cel mai frecvent)
  const h5 = $("h5").filter((_, el) => /Odds|Cote/i.test($(el).text())).first();
  if (h5.length) {
    const oddsP = h5.nextAll("p.odds-detail").first();
    if (oddsP.length) {
      const m = oddsP.text().match(/\d+(?:[.,]\d+)?/g);
      const res = pick3Numbers(m);
      if (res) return res;
    }
    // 2) dacă nu e .odds-detail, ia primul <p> după h5
    const p = h5.nextAll("p").first();
    if (p.length) {
      const m = p.text().match(/\d+(?:[.,]\d+)?/g);
      const res = pick3Numbers(m);
      if (res) return res;
    }
  }

  // 3) direct orice <p class*="odds">
  const anyOdds = $('p[class*="odds"]')
    .map((_, el) => $(el).text())
    .toArray()
    .join(" ");
  if (anyOdds) {
    const m = anyOdds.match(/\d+(?:[.,]\d+)?/g);
    const res = pick3Numbers(m);
    if (res) return res;
  }
  return null;
}

function parseOddsByHeuristic(html) {
  // caută o fereastră în jurul cuvintelor-cheie, apoi ia 3 numere
  const KEYS = ["1X2", "Odds", "Cote", "Full Time", "Full-Time", "Rezultat final"];
  let idx = -1;
  for (const k of KEYS) {
    idx = html.search(new RegExp(k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i"));
    if (idx >= 0) break;
  }
  const scope = idx >= 0 ? html.slice(idx, idx + 1800) : html;

  // format cu pipe-uri
  let m = /\b(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)\b/.exec(scope);
  if (m) return { o1: Number(m[1].replace(",", ".")), ox: Number(m[2].replace(",", ".")), o2: Number(m[3].replace(",", ".")) };

  // trei numere consecutive
  m = scope.match(/\b\d+(?:[.,]\d+)?\b/g);
  return pick3Numbers(m);
}

function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);
  return parseOddsByStructure($) || parseOddsByHeuristic(html);
}

function toOddsSubpage(matchUrl, offset) {
  const id = (/\/match\/([^/]+)\//i.exec(matchUrl) || [])[1];
  return id ? `${BASE}/match/${id}/odds/?d=${offset}` : null;
}

async function scrapeMatch(match, i, dumpHtml = true) {
  // 1) pagina principală a meciului
  let html = await fetchText(match.url);
  if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");
  let odds = parseOddsFromHtml(html);
  if (odds) return asTriplet(match, odds);

  // 2) fallback: subpagina de cote
  const oddsUrl = toOddsSubpage(match.url, DAY_OFFSET);
  if (oddsUrl) {
    html = await fetchText(oddsUrl);
    if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}-odds.html`, html, "utf8");
    odds = parseOddsFromHtml(html);
    if (odds) return asTriplet(match, odds, oddsUrl);
  }

  console.log(`[odds] none for ${match.id} (${match.teams})`);
  return [];
}

function asTriplet(match, odds, urlOverride) {
  const url = urlOverride || match.url;
  const out = [];
  if (odds.o1) out.push({ id: match.id, teams: match.teams, market: "1", odd: odds.o1, url });
  if (odds.ox) out.push({ id: match.id, teams: match.teams, market: "X", odd: odds.ox, url });
  if (odds.o2) out.push({ id: match.id, teams: match.teams, market: "2", odd: odds.o2, url });
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
