// engine/matcher_core.js
//
// UNIVERSAL FLASHSCORE EVENT MATCHER
//
// Used by:
// - ClaudiuHood
// - TalkFootball
// - PredictZ
// - PonturiPariuri
// - future external sources
//
// Matching hierarchy:
//
// 1. direct Flashscore ID
// 2. normalized exact home + away
// 3. alias-assisted exact
// 4. fuzzy home + away matching
// 5. optional supporting signals:
//      time
//      country
//      competition
//
// IMPORTANT:
// A fuzzy candidate is accepted only when:
// - BOTH teams individually have a sufficiently strong score
// - total confidence passes threshold
// - candidate is sufficiently better than candidate #2
//
// This prevents weak / ambiguous matches from entering master_pool.

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  // Strong automatic fuzzy acceptance.
  HIGH_CONFIDENCE: 0.90,

  // Normal acceptance when candidate separation is good.
  NORMAL_CONFIDENCE: 0.84,

  // Lowest allowed only when supporting evidence exists.
  SUPPORTED_CONFIDENCE: 0.80,

  // Each team must independently meet this threshold.
  MIN_TEAM_SCORE: 0.74,

  // Required difference between #1 and #2 candidates.
  MIN_MARGIN: 0.08,

  // Stronger margin for lower-confidence matches.
  LOW_CONFIDENCE_MARGIN: 0.12,

  // Time tolerance when time is supplied by source.
  TIME_TOLERANCE_MINUTES: 45,

  // Reject source events that explicitly belong to another date.
  DATE_GUARD_ENABLED: true,
};

// ============================================================
// TEAM ALIASES
// ============================================================
//
// Keep aliases only for genuine naming differences that cannot
// reliably be inferred from spelling similarity.
//
// The fuzzy matcher handles ordinary abbreviations automatically.
// Alias dictionary is therefore a supplement, not the main engine.

const TEAM_ALIASES = {
  "man city": "manchester city",
  "manchester city": "manchester city",

  "man utd": "manchester united",
  "man united": "manchester united",
  "manchester utd": "manchester united",
  "manchester united": "manchester united",

  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "paris saint germain": "paris saint germain",

  "inter": "inter milan",
  "internazionale": "inter milan",
  "inter milano": "inter milan",
  "inter milan": "inter milan",

  "ath madrid": "atletico madrid",
  "atl madrid": "atletico madrid",
  "atletico madrid": "atletico madrid",

  "bayern": "bayern munich",
  "bayern munchen": "bayern munich",
  "bayern munich": "bayern munich",

  "az": "az alkmaar",
  "az alkmaar": "az alkmaar",

  "cfr cluj": "cfr 1907 cluj",
  "cfr 1907 cluj": "cfr 1907 cluj",

  "universitatea craiova": "univ craiova",
  "universitatea craiova 1948": "univ craiova",
  "univ craiova": "univ craiova",

  "kuopio palloseura": "kups",
  "kuopion palloseura": "kups",
  "kups": "kups",

  "dinamo minsk": "din minsk",
  "din minsk": "din minsk",

  "sporting braga": "braga",
  "sc sporting braga": "braga",
  "sporting clube de braga": "braga",
  "braga": "braga",

  "kr reykjavik": "kr",
};

// ============================================================
// GENERIC HELPERS
// ============================================================

