// scrape_claudiu_pool.js
// FINAL FIX – robust mapping + per-ticket dedupe + fallback
// Node 18+

import fs from "fs/promises";

/* =========================================================
 * CONFIG
 * ========================================================= */
const OUTPUT_FILE = "claudiu_pool.json";

const MIN_BILETUL_ZILEI = 4;
const FALLBACK_MIN = 3;

/* =========================================================
 * HELPERS
 * ========================================================= */
function norm(t = "") {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * EXTENDED MARKET MAPPING
 */
function mapMarket(text) {
  const t = norm(text);

  // BTTS
  if (
    t.includes("ambele") && t.includes("marchează") ||
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

  // DEFAULT = 1X2
  return { market: "1" };
}

/**
 * one-per-match PER TICKET
 */
function dedupePerMatch(selections) {
  const seen = new Set();
  return selections.filter(sel => {
    if (seen.has(sel.matchId)) return false;
    seen.add(sel.matchId);
    return true;
  });
}

/* =========================================================
 * CORE BUILDER
 * ========================================================= */
function buildTicket(name, rawSelections) {
  const mapped = [];
  const unmapped = [];

  for (const sel of rawSelections) {
    const meta = mapMarket(sel.bet_text || "");

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
    `[${name}] mapped=${mapped.length}, deduped=${deduped.length}, unmapped=${unmapped.length}`
  );

  return {
    selections: deduped,
    fallbackPool: unmapped,
  };
}

/* =========================================================
 * MAIN
 * ========================================================= */
(async () => {
  const raw = JSON.parse(await fs.readFile("raw_claudiu_input.json", "utf8"));

  /* ---------- BUILD TICKETS INDEPENDENT ---------- */
  const cota2 = buildTicket("cota2", raw.cota2 || []);
  const biletulZilei = buildTicket("biletul_zilei", raw.biletul_zilei || []);
  const rezerva = raw.varianta_rezerva || [];

  /* ---------- FALLBACK LOGIC ---------- */
  if (biletulZilei.selections.length < MIN_BILETUL_ZILEI) {
    console.log(
      `[fallback] Biletul Zilei incomplete (${biletulZilei.selections.length})`
    );

    const needed = MIN_BILETUL_ZILEI - biletulZilei.selections.length;

    const fallbackCandidates = [
      ...rezerva,
      ...cota2.selections,
    ];

    for (const sel of fallbackCandidates) {
      if (biletulZilei.selections.length >= MIN_BILETUL_ZILEI) break;
      if (
        !biletulZilei.selections.find(s => s.matchId === sel.matchId)
      ) {
        biletulZilei.selections.push(sel);
      }
    }

    biletulZilei.fallback_used = true;
  }

  /* ---------- FINAL VALIDATION ---------- */
  const output = {
    generated_at: new Date().toISOString(),
    cota2: cota2.selections,
    biletul_zilei:
      biletulZilei.selections.length >= FALLBACK_MIN
        ? biletulZilei.selections
        : [],
    meta: {
      biletul_zilei_fallback: !!biletulZilei.fallback_used,
    },
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf8");

  console.log("✅ claudiu_pool.json generated");
})();
