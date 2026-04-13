// scrapers/scrape_predictz.js

import fs from "fs/promises";
import cheerio from "cheerio";
import fetch from "node-fetch";

const URLS = [
  { url: "https://www.predictz.com/predictions/", market: "1X2" },
  { url: "https://www.predictz.com/predictions/today/both-teams-to-score/", market: "BTTS" },
  { url: "https://www.predictz.com/predictions/today/both-teams-to-score-and-win/", market: "BTTS_AND_WIN" },
  { url: "https://www.predictz.com/predictions/today/over-under-25-goals/", market: "OVER_2_5" }
];

function clean(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

async function scrapePage(url, market) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  const html = await res.text();
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
      const data = await scrapePage(u.url, u.market);
      all.push(...data);
    } catch (e) {
      console.log("ERR", u.url, e.message);
    }
  }

  await fs.writeFile(
    "predictz_pool.json",
    JSON.stringify({ selections: all }, null, 2)
  );

  console.log("✅ predictz_pool.json generated:", all.length);
})();
