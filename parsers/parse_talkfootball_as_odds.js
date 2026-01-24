// parsers/parse_talkfootball_as_odds.js
// Injectează TalkFootball ca odd source în master_pool.json (structură compatibilă cu generatorul existent)

import fs from "fs/promises";

const TF_MATCHED = "artifacts/talkfootball_matched.json";
const CLAUDIU = "claudiu_pool.json";
const MASTER = "master_pool.json";

function safe(x) {
  return (x ?? "").toString().trim();
}

function impliedOdd(conf) {
  const c = Number(conf);
  if (!isFinite(c)) return null;
  if (c >= 100) return 1.30;
  if (c >= 95) return 1.40;
  if (c >= 90) return 1.55;
  if (c >= 85) return 1.70;
  return null;
}

function mapMarket(tf) {
  // păstrăm compatibil cu restul flow-ului
  if (tf.market === "1X2") return safe(tf.pick);          // 1 / X / 2 / 1X / 2X
  if (tf.market === "OVER_1_5") return "OVER_1_5";
  if (tf.market === "BTTS") return safe(tf.pick);         // BTTS_YES / BTTS_NO
  return null;
}

function betText(tf) {
  const m = safe(tf.market);
  const p = safe(tf.pick);

  if (m === "1X2") {
    if (p === "1") return "Victorie gazde";
    if (p === "2") return "Victorie oaspeți";
    if (p === "1X") return "Gazde sau egal";
    if (p === "2X") return "Oaspeți sau egal";
    if (p === "X") return "Egal";
  }
  if (m === "OVER_1_5") return "Peste 1.5 goluri";
  if (p === "BTTS_YES") return "Ambele echipe marchează";
  if (p === "BTTS_NO") return "Cel puțin o echipă nu marchează";
  return "Pariu propus";
}

async function readJson(path, fallback) {
  const raw = await fs.readFile(path, "utf8").catch(() => null);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

(async () => {
  // 1) Claudiu pool (baza)
  const claudiu = await readJson(CLAUDIU, null);
  if (!claudiu) {
    console.error("❌ claudiu_pool.json lipsă");
    process.exit(1);
  }

  // 2) Master pool (dacă nu există, îl creăm din Claudiu)
  let master = await readJson(MASTER, null);
  if (!master || !Array.isArray(master.selections)) {
    master = {
      date: claudiu.date,
      source: "master_pool",
      selections: (claudiu.selections || []).slice()
    };
  }

  // index pentru dedupe: match_id|bet_type|params
  const keyOf = (s) =>
    `${safe(s.match_id)}|${safe(s.bet_type)}|${JSON.stringify(s.params || {})}`;

  const existing = new Set(master.selections.map(keyOf));

  // 3) TalkFootball matched
  const tfMatched = await readJson(TF_MATCHED, []);
  if (!Array.isArray(tfMatched) || tfMatched.length === 0) {
    // chiar și fără TF, scriem master_pool.json (important)
    await fs.writeFile(MASTER, JSON.stringify(master, null, 2), "utf8");
    console.log("ℹ️ TalkFootball matched empty → master_pool.json created from Claudiu only");
    return;
  }

  // 4) Transform TF → selecții compatibile
  let added = 0;

  for (const tf of tfMatched) {
    const bet_type = mapMarket(tf);
    const odd = impliedOdd(tf.confidence);
    if (!bet_type || !odd) continue;

    // params compatibile (minim)
    let params = {};
    if (bet_type === "OVER_1_5") params = { side: "over", line: 1.5 };
    if (bet_type === "BTTS_YES") params = { side: "yes" };
    if (bet_type === "BTTS_NO") params = { side: "no" };
    if (["1", "2", "X", "1X", "2X"].includes(bet_type)) params = { pick: bet_type };

    const sel = {
      match_id: safe(tf.flashscore_id),
      flashscore_url: `https://www.flashscore.mobi/match/${safe(tf.flashscore_id)}/`,
      teams: `${safe(tf.home)} - ${safe(tf.away)}`,
      bet_type,
      bet_text_ro: betText(tf),
      bet_text_en: "",
      params,
      odd: Number(odd.toFixed(3)),
      source: "talkfootball"
    };

    const k = keyOf(sel);
    if (existing.has(k)) continue;

    master.selections.push(sel);
    existing.add(k);
    added++;
  }

  await fs.writeFile(MASTER, JSON.stringify(master, null, 2), "utf8");
  console.log(`✅ TalkFootball odds added to master_pool.json: +${added}`);
})();
