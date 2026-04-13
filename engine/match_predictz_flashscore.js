// engine/match_predictz_flashscore.js

import fs from "fs/promises";

function norm(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function matchTeams(a, b) {
  const A = norm(a);
  const B = norm(b);
  return A.includes(B) || B.includes(A);
}

(async () => {
  const predictz = JSON.parse(await fs.readFile("predictz_pool.json", "utf8"));
  const flash = JSON.parse(await fs.readFile("matches.json", "utf8"));

  const out = [];

  for (const p of predictz.selections) {
    let found = null;

    for (const m of flash.matches) {
      if (matchTeams(p.teams, m.teams)) {
        found = m;
        break;
      }
    }

    if (!found) continue; // 🔥 STRICT

    out.push({
      ...p,
      flashscore_id: found.id,
      flashscore_url: found.url,
      flashscore_kickoff: found.time
    });
  }

  await fs.writeFile(
    "predictz_matched.json",
    JSON.stringify({ selections: out }, null, 2)
  );

  console.log("✅ matched:", out.length);
})();
