import https from "https";

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, res => {
        let data = "";
        res.on("data", c => (data += c));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

const STOP_WORDS = [
  "Pontul", "Zilei", "Biletul", "Fotbal", "Tenis",
  "Cota", "Ban", "Ion", "Dan", "Propus", "de"
];

function extractEntities(text) {
  const candidates = text.match(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g
  ) || [];

  return [...new Set(
    candidates.filter(e =>
      e.split(" ").length <= 3 &&
      !STOP_WORDS.some(w => e.includes(w))
    )
  )];
}

export async function flashscoreMapMatch({ sport, rawText, log = console }) {
  const entities = extractEntities(rawText);

  if (entities.length < 2) {
    log.info?.("[MATCH] no usable entities found");
    return null;
  }

  // încercăm combinații de 2 entități
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const query = `${entities[i]} ${entities[j]}`;
      const url = `https://www.flashscore.com/search/?q=${encodeURIComponent(query)}`;

      log.info?.(`[MATCH][flashscore] search: ${query}`);

      try {
        const html = await fetch(url);
        const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/s);
        if (!m) continue;

        const state = JSON.parse(m[1]);
        const results = state.search?.results || [];

        const hit = results.find(r =>
          (sport === "football" ? r.sport === "football" : r.sport === "tennis") &&
          r.name?.includes(" - ")
        );

        if (hit) {
          const [home, away] = hit.name.split(" - ");
          const result = {
            home: home.trim(),
            away: away.trim(),
            type: sport === "tennis" ? "players" : "teams",
            source: "flashscore",
            flashscoreUrl: `https://www.flashscore.com${hit.url}`,
          };

          log.info?.(`[MATCH][flashscore HIT] ${home} vs ${away}`);
          log.info?.(`↳ ${result.flashscoreUrl}`);

          return result;
        }
      } catch {
        continue;
      }
    }
  }

  log.info?.("[MATCH] no flashscore match found");
  return null;
}
