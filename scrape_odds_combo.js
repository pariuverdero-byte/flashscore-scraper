// scrape_odds_combo.js
// Combo: OddsPortal (football) + BetExplorer (tennis/basket) + TheOddsAPI fallback for O/U
// Output: odds_extra.json  =>  { [flashscoreId]: { markets: {...}, sources: {...} } }

import fs from "fs/promises";
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const SLEEP = (ms)=>new Promise(r=>setTimeout(r,ms));

const ODDSAPI_KEY   = process.env.ODDS_API_KEY || "";   // from the-odds-api.com (optional)
const ODDSAPI_REG   = process.env.ODDS_REGION  || "eu";
const DAY_OFFSET    = Number(process.env.DAY_OFFSET || 0); // align with your Flashscore scrape

function norm(s=""){ return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim(); }
function teamPairKey(home, away){ return `${norm(home)}__${norm(away)}`; }
function asDateISO(d){ return new Date(d).toISOString().slice(0,10); }
function todayISO(offset=0){ return asDateISO(Date.now()+offset*86400000); }

function deVig3(odd1, oddx, odd2){
  const p1=1/odd1, px=1/oddx, p2=1/odd2; const s=p1+px+p2;
  const f1=p1/s, fx=px/s, f2=p2/s;
  const inv=(p)=>p>0?Number((1/p).toFixed(2)):null;
  return { "1X": inv(f1+fx), "X2": inv(fx+f2), "12": inv(f1+f2) };
}

