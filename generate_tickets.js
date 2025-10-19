// Generator bilete — disjuncte + preferințe competiții + fallback "aproape de țintă"
// - Bilet cota 2: EXACT 2 selecții, țintă [1.90, 2.50]
// - Biletul zilei: EXACT 4 selecții, țintă [4.00, 6.00]
// - Fără suprapunere între bilete (nu se repetă același meci).
// - Dacă nu există combinație în interval, alege cea mai apropiată (marcată "aproape").
// - Poți seta toleranțe prin ENV: COTA2_TOL (ex: 0.15), ZI_TOL (ex: 0.30)

import fs from "fs/promises";

const INPUT = "odds.json";

const RULE_COTA2 = {
  size: 2,
  min: 1.90,
  max: 2.50,
  tol: Number(process.env.COTA2_TOL || 0)  // ex: 0.15 pentru fallback în interval [min-tol, max+tol]
};
const RULE_ZI = {
  size: 4,
  min: 4.00,
  max: 6.00,
  tol: Number(process.env.ZI_TOL || 0)     // ex: 0.30
};

const ODD_MIN = 1.10, ODD_MAX = 25.0;
const EXCLUDE = /(HT|First Half|2nd Half|Asian|Exact|Correct Score)/i;

// competiții „majore” — scor mic = preferat
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

// Căutare prin backtracking cu fallback.
// MAX_ITER limitează munca pentru safety; ordonarea "smart" aduce rapid soluții bune.
function pickCombo(events, rule){
  const arr = smartSort(events);
  const targetMid = (rule.min + rule.max) / 2;
  const lo = rule.min, hi = rule.max;
  const loTol = Math.max(1.0, lo - rule.tol), hiTol = hi + rule.tol;

  let bestExact = null;       // prima soluție în [lo,hi]
  let bestTol = null;         // cea mai bună în [loTol,hiTol] dacă nu există în [lo,hi]
  let bestAny = null;         // cea mai apropiată de [lo,hi], dacă nu există nici în [loTol,hiTol]
  let iters = 0;
  const MAX_ITER = 200000;

  function consider(chosen){
    const prod = Number(product(chosen.map(x=>x.odd)).toFixed(3));
    const obj = { selections: chosen.slice(), product: prod };
    if (within(prod, lo, hi) && !bestExact) { bestExact = obj; return; }
    if (within(prod, loTol, hiTol)) {
      const score = Math.abs(prod - targetMid);
      if (!bestTol || score < Math.abs(bestTol.product - targetMid)) bestTol = obj;
    }
    const dist = distanceToRange(prod, lo, hi);
    if (!bestAny || dist < distanceToRange(bestAny.product, lo, hi)) bestAny = obj;
  }

  function bt(start, chosen, usedIds){
    if (iters++ > MAX_ITER) return;
    if (bestExact) return; // oprim la prima exactă — datorită ordonării, e "bună"
    if (chosen.length === rule.size) { consider(chosen); return; }
    for (let i=start;i<arr.length;i++){
      const e = arr[i];
      if (usedIds.has(e.id)) continue; // nu pune 2 pariuri pe același meci
      chosen.push(e); usedIds.add(e.id);
      bt(i+1, chosen, usedIds);
      usedIds.delete(e.id); chosen.pop();
      if (bestExact) return;
    }
  }
  bt(0, [], new Set());

  const result = bestExact || bestTol || bestAny || null;
  if (!result) return null;
  // adnotăm tipul rezultatului
  let status = "exact";
  if (!within(result.product, lo, hi)) status = within(result.product, loTol, hiTol) ? "aproape" : "cel_mai_apropiat";
  return { ...result, status, range: {min: lo, max: hi}, tolRange: {min: loTol, max: hiTol}, iters };
}

function excludeByIds(events, idsToExclude){
  if (!idsToExclude?.size) return events;
  return events.filter(e => !idsToExclude.has(e.id));
}

function lineTicket(title, combo){
  const lines = [];
  lines.push(`## ${title}`);
  if (!combo){
    lines.push(`- (nu am găsit combinație validă)`);
    return lines;
  }
  const badge = combo.status==="exact" ? "✅ exact" : (combo.status==="aproape" ? "≈ aproape" : "≈ cel mai apropiat");
  lines.push(`- **Cota totală:** ${combo.product}  _(${badge} ținta ${combo.range.min}–${combo.range.max}${
    combo.status!=="exact" ? `; toleranță ${combo.tolRange.min}–${combo.tolRange.max}` : ""
  })_`);
  combo.selections.forEach(s=>{
    lines.push(`- [${s.sport}] ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
    if (s.competition) lines.push(`  - Competiție: ${s.competition}`);
    lines.push(`  - Link: ${s.url}`);
  });
  return lines;
}

(async ()=>{
  const raw = await fs.readFile(INPUT, "utf8").catch(()=>null);
  if (!raw){ console.error("odds.json missing"); process.exit(0); }
  const data = JSON.parse(raw);
  let E = Array.isArray(data?.events) ? data.events.map(normalize).filter(ok) : [];
  E = dedupeByIdMarket(E);

  // LOG mic de debug în Actions
  const bySport = new Map(), byComp = new Map();
  for (const e of E){
    bySport.set(e.sport, 1 + (bySport.get(e.sport)||0));
    const c = e.competition||"";
    if (c) byComp.set(c, 1 + (byComp.get(c)||0));
  }
  console.log("[STATS] selections total:", E.length);
  console.log("[STATS] by sport:", Object.fromEntries(bySport));
  console.log("[STATS] top competitions:", [...byComp.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8));

  // 1) Cota 2 mai întâi
  const cota2 = pickCombo(E, RULE_COTA2);

  // 2) Excludem meciurile folosite din setul pentru Biletul Zilei
  let remaining = E;
  if (cota2?.selections?.length){
    const used = new Set(cota2.selections.map(s=>s.id));
    remaining = excludeByIds(E, used);
  }

  // 3) Biletul Zilei
  const zi = pickCombo(remaining, RULE_ZI);

  // Output
  const dt = new Date().toISOString().slice(0,10);
  const md = [];
  md.push(`# Pariu Verde — ${dt}`, "");
  md.push(...lineTicket(`Bilet cota 2 (2 selecții; țintă ${RULE_COTA2.min}–${RULE_COTA2.max}${
    RULE_COTA2.tol ? `; tol ±${RULE_COTA2.tol}` : ""
  })`, cota2));
  md.push("");
  md.push(...lineTicket(`Biletul zilei (4 selecții; țintă ${RULE_ZI.min}–${RULE_ZI.max}${
    RULE_ZI.tol ? `; tol ±${RULE_ZI.tol}` : ""
  }) — fără suprapunere cu Cota 2`, zi));

  const out = { date: dt, bilet_cota2: cota2||null, biletul_zilei: zi||null };
  await fs.writeFile("tickets.json", JSON.stringify(out, null, 2), "utf8");
  await fs.writeFile("tickets.md", md.join("\n"), "utf8");
  console.log("[OK] tickets.json & tickets.md generate (fallback + disjunct)");
})();
