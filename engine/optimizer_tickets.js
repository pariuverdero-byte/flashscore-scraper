// engine/optimizer_tickets.js

import fs from "fs/promises";

function log(...args) {
  console.log("[optimizer]", ...args);
}

// scoring surse
function getSourceScore(source) {
  if (source === "claudiu") return 3;
  if (source === "talkfootball") return 2;
  if (source === "predictz") return 1;
  return 0;
}

// bonus odds
function getOddsScore(odd) {
  if (odd >= 1.3 && odd <= 1.6) return 2;
  if (odd <= 1.8) return 1;
  return 0;
}

// scor total
function computeScore(sel) {
  return getSourceScore(sel.source) + getOddsScore(sel.odd);
}

// evit duplicări pe același match
function uniqueMatches(selections) {
  const seen = new Set();
  return selections.filter(s => {
    if (seen.has(s.match_id)) return false;
    seen.add(s.match_id);
    return true;
  });
}

// calc cota totală
function totalOdds(picks) {
  return picks.reduce((acc, p) => acc * (p.odd || 1), 1);
}

// 🟢 COTA 2
function buildCota2(selections) {
  const valid = selections
    .filter(s => s.odd >= 1.3 && s.odd <= 1.7)
    .sort((a, b) => computeScore(b) - computeScore(a));

  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const picks = [valid[i], valid[j]];
      const odds = totalOdds(picks);

      if (odds >= 1.95 && odds <= 2.1) {
        return picks;
      }
    }
  }

  return null;
}

// 🔵 BILETUL ZILEI (4 selecții)
function buildDaily(selections) {
  const valid = selections
    .filter(s => s.odd >= 1.3 && s.odd <= 2)
    .sort((a, b) => computeScore(b) - computeScore(a));

  for (let a = 0; a < valid.length; a++) {
    for (let b = a + 1; b < valid.length; b++) {
      for (let c = b + 1; c < valid.length; c++) {
        for (let d = c + 1; d < valid.length; d++) {

          const picks = [valid[a], valid[b], valid[c], valid[d]];
          const odds = totalOdds(picks);

          if (odds >= 4 && odds <= 6) {
            return picks;
          }
        }
      }
    }
  }

  return null;
}

(async () => {
  const master = JSON.parse(await fs.readFile("master_pool.json", "utf8"));

  let selections = master.selections || [];

  // scor + sort
  selections = selections.map(s => ({
    ...s,
    score: computeScore(s)
  }));

  selections.sort((a, b) => b.score - a.score);

  // fără duplicate
  selections = uniqueMatches(selections);

  log("total selections:", selections.length);

  const cota2 = buildCota2(selections);
  const daily = buildDaily(selections);

  if (!cota2) {
    log("❌ NU am găsit Cota 2");
  }

  if (!daily) {
    log("❌ NU am găsit Biletul Zilei");
  }

  const output = {
    cota2,
    daily
  };

  await fs.writeFile("tickets.json", JSON.stringify(output, null, 2));

  log("✅ tickets generated");
})();
