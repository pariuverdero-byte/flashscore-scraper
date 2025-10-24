// engine.js — Selectează bilete din matches.json + odds.json + odds_extra.json
// Output: tickets.json { bilet_cota2:{selections:[]}, biletul_zilei:{selections:[]} }

import fs from "fs/promises";

// === ENV (poți ajusta din workflow) ===
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);

// Cota 2 (2 selecții)
const C2_MIN = Number(process.env.C2_MIN || 1.9);
const C2_MAX = Number(process.env.C2_MAX || 2.5);
const C2_TOL = Number(process.env.C2_TOL || 0.10); // toleranță

// Biletul Zilei (4 selecții)
const BZ_MIN = Number(process.env.BZ_MIN || 4.0);
const BZ_MAX = Number(process.env.BZ_MAX || 6.0);
const BZ_TOL = Number(process.env.BZ_TOL || 0.20);

// Preferințe piețe (prioritate la alegere)
const MARKET_PREF_ORDER = ["1X", "X2", "12", "O2.5", "U2.5", "1", "2", "X"];

// Ferestre de cote "sănătoase" per piață (pentru scoring)
const MARKET_ODD_BANDS = {
  "1X": [1.35, 1.90],
  "X2": [1.35, 1.90],
  "12": [1.45, 2.10],
  "O2.5": [1.60, 2.20],
  "U2.5": [1.60, 2.20],
  "1": [1.60, 2.30],
  "X": [3.00, 3.70],
  "2": [1.80, 2.60],
};

// === Utils ===
const clamp2 = (x) => Math.round(Number(x) * 100) / 100;

function inRange(val, min, max, tol = 0) {
  return val >= (min - tol) && val <= (max + tol);
}

