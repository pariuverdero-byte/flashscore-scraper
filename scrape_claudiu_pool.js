// scrape_claudiu_pool.js
// FINAL FIX — correct INPUT (odds_extra.json)
// Node 18+

import fs from "fs/promises";

/* =========================================================
 * CONFIG
 * ========================================================= */

// ✅ FIȘIERUL REAL GENERAT ANTERIOR ÎN FLOW
const INPUT_FILE  = "odds_extra.json";
const OUTPUT_FILE = "claudiu_pool_final.json";

const MIN_BILETUL_ZILEI = 4;
const FALLBACK_MIN = 3;

/* =========================================================
 * HELPERS
 * ========================================================= */
function norm(t = "") {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Market detection (BTTS + goals, fără cornere)
 */
function mapMarket(text = "") {
  const t = norm(text);

  // BTTS
  if (
    (t.includes("ambele") && t.includes("marche")) ||
    t.includes("both teams") ||
    t.includes("btts")
  ) {
    return { market: "btts", side: "yes" };
  }

  // OVER goals
  if (t.includes("minim 2") || t.includes("peste 1.5")) {
    return { market: "stat", stat: "goals", side: "over", threshold: "1.5" };
  }
  if (t.includes("minim 3") || t.includes("peste 2.5")) {
    return { market: "stat", stat: "goals", side: "over", threshold: "2.5" };
  }

  // UNDER goals
  if (t.includes("sub 2.5")) {
    return { market: "stat", stat: "goals", side: "under", threshold: "2.5" };
  }

  // DOUBLE CHANCE
  if (t.includes("nu pierde") || t.includes("x2") || t.includes("1x")) {
    return { market: "double_chance" };
  }

  // DEFAULT 1X2
  return { market: "1" };
}

/**
 * One selection per match
 */
function dedupePerMatch(list = []) {
  const seen = new Set();
  return list.filter(s => {
    if (!s.matchId) return false;
    if (seen.has(s.matchId)) return false;
    seen.add(s.matchId);
    return true;
  });
}

/* =========================================================
 * MAIN
 * ========================================================= */
(async () => {
  console.log("[claudiu_pool] loading", INPUT_FILE);

  const raw = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));

  // odds_extra.json STRUCTURE:
  // { selections: [...] }
  const pool = raw.selections || [];

  const mapped = [];
  const unmapped = [];

  for (const sel of pool) {
    const meta = mapMarket(sel.bet_text || sel.market_text || "");

    if (!meta.market) {
      unmapped.push(sel);
      continue;
    }

    mapped.push({
      ...sel,
      ...meta,
    });
  }

  const deduped = dedupePerMatch(mapped);

  console.log(
    `[claudiu_pool] mapped=${mapped.length}, deduped=${deduped.length}, unmapped=${unmapped.length}`
  );

  /* =========================
   * SPLIT BILETE
   * ========================= */
  const cota2 = deduped.slice(0, 2);
  let biletulZilei = deduped.slice(2);

  // fallback dacă nu sunt suficiente
  if (biletulZilei.length < MIN_BILETUL_ZILEI) {
    console.log("[fallback] completing Biletul Zilei");
    for (const sel of unmapped) {
      if (biletulZilei.length >= MIN_BILETUL_ZILEI) break;
      if (!biletulZilei.find(s => s.matchId === sel.matchId)) {
        biletulZilei.push(sel);
      }
    }
  }

  const output = {
    generated_at: new Date().toISOString(),
    cota2,
    biletul_zilei:
      biletulZilei.length >= FALLBACK_MIN ? biletulZilei : [],
  };

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log("✅ claudiu_pool_final.json generated");
})();
