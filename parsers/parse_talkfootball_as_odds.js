// parsers/parse_talkfootball_as_odds.js
// FINAL — TalkFootball ca odd source, FULL compat cu master_pool + WP

import fs from "fs/promises";

/* =========================
 * FILES
 * ========================= */
const INPUT_MATCHED = "artifacts/talkfootball_matched.json";
const MASTER_POOL  = "claudiu_pool.json";
const OUTPUT_POOL  = "master_pool.json";

/* =========================
 * UTILS
 * ========================= */
const safe = (x) => (x ?? "").toString().trim();

function parseKickoffToTime(kickoff) {
  // expects "YYYY-MM-DD HH:MM"
  if (!kickoff) return "";
  const m = kickoff.match(/\b(\d{1,2}:\d{2})\b/);
  return m ? m[1] : "";
}

/* =========================
 * MARKET → BET TEXT
 * ========================= */
function betText(tf) {
  switch (tf.market) {
    case "1X2":
      if (tf.pick === "1") return "Victorie gazde";
      if (tf.pick === "X") return "Egal";
      if (tf.pick === "2") return "Victorie oaspeți";
      if (tf.pick === "1X") return "Șansă dublă 1X";
      if (tf.pick === "X2") return "Șansă dublă X2";
      if (tf.pick === "12") return "Șansă dublă 12";
      return "1X2";

    case "BTTS":
      if (tf.pick === "BTTS_YES") return "Ambele echipe marchează";
      if (tf.pick === "BTTS_NO") return "Ambele echipe NU marchează";
      return "BTTS";

    case "OVER_1_5":
      return "Peste 1.5 goluri";

    default:
      return "Pariu special";
  }
}

/* =========================
 * MARKET → INTERNAL TYPE
 * ========================= */
function detectBetType(tf) {
  if (tf.market === "BTTS") return "btts";
  if (tf.market === "OVER_1_5") return "goals_ou";
  return "1x2";
}

function detectParams(tf) {
  if (tf.market === "OVER_1_5") {
    return { side: "over", line: 1.5 };
  }
  if (tf.market === "BTTS") {
    return { side: tf.pick === "BTTS_YES" ? "yes" : "no" };
  }
  return {};
}

/* =========================
 * MAIN
 * ========================= */
(async () => {
  // ---------- load inputs ----------
  const matchedRaw = await fs.readFile(INPUT_MATCHED, "utf8");
  const matched = JSON.parse(matchedRaw);

  const poolRaw = await fs.readFile(MASTER_POOL, "utf8");
  const pool = JSON.parse(poolRaw);

  const selections = pool.selections || [];
  let added = 0;

  for (const tf of matched) {
    if (!tf.flashscore_id) continue;

    // -------- ODD derivation --------
    let odd;
    if (tf.market === "1X2") odd = 1.55;
    else if (tf.market === "OVER_1_5") odd = 1.35;
    else if (tf.market === "BTTS") odd = 1.70;
    else continue;

    const bet_type = detectBetType(tf);
    const params = detectParams(tf);

    const sel = {
      // 🔑 IDENTITATE
      match_id: safe(tf.flashscore_id),
      flashscore_url: `https://www.flashscore.mobi/match/${safe(tf.flashscore_id)}/`,

      // 🔑 AFIȘARE WP
      teams: `${safe(tf.home)} - ${safe(tf.away)}`,
      time: parseKickoffToTime(tf.flashscore_kickoff || tf.kickoff),
      country: safe(tf.country || ""),
      competition: safe(tf.league || ""),

      // 🔑 BET
      bet_type,
      market_raw: tf.market,
      odd: Number(odd.toFixed(3)),
      source: "talkfootball",

      // 🔑 META EDITORIAL (CRITICAL)
      meta: {
        bet_text: betText(tf),
        source: "talkfootball"
      },

      // 🔑 PARAMS (verify-safe)
      params
    };

    selections.push(sel);
    added++;
  }

  const out = {
    date: pool.date,
    source: "master_pool",
    selections
  };

  await fs.writeFile(OUTPUT_POOL, JSON.stringify(out, null, 2), "utf8");

  console.log(`✅ TalkFootball odds added: +${added}`);
})();
