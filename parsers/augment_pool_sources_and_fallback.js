// parsers/augment_pool_sources_and_fallback.js
// Multi-source augmentation + last-resort Flashscore odds fallback.
// Visitor-facing output remains unchanged; source/fallback metadata is internal only.

import fs from "fs/promises";
import * as cheerio from "cheerio";
import { matchEventToFlashscore } from "../engine/matcher_core.js";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const MASTER_FILE = "master_pool.json";
const MATCHES_FILE = "matches.json";
const EXTRA_ARTIFACT = "extra_sources_pool.json";
const FALLBACK_ARTIFACT = "flashscore_odds_fallback.json";
const MIN_POOL = Math.max(4, Number(process.env.FLASHSCORE_FALLBACK_MIN_POOL || 8));
const TARGET_POOL = Math.max(MIN_POOL, Number(process.env.FLASHSCORE_FALLBACK_TARGET_POOL || 12));
const MAX_FS_MATCHES = Math.max(4, Number(process.env.FLASHSCORE_FALLBACK_MAX_MATCHES || 24));
const CONCURRENCY = Math.max(1, Number(process.env.FLASHSCORE_FALLBACK_CONCURRENCY || 4));

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const safe = (v) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const norm = (v) => safe(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const SOURCES = [
  ["biletu-zilei", "https://biletu-zilei.com/biletul-zilei/cota-2/"],
  ["biletu-zilei", "https://biletu-zilei.com/biletul-zilei/cota-3/"],
  ["10pariuri", "https://10pariuri.ro/biletul-zilei-la-pariuri/cota-2/"],
  ["10pariuri", "https://10pariuri.ro/biletul-zilei-la-pariuri/cota-3-azi/"],
  ["10pariuri", "https://10pariuri.ro/biletul-zilei-la-pariuri/bilet-cota-mare/"],
  ["sportytrader", "https://www.sportytrader.com/en/betting-tips/football/today/"],
];

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); }
  catch { return fallback; }
}

