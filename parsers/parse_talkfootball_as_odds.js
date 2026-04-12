// parsers/parse_talkfootball_as_odds.js
// FINAL — TalkFootball as fallback/source merge for master_pool

import fs from "fs/promises";

/* =========================
 * FILES
 * ========================= */
const INPUT_MATCHED = "artifacts/talkfootball_matched.json";
const CLAUDIU_POOL = "claudiu_pool.json";
const OUTPUT_POOL = "master_pool.json";

/* =========================
 * UTILS
 * ========================= */
const safe = (x) => (x ?? "").toString().trim();

async function readJsonSafe(path, fallback) {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseKickoffToTime(kickoff) {
  if (!kickoff) return "";
  const m = kickoff.match(/\b(\d{1,2}:\d{2})\b/);
  return m ? m[1] : "";
}

function slugify(text = "") {
  return safe(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeOdd(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
 * NORMALIZERS
 * ========================= */
function normalizeClaudiuSelection(sel) {
  const odd = normalizeOdd(sel.odd);
  if (!sel || !safe(sel.teams) || !odd) return null;

  return {
    match_id: safe(sel.match_id) || slugify(sel.teams),
    flashscore_url: safe(sel.flashscore_url || sel.url || ""),
    url: safe(sel.url || sel.flashscore_url || ""),
    teams: safe(sel.teams),
    time: safe(sel.time || ""),
    country: safe(sel.country || ""),
    competition: safe(sel.competition || ""),
    bet_type: safe(sel.bet_type || sel.market || "stat"),
    market_raw: safe(sel.market_raw || sel.market || "Pariu special"),
    odd: Number(odd.toFixed(3)),
    source: safe(sel.source || "claudiuhood"),
    meta: {
      ...(sel.meta || {}),
      bet_text: safe(sel.meta?.bet_text || sel.market_raw || sel.market || "Pariu special"),
      source: safe(sel.meta?.source || sel.source || "claudiuhood")
    },
    params: sel.params || {},
    id: safe(sel.id || "")
  };
}

function normalizeTalkfootballSelection(tf) {
  if (!tf || !tf.flashscore_id) return null;

  let odd;
  if (tf.market === "1X2") odd = 1.55;
  else if (tf.market === "OVER_1_5") odd = 1.35;
  else if (tf.market === "BTTS") odd = 1.7;
  else return null;

  const bet_type = detectBetType(tf);
  const params = detectParams(tf);

  return {
    match_id: safe(tf.flashscore_id),
    flashscore_url: `https://www.flashscore.mobi/match/${safe(tf.flashscore_id)}/`,
    url: `https://www.flashscore.mobi/match/${safe(tf.flashscore_id)}/`,
    teams: `${safe(tf.home)} - ${safe(tf.away)}`,
    time: parseKickoffToTime(tf.flashscore_kickoff || tf.kickoff),
    country: safe(tf.country || ""),
    competition: safe(tf.league || ""),
    bet_type,
    market_raw: safe(betText(tf)),
    odd: Number(odd.toFixed(3)),
    source: "talkfootball",
    meta: {
      bet_text: betText(tf),
      source: "talkfootball",
      market_text: safe(tf.market),
      pick: safe(tf.pick)
    },
    params,
    id: safe(tf.flashscore_id)
  };
}

function dedupeSelections(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = [
      safe(item.match_id),
      safe(item.market_raw).toLowerCase(),
      Number(item.odd).toFixed(2)
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

/* =========================
 * MAIN
 * ========================= */
(async () => {
  const matched = await readJsonSafe(INPUT_MATCHED, []);
  const claudiuPool = await readJsonSafe(CLAUDIU_POOL, {
    date: null,
    selections: [],
    errors: []
  });

  const claudiuSelections = Array.isArray(claudiuPool.selections)
    ? claudiuPool.selections.map(normalizeClaudiuSelection).filter(Boolean)
    : [];

  const talkfootballSelections = Array.isArray(matched)
    ? matched.map(normalizeTalkfootballSelection).filter(Boolean)
    : [];

  let combined = [];
  let sourcesUsed = [];
  let sourceMode = "empty";

  if (claudiuSelections.length > 0 && talkfootballSelections.length > 0) {
    combined = [...claudiuSelections, ...talkfootballSelections];
    sourcesUsed = ["claudiuhood", "talkfootball"];
    sourceMode = "claudiu_plus_talkfootball";
  } else if (claudiuSelections.length > 0) {
    combined = [...claudiuSelections];
    sourcesUsed = ["claudiuhood"];
    sourceMode = "claudiu_only";
  } else if (talkfootballSelections.length > 0) {
    combined = [...talkfootballSelections];
    sourcesUsed = ["talkfootball"];
    sourceMode = "talkfootball_only";
  }

  const selections = dedupeSelections(combined);

  const out = {
    date: safe(claudiuPool.date) || new Date().toISOString().slice(0, 10),
    source: "master_pool",
    source_mode: sourceMode,
    sources_used: sourcesUsed,
    upstream_counts: {
      claudiu: claudiuSelections.length,
      talkfootball: talkfootballSelections.length
    },
    selections
  };

  await fs.writeFile(OUTPUT_POOL, JSON.stringify(out, null, 2), "utf8");

  console.log(`[MASTER] mode: ${sourceMode}`);
  console.log(`[MASTER] claudiu: ${claudiuSelections.length}`);
  console.log(`[MASTER] talkfootball: ${talkfootballSelections.length}`);
  console.log(`[MASTER] total unique selections: ${selections.length}`);
})();
