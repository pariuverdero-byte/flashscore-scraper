// scrape_odds_tab.js — pulls 1X2 odds from Flashscore.mobi "Odds" tab (?s=5)
// It complements scrape_mobi.js which fetches fixtures.
// Writes: odds_tab.json

import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function normSpace(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

function absUrl(href) {
  try { return new URL(href, BASE).toString(); } catch { return null; }
}

async function scrapeOddsTab(offset = 0) {
  const url = `${BASE}/?d=${offset}&s=5`;
  const html = await fetchText(url);
  await fs.writeFile("list-odds.html", html, "utf8");

  const $ = cheerio.load(html);
  const rows = [];
  let currentComp = "";

  $("#score-data").contents().each((_, el) => {
    const node = $(el);
    if (node.is("h4")) {
      currentComp = normSpace(node.text().replace(/\s*Standings.*$/i, ""));
      return;
    }
    if (node.is("span")) {
      const time = node.text().trim();
      const rest = node[0].nextSibling?.nodeValue || "";
      const teams = normSpace(rest);
      const link = node.nextAll("a[href^='/match/']").first();
      const href = link.attr("href");
      if (!href) return;
      const full = absUrl(href.includes("?") ? href : `${href}?d=${offset}`);
      const idMatch = /\/match\/([^/]+)\//i.exec(full || "");
      const id = idMatch ? idMatch[1] : null;
      if (!id) return;

      // Extract odds from nearest <p class="odds-detail">
      const oddsEl = link.nextAll("p.odds-detail").first();
      const odds = oddsEl.text().match(/\d+(?:[.,]\d+)?/g);
      if (!odds || odds.length < 3) return;

      rows.push({
        id,
        teams,
        competition: currentComp,
        url: full,
        time,
        sport: "Fotbal",
        o1: parseFloat(odds[0].replace(",", ".")),
        ox: parseFloat(odds[1].replace(",", ".")),
        o2: parseFloat(odds[2].replace(",", ".")),
      });
    }
  });

  console.log(`[odds-tab] Extracted ${rows.length} rows from Odds tab`);
  return rows;
}

(async () => {
  try {
    const data = await scrapeOddsTab(DAY_OFFSET);
    await fs.writeFile("odds_tab.json", JSON.stringify({ events: data }, null, 2), "utf8");
    console.log("✅ Saved odds_tab.json");
  } catch (e) {
    console.error("❌ Error:", e.message);
    process.exit(1);
  }
})();
