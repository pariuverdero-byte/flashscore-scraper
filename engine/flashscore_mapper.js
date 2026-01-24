import https from "https";

/**
 * Very light Flashscore search mapper
 * Uses public search endpoint (no auth)
 */

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

function scoreMatch(a, b) {
  if (!a || !b) return 0;
  let score = 0;
  for (const w of a.split(" ")) {
    if (b.includes(w)) score++;
  }
  return score;
}

export async function flashscoreMapMatch({ sport, rawText }) {
  // Extragem candidate words
  const words = rawText
    .split(/\s+/)
    .filter((w) => w.length > 3 && /^[A-Z]/.test(w))
    .slice(0, 5);

  if (words.length === 0) return null;

  const query = words.join(" ");
  const url = `https://www.flashscore.com/search/?q=${encodeURIComponent(
    query
  )}`;

  try {
    const html = await fetch(url);

    // ⚠️ Flashscore search response conține JSON inline
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*\});/);
    if (!jsonMatch) return null;

    const state = JSON.parse(jsonMatch[1]);

    const results = state.search?.results || [];
    if (!Array.isArray(results)) return null;

    let best = null;
    let bestScore = 0;

    for (const r of results) {
      if (sport === "football" && r.sport !== "football") continue;
      if (sport === "tennis" && r.sport !== "tennis") continue;

      const name = normalize(r.name);
      const score = scoreMatch(normalize(rawText), name);

      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }

    if (!best || !best.name) return null;

    // Parse "Team A - Team B"
    const parts = best.name.split(" - ");
    if (parts.length !== 2) return null;

    return {
      home: parts[0].trim(),
      away: parts[1].trim(),
      type: sport === "tennis" ? "players" : "teams",
      source: "flashscore",
    };
  } catch {
    return null;
  }
}
