// generate_tickets_from_pool.js
// Generate PariuVerde tickets from claudiu_pool.json (POOL of ideas) with strict rules:
// 1) Cota 2: 2 selections, total odds in [1.90, 2.50]
// 2) Biletul Zilei: 4 selections, total odds in [3.50, 7.00]
// Additional constraints:
// - one selection per match (pool already one-per-match, but we enforce again)
// - Biletul Zilei does NOT overlap Cota 2 (no same match_id)
// - Our tickets MUST NOT be identical to Claudiu tickets (avoid exact sets)
//
// Input:  claudiu_pool.json  (created by scrape_claudiu_pool.js)
// Optional input: claudiu_original.json (if you want to explicitly blacklist exact Claudiu ticket sets)
// Output: tickets.json + tickets.md

import fs from "fs/promises";

const POOL_FILE = process.env.CLAUDIU_POOL_FILE || "claudiu_pool.json";

// strict ranges
const RULE_COTA2 = {
  size: 2,
  min: Number(process.env.PV_COTA2_MIN || 1.90),
  max: Number(process.env.PV_COTA2_MAX || 2.50),
  tol: Number(process.env.PV_COTA2_TOL || 0.0), // keep strict by default
};
const RULE_ZI = {
  size: 4,
  min: Number(process.env.PV_ZI_MIN || 3.50),
  max: Number(process.env.PV_ZI_MAX || 7.00),
  tol: Number(process.env.PV_ZI_TOL || 0.0), // keep strict by default
};

// Prefer odds around these targets
const TARGET_COTA2 = Number(process.env.PV_TARGET_COTA2 || 2.05);
const TARGET_ZI = Number(process.env.PV_TARGET_ZI || 5.00);