function getMatches(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.matches)) return raw.matches;
  if (Array.isArray(raw?.fixtures)) return raw.fixtures;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function targetDate() {
  const date = new Date(Date.now() + DAY_OFFSET * 86400000);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t) => p.find((x) => x.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function fetchText(url) {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

function blockTexts(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const out = [];
  $("article p,article li,article tr,main p,main li,main tr,.entry-content p,.entry-content li,.post-content p,.post-content li,h2,h3,h4").each((_, el) => {
    const t = safe($(el).text());
    if (t.length >= 5 && t.length <= 600) out.push(t);
  });
  if (!out.length) $("p,li,tr").each((_, el) => { const t = safe($(el).text()); if (t.length >= 5 && t.length <= 600) out.push(t); });
  return [...new Set(out)];
}

function splitEvent(text) {
  const t = safe(text);
  const patterns = [
    /^(.{2,70}?)\s+vs\.?\s+(.{2,70}?)(?=\s+(?:pont|pick|tip|peste|sub|over|under|victorie|home win|away win|cota|odds?)\b|$)/i,
    /^(.{2,70}?)\s+v\s+(.{2,70}?)(?=\s+(?:pont|pick|tip|peste|sub|over|under|victorie|home win|away win|cota|odds?)\b|$)/i,
    /^(.{2,70}?)\s+[–—-]\s+(.{2,70}?)(?=\s+(?:pont|pick|tip|peste|sub|over|under|victorie|home win|away win|cota|odds?)\b|$)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (!m) continue;
    const clean = (v) => safe(v).replace(/^\d{1,2}[:.]\d{2}\s+/, "").replace(/\s*\([^)]{2,8}\)\s*$/, "").trim();
    const home = clean(m[1]);
    const away = clean(m[2]);
    if (home.length >= 2 && away.length >= 2) return { home, away };
  }
  return null;
}

function oddFrom(text) {
  const t = safe(text).replace(/,/g, ".");
  const m = t.match(/(?:cota|cot[aă]|odds?|@)\s*[:=-]?\s*(1\.\d{2,3}|2\.\d{2,3}|3\.\d{2,3})/i);
  return m ? Number(m[1]) : null;
}

function marketFrom(text, event) {
  const t = norm(text);
  let m = t.match(/(?:peste|over)\s*(\d+(?:[ .]\d+)?)\s*(?:gol|goluri|goals?)/);
  if (m) return `Peste ${m[1].replace(" ", ".")} goluri`;
  m = t.match(/(?:sub|under)\s*(\d+(?:[ .]\d+)?)\s*(?:gol|goluri|goals?)/);
  if (m) return `Sub ${m[1].replace(" ", ".")} goluri`;
  m = t.match(/(?:peste|over)\s*(\d+(?:[ .]\d+)?)\s*(?:cornere|corners?)/);
  if (m) return `Peste ${m[1].replace(" ", ".")} cornere`;
  m = t.match(/(?:sub|under)\s*(\d+(?:[ .]\d+)?)\s*(?:cornere|corners?)/);
  if (m) return `Sub ${m[1].replace(" ", ".")} cornere`;
  m = t.match(/(?:peste|over)\s*(\d+(?:[ .]\d+)?)\s*(?:cartonase|cards?)/);
  if (m) return `Peste ${m[1].replace(" ", ".")} cartonase`;
  if (/ambele echipe.*marcheaza|both teams.*score|\bbtts\b|\bgg\b/.test(t)) return "Ambele echipe marcheaza";
  if (/sansa dubla\s*1x|double chance\s*1x|\b1x\b/.test(t)) return "Sansa dubla 1X";
  if (/sansa dubla\s*x2|double chance\s*x2|\bx2\b/.test(t)) return "Sansa dubla X2";
  if (/victorie gazde|home win|gazdele castiga/.test(t)) return "Victorie gazde";
  if (/victorie oaspeti|away win|oaspetii castiga/.test(t)) return "Victorie oaspeti";
  if (/\begal\b|\bdraw\b/.test(t)) return "Egal";
  if (event && (/\bcastiga\b|\bto win\b|\bwins?\b/.test(t))) {
    if (t.includes(norm(event.home))) return `Victorie ${event.home}`;
    if (t.includes(norm(event.away))) return `Victorie ${event.away}`;
  }
  return null;
}

function dateTokens(iso) {
  const [y,m,d] = iso.split("-");
  return [iso, `${d}-${m}-${y}`, `${d}.${m}.${y}`, `${d}/${m}/${y}`].map(norm);
}

function articleLinks(html, baseUrl, iso) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const tokens = dateTokens(iso);
  const out = [];
  $("a[href]").each((_, a) => {
    const href = safe($(a).attr("href"));
    const text = safe($(a).text());
    let url; try { url = new URL(href, baseUrl).toString(); } catch { return; }
    const hay = norm(`${text} ${url}`);
    if (tokens.some((x) => x && hay.includes(x)) || /biletul zilei|bilet cota|cota 2|cota 3/i.test(text)) out.push(url);
  });
  return [...new Set(out)].slice(0, 6);
}

