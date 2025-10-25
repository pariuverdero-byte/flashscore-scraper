// build_odds_extra_from_1x2.js
// Derives Double Chance odds (1X, 12, X2) from 1X2 in odds.json.
// Merges with any existing odds_extra.json (e.g., O/U from an API).

import fs from "fs/promises";

const INPUT_1X2 = "odds.json";
const INPUT_EXTRA_EXISTING = "odds_extra.json"; // optional, will be merged if present
const OUTPUT_EXTRA = "odds_extra.json";

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// Convert raw 1x2 odds -> de-vigged probabilities -> DC odds
function deriveDC(o1, ox, o2) {
  const p1 = 1 / o1;
  const px = 1 / ox;
  const p2 = 1 / o2;
  const sum = p1 + px + p2;
  if (sum <= 0) return null;

  // de-vigged probabilities
  const q1 = p1 / sum;
  const qx = px / sum;
  const q2 = p2 / sum;

  // DC fair odds
  const o_1x = 1 / (q1 + qx);
  const o_12 = 1 / (q1 + q2);
  const o_x2 = 1 / (qx + q2);

  // add a tiny margin (optional) to mimic book prices a bit; keep it mild
  const margin = 0.00; // set to 0 for “pure fair” values
  const inflate = (o) => o * (1 - margin);

  // sanity clamp
  const clamp = (o) => Math.max(1.02, Math.min(50, o));

  return {
    "1X": round2(clamp(inflate(o_1x))),
    "12": round2(clamp(inflate(o_12))),
    "X2": round2(clamp(inflate(o_x2))),
  };
}

(async () => {
  // 1) Load 1X2
  const raw = await fs.readFile(INPUT_1X2, "utf8").catch(() => null);
  if (!raw) {
    console.error("❌ odds.json not found; cannot build odds_extra.");
    process.exit(0);
  }
  const events = JSON.parse(raw)?.events || [];

  // Group 1X2 by match id
  const byId = new Map();
  for (const e of events) {
    if (!e || !e.id || !e.market) continue;
    const id = String(e.id);
    if (!byId.has(id)) byId.set(id, { id, teams: e.teams, url: e.url, sport: e.sport, competition: e.competition, time: e.time, country: e.country, one:null, draw:null, two:null });
    const g = byId.get(id);
    const odd = Number(e.odd);
    if (!isFinite(odd) || odd <= 1.01) continue;
    if (e.market === "1") g.one = odd;
    else if (e.market === "X") g.draw = odd;
    else if (e.market === "2") g.two = odd;
  }

  // 2) Start from existing extras if present (e.g., O/U from API)
  let extras = {};
  const rawExtra = await fs.readFile(INPUT_EXTRA_EXISTING, "utf8").catch(() => null);
  if (rawExtra) {
    try { extras = JSON.parse(rawExtra) || {}; } catch { extras = {}; }
  }

  // 3) Compute DC per match and merge
  for (const [id, g] of byId.entries()) {
    if (g.one && g.draw && g.two) {
      const dc = deriveDC(g.one, g.draw, g.two);
      if (!dc) continue;
      if (!extras[id]) extras[id] = {};
      if (!extras[id].dc) extras[id].dc = {};
      // only set if missing, don't overwrite pre-existing DC
      for (const k of ["1X","12","X2"]) {
        if (extras[id].dc[k] == null) extras[id].dc[k] = dc[k];
      }
      // ensure we have basic context (optional)
      if (!extras[id].meta) {
        extras[id].meta = {
          teams: g.teams || "",
          url: g.url || "",
          sport: g.sport || "",
          competition: g.competition || "",
          time: g.time || "",
          country: g.country || ""
        };
      }
    }
  }

  // 4) Write merged extras
  await fs.writeFile(OUTPUT_EXTRA, JSON.stringify(extras, null, 2), "utf8");
  console.log(`✔ ${OUTPUT_EXTRA} generated (DC markets filled from 1X2)`);
})();
