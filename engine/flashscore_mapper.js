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

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * STEP 1 — Regex intelligence (moved here)
 */
function extractByRegex({ sport, rawText }) {
  // TENIS – narativ
  if (sport === "tennis") {
    const m = rawText.match(
      /([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\s+(?:îl|o)\s+va\s+întâlni\s+pe\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)/i
    );
    if (m) {
      return {
        home: m[1],
        away: m[2],
        type: "players",
        source: "regex_narrative",
      };
    }
  }

  // FOTBAL – inline
  const inline = rawText.match(
    /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*(?:-|vs|întâlnește)\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/
  );

  if (inline) {
    return {
      home: inline[1],
      away: inline[2],
      type: sport === "tennis" ? "players" : "teams",
      source: "regex_inline",
    };
  }

  return null;
}

/**
 * STEP 2 — Flashscore fallback (authoritative)
 */
export async function flashscoreMapMatch({ sport, rawText, log = console }) {
  // 1️⃣ regex first
  const regexMatch = extractByRegex({ sport, rawText });
  if (regexMatch) {
    log.info?.(
      `[MATCH][regex] ${regexMatch.home} vs ${regexMatch.away}`
    );
    return regexMatch;
  }

  // 2️⃣ Flashscore search
  const keywords = rawText
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w) && w.length > 3)
    .slice(0, 6);

  if (keywords.length === 0) return null;

  const query = keywords.join(" ");
  const searchUrl = `https://www.flashscore.com/search/?q=${encodeURIComponent(
    query
  )}`;

  try {
    const html = await fetch(searchUrl);

    const jsonMatch = html.match(
      /window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/s
    );
    if (!jsonMatch) return null;

    const state = JSON.parse(jsonMatch[1]);
    const results = state.search?.results || [];

    let best = null;
    let bestScore = 0;

    for (const r of results) {
      if (sport === "football" && r.sport !== "football") continue;
      if (sport === "tennis" && r.sport !== "tennis") continue;

      const score = normalize(rawText)
        .split(" ")
        .filter((w) => r.name?.toLowerCase().includes(w)).length;

      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }

    if (!best || !best.name || !best.url) return null;

    const parts = best.name.split(" - ");
    if (parts.length !== 2) return null;

    const result = {
      home: parts[0].trim(),
      away: parts[1].trim(),
      type: sport === "tennis" ? "players" : "teams",
      source: "flashscore",
      flashscoreUrl: `https://www.flashscore.com${best.url}`,
    };

    log.info?.(
      `[MATCH][flashscore] ${result.home} vs ${result.away}`
    );
    log.info?.(`↳ ${result.flashscoreUrl}`);

    return result;
  } catch (e) {
    log.warn?.("[MATCH][flashscore] failed", e.message);
    return null;
  }
}
