// scrape_odds_combo.js — TheOddsAPI only (reliable), per-league calls, team-name matching
import fs from "fs/promises";

const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ODDS_REGION  = process.env.ODDS_REGION || "eu";
const DAY_OFFSET   = Number(process.env.DAY_OFFSET || 0);

// ---------------- Normalizers ----------------
function normName(s = "") {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(fc|cf|afc|sc|u19|u20|u21|w|women|club)\b/g, "")
    .replace(/\b(st\.|st)\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}
function keyPair(home, away) { return `${normName(home)}__${normName(away)}`; }

// ---------------- League mapping ----------------
// Map Flashscore "COUNTRY: League" -> OddsAPI sport_key
function mapCompetitionToOddsKey(comp = "") {
  const c = comp.toUpperCase();

  // quick exacts
  const dict = {
    "ENGLAND: PREMIER LEAGUE": "soccer_epl",
    "SPAIN: LALIGA": "soccer_spain_la_liga",
    "ITALY: SERIE A": "soccer_italy_serie_a",
    "GERMANY: BUNDESLIGA": "soccer_germany_bundesliga",
    "FRANCE: LIGUE 1": "soccer_france_ligue_one",
    "PORTUGAL: LIGA PORTUGAL": "soccer_portugal_primeira_liga",
    "NETHERLANDS: EREDIVISIE": "soccer_netherlands_eredivisie",
    "ROMANIA: SUPERLIGA": "soccer_romania_liga_i",
    "TURKEY: SUPER LIG": "soccer_turkey_super_league",
    "BELGIUM: JUPILER PRO LEAGUE": "soccer_belgium_first_div",
    "SCOTLAND: PREMIERSHIP": "soccer_scotland_premier_league",
    "USA: MLS": "soccer_usa_mls",
    // add as you need…
  };
  if (dict[c]) return dict[c];

  // heuristics (country + top division)
  if (/ENGLAND/i.test(comp) && /PREMIER/i.test(comp)) return "soccer_epl";
  if (/SPAIN/i.test(comp) && /LALIGA/i.test(comp)) return "soccer_spain_la_liga";
  if (/ITALY/i.test(comp) && /SERIE A/i.test(comp)) return "soccer_italy_serie_a";
  if (/ROMANIA/i.test(comp) && /(SUPERLIGA|LIGA I)/i.test(comp)) return "soccer_romania_liga_i";

  return null; // unknown / skip
}

// ---------------- API helpers ----------------
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function fetchLeagueOdds(sportKey) {
  // We want both h2h and totals. The Odds API allows comma-separated markets.
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=${ODDS_REGION}&markets=h2h,totals&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`;
  return await fetchJSON(url);
}

// ---------------- Main ----------------
(async () => {
  if (!ODDS_API_KEY) {
    console.log("No ODDS_API_KEY set. Skipping odds_extra.");
    await fs.writeFile("odds_extra.json", JSON.stringify({}, null, 2), "utf8");
    return;
  }

  const matches = JSON.parse(await fs.readFile("matches.json", "utf8"));
  // Group matches by competition -> sportKey
  const grouped = new Map(); // sportKey -> array of matches
  for (const m of matches) {
    const sportKey = mapCompetitionToOddsKey(m.competition || "");
    if (!sportKey) continue;
    if (!grouped.has(sportKey)) grouped.set(sportKey, []);
    grouped.get(sportKey).push(m);
  }

  const result = {}; // id -> { markets, sources, teams, date }

  for (const [sportKey, ms] of grouped.entries()) {
    try {
      const data = await fetchLeagueOdds(sportKey);
      // index by team-pair key
      const idx = new Map();
      for (const g of data || []) {
        const k = keyPair(g.home_team || "", g.away_team || "");
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(g);
      }

      for (const m of ms) {
        const [home, away] = String(m.teams||"").split(" - ").map(s=>s.trim());
        const k = keyPair(home, away);
        const games = idx.get(k) || [];

        let o1=null, ox=null, o2=null, oOver=null, oUnder=null, srcH2H=null, srcTot=null;

        for (const g of games) {
          for (const bk of g.bookmakers || []) {
            for (const market of bk.markets || []) {
              if (market.key === "h2h") {
                // 2-way or 3-way depending on league; name can be "Draw"
                const mm = {};
                for (const o of market.outcomes || []) {
                  const n = normName(o.name || "");
                  if (n === normName(home)) mm["1"] = Number(o.price);
                  else if (n === normName(away)) mm["2"] = Number(o.price);
                  else if (n === "draw") mm["X"] = Number(o.price);
                }
                // prefer first complete we find
                if ((mm["1"] && mm["2"]) && (o1===null || o2===null)) {
                  o1 = mm["1"] ?? o1;
                  o2 = mm["2"] ?? o2;
                  if (mm["X"]) ox = mm["X"];
                  srcH2H = `oddsapi:${bk.key}`;
                }
              }
              if (market.key === "totals") {
                for (const o of market.outcomes || []) {
                  if (Number(o.point) === 2.5) {
                    if (o.name === "Over")  { oOver  = Number(o.price); srcTot = `oddsapi:${bk.key}`; }
                    if (o.name === "Under") { oUnder = Number(o.price); srcTot = `oddsapi:${bk.key}`; }
                  }
                }
              }
            }
          }
        }

        const markets = {};
        const sources = {};
        if (o1) { markets["1"] = o1; sources["1"] = srcH2H; }
        if (ox){ markets["X"] = ox; sources["X"] = srcH2H; }
        if (o2) { markets["2"] = o2; sources["2"] = srcH2H; }
        if (oOver){ markets["O2.5"] = oOver; sources["O2.5"] = srcTot; }
        if (oUnder){ markets["U2.5"] = oUnder; sources["U2.5"] = srcTot; }

        if (Object.keys(markets).length) {
          result[m.id] = {
            markets,
            sources,
            teams: m.teams,
            competition: m.competition || "",
            date: new Date(Date.now() + DAY_OFFSET*86400000).toISOString().slice(0,10),
          };
        }
      }
    } catch (e) {
      console.log(`⚠ ${sportKey} fetch error: ${e.message}`);
    }
  }

  await fs.writeFile("odds_extra.json", JSON.stringify(result, null, 2), "utf8");
  console.log(`✔ odds_extra.json written with ${Object.keys(result).length} matches (via TheOddsAPI)`);
})();
