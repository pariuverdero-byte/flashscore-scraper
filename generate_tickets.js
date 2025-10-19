// Generează "Bilet cota 2" și "Biletul zilei" din odds.json
import fs from "fs/promises";

const INPUT = "odds.json";

// parametri configurabili rapid
const MAX_EVENTS_SCAN = 200;         // cât scanăm pentru perechi (complexitate n^2)
const TARGET_PRODUCT = 2.0;          // ținta pentru bilet cota 2
const RANGE_LOW = 1.2;               // filtru minim pentru o selecție
const RANGE_HIGH = 2.8;              // filtru maxim pentru o selecție
const SOLO_MIN = 1.55;               // min pentru "Biletul zilei"
const SOLO_MAX = 1.90;               // max pentru "Biletul zilei"

function product(arr) { return arr.reduce((a,b)=>a*b,1); }
function closeness(a,b) { return Math.abs(a-b); }

function dedupeByIdMarket(events) {
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.id}|${e.market}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickBiletulZilei(events) {
  // heuristic simplu: alege o selecție între SOLO_MIN..SOLO_MAX,
  // preferă 1 (Home) > X > 2, și odd cât mai aproape de 1.70
  const TARGET = 1.70;
  const scored = events
    .filter(e => e.odd >= SOLO_MIN && e.odd <= SOLO_MAX)
    .map(e => {
      let pref = e.market === "1" ? 0 : e.market === "X" ? 1 : 2; // preferință: 1 < X < 2
      return { e, score: closeness(e.odd, TARGET) + pref * 0.05 };
    })
    .sort((a,b)=> a.score - b.score);

  // fallback: dacă nu găsim în fereastră, ia cea mai apropiată de 1.70 din tot setul
  if (scored.length) return scored[0].e;
  const fallback = events
    .map(e => ({ e, score: closeness(e.odd, TARGET) }))
    .sort((a,b)=> a.score - b.score);
  return fallback[0]?.e || null;
}

function pickBiletCota2(events) {
  // alegem 2 selecții cu produs ~ 2.0
  const pool = events
    .filter(e => e.odd >= RANGE_LOW && e.odd <= RANGE_HIGH)
    .slice(0, MAX_EVENTS_SCAN);

  let best = null;
  for (let i=0;i<pool.length;i++){
    for (let j=i+1;j<pool.length;j++){
      const a = pool[i], b = pool[j];
      // evită 2 piețe din același meci (risc de conflict)
      if (a.id === b.id) continue;
      const prod = a.odd * b.odd;
      const score = closeness(prod, TARGET_PRODUCT);

      // scor secundar: preferă (1,1) > (1,X) > (1,2) > (X,X) > ...
      const prefA = a.market === "1" ? 0 : a.market === "X" ? 1 : 2;
      const prefB = b.market === "1" ? 0 : b.market === "X" ? 1 : 2;
      const tie = prefA + prefB;

      const cand = { a, b, prod, score, tie };
      if (!best) best = cand;
      else if (cand.score < best.score || (cand.score === best.score && cand.tie < best.tie)) best = cand;
    }
  }
  return best ? { selections: [best.a, best.b], product: Number(best.prod.toFixed(3)) } : null;
}

(async () => {
  const raw = await fs.readFile(INPUT, "utf8").catch(()=>null);
  if (!raw) {
    console.error("[ERR] odds.json missing");
    process.exit(1);
  }
  const data = JSON.parse(raw);
  let events = Array.isArray(data?.events) ? data.events : [];
  if (!events.length) {
    console.error("[ERR] no events in odds.json");
    process.exit(0);
  }
  // normalizare & dedupe
  events = events.map(e => ({
    id: String(e.id),
    teams: String(e.teams),
    market: String(e.market), // "1" | "X" | "2"
    odd: Number(e.odd),
    url: String(e.url)
  })).filter(e => e.odd > 1.01 && isFinite(e.odd));
  events = dedupeByIdMarket(events);

  // Biletul zilei (single)
  const single = pickBiletulZilei(events);

  // Bilet cota 2 (2 selecții)
  const combo = pickBiletCota2(events);

  // markdown & json outputs
  const dt = new Date().toISOString().slice(0,10);
  const mdLines = [];
  mdLines.push(`# Pariu Verde — ${dt}`);
  if (single) {
    mdLines.push(`## Biletul zilei`);
    mdLines.push(`- ${single.teams} — **${single.market} @ ${single.odd.toFixed(2)}**`);
    mdLines.push(`  - Link: ${single.url}`);
  } else {
    mdLines.push(`## Biletul zilei`);
    mdLines.push(`- (nu am găsit selecție potrivită în intervalul ${SOLO_MIN}..${SOLO_MAX})`);
  }
  mdLines.push(``);
  if (combo) {
    mdLines.push(`## Bilet cota 2 (produs ~ ${combo.product})`);
    for (const s of combo.selections) {
      mdLines.push(`- ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
      mdLines.push(`  - Link: ${s.url}`);
    }
    mdLines.push(`- **Cota totală:** ${combo.product}`);
  } else {
    mdLines.push(`## Bilet cota 2`);
    mdLines.push(`- (nu am găsit 2 selecții pentru produs ~${TARGET_PRODUCT})`);
  }

  const out = {
    date: dt,
    biletul_zilei: single || null,
    bilet_cota2: combo || null
  };

  await fs.writeFile("tickets.json", JSON.stringify(out, null, 2), "utf8");
  await fs.writeFile("tickets.md", mdLines.join("\n"), "utf8");
  console.log("[OK] tickets.json & tickets.md generate");
})();
