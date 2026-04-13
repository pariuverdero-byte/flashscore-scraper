// engine/match_predictz_flashscore.js

import fs from "fs/promises";

function normalizeTeam(name = "") {
  return name
    .toLowerCase()
    .replace(/fc|cf|sc|afc|fk|ac/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTeams(str = "") {
  if (str.includes(" - ")) return str.split(" - ");
  if (str.includes(" v ")) return str.split(" v ");
  if (str.includes(" vs ")) return str.split(" vs ");
  return [str];
}

function isMatch(a, b) {
  return a.includes(b) || b.includes(a);
}

function matchTeams(predictzTeams, flashscoreTeams) {
  const [pHome, pAway] = splitTeams(predictzTeams).map(normalizeTeam);
  const [fHome, fAway] = splitTeams(flashscoreTeams).map(normalizeTeam);

  return (
    (isMatch(pHome, fHome) && isMatch(pAway, fAway)) ||
    (isMatch(pHome, fAway) && isMatch(pAway, fHome))
  );
}

(async () => {
  const predictz = JSON.parse(await fs.readFile("predictz_pool.json", "utf8"));
  const flashscore = JSON.parse(await fs.readFile("matches.json", "utf8"));

  const matched = [];
  const skipped = [];

  for (const item of predictz.selections) {
    let found = null;

    for (const m of flashscore.matches) {
      if (matchTeams(item.teams, m.teams)) {
        found = m;
        break;
      }
    }

    if (!found) {
      skipped.push(item.teams);
      continue;
    }

    matched.push({
      ...item,
      flashscore_id: found.id,
      flashscore_url: found.url,
      match_time: found.time,
    });
  }

  await fs.writeFile(
    "predictz_matched.json",
    JSON.stringify(
      {
        total: matched.length,
        skipped: skipped.length,
        selections: matched,
      },
      null,
      2
    )
  );

  console.log("✅ matched:", matched.length);
  console.log("⚠ skipped:", skipped.length);
})();
