/**
 * Match / Players extractor – FINAL STABLE VERSION
 */

const STOP_WORDS = [
  "biletul",
  "pontul",
  "ponturi",
  "cota",
  "azi",
  "fotbal",
  "tenis",
  "ban",
  "ion",
  "dan",
  "zilei",
  "bilet",
  "pont",
];

function normalize(str) {
  return str.replace(/\s+/g, " ").trim();
}

function looksLikeEntity(str) {
  if (!str) return false;

  const s = str.toLowerCase();

  if (!/[A-Z]/.test(str)) return false;
  if (str.split(" ").length > 5) return false;

  for (const w of STOP_WORDS) {
    if (s.includes(w)) return false;
  }

  return true;
}

export function extractMatch({ sport, title, rawText }) {
  /* =========================
   * TENNIS – ONLY rawText
   * ========================= */
  if (sport === "tennis") {
    const text = rawText;

    const tennisRegexes = [
      // Daniil Medvedev il va intalni pe Learner Tien
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:il va intalni pe|va juca cu|vs\.?|contra)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,

      // Medvedev vs Tien
      /([A-Z][a-z]+)\s+vs\.?\s+([A-Z][a-z]+)/,
    ];

    for (const r of tennisRegexes) {
      const m = text.match(r);
      if (m && looksLikeEntity(m[1]) && looksLikeEntity(m[2])) {
        return {
          home: normalize(m[1]),
          away: normalize(m[2]),
          type: "players",
        };
      }
    }

    return null;
  }

  /* =========================
   * FOOTBALL – title + rawText
   * ========================= */
  if (sport === "football") {
    const text = `${title}. ${rawText}`;

    // Phase A – explicit VS / si
    const vsRegexes = [
      /([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+)\s+(?:vs\.?|-\s?|va juca cu)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+)/,
      /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s+(?:si|și)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)/,
    ];

    for (const r of vsRegexes) {
      const m = text.match(r);
      if (m && looksLikeEntity(m[1]) && looksLikeEntity(m[2])) {
        return {
          home: normalize(m[1]),
          away: normalize(m[2]),
          type: "teams",
        };
      }
    }

    // Phase B – contextual (echipele sunt X si Y)
    const contextualRegex =
      /(?:echipele|meciul|partida)\s+(?:care|pe care)?\s*(?:voi|vom)?\s*(?:miza|alege|selecta)?\s*(?:sunt|este)?[:\-]?\s*([A-Z][A-Za-z0-9\s]+)\s+(?:si|și)\s+([A-Z][A-Za-z0-9\s]+)/i;

    const cm = text.match(contextualRegex);
    if (cm && looksLikeEntity(cm[1]) && looksLikeEntity(cm[2])) {
      return {
        home: normalize(cm[1]),
        away: normalize(cm[2]),
        type: "teams",
      };
    }

    return null;
  }

  return null;
}
