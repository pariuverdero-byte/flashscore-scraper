// Scraper Flashscore.mobi — Football, Tennis, Basketball
// - listează meciuri din "All Games" (s=1) și "Odds" (s=5)
// - extrage competiția din <h4> (ex: "ENGLAND: Premier League") și o atașează fiecărui meci
// - piețe: 1X2 (3-way), 1/2 (2-way), Double Chance, Over/Under, Cards, Corners
// Output odds.json: {id, teams, market, odd, url, sport, competition}

import fs from "fs/promises";
import * as cheerio from "cheerio";

const HOST = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 80);
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36";

const SPORTS = [
  { key: "football",   path: "/" },
  { key: "tennis",     path: "/tennis/" },
  { key: "basketball", path: "/basketball/" },
];

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
      "Cache-Control": "no-cache",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function addDayParam(absUrl, d) {
  const u = new URL(absUrl);
  if (!u.searchParams.has("d")) u.searchParams.set("d", String(d));
  return u.toString();
}
function absMatchUrl(href, d) {
  const abs = new URL(href, HOST).toString();
  return addDayParam(abs, d);
}

// textul de dinaintea <a href="/match/...">
function getPrevTeamsText($, aEl) {
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
  return null;
}

// PARSE LIST cu context de competitie (din <h4>) — lucrăm în #score-data
function parseMatchLinksWithCompetitions(html, d, sportKey) {
  const $ = cheerio.load(html);
  const root = $("#score-data");
  let currentCompetition = null;
  const out = [];
  const seen = new Set();

  root.children().each((_, node) => {
    const el = $(node);
    if (el.is("h4")) {
      // exemplu text: "ENGLAND: Premier League Standings"
      const raw = el.text().trim().replace(/\s+Standings.*$/i, "").trim();
      currentCompetition = raw || null;
      return;
    }
    // caută linkuri de meci în acest bloc
    el.find('a[href*="/match/"]').each((__, a) => {
      const href = $(a).attr("href");
      if (!href) return;
      const url = absMatchUrl(href, d);
      const id = (/\/match\/([^/]+)\//i.exec(url) || [])[1];
      if (!id || seen.has(id)) return;
      const teams = getPrevTeamsText($, a);
      if (!teams) return;
      seen.add(id);
      out.push({ id, url, teams, sport: sportKey, competition: currentCompetition || "" });
    });
  });

  return out;
}

async function listSportMatches(sport) {
  const d = DAY_OFFSET;
  const urls = [
    `${HOST}${sport.path}?d=${d}&s=1`,
    `${HOST}${sport.path}?d=${d}&s=5`,
  ];
  const all = [];
  for (const u of urls) {
    try {
      const html = await fetchText(u);
      if (u.includes("s=1")) await fs.writeFile(`list-${sport.key}-s1.html`, html, "utf8");
      if (u.includes("s=5")) await fs.writeFile(`list-${sport.key}-s5.html`, html, "utf8");
      const rows = parseMatchLinksWithCompetitions(html, d, sport.key);
      all.push(...rows);
    } catch (e) {
      console.log(`[list] ${sport.key} load fail ${u}: ${e.message}`);
    }
  }
  // dedupe by id
  const uniq = [];
  const seen = new Set();
  for (const r of all) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    uniq.push(r);
  }
  console.log(`[list] ${sport.key} d=${d} -> ${uniq.length} matches`);
  return uniq;
}

function asEvent(match, market, odd) {
  const o = Number(odd);
  if (!isFinite(o) || o <= 1.01 || o >= 100) return null;
  return {
    id: match.id,
    teams: match.teams,
    market,
    odd: o,
    url: match.url,
    sport: match.sport,
    competition: match.competition || ""
  };
}

// ---- parsere piețe din pagina meciului (identice ca înainte) ----
import { parse } from "node:path";
import path from "node:path"; // inert, dar keeps ESM happy in some bundlers

function parse1X2or2Way($, match) {
  const out = [];
  const ps = $("p.odds-detail");
  for (let i = 0; i < ps.length; i++) {
    const anchors = $(ps[i]).find("a").map((_, a) => $(a).text().trim()).toArray();
    if (anchors.length >= 2) {
      const nums = anchors.map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);
      if (nums.length === 2) {
        const e1 = asEvent(match, "1", nums[0]);
        const e2 = asEvent(match, "2", nums[1]);
        if (e1) out.push(e1);
        if (e2) out.push(e2);
        return out;
      }
      if (nums.length >= 3) {
        const e1 = asEvent(match, "1", nums[0]);
        const eX = asEvent(match, "X", nums[1]);
        const e2 = asEvent(match, "2", nums[2]);
        if (e1) out.push(e1);
        if (eX) out.push(eX);
        if (e2) out.push(e2);
        return out;
      }
    }
    const txt = $(ps[i]).text().trim();
    const viaPipe = txt.split("|").map(s => s.trim()).filter(Boolean);
    const nums = viaPipe.map(s => Number(s.replace(",", "."))).filter(n => n > 1.01 && n < 100);
    if (nums.length === 2) {
      const e1 = asEvent(match, "1", nums[0]);
      const e2 = asEvent(match, "2", nums[1]);
      if (e1) out.push(e1);
      if (e2) out.push(e2);
      return out;
    }
    if (nums.length >= 3) {
      const e1 = asEvent(match, "1", nums[0]);
      const eX = asEvent(match, "X", nums[1]);
      const e2 = asEvent(match, "2", nums[2]);
      if (e1) out.push(e1);
      if (eX) out.push(eX);
      if (e2) out.push(e2);
      return out;
    }
  }
  return out;
}

