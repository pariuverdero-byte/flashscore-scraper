// Generator bilete — disjuncte + preferințe pe competiții majore
// - Cota 2: EXACT 2 selecții, produs ∈ [1.90, 2.50]
// - Biletul zilei: EXACT 4 selecții, produs ∈ [4.00, 6.00]
// - Fără suprapunere: aceleași meciuri NU pot apărea pe ambele bilete.

import fs from "fs/promises";

const INPUT = "odds.json";
const RULE_COTA2 = { size: 2, min: 1.90, max: 2.50 };
const RULE_ZI   = { size: 4, min: 4.00, max: 6.00 };

const ODD_MIN = 1.10, ODD_MAX = 25.0;
const EXCLUDE = /(HT|First Half|2nd Half|Asian|Exact|Correct Score)/i;

// competiții „majore” — scor mic = preferat
const COMP_PRIORITY = [
  // fotbal top
  "Premier League", "LaLiga", "Serie A", "Bundesliga", "Ligue 1",
  "Champions League", "Europa League", "Conference League",
  // baschet
  "NBA", "Euroleague", "EuroLeague", "ACB",
  // tenis
  "ATP", "WTA", "Grand Slam", "Australian Open", "Roland Garros", "Wimbledon", "US Open"
];

function competitionScore(c) {
  if (!c) return 5;
  const name = c.toLowerCase();
  for (let i = 0; i < COMP_PRIORITY.length; i++) {
    if (name.includes(COMP_PRIORITY[i].toLowerCase())) return 0 + Math.floor(i/5); // 0.. (grupuri)
  }
  // bonus pentru țări/ligii rezonabil de relevante
  if (/england|spain|italy|germany|france|portugal|netherlands|romania/i.test(name)) return 2;
  return 4;
}

function marketPref(m){
  if (m==="1"||m==="X"||m==="2") return 0;
  if (m==="1X"||m==="12"||m==="X2") return 1;
  if (/^(O|U)\d/.test(m)) return 2;
  if (/^Cards /.test(m)) return 3;
  if (/^Corners /.test(m)) return 4;
  return 5;
}

function product(arr){ return arr.reduce((a,b)=>a*b,1); }
function normalize(e){ return {
  id:String(e.id),
  teams:String(e.teams),
  market:String(e.market),
  odd:Number(e.odd),
  url:String(e.url),
  sport:String(e.sport||"football"),
  competition:String(e.competition||"")
};}
function ok(e){ return isFinite(e.odd) && e.odd>=ODD_MIN && e.odd<=ODD_MAX && !EXCLUDE.test(e.market); }

function dedupeByIdMarket(events){
  const map = new Map();
  for (const e of events){
    const key = `${e.id}|${e.market}|${e.sport}`;
    const prev = map.get(key);
    if (!prev || e.odd > prev.odd) map.set(key, e);
  }
  return [...map.values()];
}

// Sortare „deșteaptă”: competiție bună -> piață „safe” -> odd apropiat de 1.7 -> odd descrescător
function smartSort(events){
  return events.slice().sort((a,b)=>{
    const ca = competitionScore(a.competition), cb = competitionScore(b.competition);
    if (ca !== cb) return ca - cb;
    const mp = marketPref(a.market) - marketPref(b.market);
    if (mp !== 0) return mp;
    const d = Math.abs(a.odd-1.7) - Math.abs(b.odd-1.7);
    if (d !== 0) return d;
    return b.odd - a.odd;
  });
}

function pickCombo(events, rule){
  const arr = smartSort(events);
  let best=null;

  function bt(start, chosen, usedIds){
    if (best) return;
    if (chosen.length===rule.size){
      const prod = Number(product(chosen.map(x=>x.odd)).toFixed(3));
      if (prod>=rule.min && prod<=rule.max) best={ selections:chosen.slice(), product:prod };
      return;
    }
    for (let i=start;i<arr.length;i++){
      const e=arr[i];
      if (usedIds.has(e.id)) continue; // evită 2 pariuri pe același meci
      chosen.push(e); usedIds.add(e.id);
      bt(i+1, chosen, usedIds);
      usedIds.delete(e.id); chosen.pop();
      if (best) return;
    }
  }
  bt(0,[],new Set());
  return best;
}

function excludeByIds(events, idsToExclude){
  if (!idsToExclude?.size) return events;
  return events.filter(e => !idsToExclude.has(e.id));
}

(async ()=>{
  const raw = await fs.readFile(INPUT,"utf8").catch(()=>null);
  if (!raw){ console.error("odds.json missing"); process.exit(0); }
  const data = JSON.parse(raw);
  let E = Array.isArray(data?.events)? data.events.map(normalize).filter(ok):[];
  E = dedupeByIdMarket(E);

  // 1) construim BILET COTA 2 mai întâi
  const cota2 = pickCombo(E, RULE_COTA2);

  // 2) excludem meciurile folosite în COTA 2
  let remaining = E;
  if (cota2?.selections?.length){
    const used = new Set(cota2.selections.map(s=>s.id));
    remaining = excludeByIds(E, used);
  }

  // 3) construim BILETUL ZILEI din rest (disjunct)
  const zi = pickCombo(remaining, RULE_ZI);

  const dt = new Date().toISOString().slice(0,10);
  const md=[]; md.push(`# Pariu Verde — ${dt}`,"");

  md.push(`## Bilet cota 2 (2 selecții; ${RULE_COTA2.min}–${RULE_COTA2.max})`);
  if (cota2){
    cota2.selections.forEach(s=>{
      md.push(`- [${s.sport}] ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
      if (s.competition) md.push(`  - Competiție: ${s.competition}`);
      md.push(`  - Link: ${s.url}`);
    });
    md.push(`- **Cota totală:** ${cota2.product}`);
  } else md.push(`- (nu am găsit combinație validă azi)`);

  md.push("",`## Biletul zilei (4 selecții; ${RULE_ZI.min}–${RULE_ZI.max}) — fără suprapunere cu Cota 2`);
  if (zi){
    zi.selections.forEach(s=>{
      md.push(`- [${s.sport}] ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
      if (s.competition) md.push(`  - Competiție: ${s.competition}`);
      md.push(`  - Link: ${s.url}`);
    });
    md.push(`- **Cota totală:** ${zi.product}`);
  } else md.push(`- (nu am găsit combinație validă în setul rămas)`);

  const out = { date: dt, bilet_cota2: cota2||null, biletul_zilei: zi||null };
  await fs.writeFile("tickets.json", JSON.stringify(out,null,2), "utf8");
  await fs.writeFile("tickets.md", md.join("\n"), "utf8");
  console.log("[OK] tickets.json & tickets.md generate (disjunct + competiții prioritizate)");
})();
