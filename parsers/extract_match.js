/**
 * Match / Players extractor – production ready
 * Strategy:
 *  A. Strict VS / intalni / joaca cu
 *  B. Contextual extraction (echipele sunt: X si Y)
 *  C. Otherwise: null (Flashscore fallback)
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

  if (str.split(" ").length < 2) return false;
  if (!/[A-Z]/.test(str)) return false;

  for (const w of STOP_WORDS) {
    if (s.includes(w)) return false;
  }

  return true;
}

export function extractMatch({ sport, title, rawText }) {
  const text = `${title}. ${rawText}`;

  /* =========================
   * TENNIS
   * ========================= */
  if (sport === "tennis") {
    const tennisRegexes = [
      // Daniil Medvedev il va intalni pe Learner Tien
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:il va intalni pe|va juca cu|vs\.?|contra)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,

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
  }

  /* =========================
   * FOOTBALL – PHASE A (VS)
   * ========================= */
  if (sport === "football") {
    const vsRegexes = [
      // Aston Villa U21 vs Ipswich Town U21
      /([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+)\s+(?:vs\.?|-\s?|va juca cu)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+)/,

      // Manchester City si Wolves
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

    /* =========================
     * FOOTBALL – PHASE B (contextual)
     * ex: "Echipele pe care voi miza sunt: Aston Villa U21 si Ipswich Town U21"
     * ========================= */
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
  }

  /* =========================
   * NOT FOUND
   * ========================= */
  return null;
}
