/**
 * Extract match / players from raw text
 * Supports:
 *  - Football: Team A vs Team B
 *  - Tennis: Player A vs Player B
 */
export function extractMatch({ sport, title, rawText }) {
  const text = `${title} ${rawText}`;

  // --------------------
  // TENNIS
  // --------------------
  if (sport === "tennis") {
    // ex: "Daniil Medvedev il va intalni pe Learner Tien"
    const tennisRegexes = [
      /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\s+(vs\.?|contra|il va intalni pe)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i,
      /([A-Z][a-zA-Z]+)\s+vs\.?\s+([A-Z][a-zA-Z]+)/i,
    ];

    for (const r of tennisRegexes) {
      const m = text.match(r);
      if (m) {
        return {
          home: m[1].trim(),
          away: m[2].trim(),
          type: "players",
        };
      }
    }
  }

  // --------------------
  // FOOTBALL
  // --------------------
  if (sport === "football") {
    const footballRegexes = [
      // Aston Villa U21 vs Ipswich Town U21
      /([A-Z][a-zA-Z0-9\s]+)\s+(vs\.?|-\s?)\s+([A-Z][a-zA-Z0-9\s]+)/i,

      // Manchester City si Wolves
      /([A-Z][a-zA-Z\s]+)\s+(si|și)\s+([A-Z][a-zA-Z\s]+)/i,
    ];

    for (const r of footballRegexes) {
      const m = text.match(r);
      if (m) {
        return {
          home: m[1].trim(),
          away: m[3].trim(),
          type: "teams",
        };
      }
    }
  }

  // --------------------
  // NOT FOUND
  // --------------------
  return null;
}
