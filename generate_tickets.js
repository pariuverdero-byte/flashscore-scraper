// generate_tickets.js
// FIXED VERSION — păstrează text editorial pentru "Pariu propus"

import fs from "fs/promises";

// ---- Config ----
const INPUT_MAIN  = "odds.json";
const INPUT_EXTRA = "odds_extra.json";

// Ținte bilete
const RULE_COTA2 = { size: 2, min: 1.90, max: 2.50, tol: Number(process.env.COTA2_TOL || 0.15) };
const RULE_ZI    = { size: 4, min: 3.50, max: 7.00, tol: Number(process.env.ZI_TOL || 0.30) };

// ---- Utils ----
const safe = (x) => (x ?? "").toString().trim();

const normMain = (e) => ({
  id: safe(e.id),
  teams: safe(e.teams),
  market: safe(e.market),
  odd: Number(e.odd),
  url: safe(e.url),
  status: safe(e.status),
  sport: safe(e.sport || "football"),
  competition: safe(e.competition || ""),
  country: safe(e.country || ""),
  time: safe(e.time || ""),
  // 🔑 META EDITORIAL
  meta: {
    bet_text: safe(e.bet_text || e.market_text || e.label || ""),
    source: safe(e.source || "")
  }
});

function dedupeIdMarket(arr) {
  const m = new Map();
  for (const e of arr) {
    const k = `${e.id}|${e.market}`;
    if (!m.has(k) || e.odd > m.get(k).odd) m.set(k, e);
  }
  return [...m.values()];
}

const product = (a) => a.reduce((x, y) => x * y, 1);
const within = (v, a, b) => v >= a && v <= b;

// ---- Merge odds_extra.json ----
async function mergeExtras(baseEvents) {
  const raw = await fs.readFile(INPUT_EXTRA, "utf8").catch(() => null);
  if (!raw) return baseEvents;

  let extra = {};
  try { extra = JSON.parse(raw) || {}; } catch { return baseEvents; }

  const byId = new Map();
  for (const e of baseEvents) if (!byId.has(e.id)) byId.set(e.id, e);

  const merged = baseEvents.slice();

  const push = (base, id, market, odd, label) => {
    const val = Number(odd);
    if (!isFinite(val) || val <= 1.01) return;

    merged.push({
      ...base,
      market,
      odd: val,
      meta: {
        ...base.meta,
        bet_text: label || base.meta.bet_text
      }
    });
  };

  for (const [id, pack] of Object.entries(extra)) {
    if (!byId.has(id)) continue;
    const base = byId.get(id);

    if (pack.ou) {
      for (const [k, v] of Object.entries(pack.ou)) {
        push(base, id, k, v, pack.labels?.[k]);
      }
    }
    if (pack.dc) {
      for (const [k, v] of Object.entries(pack.dc)) {
        push(base, id, k, v, pack.labels?.[k]);
      }
    }
  }

  return merged;
}

// ---- Pick combo ----
function pickCombo(E, rule) {
  let best = null;
  const n = E.length;

  function bt(start, acc, used) {
    if (acc.length === rule.size) {
      const p = product(acc.map(x => x.odd));
      if (!within(p, rule.min * (1 - rule.tol), rule.max * (1 + rule.tol))) return;

      if (!best || Math.abs(p - (rule.min + rule.max) / 2) <
                   Math.abs(best.product - (rule.min + rule.max) / 2)) {
        best = { selections: acc.slice(), product: +p.toFixed(2) };
      }
      return;
    }

    for (let i = start; i < n; i++) {
      const e = E[i];
      if (used.has(e.id)) continue;
      used.add(e.id);
      acc.push(e);
      bt(i + 1, acc, used);
      acc.pop();
      used.delete(e.id);
    }
  }

  bt(0, [], new Set());
  return best;
}

// ---- Markdown ----
function mdTicket(title, c) {
  const out = [`## ${title}`];
  if (!c) { out.push("- (nu a fost generat)"); return out; }

  out.push(`- **Cota totală:** ${c.product}`, "");

  for (const s of c.selections) {
    const betText =
      s.meta?.bet_text ||
      s.market ||
      "Pariu special";

    out.push(`- ${s.teams} — **${betText} @ ${s.odd}**`);
    if (s.url) out.push(`  - Link: ${s.url}`);
    out.push("");
  }
  return out;
}

// ---- MAIN ----
(async () => {
  const raw = await fs.readFile(INPUT_MAIN, "utf8").catch(() => null);
  if (!raw) { console.error("❌ odds.json lipsă"); return; }

  let E = (JSON.parse(raw)?.events || []).map(normMain);
  E = await mergeExtras(E);
  E = dedupeIdMarket(E).filter(e => e.odd > 1.03);

  const cota2 = pickCombo(E, RULE_COTA2);
  const used = new Set(cota2?.selections.map(s => s.id) || []);
  const zi = pickCombo(E.filter(e => !used.has(e.id)), RULE_ZI);

  const dt = new Date().toISOString().slice(0,10);

  await fs.writeFile("tickets.json", JSON.stringify({
    date: dt,
    bilet_cota2: cota2,
    biletul_zilei: zi
  }, null, 2));

  const md = [
    `# Pariu Verde — ${dt}`,
    "",
    ...mdTicket("Bilet Cota 2", cota2),
    "",
    ...mdTicket("Biletul Zilei", zi),
    ""
  ];

  await fs.writeFile("tickets.md", md.join("\n"));
  console.log("✅ tickets.json & tickets.md generate corect (cu text editorial)");
})();
