// generate_tickets.js
// Generează biletele (Cota 2 + Biletul Zilei) din odds.json + (opțional) odds_extra.json

import fs from "fs/promises";

// ---- Config ----
const INPUT_MAIN = "odds.json";           // 1X2
const INPUT_EXTRA = "odds_extra.json";    // DC + O/U (opțional)

const RULE_COTA2 = {
  size: 2,
  min: 1.90,
  max: 2.50,
  tol: Number(process.env.COTA2_TOL || 0.15), // ±15% default
};

const RULE_ZI = {
  size: 4,
  min: 4.00,
  max: 6.00,
  tol: Number(process.env.ZI_TOL || 0.30),    // ±30% default
};

// Competiții/ligi prioritare (pentru ordonare când avem multe opțiuni echivalente)
const PRIORITY_COMP = [
  "Premier League","LaLiga","Serie A","Bundesliga","Ligue 1",
  "Champions League","Europa League","Conference League","Cupa României",
  "NBA","Euroleague","ATP","WTA","Grand Slam","Wimbledon","US Open","Roland Garros"
];

// Ordinea preferată a piețelor (vom alege mai întâi piețe de aici)
const PREF_MARKETS = [
  // 1X2
  "1","X","2",
  // Double Chance
  "1X","12","X2",
  // O/U
  "O1.5","U1.5","O2.5","U2.5","O3.5","U3.5"
];

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
  time: safe(e.time || ""),
});

function dedupeIdMarket(arr) {
  const m = new Map(); // key = id|market, păstrăm cota cea mai bună
  for (const e of arr) {
    const k = `${e.id}|${e.market}`;
    if (!m.has(k) || e.odd > m.get(k).odd) m.set(k, e);
  }
  return [...m.values()];
}

function compScore(c) {
  const s = (c || "").toLowerCase();
  for (let i = 0; i < PRIORITY_COMP.length; i++) {
    if (s.includes(PRIORITY_COMP[i].toLowerCase())) return i;
  }
  if (/england|spain|italy|germany|france|romania|portugal|netherlands/i.test(s))
    return PRIORITY_COMP.length + 1;
  return PRIORITY_COMP.length + 3;
}

function marketScore(m) {
  const i = PREF_MARKETS.indexOf(m);
  return i === -1 ? 99 : i;
}

function sortPref(list) {
  // Mic „bias” spre cote medii (nu extrem de mici/foarte mari)
  const midBias = (o) => Math.abs(o - 1.7);
  return list
    .slice()
    .sort(
      (a, b) =>
        compScore(a.competition) - compScore(b.competition) ||
        marketScore(a.market) - marketScore(b.market) ||
        midBias(a.odd) - midBias(b.odd)
    );
}

const product = (a) => a.reduce((x, y) => x * y, 1);
const within = (v, a, b) => v >= a && v <= b;
const distRange = (v, a, b) => (v < a ? a - v : v > b ? v - b : 0);

// ---- Îmbinare odds_extra.json (dacă există) ----
// odds_extra.json așteptat în forma:
// { "<id>": { "dc": { "1X": 1.35, "12": 1.30, "X2": 1.40 }, "ou": { "O1.5": 1.25, "U1.5": 4.00, "O2.5": 1.85, "U2.5": 1.95, ... } } }
async function mergeExtras(baseEvents) {
  const raw = await fs.readFile(INPUT_EXTRA, "utf8").catch(() => null);
  if (!raw) return baseEvents;

  let extraJson = {};
  try {
    extraJson = JSON.parse(raw) || {};
  } catch {
    return baseEvents;
  }

  const byId = new Map();
  for (const e of baseEvents) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }

  const merged = baseEvents.slice();

  for (const [id, pack] of Object.entries(extraJson)) {
    if (!byId.has(id)) continue; // avem extra doar pentru meciurile deja cunoscute
    const base = byId.get(id);

    const pushMarket = (market, odd) => {
      const val = Number(odd);
      if (!isFinite(val) || val <= 1.01) return;
      merged.push({
        id,
        teams: base.teams,
        market,
        odd: val,
        url: base.url,
        status: base.status || "",
        sport: base.sport || "football",
        competition: base.competition || "",
        time: base.time || "",
      });
    };

    // Double Chance
    if (pack.dc) {
      for (const k of ["1X", "12", "X2"]) {
        if (pack.dc[k]) pushMarket(k, pack.dc[k]);
      }
    }
    // Over/Under (1.5 / 2.5 / 3.5)
    if (pack.ou) {
      for (const k of ["O1.5", "U1.5", "O2.5", "U2.5", "O3.5", "U3.5"]) {
        if (pack.ou[k]) pushMarket(k, pack.ou[k]);
      }
    }
  }

  return merged;
}

