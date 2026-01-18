// generate_tickets_from_pool.js
// FINAL VERSION — relaxed Biletul Zilei (min 1 sel, min odd 2.20)

import fs from "fs/promises";

const POOL_FILE = "claudiu_pool.json";

// ---------------- RULES ----------------

// COTA 2 (STRICT)
const COTA2 = {
  size: 2,
  min: 1.90,
  max: 2.50,
  target: 2.05
};

// BILETUL ZILEI (RELAXED)
const ZI = {
  minSize: 1,
  maxSize: 4,
  minOdd: 2.20,
  target: 5.00
};

// ---------------- UTILS ----------------
const product = (a) => a.reduce((x, y) => x * y, 1);

function normalizeFp(selections) {
  return selections
    .map(s => `${s.match_id}:${s.market_raw}`)
    .sort()
    .join("|");
}

function onePerMatch(list) {
  const m = new Map();
  for (const s of list) {
    if (!m.has(s.match_id) || s.odd > m.get(s.match_id).odd) {
      m.set(s.match_id, s);
    }
  }
  return [...m.values()];
}

function mdTicket(title, t) {
  const out = [`## ${title}`];
  if (!t) {
    out.push("- (nu a fost generat)");
    return out;
  }
  out.push(`- **Cota totală:** ${t.product.toFixed(2)}`, "");
  for (const s of t.selections) {
    out.push(`- ${s.teams} — **${s.market_raw} @ ${s.odd}**`);
    if (s.url) out.push(`  - Link: ${s.url}`);
    out.push("");
  }
  return out;
}

// ---------------- COMBINATION PICKERS ----------------

function pickCota2(pool, forbiddenFp) {
  let best = null;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      if (a.match_id === b.match_id) continue;

      const p = a.odd * b.odd;
      if (p < COTA2.min || p > COTA2.max) continue;

      const fp = normalizeFp([a, b]);
      if (forbiddenFp.has(fp)) continue;

      const score = Math.abs(p - COTA2.target);
      if (!best || score < best.score) {
        best = { selections: [a, b], product: p, score };
      }
    }
  }
  return best;
}

function pickBiletZi(pool, forbiddenFp, usedMatches) {
  const clean = pool.filter(s => !usedMatches.has(s.match_id));

  for (let size = ZI.maxSize; size >= ZI.minSize; size--) {
    let best = null;

    function bt(start, acc) {
      if (acc.length === size) {
        const p = product(acc.map(x => x.odd));
        if (p < ZI.minOdd) return;

        const fp = normalizeFp(acc);
        if (forbiddenFp.has(fp)) return;

        const score = Math.abs(p - ZI.target);
        if (!best || score < best.score) {
          best = { selections: acc.slice(), product: p, score };
        }
        return;
      }

      for (let i = start; i < clean.length; i++) {
        if (acc.some(x => x.match_id === clean[i].match_id)) continue;
        acc.push(clean[i]);
        bt(i + 1, acc);
        acc.pop();
      }
    }

    bt(0, []);
    if (best) return best;
  }

  return null;
}

// ---------------- MAIN ----------------
(async () => {
  const raw = await fs.readFile(POOL_FILE, "utf8");
  const poolData = JSON.parse(raw);

  const pool = onePerMatch(poolData.selections || []);
  const date = poolData.date;

  const forbiddenFp = new Set();

  // heuristics: blacklist Claudiu tickets if present
  const bySource = {};
  for (const s of poolData.selections || []) {
    bySource[s.source] = bySource[s.source] || [];
    bySource[s.source].push(s);
  }
  if (bySource.cota2?.length >= 2)
    forbiddenFp.add(normalizeFp(bySource.cota2.slice(0, 2)));
  if (bySource.biletul_zilei?.length >= 4)
    forbiddenFp.add(normalizeFp(bySource.biletul_zilei.slice(0, 4)));

  // ---- Generate Cota 2 ----
  const cota2 = pickCota2(pool, forbiddenFp);
  const usedMatches = new Set(cota2?.selections.map(s => s.match_id) || []);

  // ---- Generate Biletul Zilei (RELAXED) ----
  const zi = pickBiletZi(pool, forbiddenFp, usedMatches);

  const out = {
    date,
    source: "pariuverde_pool",
    pool_size: pool.length,
    bilet_cota2: cota2
      ? { product: +cota2.product.toFixed(3), selections: cota2.selections }
      : null,
    biletul_zilei: zi
      ? { product: +zi.product.toFixed(3), selections: zi.selections }
      : null
  };

  await fs.writeFile("tickets.json", JSON.stringify(out, null, 2));

  const md = [
    `# Pariu Verde — ${date}`,
    "",
    ...mdTicket("Bilet Cota 2", cota2),
    "",
    ...mdTicket("Biletul Zilei", zi),
    ""
  ];
  await fs.writeFile("tickets.md", md.join("\n"));

  console.log("[OK] Tickets generated with relaxed Biletul Zilei rules");
})();
