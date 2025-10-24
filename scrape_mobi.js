// scrape_mobi.js — robust Flashscore.mobi scraper (list + 1X2 odds)
// - Parses matches reliably using structure-safe selectors
// - Cleans competition headings (removes "Standings", etc.)
// - Extracts 1X2 from <p class="odds-detail"> on match pages
// - Writes: list.html (raw), matches.json, odds.json, match-*.html (first 3)

import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0); // 0=today, 1=tomorrow
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 60);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function normSpace(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

function cleanCompetition(h4Text = "") {
  return normSpace(
    h4Text
      .replace(/\s*Standings.*$/i, "")
      .replace(/\s*Table.*$/i, "")
      .replace(/\s*Classification.*$/i, "")
      .replace(/\s*\|.*$/, "")
  );
}

function absUrl(href) {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

/** STEP 1: parse day list into matches with cleaned competition */
async function listMatches(offset) {
  const url = `${BASE}/?d=${offset}`;
  const html = await fetchText(url);
  await fs.writeFile("list.html", html, "utf8");

  const $ = cheerio.load(html);
  const rows = [];
  const seen = new Set();

  let lastComp = "";

  // Structure-safe iteration: interleave headings and match links in DOM order
  $("#score-data h4, #score-data a[href^='/match/']").each((_, el) => {
    const node = $(el);

    if (node.is("h4")) {
      lastComp = cleanCompetition(normSpace(node.text()));
      return;
    }

    // It's a match link
    const href = node.attr("href");
    if (!href) return;

    // Ensure we carry the day offset in the URL (some links already have ?d=)
    const hasQ = href.includes("?");
    const full = absUrl(hasQ ? href : `${href}?d=${offset}`);
    if (!full) return;

    const m = /\/match\/([^/]+)\//i.exec(full);
    const id = m ? m[1] : null;
    if (!id || seen.has(id)) return;

    // Find the nearest text container to extract "Home - Away" and time
    // Usually the link is inside a line like: <span>HH:MM</span>Home - Away <a ...>-:-</a>
    const container = node.closest("div, p, li");
    const lineText = normSpace(container.text());
    let teams = "";
    const m2 = lineText.match(/([^\n]+ - [^\n]+)/);
    if (m2) teams = normSpace(m2[1]);
    else {
      // fallback: remove the score tail if present
      teams = normSpace(lineText.split("-:-")[0] || "");
      // Sometimes includes the time, strip it if it prefixes:
      teams = teams.replace(/^\d{1,2}:\d{2}\s*/, "");
    }

    const time = container.find("span").first().text().trim() || "";

    seen.add(id);
    rows.push({
      id,
      teams,
      url: full,
      time,
      competition: lastComp || "",
      sport: "Fotbal",
    });
  });

  // Fallback: if nothing parsed (DOM variant), do a broader scan
  if (rows.length === 0) {
    $('a[href^="/match/"]').each((_, a) => {
      const href = $(a).attr("href");
      if (!href) return;
      const full = absUrl(href.includes("?") ? href : `${href}?d=${offset}`);
      const m = /\/match\/([^/]+)\//i.exec(full || "");
      const id = m ? m[1] : null;
      if (!id || seen.has(id)) return;

      const block = $(a).closest("div, p, li");
      const blockTxt = normSpace(block.text());
      const m2 = blockTxt.match(/([^\n]+ - [^\n]+)/);
      const teams = m2 ? normSpace(m2[1]) : normSpace(blockTxt.split("-:-")[0] || "");
      const time = block.find("span").first().text().trim() || "";

      // Walk up to nearest previous h4 for competition
      let comp = "";
      let prev = block.prev();
      while (prev.length) {
        if (prev.is("h4")) {
          comp = cleanCompetition(normSpace(prev.text()));
          break;
        }
        prev = prev.prev();
      }

      seen.add(id);
      rows.push({ id, teams, url: full, time, competition: comp, sport: "Fotbal" });
    });
  }

  console.log(`[list] found ${rows.length} matches for d=${offset}`);
  return rows.slice(0, MAX_MATCHES);
}

/** STEP 2: extract 1X2 odds from match page (<p class="odds-detail">) */
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

/** MAIN */
(async () => {
  try {
    const matches = await listMatches(DAY_OFFSET);
    await fs.writeFile("matches.json", JSON.stringify(matches, null, 2), "utf8");

    const all = [];
    for (let i = 0; i < matches.length; i++) {
      try {
        const rows = await scrapeMatch(matches[i], i);
        all.push(...rows);
        // polite delay
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        console.error("[match fail]", matches[i]?.url, e.message);
      }
    }

    await fs.writeFile("odds.json", JSON.stringify({ events: all }, null, 2), "utf8");
    console.log(`[OK] Saved odds.json with ${all.length} rows (d=${DAY_OFFSET})`);
  } catch (e) {
    console.error("SCRAPER ERROR:", e.message);
    process.exit(1);
  }
})();
