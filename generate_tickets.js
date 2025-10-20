// generate_tickets.js
import fs from "fs/promises";

const INPUT = "odds.json";
const RULE_COTA2 = { size: 2, min: 1.90, max: 2.50, tol: Number(process.env.COTA2_TOL || 0.15) };
const RULE_ZI   = { size: 4, min: 4.00, max: 6.00, tol: Number(process.env.ZI_TOL || 0.30) };

const PRIORITY_COMP = ["Premier League","LaLiga","Serie A","Bundesliga","Ligue 1",
"Champions League","Europa League","Conference League","Cupa României",
"NBA","Euroleague","ATP","WTA","Grand Slam","Wimbledon","US Open","Roland Garros"];
const PREF_MARKETS = ["1","X","2","1X","12","X2"];

const safe = (x)=> (x??"").toString().trim();
const norm = (e)=>({ id:safe(e.id), teams:safe(e.teams), market:safe(e.market), odd:Number(e.odd),
  url:safe(e.url), status:safe(e.status), sport:safe(e.sport||"football"),
  competition:safe(e.competition||""), time:safe(e.time||"") });

function dedupeIdMarket(arr){ const m=new Map(); for(const e of arr){ const k=`${e.id}|${e.market}`; if(!m.has(k)||e.odd>m.get(k).odd)m.set(k,e);} return [...m.values()]; }
function compScore(c){ const s=(c||"").toLowerCase(); for(let i=0;i<PRIORITY_COMP.length;i++){ if(s.includes(PRIORITY_COMP[i].toLowerCase())) return i; } if(/england|spain|italy|germany|france|romania|portugal|netherlands/i.test(s)) return PRIORITY_COMP.length+1; return PRIORITY_COMP.length+3; }
function marketScore(m){ const i=PREF_MARKETS.indexOf(m); return i===-1?99:i; }
function sortPref(list){ return list.slice().sort((a,b)=> compScore(a.competition)-compScore(b.competition) || marketScore(a.market)-marketScore(b.market) || Math.abs(a.odd-1.7)-Math.abs(b.odd-1.7)); }
const product = (a)=> a.reduce((x,y)=>x*y,1);
const within = (v,a,b)=> v>=a && v<=b;
const distRange = (v,a,b)=> v<a?a-v:v>b?v-b:0;

function pickCombo(E, rule){
  const arr=sortPref(E), lo=rule.min, hi=rule.max, loT=lo*(1-rule.tol), hiT=hi*(1+rule.tol), mid=(lo+hi)/2;
  let bestExact=null,bestTol=null,bestAny=null; const n=arr.length; const used=new Set();
  function consider(ch){ const p=Number(product(ch.map(s=>s.odd)).toFixed(3)); const obj={selections:ch.slice(),product:p};
    if(within(p,lo,hi)&&!bestExact){bestExact=obj;return;}
    if(within(p,loT,hiT)){ const d=Math.abs(p-mid); if(!bestTol||d<Math.abs(bestTol.product-mid)) bestTol=obj; }
    if(!bestAny||distRange(p,lo,hi)<distRange(bestAny.product,lo,hi)) bestAny=obj; }
  function bt(idx,ch){ if(ch.length===rule.size){ consider(ch); return; }
    for(let i=idx;i<n;i++){ const e=arr[i]; if(used.has(e.id)) continue; used.add(e.id); ch.push(e);
      bt(i+1,ch); ch.pop(); used.delete(e.id); if(bestExact) return; } }
  bt(0,[]); const res=bestExact||bestTol||bestAny; if(!res) return null;
  const status = within(res.product,lo,hi) ? "exact" : within(res.product,loT,hiT) ? "aproape":"cel_mai_apropiat";
  return {...res,status,range:{min:lo,max:hi},tolRange:{min:loT,max:hiT}};
}

function excludeIds(E, ids){ return !ids?.size?E:E.filter(x=>!ids.has(x.id)); }

function mdTicket(title,c){
  const out=[`## ${title}`]; if(!c){ out.push("- (nu am găsit combinație)"); return out; }
  const badge=c.status==="exact"?"✅ exact":(c.status==="aproape"?"≈ aproape":"≈ cel mai apropiat");
  out.push(`- **Cota totală:** ${c.product}  _(${badge}, țintă ${c.range.min}-${c.range.max})_`, "");
  for(const s of c.selections){
    out.push(`- ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
    if(s.competition) out.push(`  - Competiție: ${s.competition}`);
    if(s.time) out.push(`  - Ora: ${s.time}`);
    if(s.url) out.push(`  - Link: ${s.url}`);
    out.push("");
  }
  return out;
}

(async ()=>{
  const raw=await fs.readFile(INPUT,"utf8").catch(()=>null);
  if(!raw){ console.error("odds.json missing"); process.exit(0); }
  const E0=JSON.parse(raw)?.events||[];
  let E=dedupeIdMarket(E0.map(norm))
    .filter(e=>!/^(live|fin|finished)$/i.test(e.status||""))
    .filter(e=>isFinite(e.odd)&&e.odd>1.05&&e.odd<50);

  const cota2=pickCombo(E,RULE_COTA2);
  let remaining=E;
  if(cota2?.selections) remaining = excludeIds(E, new Set(cota2.selections.map(s=>s.id)));
  const zi=pickCombo(remaining,RULE_ZI);

  const dt=new Date().toISOString().slice(0,10);
  const md=[
    `# Pariu Verde — ${dt}`,
    "",
    ...mdTicket(`Bilet Cota 2 (2 selecții; țintă ${RULE_COTA2.min}-${RULE_COTA2.max}; tol ±${Math.round(RULE_COTA2.tol*100)}%)`, cota2),
    "",
    ...mdTicket(`Biletul Zilei (4 selecții; țintă ${RULE_ZI.min}-${RULE_ZI.max}; tol ±${Math.round(RULE_ZI.tol*100)}%) — fără suprapunere cu Cota 2`, zi),
    ""
  ];

  await fs.writeFile("tickets.json", JSON.stringify({date:dt,bilet_cota2:cota2||null,biletul_zilei:zi||null}, null, 2), "utf8");
  await fs.writeFile("tickets.md", md.join("\n"), "utf8");
  console.log("[OK] tickets.json & tickets.md generate");
})();
