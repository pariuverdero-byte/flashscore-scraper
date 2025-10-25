// scrape_odds_combo.js — robust to new matches.json shape; safe when no API key
import fs from "fs/promises";
import fetch from "node-fetch";

const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ODDS_REGION  = process.env.ODDS_REGION  || "eu";

// --- helpers ---
async function readJson(path, fallback = null) {
  try {
    const txt = await fs.readFile(path, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

function getMatchesArray(mjx) {
  // mjx can be { day, matches:[...] } OR [...] (legacy)
  if (!mjx) return [];
  if (Array.isArray(mjx)) return mjx;
  if (Array.isArray(mjx.matches)) return mjx.matches;
  return [];
}

function splitTeams(s = "") {
  const [home, away] = String(s).split(" - ").map(t => t?.trim()).filter(Boolean);
  return { home, away };
}

// Optional: map country/league to sport key for The Odds API
// For now, we only try "soccer" and bail gracefully.
function sportKeyFor(m) {
  return "soccer";
}

// --- main ---
(async () => {
  // 1) Load matches
  const matchesJson = await readJson("matches.json", null);
  const matches = getMatchesArray(matchesJson);

  if (!matches.length) {
    await fs.writeFile("odds_extra.json", JSON.stringify({ events: [], info: "no matches" }, null, 2));
    console.log("[odds-combo] No matches found; wrote empty odds_extra.json");
    return;
  }

  // 2) If no API key, write stub and exit OK (so workflow doesn't fail)
  if (!ODDS_API_KEY) {
    await fs.writeFile(
      "odds_extra.json",
      JSON.stringify({ events: [], info: "ODDS_API_KEY not set; skipping API fetch." }, null, 2)
    );
    console.log("[odds-combo] ODDS_API_KEY missing; wrote stub odds_extra.json");
    return;
  }

  const out = [];
  let calls = 0;

  // 3) Group matches by sport key to reduce API calls later if you expand logic
  // For now, we fetch per match (kept simple & rate-friendly with try/catch).
  for (const m of matches) {
    const { home, away } = splitTeams(m.teams || "");
    if (!home || !away) continue;

    const sportKey = sportKeyFor(m);        // "soccer"
    // The Odds API typical endpoint (no team filter server-side; we’ll filter client-side):
    // https://api.the-odds-api.com/v4/sports/soccer/odds?regions=eu&markets=h2h,totals
    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(
      sportKey
    )}/odds?regions=${encodeURIComponent(ODDS_REGION)}&markets=h2h,totals&oddsFormat=decimal&apiKey=${encodeURIComponent(
      ODDS_API_KEY
    )}`;

    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      calls++;
      if (!r.ok) {
        console.warn(`[odds-combo] HTTP ${r.status} for ${url}`);
        continue;
      }
      const arr = await r.json();
      if (!Array.isArray(arr) || !arr.length) continue;

      // naive filter on team names (string contains, case-insensitive)
      const homeUp = home.toUpperCase();
      const awayUp = away.toUpperCase();
      const candidates = arr.filter(ev => {
        const h = (ev.home_team || "").toUpperCase();
        const a = (ev.away_team || "").toUpperCase();
        return (h.includes(homeUp) && a.includes(awayUp)) || (h.includes(awayUp) && a.includes(homeUp));
      });

      for (const ev of candidates) {
        // Flatten markets we care about: h2h (1X2-ish), totals (Over/Under).
        // The Odds API returns bookmakers -> markets -> outcomes.
        // We pick the best available across bookmakers (max decimal).
        const markets = {};
        for (const bk of ev.bookmakers || []) {
          for (const mk of bk.markets || []) {
            if (!mk.key) continue;
            if (!markets[mk.key]) markets[mk.key] = [];
            markets[mk.key].push(...(mk.outcomes || []));
          }
        }

        // Build extra selections (example: Over/Under total goals)
        // Map totals to standard labels like O2.5 / U2.5 when possible.
        const extras = [];

        // H2H -> convert to 1 / 2 (no "X" on most books)
        if (Array.isArray(markets.h2h) && markets.h2h.length) {
          let maxHome = null, maxAway = null;
          for (const oc of markets.h2h) {
            if (!oc || typeof oc.price !== "number") continue;
            if (oc.name?.toUpperCase().includes(homeUp)) {
              if (!maxHome || oc.price > maxHome) maxHome = oc.price;
            } else if (oc.name?.toUpperCase().includes(awayUp)) {
              if (!maxAway || oc.price > maxAway) maxAway = oc.price;
            }
          }
          if (maxHome) extras.push({ id: m.id, teams: m.teams, market: "1", odd: maxHome, url: m.url, sport: m.sport || "football", competition: m.competition || "", country: m.country || "", time: m.time || "", status: m.status || "" });
          if (maxAway) extras.push({ id: m.id, teams: m.teams, market: "2", odd: maxAway, url: m.url, sport: m.sport || "football", competition: m.competition || "", country: m.country || "", time: m.time || "", status: m.status || "" });
        }

        // Totals -> build Over/Under selections for common lines (2.5)
        if (Array.isArray(markets.totals) && markets.totals.length) {
          // Pick best Over 2.5 and best Under 2.5 (if present)
          let bestO = null, bestU = null;
          for (const oc of markets.totals) {
            const price = typeof oc.price === "number" ? oc.price : null;
            const point = typeof oc.point === "number" ? oc.point : Number(oc.point);
            const nm = (oc.name || "").toUpperCase();
            if (!price || !point) continue;
            if (Math.abs(point - 2.5) < 1e-9) {
              if (nm.includes("OVER"))  bestO = Math.max(bestO || 0, price);
              if (nm.includes("UNDER")) bestU = Math.max(bestU || 0, price);
            }
          }
          if (bestO) extras.push({ id: m.id, teams: m.teams, market: "O2.5", odd: bestO, url: m.url, sport: m.sport || "football", competition: m.competition || "", country: m.country || "", time: m.time || "", status: m.status || "" });
          if (bestU) extras.push({ id: m.id, teams: m.teams, market: "U2.5", odd: bestU, url: m.url, sport: m.sport || "football", competition: m.competition || "", country: m.country || "", time: m.time || "", status: m.status || "" });
        }

        out.push(...extras);
      }
    } catch (e) {
      console.warn(`[odds-combo] fetch failed for ${m.teams}: ${e.message}`);
      continue;
    }
  }

  await fs.writeFile("odds_extra.json", JSON.stringify({ events: out, calls }, null, 2), "utf8");
  console.log(`[odds-combo] Wrote odds_extra.json with ${out.length} selections (API calls: ${calls})`);
})();