function extractSelections(html, source, sourceUrl) {
  const blocks = blockTexts(html);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const context = [blocks[i], blocks[i+1], blocks[i+2]].filter(Boolean).join(" | ");
    const event = splitEvent(blocks[i]) || splitEvent(context);
    if (!event) continue;
    const market = marketFrom(context, event);
    const odd = oddFrom(context);
    if (!market || !Number.isFinite(odd) || odd <= 1.01 || odd > 5) continue;
    out.push({ teams: `${event.home} - ${event.away}`, market_raw: market, odd: Number(odd.toFixed(3)), source, source_url: sourceUrl, meta: { bet_text: market, source, source_url: sourceUrl } });
  }
  return out;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((x) => {
    const key = `${safe(x.match_id)}|${norm(x.teams)}|${norm(x.market_raw)}|${Number(x.odd).toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function canonicalize(sel, matches) {
  const hit = matchEventToFlashscore(sel.teams, matches);
  if (!hit?.match) return null;
  const m = hit.match;
  const id = safe(m.id || m.match_id || m.flashscore_id);
  if (!id) return null;
  const url = safe(m.url || m.flashscore_url) || `https://www.flashscore.mobi/match/${id}/`;
  return { ...sel, id, match_id: id, flashscore_url: url, url, teams: safe(m.teams) || sel.teams, time: safe(m.time), country: safe(m.country), competition: safe(m.competition || m.league), meta: { ...sel.meta, flashscore_match_confidence: Number(hit.score?.toFixed?.(3) || hit.score || 0) } };
}

function splitTeams(value) {
  const parts = safe(value).replace(/\s+[–—−]\s+/g, " - ").split(/\s+-\s+/).map(safe).filter(Boolean);
  const strip = (v) => safe(v).replace(/\s*\([^)]{2,8}\)\s*$/, "").trim();
  return parts.length >= 2 ? { home: strip(parts[0]), away: strip(parts.slice(1).join(" - ")) } : { home: "", away: "" };
}

function validOdd(v, min, max) { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max; }


async function addExtraSources(master, matches, iso) {
  const raw = [], errors = [];
  for (const [source, indexUrl] of SOURCES) {
    try {
      const indexHtml = await fetchText(indexUrl);
      const pages = [indexUrl, ...articleLinks(indexHtml, indexUrl, iso)];
      for (const page of [...new Set(pages)].slice(0,6)) {
        try {
          const html = page === indexUrl ? indexHtml : await fetchText(page);
          raw.push(...extractSelections(html, source, page));
        } catch (e) { errors.push(`${source} ${page}: ${e.message}`); }
      }
    } catch (e) { errors.push(`${source} ${indexUrl}: ${e.message}`); }
  }
  try {
    const [y,m,d] = iso.split("-");
    const url = `https://ponturipariuri.pro/biletulzilei/biletul-zilei-cota-2-${d}-${m}-${y}/`;
    raw.push(...extractSelections(await fetchText(url), "ponturipariuri.pro", url));
  } catch (e) { errors.push(`ponturipariuri.pro: ${e.message}`); }
  const parsed = dedupe(raw);
  const matched = parsed.map((s) => canonicalize(s, matches)).filter(Boolean);
  await fs.writeFile(EXTRA_ARTIFACT, JSON.stringify({ date: iso, raw_count: parsed.length, matched_count: matched.length, selections: matched, errors }, null, 2));
  const combined = dedupe([...(master.selections || []), ...matched]);
  return { master: { ...master, source_mode: matched.length ? `${master.source_mode || "existing"}_plus_extra_sources` : (master.source_mode || "existing"), sources_used: [...new Set([...(master.sources_used || []), ...matched.map((x) => x.source)])], upstream_counts: { ...(master.upstream_counts || {}), extra_sources_raw: parsed.length, extra_sources_matched_to_flashscore: matched.length }, selections: combined }, matched: matched.length };
}

async function addFallback(master, matches) {
  // Legacy per-match Flashscore prematch fallback disabled.
  // The single official fallback now runs in:
  // parsers/flashscore_odds_list_fallback.js
  //
  // Keep this function only so the augmentation flow remains
  // backward-compatible and non-blocking.

  return {
    master,
    added: 0
  };
}

(async () => {
  const iso = targetDate();
  const matches = getMatches(await readJson(MATCHES_FILE, { matches: [] }));
  let master = await readJson(MASTER_FILE, { date: iso, source: "master_pool", source_mode: "empty", sources_used: [], selections: [] });
  const extra = await addExtraSources(master, matches, iso);
  master = extra.master;
  const fallback = await addFallback(master, matches);
  master = fallback.master;
  await fs.writeFile(MASTER_FILE, JSON.stringify(master, null, 2), "utf8");
  console.log(`[POOL+] extra_matched=${extra.matched} fallback_added=${fallback.added} final_pool=${master.selections?.length || 0}`);
})().catch((e) => console.warn(`[POOL+] non-blocking failure: ${e?.message || e}`));
