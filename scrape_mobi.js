// Flashscore.mobi — scraper (FOOTBALL) cu filtrare de status (sched/live/fin)

import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 40);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const RETRIES = Number(process.env.RETRIES || 1);
const GLOBAL_HARD_STOP_MS = Number(process.env.GLOBAL_HARD_STOP_MS || 150000);
const INCLUDE_LIVE = String(process.env.INCLUDE_LIVE || "false").toLowerCase() === "true"; // dacă vrei live

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchTextOnce(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error("timeout")), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
        "Cache-Control": "no-cache",
      },
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}
async function fetchText(url) {
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    try { return await fetchTextOnce(url); }
    catch (e) { lastErr = e; await sleep(250 * (i + 1)); }
  }
  throw lastErr || new Error("fetch failed");
}

function absUrl(href) { try { return new URL(href, BASE).toString(); } catch { return null; } }
function addDayParam(u, d) {
  try {
    const url = new URL(u);
    if (!url.searchParams.has("d")) url.searchParams.set("d", String(d));
    return url.toString();
  } catch { return u; }
}

// ia echipele din textul imediat anterior linkului
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
        t = t.replace(/\s+-:-.*$/, "").replace(/\s+\d+:\d+.*$/, "").trim();
        if (t.length > 3 && t.length <= 100) return t;
      }
    }
  }
  const parentTxt = cheerio(parent).text().replace(/\s+/g, " ").trim();
  if (parentTxt.includes(" - ")) {
    return parentTxt.replace(/\s+-:-.*$/, "").replace(/\s+\d+:\d+.*$/, "").trim();
  }
  return null;
}

// extrage ora din <span> imediat înaintea textului echipelor
function getTimeFromPrevSpan($, aEl) {
  const parent = aEl.parent;
  if (!parent?.childNodes) return null;
  const nodes = parent.childNodes;
  const idx = nodes.indexOf(aEl);
  for (let i = idx - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type === "tag" && n.name === "span") {
      const t = cheerio(n).text().trim();
      if (/^\d{1,2}:\d{2}$/.test(t)) return t;
      break;
    }
  }
  return null;
}

async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  await fs.writeFile("list.html", html, "utf8");

  const $ = cheerio.load(html);
  const rows = [];
  const seen = new Set();

  $('a[href^="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    const cls = ($(el).attr("class") || "").trim(); // "sched" | "live" | "fin"
    if (!href) return;

    // vrem doar programate; opțional, includem live dacă INCLUDE_LIVE=true
    if (!INCLUDE_LIVE && (cls.includes("live") || cls.includes("fin"))) return;
    if (cls.includes("fin")) return;

    const fullBase = absUrl(href);
    if (!fullBase) return;
    const full = addDayParam(fullBase, offset);

    const m = /\/match\/([^/]+)\//i.exec(full || "");
    const id = m ? m[1] : null;
    if (!id || seen.has(id)) return;

    const teams = getTeamsFromPrevText($, el);
    if (!teams) return;

    const ko = getTimeFromPrevSpan($, el); // "21:00" etc.

    seen.add(id);
    rows.push({ id, url: full, teams, status: cls || "sched", time: ko || null });
  });

  console.log(`[list] found ${rows.length} matches (filtered) for d=${offset}`);
  return rows.slice(0, MAX_MATCHES);
}

function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);

  // dacă pagina e deja "Finished", ieșim
  const meta = $("body").text();
  if (/Finished/i.test(meta) || /FT\b/i.test(meta)) return { finished: true };

  const oddsEl = $("p.odds-detail").first();
  if (!oddsEl.length) return null;

  const anchors = oddsEl.find("a").map((_, a) => $(a).text().trim()).toArray();
  let nums = anchors.map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);
  if (nums.length < 3) {
    const txt = oddsEl.text();
    const hits = txt.match(/\d+(?:[.,]\d+)?/g) || [];
    nums = hits.map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);
  }
  if (nums.length < 3) return null;

  return { o1: nums[0], ox: nums[1], o2: nums[2], finished: false };
}

async function scrapeOne(match, idx) {
  // safety: nu procesa dacă nu e programat, decât dacă e explicit permis live
  if (!INCLUDE_LIVE && match.status && match.status !== "sched") {
    return [];
  }
  try {
    const html = await fetchText(match.url);
    if (idx < 3) await fs.writeFile(`match-${idx + 1}-${match.id}.html`, html, "utf8");
    const odds = parseOddsFromHtml(html);
    if (!odds || odds.finished) {
      console.log(`[skip] ${match.id} ${match.teams} — status=${match.status} (finished/live/no-odds)`);
      return [];
    }
    const base = { id: match.id, teams: match.teams, url: match.url, status: "sched", time: match.time || null };
    return [
      { ...base, market: "1", odd: odds.o1 },
      { ...base, market: "X", odd: odds.ox },
      { ...base, market: "2", odd: odds.o2 },
    ];
  } catch (e) {
    console.log(`[match fail] ${match.id} ${e.message}`);
    return [];
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0, active = 0;
  return await new Promise((resolve) => {
    const launch = () => {
      while (active < limit && i < items.length) {
        const myIndex = i++;
        active++;
        fn(items[myIndex], myIndex)
          .then(res => { out[myIndex] = res; })
          .catch(() => { out[myIndex] = []; })
          .finally(() => { active--; launch(); if (i >= items.length && active === 0) resolve(out); });
      }
    };
    launch();
  });
}

(async () => {
  const globalTimer = setTimeout(() => {
    console.error(`[HARD-STOP] Global time budget exceeded (${GLOBAL_HARD_STOP_MS} ms). Flushing and exit.`);
    process.exit(0);
  }, GLOBAL_HARD_STOP_MS);

  try {
    const matches = await listMatches(DAY_OFFSET);
    await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

    console.log(`[run] scraping ${matches.length} matches (concurrency=${CONCURRENCY})`);
    const chunks = await mapWithConcurrency(matches, CONCURRENCY, scrapeOne);
    const all = chunks.flat();

    await fs.writeFile("odds.json", JSON.stringify({ events: all }, null, 2), "utf8");
    console.log(`[OK] Saved odds.json with ${all.length} rows (d=${DAY_OFFSET})`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    clearTimeout(globalTimer);
  }
})();