// Make sure we don't produce the same sets as Claudiu's daily tickets
// You can pass comma-separated "set fingerprints" via env if you have them.
// But we also auto-build blacklists from typical Claudiu pages in the pool (cota2/biletul_zilei) if present.
const ENV_BLACKLIST = (process.env.PV_BLACKLIST || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const log = (msg) => console.log(`[pv_gen] ${msg}`);

const product = (arr) => arr.reduce((x, y) => x * y, 1);
const within = (v, a, b) => v >= a && v <= b;

function distToTarget(v, target) {
  return Math.abs(v - target);
}

function fingerprint(selections) {
  // stable fingerprint of a ticket by match_id+market_raw
  // sorting ensures order doesn't matter
  const parts = selections
    .map(s => `${s.match_id}:${s.market_raw}`)
    .sort();
  return parts.join("|");
}

function mdTicket(title, ticket, rule) {
  const out = [`## ${title}`];
  if (!ticket) {
    out.push("- (nu am găsit combinație)");
    return out;
  }
  out.push(`- **Cota totală:** ${ticket.product.toFixed(3)}  _(țintă ${rule.min}-${rule.max})_`);
  out.push("");

  for (const s of ticket.selections) {
    out.push(`- ${s.teams} — **${s.market_raw} @ ${Number(s.odd).toFixed(2)}**`);
    if (s.country) out.push(`  - Țară: ${s.country}`);
    if (s.competition) out.push(`  - Competiție: ${s.competition}`);
    if (s.time) out.push(`  - Ora: ${s.time}`);
    if (s.url) out.push(`  - Link: ${s.url}`);
    if (s.meta?.bet_text) out.push(`  - Text (Hood): ${s.meta.bet_text}`);
    out.push("");
  }
  return out;
}

function onePerMatch(list) {
  const by = new Map();
  for (const s of list) {
    const k = s.match_id;
    if (!by.has(k) || s.odd > by.get(k).odd) by.set(k, s);
  }
  return [...by.values()];
}

function buildClaudiuBlacklistsFromPool(poolSelections) {
  // Heuristic: if pool contains selections sourced from "cota2" and "biletul_zilei",
  // build blacklists equal to:
  // - Claudiu Cota2 = first 2 selections from that source (by appearance)
  // - Claudiu Biletul Zilei = first 4 selections from that source
  //
  // This matches your current scraping approach where page order is preserved.
  // If pages change order, you'll still avoid exact overlaps for most cases.
  const bySource = new Map();
  for (const s of poolSelections) {
    const src = s.source || "";
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(s);
  }

  const bl = new Set();

  const c2 = bySource.get("cota2") || [];
  if (c2.length >= 2) bl.add(fingerprint(c2.slice(0, 2)));

  const zi = bySource.get("biletul_zilei") || [];
  if (zi.length >= 4) bl.add(fingerprint(zi.slice(0, 4)));

  // If he uses "varianta_rezerva" as a ticket sometimes, you can blacklist too:
  const rez = bySource.get("varianta_rezerva") || [];
  if (rez.length >= 2) bl.add(fingerprint(rez.slice(0, 2)));

  return bl;
}

function pickBestCombo(candidates, rule, target, forbiddenFingerprints = new Set(), forbiddenMatchIds = new Set()) {
  const arr = onePerMatch(candidates).filter(s => !forbiddenMatchIds.has(s.match_id));

  const n = arr.length;
  if (n < rule.size) return null;

  const best = { ticket: null, score: Infinity };

  // Backtracking / combination search with pruning
  const chosen = [];
  const usedMatches = new Set();

  const minAllowed = rule.min * (1 - rule.tol);
  const maxAllowed = rule.max * (1 + rule.tol);

  function bt(startIdx) {
    if (chosen.length === rule.size) {
      const p = product(chosen.map(x => x.odd));
      if (!within(p, minAllowed, maxAllowed)) return;

      const fp = fingerprint(chosen);
      if (forbiddenFingerprints.has(fp)) return;

      const score = distToTarget(p, target);
      if (score < best.score) {
        best.score = score;
        best.ticket = { selections: chosen.slice(), product: p, fingerprint: fp };
      }
      return;
    }

    for (let i = startIdx; i < n; i++) {
      const s = arr[i];
      if (usedMatches.has(s.match_id)) continue;

      // simple pruning:
      // estimate min/max possible product given remaining picks (loose, but helps)
      const current = product(chosen.map(x => x.odd));
      const remaining = rule.size - chosen.length;
      const optimisticMin = current * Math.pow(1.15, remaining); // assume low odds remaining
      const optimisticMax = current * Math.pow(5.0, remaining);  // assume high odds remaining
      if (optimisticMin > maxAllowed) continue;
      if (optimisticMax < minAllowed) continue;

      usedMatches.add(s.match_id);
      chosen.push(s);
      bt(i + 1);
      chosen.pop();
      usedMatches.delete(s.match_id);
    }
  }

  bt(0);
  return best.ticket;
}

(async () => {
  const raw = await fs.readFile(POOL_FILE, "utf8").catch(() => null);
  if (!raw) {
    log(`❌ Missing ${POOL_FILE}`);
    process.exit(1);
  }

  const pool = JSON.parse(raw);
  const date = pool.date || new Date().toISOString().slice(0, 10);
  const selections = Array.isArray(pool.selections) ? pool.selections : [];

  if (!selections.length) {
    log("❌ Pool empty. Writing empty tickets.");
    const out = { date, source: "pariuverde_pool", bilet_cota2: null, biletul_zilei: null, pool_size: 0 };
    await fs.writeFile("tickets.json", JSON.stringify(out, null, 2), "utf8");
    await fs.writeFile("tickets.md", `# Pariu Verde — ${date}\n\n- (pool gol)\n`, "utf8");
    process.exit(0);
  }

  // Build forbidden fingerprints:
  const forbidden = new Set(ENV_BLACKLIST);
  for (const fp of buildClaudiuBlacklistsFromPool(selections)) forbidden.add(fp);

  // --- Generate PV Cota2 ---
  const pvC2 = pickBestCombo(
    selections,
    RULE_COTA2,
    TARGET_COTA2,
    forbidden,
    new Set()
  );

  // --- Generate PV ZI (no overlap with Cota2 matches) ---
  const usedByC2 = new Set((pvC2?.selections || []).map(s => s.match_id));

  const pvZI = pickBestCombo(
    selections,
    RULE_ZI,
    TARGET_ZI,
    forbidden,
    usedByC2
  );

  // If no strict ticket found, you can optionally allow tolerance:
  // (You can set PV_COTA2_TOL / PV_ZI_TOL in env to allow near hits.)
  const out = {
    date,
    source: "pariuverde_pool",
    pool_size: selections.length,
    constraints: {
      cota2: { size: RULE_COTA2.size, min: RULE_COTA2.min, max: RULE_COTA2.max, tol: RULE_COTA2.tol },
      zi: { size: RULE_ZI.size, min: RULE_ZI.min, max: RULE_ZI.max, tol: RULE_ZI.tol }
    },
    blacklist_count: forbidden.size,
    bilet_cota2: pvC2 ? { product: Number(pvC2.product.toFixed(3)), selections: pvC2.selections, fingerprint: pvC2.fingerprint } : null,
    biletul_zilei: pvZI ? { product: Number(pvZI.product.toFixed(3)), selections: pvZI.selections, fingerprint: pvZI.fingerprint } : null
  };

  // Write tickets.json
  await fs.writeFile("tickets.json", JSON.stringify(out, null, 2), "utf8");

  // Write tickets.md
  const md = [
    `# Pariu Verde — ${date}`,
    "",
    `> Pool selections: **${selections.length}** (din Claudiu Hood, combinat de PariuVerde)`,
    "",
    ...mdTicket(`Bilet Cota 2 (2 selecții; țintă ${RULE_COTA2.min}-${RULE_COTA2.max})`, pvC2, RULE_COTA2),
    "",
    ...mdTicket(`Biletul Zilei (4 selecții; țintă ${RULE_ZI.min}-${RULE_ZI.max}) — fără suprapunere cu Cota 2`, pvZI, RULE_ZI),
    ""
  ];
  await fs.writeFile("tickets.md", md.join("\n"), "utf8");

  log(`[OK] Generated tickets from pool (c2=${pvC2 ? pvC2.product.toFixed(3) : "none"}, zi=${pvZI ? pvZI.product.toFixed(3) : "none"})`);
})();