function firstPAfterHeader($, regex) {
  const h = $("h5").filter((_, el) => regex.test($(el).text())).first();
  if (!h.length) return null;
  const p = h.nextAll("p").first();
  return p.length ? p : null;
}

function parseDoubleChance($, match) {
  const out = [];
  const p = firstPAfterHeader($, /Double chance|Dubl[ăa] șans[ăa]/i);
  if (!p) return out;
  const items = p.find("a").map((_, a) => $(a).text().trim()).toArray();
  const txt = p.text().trim();
  const cand = items.length ? items : txt.split("|").map(s => s.trim());
  cand.forEach(s => {
    const m = /(1X|12|X2)\s*[: ]\s*(\d+(?:[.,]\d+)?)/i.exec(s) || /(1X|12|X2)\s*(\d+(?:[.,]\d+)?)/i.exec(s);
    if (m) {
      const mk = m[1].toUpperCase();
      const odd = Number(m[2].replace(",", "."));
      const e = asEvent(match, mk, odd);
      if (e) out.push(e);
    }
  });
  return out;
}

function parseOverUnderGeneric($, match) {
  const out = [];
  const p =
    firstPAfterHeader($, /Over\/Under|Peste\/Sub|Total (points|games)/i) ||
    firstPAfterHeader($, /Total/i);
  if (!p) return out;
  const items = p.find("a").map((_, a) => $(a).text().trim()).toArray();
  const txt = p.text().trim();
  const cand = items.length ? items : txt.split("|").map(s => s.trim());
  cand.forEach(s => {
    const m = /(Over|Under|O|U)\s*([0-9]+(?:\.[05])?)\s*(\d+(?:[.,]\d+)?)/i.exec(s);
    if (m) {
      const side = m[1].toUpperCase().startsWith("O") ? "O" : "U";
      const line = m[2];
      const odd = Number(m[3].replace(",", "."));
      const e = asEvent(match, `${side}${line}`, odd);
      if (e) out.push(e);
    }
  });
  return out;
}

function parseCardsCorners($, match) {
  if (match.sport !== "football") return [];
  const out = [];
  const sections = [
    { rx: /Cards|Cartona[șs]e/i, prefix: "Cards" },
    { rx: /Corners|Cornere/i,   prefix: "Corners" },
  ];
  for (const sec of sections) {
    const p = firstPAfterHeader($, sec.rx);
    if (!p) continue;
    const items = p.find("a").map((_, a) => $(a).text().trim()).toArray();
    const txt = p.text().trim();
    const cand = items.length ? items : txt.split("|").map(s => s.trim());
    cand.forEach(s => {
      const m = /(Over|Under|O|U)\s*([0-9]+(?:\.[05])?)\s*(\d+(?:[.,]\d+)?)/i.exec(s);
      if (m) {
        const side = m[1].toUpperCase().startsWith("O") ? "O" : "U";
        const line = m[2];
        const odd = Number(m[3].replace(",", "."));
        const ev = asEvent(match, `${sec.prefix} ${side}${line}`, odd);
        if (ev) out.push(ev);
      }
    });
  }
  return out;
}

function dedupeSelections(rows) {
  const seen = new Set();
  return rows.filter(e => {
    const key = `${e.id}|${e.market}|${e.odd.toFixed(3)}|${e.sport}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function scrapeMatch(match, i, dumpHtml = true) {
  const html = await fetchText(match.url);
  if (dumpHtml && i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");
  const $ = cheerio.load(html);

  let rows = [];
  rows.push(...parse1X2or2Way($, match));
  rows.push(...parseDoubleChance($, match));
  rows.push(...parseOverUnderGeneric($, match));
  rows.push(...parseCardsCorners($, match));

  rows = dedupeSelections(rows);
  if (!rows.length) console.log(`[odds] none for ${match.id} (${match.teams}) [${match.sport}]`);
  return rows;
}

(async () => {
  try {
    let matches = [];
    for (const s of SPORTS) {
      const list = await listSportMatches(s);
      matches.push(...list);
    }
    if (matches.length > MAX_MATCHES) matches = matches.slice(0, MAX_MATCHES);

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