function productOdds(sel) {
  return sel.reduce((acc, s) => acc * (Number(s.odd) || 1), 1);
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

function normTeams(teams = "") {
  // "Home - Away"
  const [h, a] = String(teams).split(" - ").map((s) => s?.trim());
  return { home: h || "", away: a || "" };
}

// === Load inputs ===
async function loadJSON(path, fallback = null) {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function pickMarketForMatch(match, odds1x2, extra) {
  // Generăm candidați de piață cu cote
  const candidates = [];

  // 1) DC din odds_extra (derivat sau direct)
  for (const m of ["1X", "X2", "12"]) {
    const odd = extra?.[m];
    if (odd) candidates.push({ market: m, odd: Number(odd) });
  }

  // 2) O/U 2.5 din odds_extra
  for (const m of ["O2.5", "U2.5"]) {
    const odd = extra?.[m];
    if (odd) candidates.push({ market: m, odd: Number(odd) });
  }

  // 3) 1X2 — prioritate pe 1 și 2 (X e mai volatil)
  for (const m of ["1", "2", "X"]) {
    const odd = odds1x2?.[m] ?? extra?.[m] ?? null;
    if (odd) candidates.push({ market: m, odd: Number(odd) });
  }

  if (!candidates.length) return null;

  // Scorare: proximitate față de banda recomandată per piață + preferință piețe
  function marketScore(mkt, odd) {
    const band = MARKET_ODD_BANDS[mkt] || [1.4, 2.4];
    // 0 în bandă, crește penalizarea în afara benzii
    const [lo, hi] = band;
    let pen = 0;
    if (odd < lo) pen = lo - odd;
    else if (odd > hi) pen = odd - hi;

    const prefIndex = MARKET_PREF_ORDER.indexOf(mkt);
    const prefBonus = prefIndex >= 0 ? (MARKET_PREF_ORDER.length - prefIndex) * 0.05 : 0;
    // scor mai mare e mai bun => inversăm penalizarea și adăugăm bonus
    return Math.max(0, 1.0 - pen) + prefBonus;
  }

  // Alegem candidatul cu scor maxim
  candidates.sort((a, b) => marketScore(b.market, b.odd) - marketScore(a.market, a.odd));

  return candidates[0]; // best
}

// Combinator simplu pentru găsit 2 sau 4 selecții cu produsul în plajă
function buildTicket(candidates, size, minTotal, maxTotal, tol) {
  // Greedy + backtracking foarte light
  // 1) sort desc by "quality": preferă cote în bandă și piețe preferate
  const scored = candidates.slice().sort((a, b) => {
    // scor: band fit + preferință piață + odd closeness spre target mediu
    const msA = MARKET_ODD_BANDS[a.market] || [1.4, 2.4];
    const msB = MARKET_ODD_BANDS[b.market] || [1.4, 2.4];
    const centerA = (msA[0] + msA[1]) / 2;
    const centerB = (msB[0] + msB[1]) / 2;
    const bandScore = (m, o) => {
      const [lo, hi] = (MARKET_ODD_BANDS[m] || [1.4, 2.4]);
      if (o < lo) return 1 - (lo - o);
      if (o > hi) return 1 - (o - hi);
      return 1.1; // în bandă = ușor bonus
    };
    const pref = (m) => {
      const i = MARKET_PREF_ORDER.indexOf(m);
      return i < 0 ? 0 : (MARKET_PREF_ORDER.length - i) * 0.02;
    };
    const scoreA = bandScore(a.market, a.odd) + pref(a.market) - Math.abs(a.odd - centerA) * 0.02;
    const scoreB = bandScore(b.market, b.odd) + pref(b.market) - Math.abs(b.odd - centerB) * 0.02;
    return scoreB - scoreA;
  });

  // 2) backtracking mic
  const chosen = [];
  function dfs(start, need, accProd) {
    if (need === 0) {
      return inRange(accProd, minTotal, maxTotal, tol) ? chosen.slice() : null;
    }
    if (start >= scored.length) return null;

    for (let i = start; i < scored.length; i++) {
      const s = scored[i];
      // pruning: dacă produsul deja depășește mult, sare
      const nextProd = accProd * s.odd;
      if (nextProd > maxTotal + tol) continue;

      chosen.push(s);
      const res = dfs(i + 1, need - 1, nextProd);
      if (res) return res;
      chosen.pop();
    }
    return null;
  }

  return dfs(0, size, 1) || [];
}

(async () => {
  const matches = await loadJSON("matches.json", []);
  const odds1x2 = await loadJSON("odds.json", { events: [] });
  const extra = await loadJSON("odds_extra.json", {});

  // Index 1X2 odds by match id & market
  const map1x2 = new Map(); // id -> {1, X, 2}
  for (const e of odds1x2.events || []) {
    if (!map1x2.has(e.id)) map1x2.set(e.id, {});
    const row = map1x2.get(e.id);
    row[e.market] = Number(e.odd);
  }

  // Construim candidații (un pick per meci, best market)
  const candidates = [];
  for (const m of matches) {
    const markets1x2 = map1x2.get(m.id) || null;
    const extraRow = extra[m.id]?.markets || null;
    const best = pickMarketForMatch(m, markets1x2, extraRow);
    if (!best) continue;

    const item = {
      id: m.id,
      teams: m.teams,
      market: best.market,
      odd: clamp2(best.odd),
      url: m.url,
      sport: m.sport || "Fotbal",
      competition: m.competition || "",
      time: m.time || "",
      source: extra[m.id]?.sources?.[best.market] || (markets1x2 ? "flashscore-mobi" : "unknown"),
    };
    candidates.push(item);
  }

  // Asigură unicity by match id
  const uniqCandidates = uniqBy(candidates, (x) => x.id);

  // Bilet Cota 2 — 2 selecții, total în [C2_MIN, C2_MAX] ± C2_TOL
  const c2 = buildTicket(uniqCandidates, 2, C2_MIN, C2_MAX, C2_TOL);

  // Exclude selecțiile folosite în Cota 2 din lista pentru Biletul Zilei
  const usedIds = new Set(c2.map((s) => s.id));
  const rest = uniqCandidates.filter((s) => !usedIds.has(s.id));

  // Biletul Zilei — 4 selecții, total în [BZ_MIN, BZ_MAX] ± BZ_TOL
  const bz = buildTicket(rest, 4, BZ_MIN, BZ_MAX, BZ_TOL);

  // Formatează output
  const out = {
    meta: {
      day_offset: DAY_OFFSET,
      generated_at: new Date().toISOString(),
      totals: {
        cota2: clamp2(productOdds(c2)),
        biletul_zilei: clamp2(productOdds(bz)),
      },
    },
    bilet_cota2: {
      selections: c2,
    },
    biletul_zilei: {
      selections: bz,
    },
  };

  await fs.writeFile("tickets.json", JSON.stringify(out, null, 2), "utf8");

  console.log(`✔ tickets.json generat:
 - Cota 2: ${c2.length} selecții, total ${out.meta.totals.cota2}
 - Biletul Zilei: ${bz.length} selecții, total ${out.meta.totals.biletul_zilei}`);
})();
