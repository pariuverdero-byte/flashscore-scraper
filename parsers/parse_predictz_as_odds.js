// parsers/parse_predictz_as_odds.js

import fs from "fs/promises";

function betText(p) {
  if (p.market === "BTTS") return "Ambele echipe marchează";
  if (p.market === "OVER_2_5") return "Peste 2.5 goluri";
  if (p.market === "1X2") {
    if (p.prediction === "1") return "Victorie gazde";
    if (p.prediction === "2") return "Victorie oaspeți";
    if (p.prediction === "X") return "Egal";
  }
  return "Pariu special";
}

function detectType(p) {
  if (p.market === "BTTS") return "btts";
  if (p.market === "OVER_2_5") return "goals_ou";
  return "1x2";
}

(async () => {
  const matched = JSON.parse(await fs.readFile("predictz_matched.json", "utf8"));
  const pool = JSON.parse(await fs.readFile("master_pool.json", "utf8"));

  const selections = pool.selections || [];
  let added = 0;

  for (const p of matched.selections) {
    let odd = 1.45;

    if (p.market === "BTTS") odd = 1.70;
    if (p.market === "OVER_2_5") odd = 1.50;

    selections.push({
      match_id: p.flashscore_id,
      flashscore_url: p.flashscore_url,

      teams: p.teams,
      time: p.flashscore_kickoff,

      bet_type: detectType(p),
      market_raw: p.market,
      odd,

      source: "predictz",

      meta: {
        bet_text: betText(p),
        source: "predictz"
      }
    });

    added++;
  }

  await fs.writeFile(
    "master_pool.json",
    JSON.stringify({
      date: pool.date,
      source: "master_pool",
      selections
    }, null, 2)
  );

  console.log(`✅ predictz added: ${added}`);
})();
