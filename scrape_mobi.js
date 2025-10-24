// scrape_mobi.js — PATCHED: robust match list + clean competition names
import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 60);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language":"en-US,en;q=0.9,ro;q=0.8" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}
const absUrl = (href)=> { try { return new URL(href, BASE).toString(); } catch { return null; } };
const normSpace = (s="") => s.replace(/\s+/g," ").trim();

// NEW: strip “Standings”, “Table”, trailing links etc.
function cleanCompetition(h4Text="") {
  let t = h4Text.replace(/\s*Standings.*$/i, "")
                .replace(/\s*Table.*$/i, "")
                .replace(/\s*Classification.*$/i, "")
                .replace(/\s*\|.*$/,"")
                .trim();
  // Also normalize multiple spaces
  return normSpace(t);
}

async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  await fs.writeFile("list.html", html, "utf8");

  const $ = cheerio.load(html);
  const rows = [];
  const seen = new Set();

  let lastComp = "";

  // Primary path: traverse #score-data children
  $("#score-data").children().each((_, el) => {
    const node = $(el);

    if (node.is("h4")) {
      lastComp = cleanCompetition(normSpace(node.text()));
      return;
    }

    node.find('a[href^="/match/"]').each((__, a) => {
      const href = $(a).attr("href");
      if (!href) return;
      const full = absUrl(href.includes("?") ? `${href}&d=${offset}` : `${href}?d=${offset}`);
      const m = /\/match\/([^/]+)\//i.exec(full || "");
      const id = m ? m[1] : null;
      if (!id || seen.has(id)) return;

      // Try to extract "Home - Away"
      // Example line looks like: <span>21:00</span>West Ham - Brentford <a ...>-:-</a>
      const parentTxt = normSpace(node.text());
      let teams = "";
      const m2 = parentTxt.match(/([^\n]+ - [^\n]+)\s/);
      teams = m2 ? normSpace(m2[1]) : normSpace($(a).parent().text()).replace(/-:-.*$/,"").trim();

      const time = node.find("span").first().text().trim() || "";

      seen.add(id);
      rows.push({
        id,
        teams,
        url: full,
        time,
        competition: lastComp || "",   // CLEANED
        sport: "Fotbal",
      });
    });
  });

  // Fallback parser if nothing found (structure sometimes differs)
  if (rows.length === 0) {
    $('a[href^="/match/"]').each((_, a) => {
      const href = $(a).attr("href");
      if (!href) return;
      const full = absUrl(href.includes("?") ? `${href}&d=${offset}` : `${href}?d=${offset}`);
      const m = /\/match\/([^/]+)\//i.exec(full || "");
      const id = m ? m[1] : null;
      if (!id || seen.has(id)) return;

      const block = $(a).closest("div, p, li");
      const blockTxt = normSpace(block.text());
      const m2 = blockTxt.match(/([^\n]+ - [^\n]+)\s/);
      const teams = m2 ? normSpace(m2[1]) : normSpace(blockTxt.split("-:-")[0] || "");
      const time = block.find("span").first().text().trim() || "";

      // Walk up to find nearest h4 for comp
      let comp = "";
      let p = block.prev();
      while (p.length) {
        if (p.is("h4")) { comp = cleanCompetition(normSpace(p.text())); break; }
        p = p.prev();
      }

      seen.add(id);
      rows.push({ id, teams, url: full, time, competition: comp, sport: "Fotbal" });
    });
  }

  console.log(`[list] found ${rows.length} matches for d=${offset}`);
  return rows.slice(0, MAX_MATCHES);
}

// Odds on match page (kept)
function parseOddsFromHtml(html) {
  const $ = cheerio.load(html);
  const oddsEl = $("p.odds-detail").first();
  if (!oddsEl.length) return null;
  const odds = oddsEl.text().match(/\d+(?:[.,]\d+)?/g);
  if (!odds || odds.length < 3) return null;
  return {
    o1: parseFloat(odds[0].replace(",", ".")),
    ox: parseFloat(odds[1].replace(",", ".")),
    o2: parseFloat(odds[2].replace(",", ".")),
  };
}

async function scrapeMatch(match, i) {
  const html = await fetchText(match.url);
  if (i < 3) await fs.writeFile(`match-${i + 1}-${match.id}.html`, html, "utf8");
  const odds = parseOddsFromHtml(html);
  if (!odds) return [];
  return [
    { id: match.id, teams: match.teams, market: "1", odd: odds.o1, url: match.url },
    { id: match.id, teams: match.teams, market: "X", odd: odds.ox, url: match.url },
    { id: match.id, teams: match.teams, market: "2", odd: odds.o2, url: match.url },
  ];
}

(async () => {
  const matches = await listMatches(DAY_OFFSET);
  await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

  const all = [];
  for (let i = 0; i < matches.length; i++) {
    try {
      const rows = await scrapeMatch(matches[i], i);
      all.push(...rows);
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error("[match fail]", matches[i].url, e.message);
    }
  }
  await fs.writeFile("odds.json", JSON.stringify({ events: all }, null, 2), "utf8");
  console.log(`[OK] Saved odds.json with ${all.length} rows (d=${DAY_OFFSET})`);
})();
