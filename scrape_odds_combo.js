// scrape_odds_combo.js — DIAGNOSTICS + tolerant matching + helpful logs
import fs from "fs/promises";

const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ODDS_REGION  = process.env.ODDS_REGION || "eu";
const DAY_OFFSET   = Number(process.env.DAY_OFFSET || 0);

// ---------- Helpers ----------
function normName(s = "") {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(fc|cf|afc|sc|u19|u20|u21|w|women|club|de|da|do|la|el|los|las|the)\b/g, " ")
    .replace(/\b(st\.|st)\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}
function keyPair(home, away) { return `${normName(home)}__${normName(away)}`; }

function cleanComp(s=""){
  return s.replace(/\s*Standings.*$/i,"")
          .replace(/\s*Table.*$/i,"")
          .replace(/\s*Classification.*$/i,"")
          .replace(/\s*\|.*$/,"")
          .trim();
}

// Flashscore competition -> Odds API sport_key
function mapCompetitionToOddsKey(compRaw = "") {
  const comp = cleanComp(compRaw).toUpperCase();
  const dict = {
    "ENGLAND: PREMIER LEAGUE": "soccer_epl",
    "SPAIN: LALIGA": "soccer_spain_la_liga",
    "ITALY: SERIE A": "soccer_italy_serie_a",
    "GERMANY: BUNDESLIGA": "soccer_germany_bundesliga",
    "FRANCE: LIGUE 1": "soccer_france_ligue_one",
    "PORTUGAL: LIGA PORTUGAL": "soccer_portugal_primeira_liga",
    "NETHERLANDS: EREDIVISIE": "soccer_netherlands_eredivisie",
    "SCOTLAND: PREMIERSHIP": "soccer_scotland_premier_league",
    "BELGIUM: JUPILER PRO LEAGUE": "soccer_belgium_first_div",
    "TURKEY: SUPER LIG": "soccer_turkey_super_league",
    "ROMANIA: SUPERLIGA": "soccer_romania_liga_i",
    "USA: MLS": "soccer_usa_mls",
  };
  if (dict[comp]) return dict[comp];

  // Fuzzy heuristics
  if (/ENGLAND/.test(comp) && /PREMIER/.test(comp)) return "soccer_epl";
  if (/SPAIN/.test(comp) && /LALIGA/.test(comp))   return "soccer_spain_la_liga";
  if (/ITALY/.test(comp) && /SERIE A/.test(comp))   return "soccer_italy_serie_a";
  if (/GERMANY/.test(comp) && /BUNDES/.test(comp))  return "soccer_germany_bundesliga";
  if (/FRANCE/.test(comp) && /LIGUE 1/.test(comp))  return "soccer_france_ligue_one";
  if (/ROMANIA/.test(comp) && /(SUPERLIGA|LIGA I)/.test(comp)) return "soccer_romania_liga_i";
  return null;
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return await r.json();
}
async function fetchLeagueOdds(sportKey) {
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=${ODDS_REGION}&markets=h2h,totals&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`;
  return await fetchJSON(url);
}

// soft contains match: "man utd" in "manchester united"
function softMatch(a,b){ 
  const A = normName(a), B = normName(b);
  return A.length>3 && B.includes(A) || B.length>3 && A.includes(B);
}

// Try multiple strategies to match a Flashscore pair to an API game record
function matchGameIdx(idxMap, home, away) {
  const direct = idxMap.get(keyPair(home, away));
  if (direct) return direct;

  // Try swapped (bookmakers sometimes list reversed)
  const swapped = idxMap.get(keyPair(away, home));
  if (swapped) return swapped;

  // Soft scan
  for (const [k, arr] of idxMap.entries()) {
    const [h,a] = k.split("__");
    if ((softMatch(home,h) && softMatch(away,a)) || (softMatch(home,a) && softMatch(away,h))) {
      return arr;
    }
  }
  return null;
}

(async () => {
  const debug = { summary:{}, unmappedCompetitions:[], perLeague:{} };

  if (!ODDS_API_KEY) {
    console.log("No ODDS_API_KEY set. Skipping odds_extra.");
    await fs.writeFile("odds_extra.json", JSON.stringify({}, null, 2), "utf8");
    await fs.writeFile("odds_debug.json", JSON.stringify({error:"ODDS_API_KEY missing"}, null, 2), "utf8");
    return;
  }

  const matches = JSON.parse(await fs.readFile("matches.json", "utf8"));
  debug.summary.flashscoreMatches = matches.length;

  // Group by sportKey + track unmapped
  const grouped = new Map();
  const unmappedSet = new Set();

  for (const m of matches) {
    const sk = mapCompetitionToOddsKey(m.competition || "");
    if (!sk) { unmappedSet.add(cleanComp(m.competition||"")); continue; }
    if (!grouped.has(sk)) grouped.set(sk, []);
    grouped.get(sk).push(m);
  }
  debug.unmappedCompetitions = Array.from(unmappedSet).filter(Boolean).sort();
  debug.summary.mappedCompetitions = grouped.size;

  const result = {};

  for (const [sportKey, ms] of grouped.entries()) {
    const leagueDbg = { sportKey, flashscoreMatches: ms.length, apiGames:0, matchedPairs:0, unmatchedExamples:[] };
    try {
      const data = await fetchLeagueOdds(sportKey);
      leagueDbg.apiGames = (data||[]).length;

      // Build index by normalized pair
      const idx = new Map();
      for (const g of data || []) {
        const k = keyPair(g.home_team || "", g.away_team || "");
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(g);
      }

      for (const m of ms) {
        const [home, away] = String(m.teams||"").split(" - ").map(s=>s.trim());
        const games = matchGameIdx(idx, home, away);

        if (!games) {
          if (leagueDbg.unmatchedExamples.length < 10) {
            leagueDbg.unmatchedExamples.push({teams:m.teams, comp:cleanComp(m.competition||"")});
          }
          continue;
        }

        let o1=null, ox=null, o2=null, oOver=null, oUnder=null, srcH2H=null, srcTot=null;

        for (const g of games) {
          for (const bk of g.bookmakers || []) {
            for (const market of bk.markets || []) {
              if (market.key === "h2h") {
                const mm = {};
                for (const o of market.outcomes || []) {
                  const n = normName(o.name || "");
                  if (n === normName(home)) mm["1"] = Number(o.price);
                  else if (n === normName(away)) mm["2"] = Number(o.price);
                  else if (n === "draw") mm["X"] = Number(o.price);
                }
                if ((mm["1"] && mm["2"]) && (o1===null || o2===null)) {
                  o1 = mm["1"]; o2 = mm["2"]; if (mm["X"]) ox = mm["X"];
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
          leagueDbg.matchedPairs++;
          result[m.id] = {
            markets, sources,
            teams: m.teams,
            competition: cleanComp(m.competition||""),
            date: new Date(Date.now() + DAY_OFFSET*86400000).toISOString().slice(0,10),
          };
        } else if (leagueDbg.unmatchedExamples.length < 10) {
          leagueDbg.unmatchedExamples.push({teams:m.teams, note:"pair matched, but markets missing"});
        }
      }
    } catch (e) {
      leagueDbg.error = e.message;
    }
    debug.perLeague[sportKey] = leagueDbg;
  }

  await fs.writeFile("odds_extra.json", JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile("odds_debug.json", JSON.stringify(debug, null, 2), "utf8");

  console.log(`✔ odds_extra.json: ${Object.keys(result).length} matched matches`);
  console.log(`ℹ Unmapped competitions: ${debug.unmappedCompetitions.length}`);
  if (debug.unmappedCompetitions.length) {
    console.log(debug.unmappedCompetitions.slice(0,15).map(s=>` - ${s}`).join("\n"));
  }
})();
