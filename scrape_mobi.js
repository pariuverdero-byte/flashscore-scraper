// Scraper Flashscore.mobi — extrage din pagina meciului:
// 1X2 (p.odds-detail) + piețe suplimentare ("Double chance", "Over/Under", "Cards", "Corners")
// NOTĂ: Formatarea pe mobi diferă pe competiții; parserul are fallback-uri tolerante.

import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 50);
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36";

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
  const abs = new URL(href, BASE);
  if (!abs.searchParams.has("d")) abs.searchParams.set("d", String(offset));
  return abs.toString();
}

// --- echipele sunt în textul de DINAINTEA linkului către meci ---
function getTeamsFromContext($, aEl) {
  const parent = aEl.parent;
  if (!parent || !parent.childNodes) return null;
  const nodes = parent.childNodes;
  const idx = nodes.indexOf(aEl);
  for (let i = idx - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type === "text") {
      let t = String(n.data || "").replace(/\s+/g, " ").trim();
      if (t.includes(" - ")) {
        t = t.replace(/\s+-:-.*$/, "").replace(/\s+\d+:\d+.*$/, "").trim();
        if (t.length > 3 && t.length <= 80) return t;
      }
    }
  }
  return null;
}

async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  await fs.writeFile("list.html", html, "utf8");

  const $ = cheerio.load(html);
  const seen = new Set();
  const rows = [];
  $('a[href*="/match/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const full = toAbsUrlWithDay(href, offset);
    const id = (/\/match\/([^/]+)\//i.exec(full) || [])[1];
    if (!id || seen.has(id)) return;
    const teams = getTeamsFromContext($, el);
    if (!teams) return;
    seen.add(id);
    rows.push({ id, url: full, teams });
  });

  console.log(`[list] d=${offset} -> matches: ${rows.length}`);
  return rows.slice(0, MAX_MATCHES);
}

// ---------- parsere piețe ----------
function asEvent(match, market, odd, url) {
  return odd && odd > 1.01 && odd < 100 ? {
    id: match.id, teams: match.teams, market, odd: Number(odd), url
  } : null;
}

function parse1X2($, match, url) {
  const out = [];
  $("p.odds-detail").each((_, p) => {
    const a = $(p).find("a").map((__, x) => $(x).text().trim()).toArray();
    if (a.length >= 3) {
      const o = a.slice(0,3).map(s => Number(s.replace(",", ".")));
      const e1 = asEvent(match, "1", o[0], url);
      const eX = asEvent(match, "X", o[1], url);
      const e2 = asEvent(match, "2", o[2], url);
      [e1,eX,e2].forEach(e=>e && out.push(e));
      return false; // prima secțiune ajunge
    }
    const txt = $(p).text().trim();
    const viaPipe = txt.split("|").map(s => s.trim());
    if (viaPipe.length >= 3) {
      const o = viaPipe.slice(0,3).map(s => Number(s.replace(",", ".")));
      [asEvent(match,"1",o[0],url),asEvent(match,"X",o[1],url),asEvent(match,"2",o[2],url)]
        .forEach(e=>e && out.push(e));
      return false;
    }
  });
  return out;
}

// helper: ia primul <p> după un <h5> care conține un cuvânt-cheie (ex: Over/Under)
function firstPAfterHeader($, re) {
  const h = $("h5").filter((_, el) => re.test($(el).text())).first();
  if (!h.length) return null;
  const p = h.nextAll("p").first();
  return p.length ? p : null;
}

// Double chance (1X | 12 | X2)
function parseDoubleChance($, match, url) {
  const out = [];
  const p = firstPAfterHeader($, /Double chance|Dubl[ăa] șans[ăa]/i);
  if (!p) return out;
  // Posibile formate: "<a>1X 1.35</a>|<a>12 1.40</a>|<a>X2 1.50</a>" sau text simplu
  const chunks = p.find("a").map((_, a) => $(a).text().trim()).toArray();
  const txt = p.text().trim();
  const candidates = chunks.length ? chunks : txt.split("|").map(s => s.trim());
  candidates.forEach(s => {
    const m = /(1X|12|X2)\s*[: ]\s*(\d+(?:[.,]\d+)?)/i.exec(s) || /(1X|12|X2)\s*(\d+(?:[.,]\d+)?)/i.exec(s);
    if (m) {
      const mk = m[1].toUpperCase();
      const odd = Number(m[2].replace(",", "."));
      const e = asEvent(match, mk, odd, url);
      if (e) out.push(e);
    }
  });
  return out;
}

