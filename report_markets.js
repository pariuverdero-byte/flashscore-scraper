// report_markets.js — sumar piețe disponibile în odds.json
import fs from "fs/promises";

(async () => {
  const raw = await fs.readFile("odds.json", "utf8").catch(()=>null);
  if (!raw) { console.log("odds.json missing"); process.exit(0); }
  const data = JSON.parse(raw);
  const E = Array.isArray(data?.events) ? data.events : [];
  const byMkt = new Map();
  const byMatch = new Map();

  for (const e of E) {
    const mkt = String(e.market);
    byMkt.set(mkt, 1 + (byMkt.get(mkt) || 0));
    byMatch.set(e.id, (byMatch.get(e.id) || new Set()).add(mkt));
  }

  console.log("=== MARKET COVERAGE ===");
  console.log("Total selections:", E.length);
  [...byMkt.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
    console.log(`${k.padEnd(12)} : ${v}`);
  });

  const counts = [...byMatch.values()].map(s=>s.size);
  const avg = counts.length ? (counts.reduce((a,b)=>a+b,0)/counts.length).toFixed(2) : 0;
  console.log("Matches seen:", byMatch.size, "| avg markets/match:", avg);
})();
