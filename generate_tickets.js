// generate_tickets.js
// Creează bilete din odds.json (scraper Flashscore.mobi)
//
// - Bilet Cota 2: 2 selecții, țintă [1.90–2.50], toleranță ±COTA2_TOL (default 15%)
// - Biletul Zilei: 4 selecții, țintă [4.00–6.00], toleranță ±ZI_TOL (default 30%)
// - Se folosesc DOAR evenimente programate (exclude live / finished)
// - Biletele NU reciclează aceleași meciuri (disjuncte)
//
// Output: tickets.json + tickets.md
//
// ENV (opțional):
//   COTA2_TOL=0.15
//   ZI_TOL=0.30

import fs from "fs/promises";

// -------------------- Config --------------------
const INPUT = "odds.json";

const RULE_COTA2 = {
  size: 2,
  min: 1.90,
  max: 2.50,
  tol: Number(process.env.COTA2_TOL || 0.15),
};

const RULE_ZI = {
  size: 4,
  min: 4.00,
  max: 6.00,
  tol: Number(process.env.ZI_TOL || 0.30),
};

// priorități competiții/piețe (necesar doar pt sortare)
const PRIORITY_COMP = [
  "Premier League",
  "LaLiga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Champions League",
  "Europa League",
  "Conference League",
  "Cupa României",
  "NBA",
  "Euroleague",
  "ATP",
  "WTA",
  "Grand Slam",
  "Wimbledon",
  "US Open",
  "Roland Garros",
];

const PREFERRED_MARKETS = ["1", "X", "2", "1X", "12", "X2"];

// -------------------- Utils --------------------
function product(arr) {
  return arr.reduce((x, y) => x * y, 1);
}
function within(v, a, b) {
  return v >= a && v <= b;
}
function distanceToRange(v, a, b) {
  return v < a ? a - v : v > b ? v - b : 0;
}
function safeStr(x, def = "") {
  const s = (x ?? "").toString();
  return s.trim();
}

// normalizează evenimentul
function norm(e) {
  return {
    id: safeStr(e.id),
    teams: safeStr(e.teams),
    market: safeStr(e.market),
    odd: Number(e.odd),
    url: safeStr(e.url),
    status: safeStr(e.status), // "sched" / "live" / "fin" / "finished"
    sport: safeStr(e.sport || "football"),
    competition: safeStr(e.competition || ""),
    time: safeStr(e.time || ""),
  };
}

// elimină duplicate (același meci+piață, păstrează cota mai mare)
function dedupeIdMarket(events) {
  const map = new Map();
  for (const e of events) {
    const k = `${e.id}|${e.market}`;
    if (!map.has(k) || e.odd > map.get(k).odd) map.set(k, e);
  }
  return [...map.values()];
}

// scor de preferință competiție
function compScore(c) {
  const s = (c || "").toLowerCase();
  for (let i = 0; i < PRIORITY_COMP.length; i++) {
    if (s.includes(PRIORITY_COMP[i].toLowerCase())) return i; // mai mic = mai preferat
  }
  if (/england|spain|italy|germany|france|romania|portugal|netherlands/i.test(s)) return PRIORITY_COMP.length + 1;
  return PRIORITY_COMP.length + 3;
}

// scor piață (1X2 mai preferat)
function marketScore(m) {
  const idx = PREFERRED_MARKETS.indexOf(m);
  return idx === -1 ? 99 : idx;
}

// sortare preferințe generale
function sortPref(list) {
  return list
    .slice()
    .sort((a, b) => {
      const c = compScore(a.competition) - compScore(b.competition);
      if (c) return c;
      const m = marketScore(a.market) - marketScore(b.market);
      if (m) return m;
      // în jur de 1.70 e "mai safe"
      return Math.abs(a.odd - 1.7) - Math.abs(b.odd - 1.7);
    });
}

