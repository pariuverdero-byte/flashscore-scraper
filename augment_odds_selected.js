// augment_odds_selected.js
// Enrich tickets (already selected) with extra markets from BetExplorer per-match.
// Output: odds_extra.json { [flashscoreId]: { dc: { '1X':n, 'X2':n, '12':n }, ou25: { over:n, under:n } } }

import fs from "fs/promises";
import * as cheerio from "cheerio";

const UA = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
];

const H = () => ({
  "User-Agent": UA[Math.floor(Math.random() * UA.length)],
  "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: "https://www.betexplorer.com/",
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function norm(s="") {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/&amp;/g," ")
    .replace(/[^a-z0-9 ]+/g," ")
    .replace(/\b(fc|cf|afc|sc|club|u19|u20|u21|w|women|the|de|da|do|la|el|los|las)\b/g," ")
    .replace(/\b(st\.|st)\b/g, "saint")
    .replace(/\s+/g," ").trim();
}
function sameTeam(a,b){ const A=norm(a), B=norm(b); if (!A||!B) return false; return A===B || (A.length>3&&B.includes(A)) || (B.length>3&&A.includes(B)); }
function samePair(h1,a1,h2,a2){ return (sameTeam(h1,h2)&&sameTeam(a1,a2)) || (sameTeam(h1,a2)&&sameTeam(a1,h2)); }

async function fetchWithRetry(url, tries=5){
  let last;
  for (let i=0;i<tries;i++){
    try{
      const bust = (url.includes("?")?"&":"?")+"rnd="+Date.now();
      const r = await fetch(url + bust, { headers: H() });
      if (r.status===429 || (r.status>=500&&r.status<600)) { last=new Error("HTTP "+r.status); await sleep(800*(i+1)+Math.random()*300); continue; }
      if (!r.ok) throw new Error("HTTP "+r.status);
      return await r.text();
    }catch(e){ last=e; await sleep(600*(i+1)); }
  }
  throw last||new Error("fetch fail");
}

// 1) Caută pagina de meci pe BetExplorer
async function findBetexplorerMatchUrl(home, away){
  const q = encodeURIComponent(`${home} ${away}`);
  const html = await fetchWithRetry(`https://www.betexplorer.com/search/?q=${q}`);
  const $ = cheerio.load(html);
  let url = "";

  $('a[href*="/match/"]').each((_,a)=>{
    if (url) return;
    const href = $(a).attr("href")||"";
    const full = new URL(href, "https://www.betexplorer.com").toString();
    // În listă apare și textul "Home - Away"
    const txt = $(a).text().trim();
    const m = txt.includes(" - ") ? txt.split(" - ").map(s=>s.trim()) : null;
    if (m && m.length===2 && samePair(home, away, m[0], m[1])) url = full;
  });
  return url || null;
}

// 2) Citește DC & O/U 2.5 din pagina meciului
function pickFirstDecimal(t){
  const m = String(t||"").match(/\d+(?:[.,]\d+)?/g);
  if (!m || !m.length) return null;
  return parseFloat(m[0].replace(",","."))||null;
}

async function parseMatchMarkets(beUrl){
  const html = await fetchWithRetry(beUrl);
  const $ = cheerio.load(html);

  const out = { dc: {}, ou25: {} };

  // Double chance (tab sau secțiune cu “Double chance”)
  $('table, section, div').each((_,el)=>{
    const block = $(el);
    const head = block.find('th, h3, h4').first().text().toLowerCase();
    if (/double\s*chance/.test(head) || /double/.test(head) && /chance/.test(head)){
      // caută texte gen "1X", "X2", "12" + cote
      block.find("tr").each((__,tr)=>{
        const rowText = $(tr).text().toLowerCase();
        const odds = $(tr).find("td, span, a").map((i,td)=>$(td).text().trim()).get();
        const price = pickFirstDecimal(odds.join(" ")) || null;
        if (!price) return;
        if (/\b1x\b/.test(rowText)) out.dc["1X"] = price;
        if (/\bx2\b/.test(rowText)) out.dc["X2"] = price;
        if (/\b12\b/.test(rowText)) out.dc["12"] = price;
      });
    }
  });

  // Over/Under 2.5 (căutăm bloc cu “Over/Under” sau “Totals”)
  $('table, section, div').each((_,el)=>{
    const block = $(el);
    const head = block.find('th, h3, h4').first().text().toLowerCase();
    if (/over\/?under|totals?/.test(head)){
      block.find("tr").each((__,tr)=>{
        const t = $(tr).text().toLowerCase();
        // liniile pot apărea ca "2.5" / "O 2.5" / "U 2.5"
        if (/2\.5/.test(t)){
          const cells = $(tr).find("td, span, a").map((i,td)=>$(td).text().trim()).get().join(" ");
          // încercăm să deducem care e over și care e under
          if (/over/.test(t) || /\bO\b/.test(t)) out.ou25.over = pickFirstDecimal(cells) || out.ou25.over;
          if (/under/.test(t) || /\bU\b/.test(t)) out.ou25.under = pickFirstDecimal(cells) || out.ou25.under;
          // fallback: dacă nu apar O/U în text, luăm primele două cote din rând
          if (!out.ou25.over || !out.ou25.under){
            const all = (cells.match(/\d+(?:[.,]\d+)?/g)||[]).map(x=>parseFloat(x.replace(",",".")));
            if (all.length>=2){ out.ou25.over = out.ou25.over||all[0]; out.ou25.under = out.ou25.under||all[1]; }
          }
        }
      });
    }
  });

  return out;
}

async function main(){
  const raw = await fs.readFile("tickets.json","utf8").catch(()=>null);
  if (!raw){ console.log("No tickets.json, nothing to augment."); return; }
  const t = JSON.parse(raw);

  // adunăm TOATE meciurile unice din ambele bilete
  const sels = [];
  for (const key of ["bilet_cota2","biletul_zilei"]){
    const arr = t?.[key]?.selections || [];
    for (const s of arr){
      if (!sels.find(x=>x.id===s.id)) sels.push(s);
    }
  }
  if (!sels.length){ console.log("No selections to augment."); return; }

  const result = {};
  for (const s of sels){
    try{
      const [home, away] = String(s.teams||"").split(" - ").map(z=>z.trim());
      if (!home || !away) continue;

      const url = await findBetexplorerMatchUrl(home, away);
      if (!url){ console.log("BE not found for:", s.teams); continue; }

      // mic delay între request-uri ca să nu irităm rate-limit
      await sleep(700 + Math.random()*400);

      const markets = await parseMatchMarkets(url);
      if (Object.keys(markets.dc).length || Object.keys(markets.ou25).length){
        result[s.id] = markets;
        console.log("OK:", s.teams, markets);
      } else {
        console.log("No extra markets found:", s.teams);
      }
    }catch(e){
      console.log("skip", s.teams, "=>", e.message);
    }
  }

  await fs.writeFile("odds_extra.json", JSON.stringify(result, null, 2), "utf8");
  console.log("Wrote odds_extra.json for", Object.keys(result).length, "matches");
}

main().catch(e=>{ console.log("augment fatal:", e.message); process.exit(0); });
