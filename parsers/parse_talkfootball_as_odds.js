// parsers/parse_talkfootball_as_odds.js
// FINAL — Claudiu + TalkFootball merged into master_pool
// IMPORTANT: Claudiu selections are included ONLY if matched to Flashscore

import fs from "fs/promises";
import { matchEventToFlashscore } from "../engine/matcher_core.js";

/* =========================
 * FILES
 * ========================= */
const INPUT_MATCHED = "artifacts/talkfootball_matched.json";
const CLAUDIU_POOL = "claudiu_pool.json";
const MATCHES_FILE = "matches.json";
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

function normalizeOdd(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTeam(text = "") {
  return safe(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|fk|if|bk|sk|u19|u20|u21)\b/g, "")
    .replace(/\b\d{2}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTeams(teams = "") {
  const parts = safe(teams).split(" - ").map((x) => x.trim());
  if (parts.length < 2) return { home: "", away: "" };
  return { home: parts[0], away: parts.slice(1).join(" - ") };
}

function softEq(a, b) {
  return a === b || a.includes(b) || b.includes(a);
}

function getMatchesArray(rawMatches) {
  if (Array.isArray(rawMatches)) return rawMatches;
  if (Array.isArray(rawMatches?.matches)) return rawMatches.matches;
  if (Array.isArray(rawMatches?.fixtures)) return rawMatches.fixtures;
  if (Array.isArray(rawMatches?.data)) return rawMatches.data;
  return [];
}

/* =========================
 * CLAUDIU → FLASHSCORE MATCH
 * ========================= */
function buildFlashscoreUrl(match) {
  if (safe(match.url)) return safe(match.url);
  if (safe(match.flashscore_url)) return safe(match.flashscore_url);
  if (safe(match.id)) return `https://www.flashscore.mobi/match/${safe(match.id)}/`;
  return "";
}

function matchClaudiuToFlashscore(sel, matches) {
  const arr = getMatchesArray(matches);
  return (
    matchEventToFlashscore(
      {
        ...sel,
        teams: sel.teams
      },
      arr
    )?.match ||
    null
  );
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
function normalizeClaudiuSelection(sel, matches) {
  const odd = normalizeOdd(sel.odd);
  if (!sel || !safe(sel.teams) || !odd) return null;

  const flashscoreMatch = matchClaudiuToFlashscore(sel, matches);
  if (!flashscoreMatch) {
    console.log(`[MASTER] drop Claudiu (no Flashscore match): ${sel.teams}`);
    return null;
  }

  const flashscoreId = safe(
    flashscoreMatch.id || flashscoreMatch.flashscore_id || flashscoreMatch.match_id || ""
  );

  const flashscoreUrl = buildFlashscoreUrl(flashscoreMatch);

  if (!flashscoreId || !flashscoreUrl) {
    console.log(`[MASTER] drop Claudiu (missing Flashscore id/url): ${sel.teams}`);
    return null;
  }

  return {
    match_id: flashscoreId,
    id: flashscoreId,
    flashscore_url: flashscoreUrl,
    url: flashscoreUrl,
    teams: safe(flashscoreMatch.teams) || safe(sel.teams),
    time: safe(
      flashscoreMatch.time ||
      parseKickoffToTime(flashscoreMatch.kickoff || flashscoreMatch.flashscore_kickoff || "")
    ),
    country: safe(flashscoreMatch.country || ""),
    competition: safe(flashscoreMatch.competition || flashscoreMatch.league || ""),
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
    id: safe(tf.flashscore_id),
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
  const rawMatches = await readJsonSafe(MATCHES_FILE, []);
  const matches = getMatchesArray(rawMatches);

  console.log(`[MASTER] matches loaded: ${matches.length}`);

  const claudiuSelections = Array.isArray(claudiuPool.selections)
    ? claudiuPool.selections.map((s) => normalizeClaudiuSelection(s, matches)).filter(Boolean)
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
      claudiu_raw: Array.isArray(claudiuPool.selections) ? claudiuPool.selections.length : 0,
      claudiu_matched_to_flashscore: claudiuSelections.length,
      talkfootball: talkfootballSelections.length,
      flashscore_matches: matches.length
    },
    selections
  };

  await fs.writeFile(OUTPUT_POOL, JSON.stringify(out, null, 2), "utf8");

  console.log(`[MASTER] mode: ${sourceMode}`);
  console.log(`[MASTER] claudiu raw: ${out.upstream_counts.claudiu_raw}`);
  console.log(`[MASTER] claudiu matched: ${out.upstream_counts.claudiu_matched_to_flashscore}`);
  console.log(`[MASTER] talkfootball: ${talkfootballSelections.length}`);
  console.log(`[MASTER] total unique selections: ${selections.length}`);
})();