function safe(value) {
  return (value ?? "").toString().trim();
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

// ============================================================
// NORMALIZATION
// ============================================================

function removeDiacritics(value = "") {
  return safe(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeCountrySuffix(value = "") {
  // Flashscore frequently uses:
  //
  // Univ. Craiova (Rou)
  // KuPS (Fin)
  // Braga (Por)
  //
  // Country parenthesis is not part of the team name.
  return safe(value).replace(/\s*\([A-Za-z]{2,4}\)\s*$/g, "");
}

function normalizeTeam(value = "") {
  let text = removeDiacritics(
    normalizeCountrySuffix(value)
  ).toLowerCase();

  text = text
    // common separators / punctuation
    .replace(/&/g, " and ")
    .replace(/[.'’`]/g, "")
    .replace(/[_/\\]/g, " ")
    .replace(/-/g, " ")

    // club prefixes which rarely carry identity
    .replace(
      /\b(fc|cf|sc|ac|afc|fk|bk|sk|sv|ss|ssc|as|cd|club)\b/g,
      " "
    )

    // normalize some common words
    .replace(/\butd\b/g, " united ")
    .replace(/\buniv\b/g, " univ ")
    .replace(/\bdep\b/g, " deportivo ")

    // remove duplicate whitespace
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function applyAlias(value = "") {
  const normalized = normalizeTeam(value);
  return TEAM_ALIASES[normalized] || normalized;
}

// ============================================================
// TEAM SPLITTING
// ============================================================

function splitTeams(value = "") {
  let text = safe(value);

  if (!text) {
    return [null, null];
  }

  // normalize typical source separators
  text = text
    .replace(/\s+versus\s+/i, " - ")
    .replace(/\s+vs\.?\s+/i, " - ")
    .replace(/\s+v\s+/i, " - ")
    .replace(/\s+–\s+/g, " - ")
    .replace(/\s+—\s+/g, " - ");

  const parts = text
    // Match event separators even when Flashscore omits the
    // space on one side of the dash:
    //
    // Hammarby (Swe)- Rakow (Pol)
    // Hammarby (Swe) - Rakow (Pol)
    //
    // Require whitespace on at least one side so club names
    // such as Atletico-MG are NOT split accidentally.
    .split(/\s+[-–—]\s*|\s*[-–—]\s+/)
    .map((x) => safe(x))
    .filter(Boolean);

  if (parts.length !== 2) {
    return [null, null];
  }

  return [
    parts[0],
    parts[1],
  ];
}

// ============================================================
// TOKEN HELPERS
// ============================================================

function tokens(value = "") {
  return normalizeTeam(value)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean);
}

function uniqueTokens(value = "") {
  return [...new Set(tokens(value))];
}

function tokenIntersectionScore(a = "", b = "") {
  const aa = uniqueTokens(a);
  const bb = uniqueTokens(b);

  if (!aa.length || !bb.length) {
    return 0;
  }

  const setA = new Set(aa);
  const setB = new Set(bb);

  let common = 0;

  for (const token of setA) {
    if (setB.has(token)) {
      common++;
    }
  }

  return common / Math.max(
    setA.size,
    setB.size
  );
}

function tokenContainmentScore(a = "", b = "") {
  const aa = uniqueTokens(a);
  const bb = uniqueTokens(b);

  if (!aa.length || !bb.length) {
    return 0;
  }

  const setA = new Set(aa);
  const setB = new Set(bb);

  let common = 0;

  for (const token of setA) {
    if (setB.has(token)) {
      common++;
    }
  }

  return common / Math.min(
    setA.size,
    setB.size
  );
}

// ============================================================
// ABBREVIATION / PREFIX MATCHING
// ============================================================

function tokenPrefixSimilarity(a = "", b = "") {
  const x = safe(a);
  const y = safe(b);

  if (!x || !y) {
    return 0;
  }

  if (x === y) {
    return 1;
  }

  const shorter =
    x.length <= y.length
      ? x
      : y;

  const longer =
    x.length <= y.length
      ? y
      : x;

  // Examples:
  //
  // Din  -> Dinamo
  // Univ -> Universitatea
  //
  // Require at least 3 chars to avoid weak one-letter matches.
  if (
    shorter.length >= 3 &&
    longer.startsWith(shorter)
  ) {
    return clamp(
      0.82 +
      Math.min(
        shorter.length / longer.length,
        1
      ) * 0.18
    );
  }

  return 0;
}

function abbreviationScore(a = "", b = "") {
  const aa = uniqueTokens(a);
  const bb = uniqueTokens(b);

  if (!aa.length || !bb.length) {
    return 0;
  }

  const scoreSide = (
    sourceTokens,
    targetTokens
  ) => {
    let total = 0;

    for (const sourceToken of sourceTokens) {
      let best = 0;

      for (const targetToken of targetTokens) {
        best = Math.max(
          best,
          tokenPrefixSimilarity(
            sourceToken,
            targetToken
          )
        );
      }

      total += best;
    }

    return total / sourceTokens.length;
  };

  const scoreAB =
    scoreSide(aa, bb);

  const scoreBA =
    scoreSide(bb, aa);

  return (
    scoreAB +
    scoreBA
  ) / 2;
}

// ============================================================
// BIGRAM DICE SIMILARITY
// ============================================================

function bigrams(value = "") {
  const text =
    normalizeTeam(value)
      .replace(/\s+/g, "");

  if (!text) {
    return [];
  }

  if (text.length === 1) {
    return [text];
  }

  const out = [];

  for (
    let i = 0;
    i < text.length - 1;
    i++
  ) {
    out.push(
      text.slice(i, i + 2)
    );
  }

  return out;
}

function diceSimilarity(a = "", b = "") {
  const aa = bigrams(a);
  const bb = bigrams(b);

  if (!aa.length || !bb.length) {
    return 0;
  }

  const counts = new Map();

  for (const gram of aa) {
    counts.set(
      gram,
      (counts.get(gram) || 0) + 1
    );
  }

  let overlap = 0;

  for (const gram of bb) {
    const count =
      counts.get(gram) || 0;

    if (count > 0) {
      overlap++;

      counts.set(
        gram,
        count - 1
      );
    }
  }

  return (
    2 * overlap
  ) / (
    aa.length +
    bb.length
  );
}

// ============================================================
// CHARACTER EDIT SIMILARITY
// ============================================================

function levenshteinDistance(a = "", b = "") {
  const x = normalizeTeam(a);
  const y = normalizeTeam(b);

  if (x === y) {
    return 0;
  }

  if (!x.length) {
    return y.length;
  }

  if (!y.length) {
    return x.length;
  }

  let previous =
    Array.from(
      { length: y.length + 1 },
      (_, i) => i
    );

  for (
    let i = 1;
    i <= x.length;
    i++
  ) {
    const current = [i];

    for (
      let j = 1;
      j <= y.length;
      j++
    ) {
      const cost =
        x[i - 1] === y[j - 1]
          ? 0
          : 1;

      current[j] =
        Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + cost
        );
    }

    previous = current;
  }

  return previous[y.length];
}

function editSimilarity(a = "", b = "") {
  const x = normalizeTeam(a);
  const y = normalizeTeam(b);

  if (!x || !y) {
    return 0;
  }

  const maxLength =
    Math.max(
      x.length,
      y.length
    );

  if (!maxLength) {
    return 1;
  }

  return clamp(
    1 -
    (
      levenshteinDistance(
        x,
        y
      ) /
      maxLength
    )
  );
}

// ============================================================
// TEAM SIMILARITY
// ============================================================

function teamSimilarity(
  sourceTeam,
  flashscoreTeam
) {
  const sourceNormalized =
    normalizeTeam(sourceTeam);

  const flashNormalized =
    normalizeTeam(flashscoreTeam);

  if (
    !sourceNormalized ||
    !flashNormalized
  ) {
    return {
      score: 0,
      method: "empty",
    };
  }

  // Exact without alias.
  if (
    sourceNormalized ===
    flashNormalized
  ) {
    return {
      score: 1,
      method: "normalized_exact",
    };
  }

  const sourceAlias =
    applyAlias(sourceTeam);

  const flashAlias =
    applyAlias(flashscoreTeam);

  // Exact after alias mapping.
  if (
    sourceAlias ===
    flashAlias
  ) {
    return {
      score: 0.99,
      method: "alias_exact",
    };
  }

  // Strong containment.
  //
  // Example:
  // Real Madrid
  // Real Madrid Castilla
  //
  // This must NOT automatically become 1.0 because it can be
  // dangerous. It remains one component of fuzzy scoring.
  const containment =
    sourceAlias.includes(
      flashAlias
    ) ||
    flashAlias.includes(
      sourceAlias
    )
      ? 0.88
      : 0;

  const tokenIntersection =
    tokenIntersectionScore(
      sourceAlias,
      flashAlias
    );

  const tokenContainment =
    tokenContainmentScore(
      sourceAlias,
      flashAlias
    );

  const abbreviation =
    abbreviationScore(
      sourceAlias,
      flashAlias
    );

  const dice =
    diceSimilarity(
      sourceAlias,
      flashAlias
    );

  const edit =
    editSimilarity(
      sourceAlias,
      flashAlias
    );

  // Weighted lexical score.
  //
  // Token / abbreviation evidence is more important than raw
  // edit distance because football team naming often differs by
  // prefixes / abbreviations.
  let score =
    (
      tokenIntersection * 0.22 +
      tokenContainment * 0.22 +
      abbreviation * 0.20 +
      dice * 0.20 +
      edit * 0.16
    );

  score =
    Math.max(
      score,
      containment
    );

  return {
    score:
      clamp(score),

    method:
      "fuzzy",

    diagnostics: {
      tokenIntersection:
        Number(
          tokenIntersection.toFixed(3)
        ),

      tokenContainment:
        Number(
          tokenContainment.toFixed(3)
        ),

      abbreviation:
        Number(
          abbreviation.toFixed(3)
        ),

      dice:
        Number(
          dice.toFixed(3)
        ),

      edit:
        Number(
          edit.toFixed(3)
        ),
    },
  };
}

// ============================================================
// TIME HELPERS
// ============================================================

function parseTimeToMinutes(value = "") {
  const match =
    safe(value).match(
      /\b(\d{1,2}):(\d{2})\b/
    );

  if (!match) {
    return null;
  }

  const hour =
    Number(match[1]);

  const minute =
    Number(match[2]);

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return (
    hour * 60 +
    minute
  );
}

function timeSimilarity(
  sourceTime,
  flashscoreTime
) {
  const sourceMinutes =
    parseTimeToMinutes(
      sourceTime
    );

  const fsMinutes =
    parseTimeToMinutes(
      flashscoreTime
    );

  if (
    sourceMinutes == null ||
    fsMinutes == null
  ) {
    return null;
  }

  const difference =
    Math.abs(
      sourceMinutes -
      fsMinutes
    );

  if (difference === 0) {
    return 1;
  }

  if (difference <= 15) {
    return 0.95;
  }

  if (difference <= 30) {
    return 0.85;
  }

  if (
    difference <=
    CONFIG.TIME_TOLERANCE_MINUTES
  ) {
    return 0.70;
  }

  return 0;
}

// ============================================================
// DATE GUARD
// ============================================================
//
// If a source gives us an explicit date/kickoff date, do not even
// attempt fuzzy matching against Flashscore fixtures from another day.
//
// Examples:
//   TalkFootball kickoff: "08/14 17:00"
//   DAY_OFFSET=-1 on 2026-08-14 -> target date 2026-08-13
//
// Result:
//   date_mismatch -> reject BEFORE team matching.

function bucharestDateFromOffset(offset = 0) {
  const date =
    new Date(
      Date.now() +
      Number(offset || 0) * 86400000
    );

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Europe/Bucharest",
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit",
      }
    ).formatToParts(date);

  const get =
    type =>
      parts.find(
        part =>
          part.type === type
      )?.value || "";

  return (
    `${get("year")}-` +
    `${get("month")}-` +
    `${get("day")}`
  );
}

function normalizeIsoDate(
  year,
  month,
  day
) {
  const y =
    Number(year);

  const m =
    Number(month);

  const d =
    Number(day);

  if (
    !Number.isInteger(y) ||
    !Number.isInteger(m) ||
    !Number.isInteger(d) ||
    y < 2000 ||
    y > 2100 ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31
  ) {
    return null;
  }

  return (
    `${String(y).padStart(4, "0")}-` +
    `${String(m).padStart(2, "0")}-` +
    `${String(d).padStart(2, "0")}`
  );
}

function parseSourceDate(
  value,
  targetDate = ""
) {
  const text =
    safe(value);

  if (!text) {
    return null;
  }

  let match;

  // YYYY-MM-DD
  match =
    text.match(
      /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/
    );

  if (match) {
    return normalizeIsoDate(
      match[1],
      match[2],
      match[3]
    );
  }

  // DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY
  match =
    text.match(
      /\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](20\d{2})\b/
    );

  if (match) {
    return normalizeIsoDate(
      match[3],
      match[2],
      match[1]
    );
  }

  // TalkFootball format:
  // MM/DD HH:mm
  //
  // Example:
  // 08/14 17:30
  match =
    text.match(
      /\b(\d{1,2})\/(\d{1,2})\s+\d{1,2}:\d{2}\b/
    );

  if (match) {
    const targetYear =
      Number(
        safe(targetDate).slice(0, 4)
      ) ||
      new Date().getUTCFullYear();

    return normalizeIsoDate(
      targetYear,
      match[1],
      match[2]
    );
  }

  return null;
}

function sourceDateValue(
  eventInput,
  context = {}
) {
  if (
    eventInput &&
    typeof eventInput === "object"
  ) {
    return safe(
      eventInput.date ||
      eventInput.match_date ||
      eventInput.matchDate ||
      eventInput.target_date ||
      eventInput.kickoff ||
      eventInput.datetime ||
      eventInput.start_time ||
      eventInput.startTime
    );
  }

  return safe(
    context.date ||
    context.match_date ||
    context.matchDate ||
    context.kickoff
  );
}

function resolveTargetDate(
  context = {}
) {
  const explicit =
    safe(
      context.targetDate ||
      context.target_date
    );

  if (explicit) {
    const parsed =
      parseSourceDate(
        explicit,
        explicit
      );

    if (parsed) {
      return parsed;
    }
  }

  return bucharestDateFromOffset(
    process.env.DAY_OFFSET || 0
  );
}

export function eventDateGuard(
  eventInput,
  context = {}
) {
  const targetDate =
    resolveTargetDate(
      context
    );

  const rawSourceDate =
    sourceDateValue(
      eventInput,
      context
    );

  const sourceDate =
    parseSourceDate(
      rawSourceDate,
      targetDate
    );

  // Source has no usable date -> do NOT reject.
  // Matching continues normally.
  if (!sourceDate) {
    return {
      ok: true,
      reason:
        "source_date_unknown",
      sourceDate:
        null,
      targetDate,
    };
  }

  if (
    CONFIG.DATE_GUARD_ENABLED &&
    sourceDate !== targetDate
  ) {
    return {
      ok: false,
      reason:
        "date_mismatch",
      sourceDate,
      targetDate,
    };
  }

  return {
    ok: true,
    reason:
      "date_match",
    sourceDate,
    targetDate,
  };
}

// ============================================================
// TEXT CONTEXT SIMILARITY
// ============================================================

function contextSimilarity(
  source,
  target
) {
  const a =
    normalizeTeam(source);

  const b =
    normalizeTeam(target);

  if (!a || !b) {
    return null;
  }

  if (a === b) {
    return 1;
  }

  return Math.max(
    tokenContainmentScore(
      a,
      b
    ),
    diceSimilarity(
      a,
      b
    )
  );
}

// ============================================================
// MATCH DATA HELPERS
// ============================================================

function getMatchId(match = {}) {
  return safe(
    match.id ||
    match.match_id ||
    match.flashscore_id
  );
}

function getMatchTeams(match = {}) {
  if (safe(match.teams)) {
    return safe(match.teams);
  }

  if (
    safe(match.home) &&
    safe(match.away)
  ) {
    return (
      `${safe(match.home)} - ` +
      `${safe(match.away)}`
    );
  }

  return "";
}

function getMatchTime(match = {}) {
  return safe(
    match.time ||
    match.flashscore_kickoff ||
    match.kickoff
  );
}

function getMatchCountry(match = {}) {
  return safe(
    match.country ||
    match.region
  );
}

function getMatchCompetition(match = {}) {
  return safe(
    match.competition ||
    match.league ||
    match.tournament
  );
}

// ============================================================
// INPUT NORMALIZATION
// ============================================================

function normalizeInput(
  eventInput,
  context = {}
) {
  if (
    typeof eventInput ===
    "string"
  ) {
    return {
      teams:
        safe(eventInput),

      matchId:
        safe(
          context.matchId ||
          context.match_id ||
          context.flashscore_id
        ),

      time:
        safe(
          context.time ||
          context.kickoff
        ),

      country:
        safe(
          context.country
        ),

      competition:
        safe(
          context.competition ||
          context.league
        ),

      allowReverse:
        context.allowReverse === true,
    };
  }

  const obj =
    eventInput &&
    typeof eventInput === "object"
      ? eventInput
      : {};

  const teams =
    safe(obj.teams) ||
    (
      safe(obj.home) &&
      safe(obj.away)
        ? (
            `${safe(obj.home)} - ` +
            `${safe(obj.away)}`
          )
        : ""
    );

  return {
    teams,

    matchId:
      safe(
        obj.match_id ||
        obj.matchId ||
        obj.flashscore_id ||
        context.matchId ||
        context.match_id ||
        context.flashscore_id
      ),

    time:
      safe(
        obj.time ||
        obj.kickoff ||
        context.time ||
        context.kickoff
      ),

    country:
      safe(
        obj.country ||
        context.country
      ),

    competition:
      safe(
        obj.competition ||
        obj.league ||
        context.competition ||
        context.league
      ),

    allowReverse:
      obj.allowReverse === true ||
      context.allowReverse === true,
  };
}

// ============================================================
// CANDIDATE SCORING
// ============================================================

function scoreCandidate(
  input,
  match,
  reverse = false
) {
  const [
    sourceHome,
    sourceAway,
  ] =
    splitTeams(
      input.teams
    );

  const [
    flashHome,
    flashAway,
  ] =
    splitTeams(
      getMatchTeams(match)
    );

  if (
    !sourceHome ||
    !sourceAway ||
    !flashHome ||
    !flashAway
  ) {
    return null;
  }

  const homeTarget =
    reverse
      ? flashAway
      : flashHome;

  const awayTarget =
    reverse
      ? flashHome
      : flashAway;

  const homeResult =
    teamSimilarity(
      sourceHome,
      homeTarget
    );

  const awayResult =
    teamSimilarity(
      sourceAway,
      awayTarget
    );

  const homeScore =
    homeResult.score;

  const awayScore =
    awayResult.score;

  // Base score gives equal importance to both clubs.
  //
  // The weaker club is also important, so add a small penalty
  // when one side scores significantly lower than the other.
  const averageTeamScore =
    (
      homeScore +
      awayScore
    ) / 2;

  const weakerTeam =
    Math.min(
      homeScore,
      awayScore
    );

  let score =
    averageTeamScore * 0.85 +
    weakerTeam * 0.15;

  // Optional supporting signals.
  const timeScore =
    timeSimilarity(
      input.time,
      getMatchTime(match)
    );

  const countryScore =
    contextSimilarity(
      input.country,
      getMatchCountry(match)
    );

  const competitionScore =
    contextSimilarity(
      input.competition,
      getMatchCompetition(match)
    );

  let supportingSignals = 0;
  let supportingWeight = 0;

  if (timeScore != null) {
    supportingSignals +=
      timeScore * 0.06;

    supportingWeight +=
      0.06;
  }

  if (countryScore != null) {
    supportingSignals +=
      countryScore * 0.03;

    supportingWeight +=
      0.03;
  }

  if (
    competitionScore != null
  ) {
    supportingSignals +=
      competitionScore * 0.05;

    supportingWeight +=
      0.05;
  }

  if (supportingWeight > 0) {
    score =
      score *
      (
        1 -
        supportingWeight
      ) +
      supportingSignals;
  }

  score =
    clamp(score);

  let method =
    "fuzzy";

  if (
    homeResult.method ===
      "normalized_exact" &&
    awayResult.method ===
      "normalized_exact"
  ) {
    method =
      "normalized_exact";
  } else if (
    [
      "normalized_exact",
      "alias_exact",
    ].includes(
      homeResult.method
    ) &&
    [
      "normalized_exact",
      "alias_exact",
    ].includes(
      awayResult.method
    )
  ) {
    method =
      "alias_exact";
  }

  return {
    match,

    score,

    confidence:
      score,

    homeScore,

    awayScore,

    method,

    reversed:
      reverse,

    supporting: {
      time:
        timeScore,

      country:
        countryScore,

      competition:
        competitionScore,
    },

    diagnostics: {
      sourceHome,

      sourceAway,

      flashHome,

      flashAway,

      home:
        homeResult,

      away:
        awayResult,
    },
  };
}

// ============================================================
// ACCEPTANCE LOGIC
// ============================================================

function shouldAccept(
  best,
  second
) {
  if (!best) {
    return {
      accepted: false,
      reason:
        "no_candidate",
    };
  }

  const secondScore =
    second?.score || 0;

  const margin =
    best.score -
    secondScore;

  const bothTeamsStrong =
    best.homeScore >=
      CONFIG.MIN_TEAM_SCORE &&
    best.awayScore >=
      CONFIG.MIN_TEAM_SCORE;

  if (!bothTeamsStrong) {
    return {
      accepted: false,

      reason:
        "weak_team_match",

      margin,
    };
  }

  // Exact / alias exact pair.
  if (
    best.method ===
      "normalized_exact" ||
    best.method ===
      "alias_exact"
  ) {
    return {
      accepted: true,

      reason:
        best.method,

      margin,
    };
  }

  // Very strong fuzzy match.
  if (
    best.score >=
    CONFIG.HIGH_CONFIDENCE
  ) {
    // Still reject near-ties.
    if (
      second &&
      margin < 0.04
    ) {
      return {
        accepted: false,

        reason:
          "ambiguous_high_confidence",

        margin,
      };
    }

    return {
      accepted: true,

      reason:
        "high_confidence",

      margin,
    };
  }

  // Normal fuzzy acceptance.
  if (
    best.score >=
    CONFIG.NORMAL_CONFIDENCE
  ) {
    if (
      !second ||
      margin >=
        CONFIG.MIN_MARGIN
    ) {
      return {
        accepted: true,

        reason:
          "confidence_and_margin",

        margin,
      };
    }

    return {
      accepted: false,

      reason:
        "ambiguous_candidate",

      margin,
    };
  }

  // Lower range requires supporting context.
  if (
    best.score >=
    CONFIG.SUPPORTED_CONFIDENCE
  ) {
    const supportValues =
      Object.values(
        best.supporting
      ).filter(
        (value) =>
          value != null
      );

    const strongSupport =
      supportValues.some(
        (value) =>
          value >= 0.85
      );

    if (
      strongSupport &&
      (
        !second ||
        margin >=
          CONFIG.LOW_CONFIDENCE_MARGIN
      )
    ) {
      return {
        accepted: true,

        reason:
          "supported_confidence",

        margin,
      };
    }
  }

  return {
    accepted: false,

    reason:
      "confidence_too_low",

    margin,
  };
}

// ============================================================
// DIRECT ID MATCH
// ============================================================

function directIdMatch(
  requestedId,
  matches
) {
  const id =
    safe(requestedId);

  if (!id) {
    return null;
  }

  return (
    matches.find(
      (match) =>
        getMatchId(match) === id
    ) || null
  );
}

// ============================================================
// MAIN PUBLIC FUNCTION
// ============================================================

export function matchEventToFlashscore(
  eventInput,
  matches = [],
  context = {}
) {
  const dateGuard =
    eventDateGuard(
      eventInput,
      context
    );

  if (!dateGuard.ok) {
    return null;
  }

  const input =
    normalizeInput(
      eventInput,
      context
    );

  const matchList =
    Array.isArray(matches)
      ? matches
      : [];

  if (!matchList.length) {
    return null;
  }

  // ----------------------------------------------------------
  // 1. DIRECT FLASHSCORE ID
  // ----------------------------------------------------------

  if (input.matchId) {
    const direct =
      directIdMatch(
        input.matchId,
        matchList
      );

    if (direct) {
      return {
        match:
          direct,

        score:
          1,

        confidence:
          1,

        homeScore:
          1,

        awayScore:
          1,

        method:
          "direct_id",

        match_method:
          "direct_id",

        match_confidence:
          1,

        margin:
          1,

        secondBestScore:
          0,

        reversed:
          false,

        diagnostics: {
          requestedId:
            input.matchId,
        },
      };
    }
  }

  // ----------------------------------------------------------
  // 2. TEAM-BASED MATCH
  // ----------------------------------------------------------

  if (!input.teams) {
    return null;
  }

  const [
    home,
    away,
  ] =
    splitTeams(
      input.teams
    );

  if (!home || !away) {
    return null;
  }

  const candidates = [];

  for (
    const match of
    matchList
  ) {
    const normal =
      scoreCandidate(
        input,
        match,
        false
      );

    if (normal) {
      candidates.push(
        normal
      );
    }

    // Optional only.
    //
    // We do NOT reverse by default because a source pick such as
    // "1" or "2" depends on home/away order.
    if (
      input.allowReverse
    ) {
      const reversed =
        scoreCandidate(
          input,
          match,
          true
        );

      if (reversed) {
        candidates.push(
          reversed
        );
      }
    }
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  const best =
    candidates[0];

  const second =
    candidates[1];

  const decision =
    shouldAccept(
      best,
      second
    );

  if (
    !decision.accepted
  ) {
    return null;
  }

  const confidence =
    Number(
      best.score.toFixed(4)
    );

  const margin =
    Number(
      (
        decision.margin || 0
      ).toFixed(4)
    );

  const secondBestScore =
    Number(
      (
        second?.score || 0
      ).toFixed(4)
    );

  return {
    ...best,

    score:
      confidence,

    confidence,

    homeScore:
      Number(
        best.homeScore.toFixed(4)
      ),

    awayScore:
      Number(
        best.awayScore.toFixed(4)
      ),

    match_method:
      best.method,

    match_confidence:
      confidence,

    acceptance_reason:
      decision.reason,

    margin,

    secondBestScore,
  };
}

// ============================================================
// OPTIONAL DIAGNOSTIC FUNCTION
// ============================================================
//
// Useful for debugging candidates that are rejected.
// Does NOT change production behaviour.

export function rankFlashscoreCandidates(
  eventInput,
  matches = [],
  context = {},
  limit = 5
) {
  const input =
    normalizeInput(
      eventInput,
      context
    );

  const matchList =
    Array.isArray(matches)
      ? matches
      : [];

  if (
    !input.teams ||
    !matchList.length
  ) {
    return [];
  }

  const candidates = [];

  for (
    const match of
    matchList
  ) {
    const normal =
      scoreCandidate(
        input,
        match,
        false
      );

    if (normal) {
      candidates.push(
        normal
      );
    }

    if (
      input.allowReverse
    ) {
      const reversed =
        scoreCandidate(
          input,
          match,
          true
        );

      if (reversed) {
        candidates.push(
          reversed
        );
      }
    }
  }

  return candidates
    .sort(
      (a, b) =>
        b.score -
        a.score
    )
    .slice(
      0,
      Math.max(
        1,
        Number(limit) || 5
      )
    )
    .map(
      (candidate) => ({
        match_id:
          getMatchId(
            candidate.match
          ),

        teams:
          getMatchTeams(
            candidate.match
          ),

        score:
          Number(
            candidate.score.toFixed(
              4
            )
          ),

        homeScore:
          Number(
            candidate.homeScore.toFixed(
              4
            )
          ),

        awayScore:
          Number(
            candidate.awayScore.toFixed(
              4
            )
          ),

        method:
          candidate.method,

        reversed:
          candidate.reversed,

        supporting:
          candidate.supporting,
      })
    );
}

// ============================================================
// TEST / ADVANCED EXPORTS
// ============================================================

export {
  normalizeTeam,
  applyAlias,
  splitTeams,
  teamSimilarity,
};