// Over/Under Goluri (ex: Over 2.5, Under 2.5)
function parseOverUnderGoals($, match, url) {
  const out = [];
  const p = firstPAfterHeader($, /Over\/Under|Peste\/Sub|Total goals/i);
  if (!p) return out;
  const items = p.find("a").map((_, a) => $(a).text().trim()).toArray();
  const txt = p.text().trim();
  const candidates = items.length ? items : txt.split("|").map(s => s.trim());
  candidates.forEach(s => {
    // ex: "Over 2.5 1.90" / "Under 2.5 1.95" / "O2.5 1.90"
    const m = /(Over|Under|O|U)\s*([0-9]+(?:\.[05])?)\s*(\d+(?:[.,]\d+)?)/i.exec(s);
    if (m) {
      const side = m[1].toUpperCase().startsWith("O") ? "O" : "U";
      const line = m[2];
      const odd = Number(m[3].replace(",", "."));
      const market = `${side}${line}`; // ex: O2.5 / U3.5
      const e = asEvent(match, market, odd, url);
      if (e) out.push(e);
    }
  });
  return out;
}

// Cartonașe (Cards) și Cornere (Corners) — format similar Over/Under
function parseTotalsSection($, match, url, headerRegex, prefix) {
  const out = [];
  const p = firstPAfterHeader($, headerRegex);
  if (!p) return out;
  const items = p.find("a").map((_, a) => $(a).text().trim()).toArray();
  const txt = p.text().trim();
  const candidates = items.length ? items : txt.split("|").map(s => s.trim());
  candidates.forEach(s => {
    const m = /(Over|Under|O|U)\s*([0-9]+(?:\.[05])?)\s*(\d+(?:[.,]\d+)?)/i.exec(s);
    if (m) {
      const side = m[1].toUpperCase().startsWith("O") ? "O" : "U";
      const line = m[2];
      const odd = Number(m[3].replace(",", "."));
      const market = `${prefix} ${side}${line}`; // ex: Cards O4.5 / Corners U9.5
      const e = asEvent(match, market, odd, url);
      if (e) out.push(e);
    }
  });
  return out;
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter(e => {
    const key = `${e.id}|${e.market}|${e.odd.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function scrapeMatch(match, i, dumpHtml = true) {
  const html = await fetchText(match.url);
  if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");

  const $ = cheerio.load(html);

  let events = [];
  events.push(...parse1X2($, match, match.url));
  events.push(...parseDoubleChance($, match, match.url));
  events.push(...parseOverUnderGoals($, match, match.url));
  events.push(...parseTotalsSection($, match, match.url, /Cards|Cartona[șs]e/i, "Cards"));
  events.push(...parseTotalsSection($, match, match.url, /Corners|Cornere/i, "Corners"));

  events = dedupe(events);
  if (!events.length) console.log(`[odds] none for ${match.id} (${match.teams})`);
  return events;
}

// MAIN
(async () => {
  try {
    const matches = await listMatches(DAY_OFFSET);
    await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

    const all = [];
    for (let i = 0; i < matches.length; i++) {
      try {
        const rows = await scrapeMatch(matches[i], i, true);
        all.push(...rows);
        await new Promise(r => setTimeout(r, 150));
      } catch (e) {
        console.error("[MATCH FAIL]", matches[i].url, e.message);
      }
    }

    await fs.writeFile("odds.json", JSON.stringify({ events: all }, null, 2), "utf8");
    console.log(`[OK] Saved odds.json with ${all.length} selections (d=${DAY_OFFSET})`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
