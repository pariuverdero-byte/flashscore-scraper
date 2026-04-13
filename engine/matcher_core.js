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

  let bestMatch = null;
  let bestScore = 0;

  for (const m of matches) {
    const [mHomeRaw, mAwayRaw] = splitTeams(m.teams || "");

    if (!mHomeRaw || !mAwayRaw) continue;

    const mHome = applyAlias(mHomeRaw);
    const mAway = applyAlias(mAwayRaw);

    const homeScore = similarity(home, mHome);
    const awayScore = similarity(away, mAway);

    const totalScore = (homeScore + awayScore) / 2;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestMatch = m;
    }
  }

  // threshold critic
  if (bestScore >= 0.6) {
    return {
      match: bestMatch,
      score: bestScore,
    };
  }

  return null;
}
