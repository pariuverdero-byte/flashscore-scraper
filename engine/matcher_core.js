// engine/matcher_core.js

function normalize(str = "") {
  return str
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/fc|cf|sc|ac|fk|bk|club|deportivo|athletic/g, "")
    .replace(/u\d{2}/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TEAM_ALIASES = {
  "man city": "manchester city",
  "man utd": "manchester united",
  "inter": "inter milan",
  "psg": "paris saint germain",
  "az": "az alkmaar",
  "cfr cluj": "cfr 1907 cluj",
  "kr reykjavik": "kr",
};

function applyAlias(name) {
  const n = normalize(name);
  return TEAM_ALIASES[n] || n;
}

function splitTeams(str) {
  const s = str.replace(/\s+v\s+|\s+vs\s+/i, " - ");
  const parts = s.split(" - ");
  if (parts.length !== 2) return [null, null];
  return [parts[0].trim(), parts[1].trim()];
}

function similarity(a, b) {
  if (!a || !b) return 0;

  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) return 0.8;

  let score = 0;
  const aParts = a.split(" ");
  const bParts = b.split(" ");

  for (const w of aParts) {
    if (bParts.includes(w)) score++;
  }

  return score / Math.max(aParts.length, bParts.length);
}

export function matchEventToFlashscore(eventTeams, matches) {
  const [homeRaw, awayRaw] = splitTeams(eventTeams);
  if (!homeRaw || !awayRaw) return null;

  const home = applyAlias(homeRaw);
  const away = applyAlias(awayRaw);

  let best = null;
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
      best = m;
    }
  }

  if (bestScore >= 0.6) {
    return {
      match: best,
      score: bestScore,
    };
  }

  return null;
}
