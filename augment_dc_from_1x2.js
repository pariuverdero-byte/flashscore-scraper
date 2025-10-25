// augment_dc_from_1x2.js
// Compute Double Chance (1X, X2, 12) from existing 1X2 odds.json (implied, no margin correction)

import fs from "fs/promises";

const INPUT = "odds.json";
const OUTPUT = "odds_extra.json";

const toNum = (x) => (isFinite(+x) ? +x : NaN);
const dc = (a, b) => {
  const A = toNum(a), B = toNum(b);
  if (!(A > 1 && B > 1)) return null;
  const v = 1 / (1 / A + 1 / B);
  return v > 1.01 && v < 100 ? +v.toFixed(2) : null;
};

(async () => {
  const raw = await fs.readFile(INPUT, "utf8").catch(() => null);
  if (!raw) {
    console.error("❌ odds.json not found, cannot compute DC.");
    process.exit(0);
  }

  const events = JSON.parse(raw)?.events || [];
  // group by match id: collect 1, X, 2 odds
  const byId = new Map();
  for (const e of events) {
    const id = e.id;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, { teams: e.teams, url: e.url, comp: e.competition, time: e.time, o1: null, ox: null, o2: null });
    const g = byId.get(id);
    if (e.market === "1") g.o1 = toNum(e.odd);
    else if (e.market === "X") g.ox = toNum(e.odd);
    else if (e.market === "2") g.o2 = toNum(e.odd);
  }

  const out = {};
  for (const [id, g] of byId.entries()) {
    const oneX = dc(g.o1, g.ox);
    const xTwo = dc(g.ox, g.o2);
    const oneTwo = dc(g.o1, g.o2);
    if (oneX || xTwo || oneTwo) {
      out[id] = {
        dc: {
          "1X": oneX || null,
          "X2": xTwo || null,
          "12": oneTwo || null,
        },
        // Totals placeholder – stays empty unless you wire a real source
        ou: {}
      };
    }
  }

  await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2), "utf8");
  console.log(`✅ Wrote ${OUTPUT} with implied DC for ${Object.keys(out).length} matches.`);
})();
