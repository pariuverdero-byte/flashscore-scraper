// generate_tickets_from_pool.js
// FINAL — fallback-safe, no-picks-safe

import fs from "fs/promises";

const POOL_FILE = "master_pool.json";

// ---------------- RULES ----------------

// COTA 2
const COTA2 = {
  size: 2,
  min: 1.9,
  max: 2.5,
  target: 2.05
};

// BILETUL ZILEI
const ZI = {
  minSize: 1,
  maxSize: 4,
  minOdd: 2.2,
  target: 5.0
};

// ---------------- UTILS ----------------
const product = (arr) => arr.reduce((x, y) => x * y, 1);

function normalizeFp(selections) {
  return selections
    .map((s) => `${s.match_id}:${s.market_raw}`)
    .sort()
    .join("|");
}

function onePerMatch(list) {
  const m = new Map();

  for (const s of list) {
    if (!s?.match_id) continue;

    const odd = Number(s.odd);
    if (!Number.isFinite(odd)) continue;

    if (!m.has(s.match_id) || odd > Number(m.get(s.match_id).odd)) {
      m.set(s.match_id, { ...s, odd });
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

async function writeNoPicks(date, reason, poolSize = 0, extra = {}) {
  const out = {
    date: date || new Date().toISOString().slice(0, 10),
    source: "master_pool",
    status: "no_picks",
    reason,
    pool_size: poolSize,
    bilet_cota2: null,
    biletul_zilei: null,
    ...extra
  };

  await fs.writeFile("tickets.json", JSON.stringify(out, null, 2), "utf8");

  const md = [
    `# Pariu Verde — ${out.date}`,
    "",
    `Status: no_picks`,
    `Reason: ${reason}`,
    "",
    "## Bilet Cota 2",
    "- (nu a fost generat)",
    "",
    "## Biletul Zilei",
    "- (nu a fost generat)",
    ""
  ];

  await fs.writeFile("tickets.md", md.join("\n"), "utf8");
}

// ---------------- COMBINATION PICKERS ----------------

function pickCota2(pool, forbiddenFp) {
  let best = null;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];

      if (a.match_id === b.match_id) continue;

      const p = Number(a.odd) * Number(b.odd);
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
  const clean = pool.filter((s) => !usedMatches.has(s.match_id));

  for (let size = ZI.maxSize; size >= ZI.minSize; size--) {
    let best = null;

    function bt(start, acc) {
      if (acc.length === size) {
        const p = product(acc.map((x) => Number(x.odd)));
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
        if (acc.some((x) => x.match_id === clean[i].match_id)) continue;
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
  try {
    let poolData;

    try {
      const raw = await fs.readFile(POOL_FILE, "utf8");
      poolData = JSON.parse(raw);
    } catch (err) {
      await writeNoPicks(
        new Date().toISOString().slice(0, 10),
        `Could not read ${POOL_FILE}: ${err.message}`,
        0
      );
      console.log(`[INFO] ${POOL_FILE} missing or invalid. Wrote no_picks output.`);
      process.exit(0);
    }

    const allSelections = Array.isArray(poolData?.selections) ? poolData.selections : [];
    const pool = onePerMatch(allSelections).filter(
      (s) => s && s.match_id && s.market_raw && Number.isFinite(Number(s.odd)) && Number(s.odd) > 1
    );

    const date = poolData?.date || new Date().toISOString().slice(0, 10);
    const sourceMode = poolData?.source_mode || "unknown";

    if (allSelections.length === 0) {
      await writeNoPicks(date, "MASTER pool has no selections", 0, {
        source_mode: sourceMode
      });
      console.log("[INFO] No selections found in master_pool.json");
      process.exit(0);
    }

    const forbiddenFp = new Set();

    const bySource = {};
    for (const s of allSelections) {
      if (!s?.source) continue;
      bySource[s.source] = bySource[s.source] || [];
      bySource[s.source].push(s);
    }

    if (bySource.cota2?.length >= 2) {
      forbiddenFp.add(normalizeFp(bySource.cota2.slice(0, 2)));
    }

    if (bySource.biletul_zilei?.length >= 4) {
      forbiddenFp.add(normalizeFp(bySource.biletul_zilei.slice(0, 4)));
    }

    const cota2 = pool.length >= 2 ? pickCota2(pool, forbiddenFp) : null;
    const usedMatches = new Set(cota2?.selections.map((s) => s.match_id) || []);
    const zi = pool.length >= 1 ? pickBiletZi(pool, forbiddenFp, usedMatches) : null;

    const status = cota2 || zi ? "ok" : "no_picks";

    let reason = null;
    if (status === "no_picks") {
      if (pool.length === 0) reason = "No valid selections after normalization";
      else if (pool.length === 1) reason = "Only one usable match available";
      else reason = "No combinations matched configured odds rules";
    }

    const out = {
      date,
      source: "master_pool",
      source_mode: sourceMode,
      status,
      reason,
      pool_size: pool.length,
      bilet_cota2: cota2
        ? {
            product: +cota2.product.toFixed(3),
            selections: cota2.selections
          }
        : null,
      biletul_zilei: zi
        ? {
            product: +zi.product.toFixed(3),
            selections: zi.selections
          }
        : null
    };

    await fs.writeFile("tickets.json", JSON.stringify(out, null, 2), "utf8");

    const md = [
      `# Pariu Verde — ${date}`,
      "",
      `Status: ${status}`,
      ...(reason ? [`Reason: ${reason}`, ""] : [""]),
      ...mdTicket("Bilet Cota 2", cota2),
      "",
      ...mdTicket("Biletul Zilei", zi),
      ""
    ];

    await fs.writeFile("tickets.md", md.join("\n"), "utf8");

    console.log(`[OK] Tickets generated from ${POOL_FILE}`);
    console.log(`[INFO] source_mode: ${sourceMode}`);
    console.log(`[INFO] Pool size: ${pool.length}`);
    console.log(`[INFO] Cota 2: ${cota2 ? "generated" : "not generated"}`);
    console.log(`[INFO] Biletul Zilei: ${zi ? "generated" : "not generated"}`);

    process.exit(0);
  } catch (err) {
    console.error("[ERROR] Ticket generation failed:", err?.message || err);

    try {
      await writeNoPicks(
        new Date().toISOString().slice(0, 10),
        `Generator exception: ${err?.message || String(err)}`,
        0
      );
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }
})();
