// scrapers/scrape_predictz.js

import fs from "fs/promises";
import * as cheerio from "cheerio";
import fetch from "node-fetch";

const URLS = [
  { key: "match_tips", url: "https://www.predictz.com/predictions/", market: "1X2" },
  { key: "btts", url: "https://www.predictz.com/predictions/today/both-teams-to-score/", market: "BTTS" },
  { key: "btts_and_win", url: "https://www.predictz.com/predictions/today/both-teams-to-score-and-win/", market: "BTTS_AND_WIN" },
  { key: "over_under_25", url: "https://www.predictz.com/predictions/today/over-under-25-goals/", market: "OVER_2_5" }
];

function clean(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

async function scrapePage(url, market, key) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const html = await res.text();
  await fs.writeFile(`predictz_${key}.html`, html, "utf8");

  const $ = cheerio.load(html);
  const selections = [];

  $(".pt-body tr").each((_, row) => {
    const tds = $(row).find("td");

    if (tds.length < 3) return;

    const teams = clean($(tds[1]).text());
    const prediction = clean($(tds[2]).text());

    if (!teams || !prediction) return;

    selections.push({
      source: "predictz",
      teams,
      market,
      prediction
    });
  });

  console.log(`[predictz] ${market}: ${selections.length}`);
  return selections;
}

(async () => {
  let all = [];

  for (const u of URLS) {
    try {
      const data = await scrapePage(u.url, u.market, u.key);
      all.push(...data);
    } catch (e) {
      console.log(`[predictz] ERR ${u.url}: ${e.message}`);
    }
  }

  await fs.writeFile(
    "predictz_pool.json",
    JSON.stringify({ selections: all }, null, 2)
  );

  console.log("✅ predictz_pool.json generated:", all.length);
})();
