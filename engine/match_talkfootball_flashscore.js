// engine/match_talkfootball_flashscore.js
// FINAL — compatibil cu scrape_mobi.js (matches.json)

import fs from "fs";

// ---------------- UTILS ----------------

function normalizeTeam(str = "") {
  return str
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/\b(fc|cf|sc|ac)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tfKickoffToISO(tfKickoff) {
  // "01/24 19:00" → "YYYY-01-24 19:00"
  const year = new Date().getFullYear();
  const [md, time] = tfKickoff.split(" ");
  const [mm, dd] = md.split("/");
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")} ${time}`;
}

function toTs(s) {
  return new Date(s.replace(" ", "T")).getTime();
}

function kickoffClose(a, b, mins = 90) {
  return Math.abs(toTs(a) - toTs(b)) <= mins * 60 * 1000;
}

// ---------------- LOAD ----------------

const talkfootball = JSON.parse(
  fs.readFileSync("artifacts/talkfootball_pool.json", "utf8")
);

// ⚠️ AICI E FIXUL
const flashscoreRaw = JSON.parse(
  fs.readFileSync("matches.json", "utf8")
);

// normalize matches.json
const flashscore = (flashscoreRaw.matches || []).map(m => ({
  id: m.id,
  home: m.teams.split(" - ")[0],
  away: m.teams.split(" - ")[1],
  kickoff: `${new Date().getFullYear()}-${String(m.day || "").padStart(2,"0")}-${String(m.date || "").padStart(2,"0")} ${m.time}`,
  url: m.url
}));

// ---------------- MATCHING ----------------

const matched = [];
const dropped = [];

for (const tf of talkfootball) {
  const tfISO = tfKickoffToISO(tf.kickoff);

  const found = flashscore.find(fsEv =>
    normalizeTeam(fsEv.home) === normalizeTeam(tf.home) &&
    normalizeTeam(fsEv.away) === normalizeTeam(tf.away) &&
    kickoffClose(tfISO, fsEv.kickoff)
  );

  if (found) {
    matched.push({
      ...tf,
      kickoff_iso: tfISO,
      flashscore_id: found.id,
      flashscore_kickoff: found.kickoff,
      status: "matched"
    });
  } else {
    dropped.push({
      ...tf,
      status: "dropped_not_on_flashscore"
    });
  }
}

// ---------------- OUTPUT ----------------

fs.mkdirSync("artifacts", { recursive: true });

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