// ---- Alegerea combinațiilor ----
function pickCombo(E, rule) {
  const arr = sortPref(E);
  const lo = rule.min;
  const hi = rule.max;
  const loT = lo * (1 - rule.tol);
  const hiT = hi * (1 + rule.tol);
  const mid = (lo + hi) / 2;

  let bestExact = null;
  let bestTol = null;
  let bestAny = null;

  const n = arr.length;
  const used = new Set();

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
    if (!bestAny || distRange(p, lo, hi) < distRange(bestAny.product, lo, hi))
      bestAny = obj;
  }

  function bt(idx, ch) {
    if (ch.length === rule.size) {
      consider(ch);
      return;
    }
    for (let i = idx; i < n; i++) {
      const e = arr[i];
      if (used.has(e.id)) continue; // nu punem două pariuri din același meci
      used.add(e.id);
      ch.push(e);
      bt(i + 1, ch);
      ch.pop();
      used.delete(e.id);
      if (bestExact) return; // oprim devreme dacă am găsit exact
    }
  }

  bt(0, []);

  const res = bestExact || bestTol || bestAny;
  if (!res) return null;

  const status = within(res.product, lo, hi)
    ? "exact"
    : within(res.product, loT, hiT)
    ? "aproape"
    : "cel_mai_apropiat";

  return {
    ...res,
    status,
    range: { min: lo, max: hi },
    tolRange: { min: loT, max: hiT },
  };
}

// Exclude meciurile deja folosite la Cota 2
function excludeIds(E, ids) {
  if (!ids?.size) return E;
  return E.filter((x) => !ids.has(x.id));
}

// Markdown friendly
function mdTicket(title, c) {
  const out = [`## ${title}`];
  if (!c) {
    out.push("- (nu am găsit combinație)");
    return out;
  }
  const badge =
    c.status === "exact"
      ? "✅ exact"
      : c.status === "aproape"
      ? "≈ aproape"
      : "≈ cel mai apropiat";

  out.push(
    `- **Cota totală:** ${c.product}  _(${badge}, țintă ${c.range.min}-${c.range.max})_`,
    ""
  );

  for (const s of c.selections) {
    out.push(`- ${s.teams} — **${s.market} @ ${s.odd.toFixed(2)}**`);
    if (s.competition) out.push(`  - Competiție: ${s.competition}`);
    if (s.time) out.push(`  - Ora: ${s.time}`);
    if (s.url) out.push(`  - Link: ${s.url}`);
    out.push("");
  }
  return out;
}

// ---- Main ----
(async () => {
  // 1) odds.json obligatoriu
  const raw = await fs.readFile(INPUT_MAIN, "utf8").catch(() => null);
  if (!raw) {
    console.error("❌ odds.json lipsă");
    process.exit(0);
  }

  const baseEvents = (JSON.parse(raw)?.events || []).map(normMain);

  // 2) Adaugă piețe extra dacă există odds_extra.json
  let E = await mergeExtras(baseEvents);

  // Curățare & dedup
  E = dedupeIdMarket(E)
    .filter((e) => !/^(live|fin|finished)$/i.test(e.status || ""))
    .filter((e) => isFinite(e.odd) && e.odd > 1.03 && e.odd < 100);

  // 3) Construim biletele
  const cota2 = pickCombo(E, RULE_COTA2);

  let remaining = E;
  if (cota2?.selections) {
    remaining = excludeIds(E, new Set(cota2.selections.map((s) => s.id)));
  }

  const zi = pickCombo(remaining, RULE_ZI);

  // 4) Output
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
      `Biletul Zilei (4 selecții; țintă ${RULE_ZI.min}-${RULE_ZI.max}; tol ±${Math.round(
        RULE_ZI.tol * 100
      )}%) — fără suprapunere cu Cota 2`,
      zi
    ),
    "",
  ];

  await fs.writeFile(
    "tickets.json",
    JSON.stringify(
      { date: dt, bilet_cota2: cota2 || null, biletul_zilei: zi || null },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile("tickets.md", md.join("\n"), "utf8");

  console.log(
    `[OK] tickets.json & tickets.md generate (${cota2 ? "c2" : "no c2"}, ${
      zi ? "zi" : "no zi"
    })`
  );
})();
