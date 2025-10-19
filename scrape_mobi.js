// Flashscore.mobi scraper – versiune completă (fix odds-detail)
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

    const teams = cleanTeams($(el).text());
    if (!teams) { skippedNoTeams++; return; }

    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] d=${offset} -> matches: ${rows.length} (skipped w/o clean teams: ${skippedNoTeams})`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  [${i}] ${r.teams} -> ${r.url}`));
  return rows.slice(0, MAX_MATCHES);
}

// --------- CORE: PARSING ODDS ----------
function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);

  // 1️⃣ Căutăm toate <p class="odds-detail"> cu format "2.58|3.59|2.86"
  const ps = $("p.odds-detail");
  for (let i = 0; i < ps.length; i++) {
    const txt = $(ps[i]).text().trim();

    // Split exact pe "|"
    const viaPipe = txt.split("|").map(s => s.trim()).filter(Boolean);
    if (viaPipe.length >= 3) {
      const o1 = Number(viaPipe[0].replace(",", "."));
      const ox = Number(viaPipe[1].replace(",", "."));
      const o2 = Number(viaPipe[2].replace(",", "."));
      if ([o1, ox, o2].every(v => v > 1.01 && v < 100)) {
        return { o1, ox, o2 };
      }
    }

    // fallback: extrage toate numerele din text (dacă lipsesc "|")
    const nums = (txt.match(/\d+(?:[.,]\d+)?/g) || [])
      .map(s => Number(s.replace(",", ".")))
      .filter(n => n > 1.01 && n < 100);
    if (nums.length >= 3) return { o1: nums[0], ox: nums[1], o2: nums[2] };
  }

  // 2️⃣ fallback: <h5>Odds/Cote</h5> → primul <p> de după
  const h5 = $("h5").filter((_, el) => /Odds|Cote/i.test($(el).text())).first();
  if (h5.length) {
    const p = h5.nextAll("p").first();
    const txt = p.text().trim();

    const viaPipe = txt.split("|").map(s => s.trim()).filter(Boolean);
    if (viaPipe.length >= 3) {
      const [a, b, c] = viaPipe.map(s => Number(s.replace(",", ".")));
      if ([a, b, c].every(v => v > 1.01 && v < 100)) return { o1: a, ox: b, o2: c };
    }

    const nums = (txt.match(/\d+(?:[.,]\d+)?/g) || [])
      .map(s => Number(s.replace(",", ".")))
      .filter(n => n > 1.01 && n < 100);
    if (nums.length >= 3) return { o1: nums[0], ox: nums[1], o2: nums[2] };
  }

  return null;
}

// --------- SCRAPE EACH MATCH ----------
async function scrapeMatch(match, i, dumpHtml = false) {
  const html = await fetchText(match.url);
  if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");

  const odds = parseOddsFromHtml(html);
  if (!odds) {
    console.log(`[odds] none for ${match.id} (${match.teams}) -> ${match.url}`);
    return [];
  }
  console.log(`[odds] ${match.id} ${match.teams} -> ${odds.o1}/${odds.ox}/${odds.o2}`);

  const out = [];
  if (odds.o1) out.push({ id: match.id, teams: match.teams, market: "1", odd: odds.o1, url: match.url });
  if (odds.ox) out.push({ id: match.id, teams: match.teams, market: "X", odd: odds.ox, url: match.url });
  if (odds.o2) out.push({ id: match.id, teams: match.teams, market: "2", odd: odds.o2, url: match.url });
  return out;
}

// --------- MAIN FLOW ----------
(async () => {
  try {
    const matches = await listMatches(DAY_OFFSET);
    await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

    const all = [];
    for (let i = 0; i < matches.length; i++) {
      try {
        const rows = await scrapeMatch(matches[i], i, true);
        all.push(...rows);
        await new Promise(r => setTimeout(r, 200)); // mic delay
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
