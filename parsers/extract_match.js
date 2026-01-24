/**
 * Robust match / players extractor
 * Avoids editorial titles and false positives
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
];

function looksLikeName(str) {
  if (!str) return false;

  const s = str.toLowerCase();

  // minim 2 cuvinte
  if (str.trim().split(/\s+/).length < 2) return false;

  // nu contine stop words editoriale
  for (const w of STOP_WORDS) {
    if (s.includes(w)) return false;
  }

  // trebuie sa contina litere mari (nume proprii)
  return /[A-Z]/.test(str);
}

export function extractMatch({ sport, title, rawText }) {
  const text = `${title}. ${rawText}`;

  /* ======================
   * TENNIS
   * ====================== */
  if (sport === "tennis") {
    const tennisRegexes = [
      // Daniil Medvedev il va intalni pe Learner Tien
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:il va intalni pe|va juca cu|vs\.?|contra)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,

      // Medvedev vs Tien
      /([A-Z][a-z]+)\s+vs\.?\s+([A-Z][a-z]+)/,
    ];

    for (const r of tennisRegexes) {
      const m = text.match(r);
      if (m && looksLikeName(m[1]) && looksLikeName(m[2])) {
        return {
          home: m[1].trim(),
          away: m[2].trim(),
          type: "players",
        };
      }
    }
  }

  /* ======================
   * FOOTBALL
   * ====================== */
  if (sport === "football") {
    const footballRegexes = [
      // Aston Villa U21 vs Ipswich Town U21
      /([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+)\s+(?:vs\.?|-\s?|va juca cu)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+)/,

      // Manchester City si Wolves
      /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s+(?:si|și)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)/,
    ];

    for (const r of footballRegexes) {
      const m = text.match(r);
      if (m && looksLikeName(m[1]) && looksLikeName(m[2])) {
        return {
          home: m[1].trim(),
          away: m[2].trim(),
          type: "teams",
        };
      }
    }
  }

  return null;
}
