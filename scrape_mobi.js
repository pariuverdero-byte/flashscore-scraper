// Flashscore.mobi/.ro hibrid — fetch + fallback Playwright (doar dacă HTML-ul e "gol").
// 1) încearcă multi-host cu fetch; loghează head-ul HTML (debug).
// 2) dacă nu există linkuri /match/, folosește Playwright să ia HTML-ul randat.
// 3) extrage 1/X/2 din <p class="odds-detail"> (ancore | split | regex).

import fs from "fs/promises";
import * as cheerio from "cheerio";

const HOSTS = [
  "https://flashscore.mobi",
  "https://www.flashscore.mobi",
  "https://m.flashscore.ro",
  "https://m.flashscore.com"
];

const DAY_OFFSET  = Number(process.env.DAY_OFFSET || 0);
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 50);
const UA_LIST = [
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
];
const UA = UA_LIST[Math.floor(Math.random() * UA_LIST.length)];

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": url.split("?")[0],
      "Connection": "keep-alive",
      // unele instanțe servesc compact fără accept-encoding — lăsăm implicit (node decomprimă)
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

function cleanTeamsFromAnchorText(raw) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!/ - /.test(t)) return null;
  return t.replace(/\s+-:-.*$/, "").trim();
}

function headLog(html, label) {
  const slice = (html || "").slice(0, 400).replace(/\s+/g, " ").trim();
  console.log(`[html:${label}] len=${(html || "").length} head="${slice}"`);
}

async function loadListHtml(offset) {
  // încearcă pe rând host-urile; salvează fiecare list-<host>.html
  for (const base of HOSTS) {
    const url = `${base}/?d=${offset}`;
    try {
      const html = await fetchText(url);
      const fname = `list-${new URL(base).host}.html`;
      await fs.writeFile(fname, html, "utf8");
      headLog(html, new URL(base).host);
      const $ = cheerio.load(html);
      const links = $('a[href*="/match/"]').length;
      if (links > 0) return { base, html, from: "fetch" };
    } catch (e) {
      console.log(`[list] fetch fail ${base}: ${e.message}`);
    }
  }
  // dacă niciun host nu dă linkuri, întoarce null — vom cădea pe Playwright
  return null;
}

async function loadListHtmlWithPlaywright(offset) {
  // dynamic import ca să nu stricăm rularea dacă lipsește playwright în local
  const { chromium } = await import("playwright");
  for (const base of HOSTS) {
    const url = `${base}/?d=${offset}`;
    try {
      const browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        userAgent: UA,
        viewport: { width: 412, height: 915 }, // mobile-ish
      });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
      // uneori cookie banner — încearcă să-l închizi
      try {
        const btn = page.locator('button:has-text("Accept"), button:has-text("Agree"), button:has-text("Sunt de acord")').first();
        if (await btn.isVisible()) await btn.click();
      } catch {}
      await page.waitForTimeout(800);
      const html = await page.content();
      await browser.close();
      const fname = `list-rendered-${new URL(base).host}.html`;
      await fs.writeFile(fname, html, "utf8");
      headLog(html, `rendered:${new URL(base).host}`);
      const $ = cheerio.load(html);
      const links = $('a[href*="/match/"]').length;
      if (links > 0) return { base, html, from: "playwright" };
    } catch (e) {
      console.log(`[list] playwright fail ${base}: ${e.message}`);
    }
  }
  return null;
}

async function listMatches(offset) {
  let res = await loadListHtml(offset);
  if (!res) {
    console.log("[list] no links via fetch — trying Playwright…");
    res = await loadListHtmlWithPlaywright(offset);
  }
  if (!res) {
    console.log("[list] total failure — no match links from any host");
    return [];
  }

  const { base, html, from } = res;
  const $ = cheerio.load(html);
  const seen = new Set();
  const rows = [];
  let skipped = 0;

  $('a[href*="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const full = toAbsUrlWithDay(href, base, offset);
    const id = (/\/match\/([^/]+)\//i.exec(full) || [])[1];
    if (!id || seen.has(id)) return;
    const teams = cleanTeamsFromAnchorText($(el).text());
    if (!teams) { skipped++; return; }
    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] base=${base} from=${from} d=${offset} -> matches: ${rows.length} (skipped=${skipped})`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  [${i}] ${r.teams} -> ${r.url}`));
  return rows.slice(0, MAX_MATCHES);
}

/* ---------- ODDS PARSER ---------- */

function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);
  const ps = $("p.odds-detail");
  for (let i = 0; i < ps.length; i++) {
    const anchors = $(ps[i]).find("a").map((_, a) => $(a).text().trim()).toArray();
    if (anchors.length >= 3) {
      const nums = anchors.slice(0,3).map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);
      if (nums.length >= 2) return { o1: nums[0] ?? null, ox: nums[1] ?? null, o2: nums[2] ?? null };
    }
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
  // fallback: h5 Odds/Cote -> primul p
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

async function fetchMatchHtml(url) {
  // întâi fetch clasic
  try {
    const html = await fetchText(url);
    headLog(html, "match:fetch");
    return { html, from: "fetch" };
  } catch (e) {
    console.log(`[match] fetch fail: ${e.message}`);
  }
  // apoi Playwright
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(600);
  const html = await page.content();
  await browser.close();
  headLog(html, "match:rendered");
  return { html, from: "playwright" };
}

async function scrapeMatch(match, i) {
  const { html, from } = await fetchMatchHtml(match.url);
  if (i < 5) await fs.writeFile(`match-${i + 1}-${match.id}.${from}.html`, html, "utf8");

  const odds = parseOddsFromHtml(html);
  if (!odds) {
    console.log(`[odds] none for ${match.id} (${match.teams}) [via ${from}]`);
    return [];
  }
  console.log(`[odds] ${match.id} ${match.teams} -> ${odds.o1}/${odds.ox}/${odds.o2} [via ${from}]`);

  return [
    { id: match.id, teams: match.teams, market: "1", odd: odds.o1, url: match.url },
    { id: match.id, teams: match.teams, market: "X", odd: odds.ox, url: match.url },
    { id: match.id, teams: match.teams, market: "2", odd: odds.o2, url: match.url }
  ];
}

/* ---------- MAIN ---------- */
(async () => {
  try {
    const matches = await listMatches(DAY_OFFSET);
    await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

    const all = [];
    for (let i = 0; i < matches.length; i++) {
      try {
        const rows = await scrapeMatch(matches[i], i);
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
