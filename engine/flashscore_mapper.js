import https from "https";

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { "User-Agent": "Mozilla/5.0" } },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve(data));
        }
      )
      .on("error", reject);
  });
}

/**
 * 🔹 STEP 1 — strict match extraction (corect)
 */
function extractMatchRegex(rawText) {
  const patterns = [
    // Team A vs Team B
    /([A-Z][A-Za-z\s]+?)\s+(?:vs|v\.?|–|-)\s+([A-Z][A-Za-z\s]+)/,

    // Team A împotriva lui Team B
    /([A-Z][A-Za-z\s]+?)\s+împotriva\s+(?:lui\s+)?([A-Z][A-Za-z\s]+)/i,

    // meciul dintre A și B
    /dintre\s+([A-Z][A-Za-z\s]+?)\s+și\s+([A-Z][A-Za-z\s]+)/i,
  ];

  for (const p of patterns) {
    const m = rawText.match(p);
    if (m) {
      return {
        home: m[1].trim(),
        away: m[2].trim(),
        source: "regex",
      };
    }
  }

  return null;
}

/**
 * 🔹 STEP 2 — Flashscore fallback (DOAR cu match clar)
 */
export async function flashscoreMapMatch({ sport, rawText, log = console }) {
  // 1️⃣ Regex FIRST (asta rezolvă 90%)
  const regexMatch = extractMatchRegex(rawText);
  if (regexMatch) {
    log.info?.(
      `[MATCH][regex] ${regexMatch.home} vs ${regexMatch.away}`
    );
    return {
      ...regexMatch,
      type: sport === "tennis" ? "players" : "teams",
    };
  }

  // 2️⃣ Dacă NU avem pereche clară → STOP
  log.info?.("[MATCH] no explicit match pattern found");
  return null;
}
