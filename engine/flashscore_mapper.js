/**
 * Curăță prefixe editoriale frecvente
 */
function cleanText(text) {
  return text
    .replace(/meciul ales pentru acest bilet este/i, "")
    .replace(/meciul ales este/i, "")
    .replace(/pentru acest bilet/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 🔹 STEP 1 — strict match extraction (fotbal + tenis)
 */
function extractMatchRegex(rawText) {
  const text = cleanText(rawText);

  const patterns = [
    // Team A vs Team B / A - B
    /\b([A-Z][A-Za-z\s]+?)\s+(?:vs|v\.?|–|-)\s+([A-Z][A-Za-z\s]+)\b/,

    // Team A împotriva lui Team B
    /\b([A-Z][A-Za-z\s]+?)\s+împotriva\s+(?:lui\s+)?([A-Z][A-Za-z\s]+)\b/i,

    // meciul dintre A și B
    /dintre\s+([A-Z][A-Za-z\s]+?)\s+și\s+([A-Z][A-Za-z\s]+)\b/i,

    // TENIS: X va juca cu Y / X va juca împotriva lui Y
    /\b([A-Z][A-Za-z\s]+?)\s+va\s+juca\s+(?:împotriva|cu)\s+(?:lui\s+)?([A-Z][A-Za-z\s]+)\b/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
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
 * 🔹 EXPORT PUBLIC
 */
export async function flashscoreMapMatch({ sport, rawText, log = console }) {
  const match = extractMatchRegex(rawText);

  if (match) {
    log.info?.(
      `[MATCH][regex] ${match.home} vs ${match.away}`
    );

    return {
      ...match,
      type: sport === "tennis" ? "players" : "teams",
    };
  }

  log.info?.("[MATCH] no explicit match pattern found");
  return null;
}
