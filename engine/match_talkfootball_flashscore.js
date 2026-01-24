// engine/match_talkfootball_flashscore.js
// Match talkfootball_pool.json → matches.json (din scrape_mobi.js)
// Output: artifacts/talkfootball_matched.json, artifacts/talkfootball_dropped.json

import fs from "fs";

function normalizeTeam(str = "") {
  return str
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/\b(fc|cf|sc|ac)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tfKickoffToIso(tfKickoff, dayOffset = 0) {
  // "01/24 19:00" -> "YYYY-01-24 19:00" (cu offset pe zi)
  const base = new Date();
  base.setDate(base.getDate() + dayOffset);

  const year = base.getFullYear();
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

function ensureOffset(href, offset) {
  if (!href) return href;
  const hasQ = href.includes("?");
  if (href.includes("d=")) return href;
  return hasQ ? `${href}&d=${offset}` : `${href}?d=${offset}`;
}

function extractId(url = "") {
  const m = /\/match\/([^/?#]+)\//i.exec(url) || /\/match\/([^/?#]+)\b/i.exec(url);
  return m ? m[1] : null;
}

// ---- LOAD ----
const tf = JSON.parse(fs.readFileSync("artifacts/talkfootball_pool.json", "utf8"));
const mob = JSON.parse(fs.readFileSync("matches.json", "utf8"));
const fixtures = (mob.matches || []);

// transform fixtures → {id, home, away, kickoff}
const flashscore = fixtures.map(m => {
  const teams = (m.teams || "").split(" - ");
  const home = (teams[0] || "").trim();
  const away = (teams[1] || "").trim();

  // scrape_mobi.js produce "time" si "day" (offset in URL), dar nu produce yyyy-mm-dd.
  // folosim anul curent + data curentă, iar matching se face cu toleranță +/- 90m + offset d.
  const kickoff = `${new Date().getFullYear()}-01-01 ${m.time || "00:00"}`; // placeholder (nu folosim strict)

  return {
    id: m.id || extractId(m.url || ""),
    home,
    away,
    time: m.time || "",
    url: m.url || "",
    competition: m.competition || "",
    country: m.country || "",
    status: m.status || "sched"
  };
}).filter(x => x.id && x.home && x.away);

// ---- MATCH ----
const OFFSETS = [0, -1, 1];

const matched = [];
const dropped = [];

for (const e of tf) {
  const tfHome = normalizeTeam(e.home);
  const tfAway = normalizeTeam(e.away);

  let found = null;

  for (const off of OFFSETS) {
    const tfIso = tfKickoffToIso(e.kickoff, off);

    const cand = flashscore.find(f =>
      normalizeTeam(f.home) === tfHome &&
      normalizeTeam(f.away) === tfAway
    );

    if (cand) {
      found = { cand, off, tfIso };
      break;
    }
  }

  if (found) {
    matched.push({
      ...e,
      kickoff_iso: found.tfIso,
      flashscore_id: found.cand.id,
      flashscore_url: found.cand.url ? ensureOffset(found.cand.url, 0) : `https://www.flashscore.mobi/match/${found.cand.id}/`,
      flashscore_kickoff: found.cand.time || "",
      matched_day_offset: found.off,
      status: "matched"
    });
  } else {
    dropped.push({ ...e, status: "dropped_not_on_flashscore" });
  }
}

fs.mkdirSync("artifacts", { recursive: true });

fs.writeFileSync("artifacts/talkfootball_matched.json", JSON.stringify(matched, null, 2));
fs.writeFileSync("artifacts/talkfootball_dropped.json", JSON.stringify(dropped, null, 2));

console.log(`[matcher] matched: ${matched.length}`);
console.log(`[matcher] dropped: ${dropped.length}`);
