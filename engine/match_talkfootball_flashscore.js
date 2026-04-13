// engine/match_talkfootball_flashscore.js

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

function getTalkfootballSelections(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.selections)) return raw.selections;
  if (Array.isArray(raw?.picks)) return raw.picks;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function buildTeamsFromPick(pick) {
  if (pick.teams) return pick.teams;
  if (pick.home && pick.away) return `${pick.home} - ${pick.away}`;
  return "";
}

const tfRaw = safeReadJson("artifacts/talkfootball_pool.json", { selections: [] });
const matchesRaw = safeReadJson("matches.json", { matches: [] });

const tfSelections = getTalkfootballSelections(tfRaw);
const matches = getMatchesArray(matchesRaw);

const matched = [];
const dropped = [];

for (const pick of tfSelections) {
  const teams = buildTeamsFromPick(pick);

  if (!teams) {
    dropped.push({
      ...pick,
      drop_reason: "missing teams",
    });
    continue;
  }

  const res = matchEventToFlashscore(teams, matches);

  if (res) {
    matched.push({
      ...pick,
      teams,
      flashscore_id: res.match.id || "",
      flashscore_url: res.match.url || "",
      flashscore_kickoff: res.match.time || "",
      match_score: Number(res.score.toFixed(3)),
    });
  } else {
    dropped.push({
      ...pick,
      teams,
      drop_reason: "no flashscore match",
    });
  }
}

fs.writeFileSync(
  "artifacts/talkfootball_matched.json",
  JSON.stringify(matched, null, 2)
);

fs.writeFileSync(
  "artifacts/talkfootball_dropped.json",
  JSON.stringify(dropped, null, 2)
);

console.log(`[matcher] matched: ${matched.length}`);
console.log(`[matcher] dropped: ${dropped.length}`);
