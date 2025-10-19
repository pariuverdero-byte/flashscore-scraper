// Flashscore.mobi scraper – multi-host + headers robuste + debug complet
import fs from "fs/promises";
import * as cheerio from "cheerio";

const HOSTS = [
  "https://flashscore.mobi",
  "https://www.flashscore.mobi",
  "https://m.flashscore.com"
];
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0); // 0=azi, 1=maine, 2=poimaine
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 50);

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36"
];
const UA = UAS[Math.floor(Math.random() * UAS.length)];

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Connection": "keep-alive",
      "Referer": url.split("?")[0]
    }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function toAbsUrlWithDay(href, base, offset) {
  const abs = new URL(href, base);
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

// încarcă toate host-urile; întoarce primul cu linkuri valide către /match/
async function loadListFromAnyHost(offset) {
  const attempts = [];
  for (const base of HOSTS) {
    const url = `${base}/?d=${offset}`;
    try {
      const html = await fetchText(url);
      const fname = `list-${new URL(base).host}.html`;
      await fs.writeFile(fname, html, "utf8");
      const $ = cheerio.load(html);
      const links = $('a[href*="/match/"]');
      attempts.push({ base, count: links.length });
      if (links.length > 0) {
        return { base, html };
      }
    } catch (e) {
      attempts.push({ base, error: e.message });
    }
  }
  console.log("[list] attempts:", attempts);
  return { base: null, html: "" };
}

async function listMatches(offset) {
  const { base, html } = await loadListFromAnyHost(offset);
  if (!base) {
    console.log("[list] no host returned match links");
    return [];
  }

  const $ = cheerio.load(html);
  const seen = new Set();
  const rows = [];
  let skippedNoTeams = 0;

  $('a[href*="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const full = toAbsUrlWithDay(href, base, offset);
    const id = (/\/match\/([^/]+)\//i.exec(full) || [])[1];
    if (!id || seen.has(id)) return;

    const teams = cleanTeams($(el).text());
    if (!teams) { skippedNoTeams++; return; }

    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] base=${base} d=${offset} -> matches: ${rows.length} (skipped w/o teams: ${skippedNoTeams})`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  [${i}] ${r.teams} -> ${r.url}`));
  return rows.slice(0, MAX_MATCHES);
}

// ---- ODDS PARSER (din <p class="odds-detail"> cu <a> sau text "2.58|3.59|2.86") ----
function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);

  const ps = $("p.odds-detail");
  for (let i = 0; i < ps.length; i++) {
    // 1) doar <a> din interior
    const anchors = $(ps[i]).find("a").map((_, a) => $(a).text().trim()).toArray();
    if (anchors.length >= 3) {
      const nums = anchors.slice(0, 3)
        .map(s => Number(s.replace(",", ".")))
        .filter(n => n > 1.01 && n < 100);
      if (nums.length >= 2) return { o1: nums[0] ?? null, ox: nums[1] ?? null, o2: nums[2] ?? null };
    }
    // 2) text direct (poate fi "2.58|3.59|2.86" fără spații)
    const txt = $(ps[i]).text().trim();
    const viaPipe = txt.split("|").map(s => s.trim()).filter(Boolean);
    if (viaPipe.length >= 3) {
      const [a,b,c] = viaPipe.map(s => Number(s.replace(",", ".")));
      if ([a,b,c].every(v => v > 1.01 && v < 100)) return { o1: a, ox: b, o2: c };
    }
    // 3) fallback: toate numerele
    const nums2 = (txt.match(/\d+(?:[.,]\d+)?/g) || [])
      .map(s => Number(s.replace(",", ".")))
      .filter(n => n > 1.01 && n < 100);
    if (nums2.length >= 3) return { o1: nums2[0], ox: nums2[1], o2: nums2[2] };
  }

  // 4) fallback pe h5 Odds/Cote -> primul <p>
  const $h5 = $("h5").filter((_, el) => /Odds|Cote/i.test($(el).text())).first();
  if ($h5.length) {
    const p = $h5.nextAll("p").first();
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

function triplet(match, odds, url) {
  const out = [];
  if (odds.o1) out.push({ id: match.id, teams: match.teams, market: "1", odd: odds.o1, url });
  if (odds.ox) out.push({ id: match.id, teams: match.teams, market: "X", odd: odds.ox, url });
  if (odds.o2) out.push({ id: match.id, teams: match.teams, market: "2", odd: odds.o2, url });
  return out;
}

async function scrapeMatch(match, i, dumpHtml = true) {
  const html = await fetchText(match.url);
  if (dumpHtml && i < 5) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");

  const odds = parseOddsFromHtml(html);
  if (!odds) {
    console.log(`[odds] none for ${match.id} (${match.teams}) -> ${match.url}`);
    return [];
  }
  console.log(`[odds] ${match.id} ${match.teams} -> ${odds.o1}/${odds.ox}/${odds.o2}`);
  return triplet(match, odds, match.url);
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
