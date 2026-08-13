// parsers/parse_predictz_as_odds.js
// PredictZ injection, then multi-source augmentation + Flashscore-odds fallback.

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

async function readJsonSafe(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); }
  catch { return fallback; }
}

(async () => {
  const matched = await readJsonSafe("predictz_matched.json", { selections: [] });
  const pool = await readJsonSafe("master_pool.json", { date: null, source: "master_pool", selections: [] });
  const selections = Array.isArray(pool.selections) ? [...pool.selections] : [];
  let added = 0;

  for (const p of (Array.isArray(matched?.selections) ? matched.selections : [])) {
    if (!p?.flashscore_id) continue;
    let odd = 1.45;
    if (p.market === "BTTS") odd = 1.70;
    if (p.market === "OVER_2_5") odd = 1.50;
    const url = p.flashscore_url || `https://www.flashscore.mobi/match/${p.flashscore_id}/`;
    selections.push({
      match_id: p.flashscore_id,
      id: p.flashscore_id,
      flashscore_url: url,
      url,
      teams: p.teams,
      time: p.flashscore_kickoff,
      bet_type: detectType(p),
      market_raw: betText(p),
      odd,
      source: "predictz",
      meta: { bet_text: betText(p), source: "predictz", source_market: p.market }
    });
    added++;
  }

  await fs.writeFile("master_pool.json", JSON.stringify({ ...pool, source: "master_pool", selections }, null, 2), "utf8");
  console.log(`✅ predictz added: ${added}`);

  try {
    await import("./augment_pool_sources_and_fallback.js");
  } catch (e) {
    console.warn(`[POOL+] skipped after error: ${e?.message || e}`);
  }
})();