async function fetchText(url, headers={}){
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language":"en;q=0.9,ro;q=0.8", Referer: "https://google.com", ...headers }});
  if(!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.text();
}

// --------- OddsPortal (football) simple list parser (1X2) ----------
async function scrapeOddsPortalFootballList(listUrl){
  const html = await fetchText(listUrl);
  const $ = cheerio.load(html);
  const out = [];
  // Generic rows (OddsPortal changes often; this selector is intentionally broad)
  $("table,div").find("tr,div.eventRow").each((_,row)=>{
    const r = $(row);
    const nameCell = r.find("td.name a, a.name, a[href*='/soccer/']");
    const oddsCells = r.find("td.odds-nowrp");
    if(!nameCell.length || oddsCells.length < 3) return;
    const teams = nameCell.text().trim();
    if(!teams.includes(" - ")) return;
    const [home, away] = teams.split(" - ").map(s=>s.trim());
    const o1 = Number((oddsCells.eq(0).text()||"").replace(",","."));
    const ox = Number((oddsCells.eq(1).text()||"").replace(",","."));
    const o2 = Number((oddsCells.eq(2).text()||"").replace(",","."));
    if(o1&&ox&&o2) out.push({ home, away, markets: { "1":o1, "X":ox, "2":o2 }, src:"oddsportal" });
  });
  return out;
}

// --------- BetExplorer (tennis/basket) list parser (1X2-like) ----------
async function scrapeBetExplorerList(listUrl){
  const html = await fetchText(listUrl);
  const $ = cheerio.load(html);
  const out = [];
  $(".list-events__item, .ul-list, table").each((_,blk)=>{
    const b = $(blk);
    b.find("tr, .list-events__item__event").each((__,row)=>{
      const r=$(row);
      const nm = r.find("a").first().text().trim();
      if(!nm || !nm.includes(" - ")) return;
      const [home, away] = nm.split(" - ").map(s=>s.trim());
      // odds often as text in cells with data-odd or inner text
      const cells = r.find("[data-odd], .list-events__odds, td.kx");
      const vals = cells.map((i,el)=>$(el).attr("data-odd")||$(el).text()).get()
        .map(s=>Number(String(s).replace(",",".").trim())).filter(n=>n>1);
      if(vals.length>=2){
        // Tennis is typically 2-way (home/away). Map to 1/2; X absent.
        const m = { "1": vals[0], "2": vals[1] };
        out.push({ home, away, markets:m, src:"betexplorer" });
      }
    });
  });
  return out;
}

// --------- TheOddsAPI fallback for totals (Over/Under 2.5) ----------
async function fetchTotalsOdds(home, away){
  if(!ODDSAPI_KEY) return { over25:null, under25:null, src:null };
  try{
    const sport = "soccer"; // generic; their taxonomy also has league-specific endpoints
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?regions=${ODDSAPI_REG}&markets=totals&oddsFormat=decimal&apiKey=${ODDSAPI_KEY}`;
    const j = await fetch(url).then(r=>r.json());
    const H = norm(home), A = norm(away);
    for(const g of j||[]){
      if(norm(g.home_team)===H && norm(g.away_team)===A){
        for(const bk of g.bookmakers||[]){
          for(const m of bk.markets||[]){
            if(m.key!=="totals") continue;
            let over=null, under=null;
            for(const o of m.outcomes||[]){
              if(Number(o.point)===2.5){
                if(o.name==="Over")  over = Number(o.price);
                if(o.name==="Under") under = Number(o.price);
              }
            }
            if(over||under) return { over25: over||null, under25: under||null, src:`oddsapi:${bk.key}` };
          }
        }
      }
    }
    return { over25:null, under25:null, src:null };
  }catch(e){
    return { over25:null, under25:null, src:null };
  }
}

// --------- Main driver: enrich matches.json ---------
(async()=>{
  const raw = await fs.readFile("matches.json","utf8").catch(()=>null);
  if(!raw){ console.error("No matches.json"); process.exit(0); }
  const matches = JSON.parse(raw); // [{id, teams, url, time?, sport? (optional)}]

  // Preload sources lists (lightweight pages)
  const dateStr = todayISO(DAY_OFFSET);

  // Football from OddsPortal (pick a broad list; you can target leagues you care about)
  let footballList = [];
  try{
    footballList = await scrapeOddsPortalFootballList("https://www.oddsportal.com/matches/soccer/");
    await SLEEP(800);
  }catch(e){ console.log("⚠ OddsPortal fetch issue:", e.message); }

  // Tennis & Basketball from BetExplorer
  let tennisList = [], basketList = [];
  try{ tennisList = await scrapeBetExplorerList("https://www.betexplorer.com/next/tennis/"); await SLEEP(600);}catch{}
  try{ basketList = await scrapeBetExplorerList("https://www.betexplorer.com/next/basketball/"); await SLEEP(600);}catch{}

  // Index by team pair
  const idx = new Map();
  for(const it of footballList){ idx.set(teamPairKey(it.home,it.away), it); }
  for(const it of tennisList){ idx.set(teamPairKey(it.home,it.away), it); }
  for(const it of basketList){ idx.set(teamPairKey(it.home,it.away), it); }

  const out = {}; // flashscoreId => { markets:{}, sources:{} }

  for(const m of matches){
    const pair = (m.teams||"").split(" - ");
    if(pair.length<2) continue;
    const [home, away] = pair.map(s=>s.trim());
    const key = teamPairKey(home, away);

    const hit = idx.get(key);
    const markets = {};
    const sources = {};

    // 1X2 / 2-way
    if(hit?.markets?.["1"] && hit?.markets?.["2"]){
      if(hit.markets["1"]) markets["1"] = Number(hit.markets["1"]);
      if(hit.markets["X"]) markets["X"] = Number(hit.markets["X"]);
      if(hit.markets["2"]) markets["2"] = Number(hit.markets["2"]);
      sources["1X2"] = hit.src;
    }

    // DC approximated from 1X2
    if(markets["1"] && markets["X"] && markets["2"]){
      const dc = deVig3(markets["1"], markets["X"], markets["2"]);
      markets["1X"] = dc["1X"];
      markets["X2"] = dc["X2"];
      markets["12"] = dc["12"];
      sources["DC"] = "derived-1x2";
    }

    // O/U 2.5 via TheOddsAPI (if football & we didn’t get it elsewhere)
    if(!markets["O2.5"] && !markets["U2.5"]){
      const t = await fetchTotalsOdds(home, away);
      if(t.over25) { markets["O2.5"] = t.over25; sources["O2.5"]=t.src; }
      if(t.under25){ markets["U2.5"] = t.under25; sources["U2.5"]=t.src; }
      await SLEEP(300);
    }

    if(Object.keys(markets).length){
      out[m.id] = { markets, sources, teams: m.teams, date: dateStr };
    }
  }

  await fs.writeFile("odds_extra.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`✔ odds_extra.json written with ${Object.keys(out).length} matches`);
})();
