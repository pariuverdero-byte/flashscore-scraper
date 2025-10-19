// Generator bilete — disjunct + priorități + fallback + toleranță
// - Cota 2: 2 selecții, țintă [1.90–2.50] ±15 %
// - Biletul zilei: 4 selecții, țintă [4.00–6.00] ±30 %
// - Nu folosește aceleași meciuri pe ambele bilete
// - Preferă competițiile majore și piețele „safe” (1X2, Double Chance, O/U)

import fs from "fs/promises";

const INPUT = "odds.json";
const RULE_COTA2 = { size: 2, min: 1.90, max: 2.50, tol: Number(process.env.COTA2_TOL || 0.15) };
const RULE_ZI   = { size: 4, min: 4.00, max: 6.00, tol: Number(process.env.ZI_TOL || 0.30) };

const ODD_MIN = 1.10, ODD_MAX = 25.0;
const EXCLUDE = /(HT|First Half|2nd Half|Asian|Exact|Correct Score)/i;

const COMP_PRIORITY = [
  "Premier League","LaLiga","Serie A","Bundesliga","Ligue 1",
  "Champions League","Europa League","Conference League",
  "NBA","Euroleague","EuroLeague","ACB",
  "ATP","WTA","Grand Slam","Australian Open","Roland Garros","Wimbledon","US Open"
];

function competitionScore(c){
  if (!c) return 5;
  const name = c.toLowerCase();
  for (let i=0;i<COMP_PRIORITY.length;i++){
    if (name.includes(COMP_PRIORITY[i].toLowerCase())) return 0 + Math.floor(i/5);
  }
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
  id:String(e.id), teams:String(e.teams), market:String(e.market),
  odd:Number(e.odd), url:String(e.url), sport:String(e.sport||"football"),
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
function within(val, lo, hi){ return val>=lo && val<=hi; }
function distanceToRange(val, lo, hi){
  if (val < lo) return lo - val;
  if (val > hi) return val - hi;
  return 0;
}

// caută combinația ideală cu fallback + toleranță
function pickCombo(events, rule){
  const arr = smartSort(events);
  const lo = rule.min, hi = rule.max;
  const loTol = lo * (1 - rule.tol), hiTol = hi * (1 + rule.tol);

  let bestExact=null, bestTol=null, bestAny=null;
  let iters=0, MAX_ITER=200000;
  const mid=(lo+hi)/2;

  function consider(ch){
    const prod=Number(product(ch.map(x=>x.odd)).toFixed(3));
    const obj={selections:ch.slice(),product:prod};
    if (within(prod,lo,hi) && !bestExact){bestExact=obj;return;}
    if (within(prod,loTol,hiTol)){
      const d=Math.abs(prod-mid);
      if (!bestTol || d<Math.abs(bestTol.product-mid)) bestTol=obj;
    }
    const dist=distanceToRange(prod,lo,hi);
    if (!bestAny || dist<distanceToRange(bestAny.product,lo,hi)) bestAny=obj;
  }

  function bt(start,ch,used){
    if (iters++>MAX_ITER) return;
    if (bestExact) return;
    if (ch.length===rule.size){ consider(ch); return; }
    for(let i=start;i<arr.length;i++){
      const e=arr[i]; if(used.has(e.id)) continue;
      ch.push(e); used.add(e.id);
      bt(i+1,ch,used);
      used.delete(e.id); ch.pop();
      if (bestExact) return;
    }
  }
  bt(0,[],new Set());
  const result=bestExact||bestTol||bestAny||null;
  if(!result)return null;
  let status="exact";
  if(!within(result.product,lo,hi)) status=within(result.product,loTol,hiTol)?"aproape":"cel_mai_apropiat";
  return {...result,status,range:{min:lo,max:hi},tolRange:{min:loTol,max:hiTol}};
}
function excludeByIds(events,ids){ if(!ids?.size)return events; return events.filter(e=>!ids.has(e.id)); }

function lineTicket(title,combo){
  const lines=[];
  lines.push(`## ${title}`);
  if(!combo){ lines.push(`- (nu am găsit combinație validă)`); return lines; }
  const badge=combo.status==="exact"?"✅ exact":(combo.status==="aproape"?"≈ aproape":"≈ cel mai apropiat");
  lines.push(`- **Cota totală:** ${combo.product}  _(${badge} ținta ${combo.range.min}–${combo.range.max})_`);
  combo.selections.forEach(s=>{
    lines.push(`- [${s.sport}] ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
    if(s.competition)lines.push(`  - Competiție: ${s.competition}`);
    lines.push(`  - Link: ${s.url}`);
  });
  return lines;
}

(async()=>{
  const raw=await fs.readFile(INPUT,"utf8").catch(()=>null);
  if(!raw){ console.error("odds.json missing"); process.exit(0); }
  const data=JSON.parse(raw);
  let E=Array.isArray(data?.events)?data.events.map(normalize).filter(ok):[];
  E=dedupeByIdMarket(E);

  // log scurt de diagnostic
  const bySport=new Map(),byComp=new Map();
  for(const e of E){
    bySport.set(e.sport,1+(bySport.get(e.sport)||0));
    const c=e.competition||""; if(c)byComp.set(c,1+(byComp.get(c)||0));
  }
  console.log("[STATS]",E.length,"selecții");
  console.log("[STATS] sport:",Object.fromEntries(bySport));
  console.log("[STATS] top competiții:",[...byComp.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6));

  // 1️⃣ Cota 2
  const cota2=pickCombo(E,RULE_COTA2);

  // 2️⃣ Excludem meciurile folosite
  let remaining=E;
  if(cota2?.selections?.length){
    const used=new Set(cota2.selections.map(s=>s.id));
    remaining=excludeByIds(E,used);
  }

  // 3️⃣ Biletul zilei
  const zi=pickCombo(remaining,RULE_ZI);

  // output
  const dt=new Date().toISOString().slice(0,10);
  const md=[];
  md.push(`# Pariu Verde — ${dt}`,"");
  md.push(...lineTicket(`Bilet cota 2 (2 selecții; țintă ${RULE_COTA2.min}–${RULE_COTA2.max}; toleranță ±${Math.round(RULE_COTA2.tol*100)}%)`,cota2));
  md.push("");
  md.push(...lineTicket(`Biletul zilei (4 selecții; țintă ${RULE_ZI.min}–${RULE_ZI.max}; toleranță ±${Math.round(RULE_ZI.tol*100)}%) — fără suprapunere cu Cota 2`,zi));

  const out={date:dt,bilet_cota2:cota2||null,biletul_zilei:zi||null};
  await fs.writeFile("tickets.json",JSON.stringify(out,null,2),"utf8");
  await fs.writeFile("tickets.md",md.join("\n"),"utf8");
  console.log("[OK] tickets.json & tickets.md generate (toleranță + fallback)");
})();
