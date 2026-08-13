// engine/matcher_core.js

// ----------------------
// NORMALIZATION
// ----------------------
function normalize(str = "") {
  return str
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|ac|fk|bk)\b/g, "")
    .replace(/\b(u\d{2})\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ----------------------
// TEAM ALIASES (VERY IMPORTANT)
// ----------------------
const TEAM_ALIASES = {
  "man city": "manchester city",
  "man utd": "manchester united",
  "inter": "inter milan",
  "psg": "paris saint germain",
  "az": "az alkmaar",
  "cfr cluj": "cfr 1907 cluj",

  // Romanian / European naming variants
  "universitatea craiova": "univ craiova",
  "univ craiova": "univ craiova",

  "kuopio palloseura": "kups",
  "kups": "kups",

  "dinamo minsk": "din minsk",
  "din minsk": "din minsk",

  "sporting braga": "braga",
  "sc sporting braga": "braga",
  "braga": "braga",

  // Romanian / European naming variants
  "universitatea craiova": "univ craiova",
  "univ craiova": "univ craiova",

  "kuopio palloseura": "kups",
  "kups": "kups",

  "dinamo minsk": "din minsk",
  "din minsk": "din minsk",

  "sporting braga": "braga",
  "sc sporting braga": "braga",
  "braga": "braga",
  "kr reykjavik": "kr",
  "ath madrid": "atletico madrid",
  "real sociedad": "real sociedad",
  "bayern": "bayern munich",
};

function applyAlias(name) {
  const n = normalize(name);
  return TEAM_ALIASES[n] || n;
}

// ----------------------
// SPLIT TEAMS
// ----------------------
function splitTeams(str = "") {
  const s = str
    .replace(/\s+v\s+/i, " - ")
    .replace(/\s+vs\s+/i, " - ");

  const parts = s.split(" - ");

  if (parts.length !== 2) return [null, null];

  return [parts[0].trim(), parts[1].trim()];
}

// ----------------------
// SIMILARITY SCORE
// ----------------------
function similarity(a, b) {
  if (!a || !b) return 0;

  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) return 0.85;

  const aParts = a.split(" ");
  const bParts = b.split(" ");

  let common = 0;

  for (const w of aParts) {
    if (bParts.includes(w)) common++;
  }

  return common / Math.max(aParts.length, bParts.length);
}

// ----------------------
// MAIN MATCH FUNCTION
// ----------------------
export function matchEventToFlashscore(eventTeams, matches) {
  const [homeRaw, awayRaw] = splitTeams(eventTeams);
  if (!homeRaw || !awayRaw) return null;
  const home = applyAlias(homeRaw);
  const away = applyAlias(awayRaw);
  const ranked = [];
  for (const m of matches) {
    const [mHomeRaw, mAwayRaw] = splitTeams(m.teams || `${m.home || ""} - ${m.away || ""}`);
    if (!mHomeRaw || !mAwayRaw) continue;
    const homeScore = similarity(home, applyAlias(mHomeRaw));
    const awayScore = similarity(away, applyAlias(mAwayRaw));
    const score = (homeScore + awayScore) / 2;
    if (homeScore >= 0.60 && awayScore >= 0.60) ranked.push({ match: m, score, homeScore, awayScore });
  }
  ranked.sort((a,b)=>b.score-a.score);
  const best=ranked[0], second=ranked[1];
  if (!best || best.score < 0.72) return null;
  if (second && best.score-second.score < 0.08 && best.score < 0.90) return null;
  return best;
}
