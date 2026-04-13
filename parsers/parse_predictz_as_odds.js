// parsers/parse_predictz_as_odds.js

import fs from "fs/promises";

function mapMarket(item) {
  switch (item.market) {
    case "1X2":
      return {
        type: "1X2",
        value: item.prediction,
      };

    case "BTTS":
      return {
        type: "BTTS",
        value: item.prediction === "BTTS_YES" ? "YES" : "NO",
      };

    case "BTTS_AND_WIN":
      return {
        type: "BTTS_AND_WIN",
        value: item.prediction,
      };

    case "OVER_UNDER_25":
      return {
        type: "GOALS_OU",
        value: item.prediction === "OVER_2_5" ? "OVER_2_5" : "UNDER_2_5",
      };

    default:
      return null;
  }
}

(async () => {
  const data = JSON.parse(await fs.readFile("predictz_matched.json", "utf8"));

  const parsed = [];

  for (const item of data.selections) {
    const market = mapMarket(item);

    if (!market) continue;

    parsed.push({
      source: "predictz",
      event: item.teams,
      market: market.type,
      pick: market.value,
      odd: item.odd,
      match_id: item.flashscore_id,
      match_url: item.flashscore_url,
      time: item.match_time,
    });
  }

  // 🔥 inject în MASTER
  let master = { selections: [] };

  try {
    master = JSON.parse(await fs.readFile("master_pool.json", "utf8"));
  } catch {}

  master.selections.push(...parsed);

  await fs.writeFile("master_pool.json", JSON.stringify(master, null, 2));

  console.log("✅ predictz injected:", parsed.length);
})();
