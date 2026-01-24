// parsers/parse_talkfootball_as_odds.js
// TalkFootball devine ODD SOURCE compatibil cu master_pool

import fs from "fs/promises";

const INPUT_TF = "artifacts/talkfootball_matched.json";
const INPUT_MASTER = "master_pool.json";
const OUTPUT = "master_pool.json";

function impliedOdd(conf) {
  if (conf >= 100) return 1.30;
  if (conf >= 95) return 1.40;
  if (conf >= 90) return 1.55;
  if (conf >= 85) return 1.70;
  return null;
}

function mapMarket(tf) {
  if (tf.market === "1X2") return tf.pick;
  if (tf.market === "OVER_1_5") return "OVER_1_5";
  if (tf.market === "BTTS") return tf.pick;
  return null;
}

function betText(tf) {
  if (tf.market === "1X2") {
    if (tf.pick === "1") return "Victorie gazde";
    if (tf.pick === "2") return "Victorie oaspeți";
    if (tf.pick === "1X") return "Gazde sau egal";
    if (tf.pick === "2X") return "Oaspeți sau egal";
    if (tf.pick === "X") return "Egal";
  }
  if (tf.market === "OVER_1_5") return "Peste 1.5 goluri";
  if (tf.pick === "BTTS_YES") return "Ambele echipe marchează";
  if (tf.pick === "BTTS_NO") return "Cel puțin o echipă nu marchează";
  return "Pariu propus";
}

(async () => {
  const tfRaw = await fs.readFile(INPUT_TF, "utf8").catch(() => null);
  if (!tfRaw) {
    console.log("ℹ️ No TalkFootball matched events");
    return;
  }

  const tfEvents = JSON.parse(tfRaw);

  const masterRaw = await fs.readFile(INPUT_MASTER, "utf8").catch(() => "[]");
  const master = JSON.parse(masterRaw);

  const existing = new Set(
    master.map(e => `${e.id}|${e.market}`)
  );

  const tfOdds = tfEvents
    .map(tf => {
      const market = mapMarket(tf);
      const odd = impliedOdd(tf.confidence);

      if (!market || !odd) return null;

      const key = `${tf.flashscore_id}|${market}`;
      if (existing.has(key)) return null;

      return {
        id: tf.flashscore_id,
        teams: `${tf.home} - ${tf.away}`,
        market,
        odd,
        url: `https://www.flashscore.com/match/${tf.flashscore_id}/`,
        status: "scheduled",
        sport: "football",
        competition: tf.league,
        country: "",
        time: tf.flashscore_kickoff?.slice(11, 16) || "",
        source: "talkfootball",
        bet_text: betText(tf)
      };
    })
    .filter(Boolean);

  const merged = [...master, ...tfOdds];

  await fs.writeFile(OUTPUT, JSON.stringify(merged, null, 2));

  console.log(`✅ TalkFootball odds added: +${tfOdds.length}`);
})();