// caută combinație de m elemente cu produs în range (cu toleranță fallback)
function pickCombo(E, rule) {
  const arr = sortPref(E);
  const lo = rule.min,
    hi = rule.max,
    loT = lo * (1 - rule.tol),
    hiT = hi * (1 + rule.tol),
    mid = (lo + hi) / 2;

  let bestExact = null,
    bestTol = null,
    bestAny = null;

  const n = arr.length;
  const usedIds = new Set();

  function consider(ch) {
    const p = Number(product(ch.map((s) => s.odd)).toFixed(3));
    const obj = { selections: ch.slice(), product: p };
    if (within(p, lo, hi) && !bestExact) {
      bestExact = obj;
      return;
    }
    if (within(p, loT, hiT)) {
      const d = Math.abs(p - mid);
      if (!bestTol || d < Math.abs(bestTol.product - mid)) bestTol = obj;
    }
    if (!bestAny || distanceToRange(p, lo, hi) < distanceToRange(bestAny.product, lo, hi)) bestAny = obj;
  }

  function bt(idx, ch) {
    if (ch.length === rule.size) {
      consider(ch);
      return;
    }
    for (let i = idx; i < n; i++) {
      const e = arr[i];
      if (usedIds.has(e.id)) continue; // nu repetăm același meci în bilet
      usedIds.add(e.id);
      ch.push(e);
      bt(i + 1, ch);
      ch.pop();
      usedIds.delete(e.id);
      if (bestExact) return; // am găsit perfect, ne oprim
    }
  }

  bt(0, []);

  const res = bestExact || bestTol || bestAny;
  if (!res) return null;

  let status = "exact";
  if (!within(res.product, lo, hi)) status = within(res.product, loT, hiT) ? "aproape" : "cel_mai_apropiat";

  return { ...res, status, range: { min: lo, max: hi }, tolRange: { min: loT, max: hiT } };
}

function excludeIds(E, idsSet) {
  if (!idsSet || !idsSet.size) return E;
  return E.filter((x) => !idsSet.has(x.id));
}

function mdTicket(title, c) {
  const out = [`## ${title}`];
  if (!c) {
    out.push("- (nu am găsit o combinație potrivită)");
    return out;
  }
  const badge = c.status === "exact" ? "✅ exact" : c.status === "aproape" ? "≈ aproape" : "≈ cel mai apropiat";
  out.push(`- **Cota totală:** ${c.product}  _(${badge}, țintă ${c.range.min}-${c.range.max})_`);
  out.push("");
  for (const s of c.selections) {
    out.push(`- ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
    if (s.competition) out.push(`  - Competiție: ${s.competition}`);
    if (s.time) out.push(`  - Ora: ${s.time}`);
    if (s.url) out.push(`  - Link: ${s.url}`);
    out.push("");
  }
  return out;
}

// -------------------- Main --------------------
(async () => {
  const raw = await fs.readFile(INPUT, "utf8").catch(() => null);
  if (!raw) {
    console.error("odds.json missing — nu pot genera bilete.");
    process.exit(0);
  }

  const E0 = JSON.parse(raw)?.events || [];
  // normalize + filtrează doar programatele + cote valide
  let E = dedupeIdMarket(E0.map(norm))
    .filter((e) => !/^(live|fin|finished)$/i.test(e.status || "")) // DOAR programate
    .filter((e) => isFinite(e.odd) && e.odd > 1.05 && e.odd < 50);

  // COTA 2
  const cota2 = pickCombo(E, RULE_COTA2);

  // excludem meciurile folosite în Cota 2
  let remaining = E;
  if (cota2?.selections) remaining = excludeIds(E, new Set(cota2.selections.map((s) => s.id)));

  // BILETUL ZILEI
  const zi = pickCombo(remaining, RULE_ZI);

  const dt = new Date().toISOString().slice(0, 10);
  const md = [
    `# Pariu Verde — ${dt}`,
    "",
    ...mdTicket(
      `Bilet Cota 2 (2 selecții; țintă ${RULE_COTA2.min}-${RULE_COTA2.max}; tol ±${Math.round(
        RULE_COTA2.tol * 100
      )}%)`,
      cota2
    ),
    "",
    ...mdTicket(
      `Biletul Zilei (4 selecții; țintă ${RULE_ZI.min}-${RULE_ZI.max}; tol ±${Math.round(RULE_ZI.tol * 100)}%) — fără suprapunere cu Cota 2`,
      zi
    ),
    "",
  ];

  // scriem fișierele
  await fs.writeFile(
    "tickets.json",
    JSON.stringify({ date: dt, bilet_cota2: cota2 || null, biletul_zilei: zi || null }, null, 2),
    "utf8"
  );
  await fs.writeFile("tickets.md", md.join("\n"), "utf8");

  console.log("[OK] tickets.json & tickets.md generate");
})();
