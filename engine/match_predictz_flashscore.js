// engine/match_predictz_flashscore.js

import fs from "fs";
import { matchEventToFlashscore } from "./matcher_core.js";

function safeReadJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function getMatchesArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.matches)) return raw.matches;
  if (Array.isArray(raw?.fixtures)) return raw.fixtures;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function getPredictzSelections(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.selections)) return raw.selections;
  if (Array.isArray(raw?.picks)) return raw.picks;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

const pzRaw = safeReadJson("predictz_pool.json", { selections: [] });
const matchesRaw = safeReadJson("matches.json", { matches: [] });

const pzSelections = getPredictzSelections(pzRaw);
const matches = getMatchesArray(matchesRaw);

const matched = [];
const dropped = [];

for (const pick of pzSelections) {
  if (!pick.teams) {
    dropped.push({
      ...pick,
      drop_reason: "missing teams",
    });
    continue;
  }

  const res = matchEventToFlashscore(pick.teams, matches);

  if (res) {
    matched.push({
      ...pick,
      flashscore_id: res.match.id || "",
      flashscore_url: res.match.url || "",
      flashscore_kickoff: res.match.time || "",
      match_score: Number(res.score.toFixed(3)),
    });
  } else {
    dropped.push({
      ...pick,
      drop_reason: "no flashscore match",
    });
  }
}

fs.writeFileSync(
  "predictz_matched.json",
  JSON.stringify(
    {
      matched: matched.length,
      dropped: dropped.length,
      selections: matched,
      dropped_selections: dropped,
    },
    null,
    2
  )
);

console.log(`[predictz matcher] matched: ${matched.length}`);
console.log(`[predictz matcher] dropped: ${dropped.length}`);
