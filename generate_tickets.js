// Generator bilete cu constrângeri:
// - Bilet cota 2: EXACT 2 selecții, produs în [1.90, 2.50]
// - Biletul zilei: EXACT 4 selecții, produs în [4.00, 6.00]
// Acceptă piețe: 1X2, 1X/12/X2, O/U goluri, Cards, Corners.

import fs from "fs/promises";

const INPUT = "odds.json";

// filtre utile
const ODD_MIN = 1.10;         // elimină cote aberant de mici
const ODD_MAX = 10.00;
const EXCLUDE_MARKETS_REGEX = /(HT|First Half|2nd Half|Asian|Exact|Correct Score)/i;

// RULESETS
const RULE_COTA2 = { size: 2, min: 1.90, max: 2.50 };
const RULE_ZI =   { size: 4, min: 4.00, max: 6.00 };

// preferințe piețe (scor mai mic = preferat)
function marketPreference(mkt) {
  if (mkt === "1" || mkt === "X" || mkt === "2") return 0;
  if (mkt === "1X" || mkt === "12" || mkt === "X2") return 1;
  if (/^O\d/.test(mkt) || /^U\d/.test(mkt)) return 2;                  // Over/Under goals
  if (/^Cards /.test(mkt)) return 3;
  if (/^Corners /.test(mkt)) return 4;
  return 5;
}

function product(arr) { return arr.reduce((a,b)=>a*b,1); }
function closeness(val, low, high) {
  if (val >= low && val <= high) return 0;
  if (val < low) return low - val;
  return val - high;
}

function normalize(e) {
  return {
    id: String(e.id),
    teams: String(e.teams),
    market: String(e.market),
    odd: Number(e.odd),
    url: String(e.url)
  };
}

function isOk(e) {
  if (!isFinite(e.odd) || e.odd < ODD_MIN || e.odd > ODD_MAX) return false;
  if (EXCLUDE_MARKETS_REGEX.test(e.market)) return false;
  return true;
}

function dedupeByMatchMarket(events) {
  const map = new Map();
  for (const e of events) {
    const key = `${e.id}|${e.market}`;
    const prev = map.get(key);
    if (!prev || e.odd > prev.odd) map.set(key, e); // păstrează cota cea mai mare
  }
  return Array.from(map.values());
}

function pickCombo(events, rule) {
  // backtracking simplu cu tăieri; pentru size 2 și 4 e ok.
  events = events.slice().sort((a,b) => {
    // preferințe: piețe mai „safe”, apoi odd apropiat de ținta geometrică
    const pref = marketPreference(a.market) - marketPreference(b.market);
    if (pref !== 0) return pref;
    return Math.abs(a.odd - 1.7) - Math.abs(b.odd - 1.7);
  });

  const targetGeo = Math.pow((rule.min + rule.max)/2, 1 / rule.size); // aproximativ
  // low/high per selecție — doar pentru ghidare (nu sunt hard)
  const lowEach  = Math.max(1.10, targetGeo * 0.8);
  const highEach = targetGeo * 1.3;

  // evită conflictul: nu pune două piețe din același meci
  const res = [];
  let best = null;

  function bt(start, chosen, usedIds) {
    if (best) return; // oprim la prima validă (preferințe au ordonat deja)
    if (chosen.length === rule.size) {
      const prod = Number(product(chosen.map(x=>x.odd)).toFixed(3));
      if (prod >= rule.min && prod <= rule.max) {
        best = { selections: chosen.slice(), product: prod };
      }
      return;
    }
    for (let i = start; i < events.length; i++) {
      const e = events[i];
      if (usedIds.has(e.id)) continue;
      // mic pruning: dacă odd e complet în afara ghidajului, sare
      if (e.odd < 1.05) continue;
      // continuă
      chosen.push(e);
      usedIds.add(e.id);
      bt(i + 1, chosen, usedIds);
      usedIds.delete(e.id);
      chosen.pop();
      if (best) return;
    }
  }

  bt(0, [], new Set());
  return best;
}

(async () => {
  const raw = await fs.readFile(INPUT, "utf8").catch(()=>null);
  if (!raw) {
    console.error("[ERR] odds.json missing");
    process.exit(1);
  }
  const data = JSON.parse(raw);
  let events = Array.isArray(data?.events) ? data.events.map(normalize).filter(isOk) : [];
  events = dedupeByMatchMarket(events);

  if (!events.length) {
    console.error("[ERR] no events to build tickets");
    process.exit(0);
  }

  const cota2 = pickCombo(events, RULE_COTA2);
  const zi = pickCombo(events, RULE_ZI);

  const dt = new Date().toISOString().slice(0,10);
  const out = { date: dt, bilet_cota2: cota2 || null, biletul_zilei: zi || null };
  const md = [];

  md.push(`# Pariu Verde — ${dt}`);
  md.push(``);
  md.push(`## Bilet cota 2 (2 selecții; țintă ${RULE_COTA2.min}–${RULE_COTA2.max})`);
  if (cota2) {
    cota2.selections.forEach(s => {
      md.push(`- ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
      md.push(`  - Link: ${s.url}`);
    });
    md.push(`- **Cota totală:** ${cota2.product}`);
  } else {
    md.push(`- (nu am găsit combinație validă azi)`);
  }
  md.push(``);
  md.push(`## Biletul zilei (4 selecții; țintă ${RULE_ZI.min}–${RULE_ZI.max})`);
  if (zi) {
    zi.selections.forEach(s => {
      md.push(`- ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
      md.push(`  - Link: ${s.url}`);
    });
    md.push(`- **Cota totală:** ${zi.product}`);
  } else {
    md.push(`- (nu am găsit combinație validă azi)`);
  }

  await fs.writeFile("tickets.json", JSON.stringify(out, null, 2), "utf8");
  await fs.writeFile("tickets.md", md.join("\n"), "utf8");
  console.log("[OK] tickets.json & tickets.md generate cu reguli noi");
})();
