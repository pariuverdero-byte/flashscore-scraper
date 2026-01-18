// generate_tickets_claudiuhood.js
// Flow:
// 1) Build ClaudiuHood daily URLs (Cota 2 + Biletul Zilei) from date
// 2) Extract events + odds from WP tables
// 3) Validate against target ranges (same as current script)
// 4) Map events to Flashscore matches.json (from scrape_mobi.js)
// 5) Output tickets.json & tickets.md
// 6) If no valid tickets for today -> fallback: node generate_tickets.js

import fs from "fs/promises";
import * as cheerio from "cheerio";
import crypto from "crypto";
import { execSync } from "child_process";

// ---------------- Config ----------------
const TZ = "Europe/Bucharest";

const RULE_COTA2 = {
  size: 2,
  min: 1.9,
  max: 2.5,
  tol: Number(process.env.COTA2_TOL || 0.15),
};

const RULE_ZI = {
  size: 4,
  min: 4.0,
  max: 6.0,
  tol: Number(process.env.ZI_TOL || 0.3),
};

const MATCHES_JSON = "matches.json"; // output from scrape_mobi.js
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

// optional: if you want tomorrow, set DAY_OFFSET=1 (same env as your other flow)
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);

const RO_MONTH = [
  "ianuarie",
  "februarie",
  "martie",
  "aprilie",
  "mai",
  "iunie",
  "iulie",
  "august",
  "septembrie",
  "octombrie",
  "noiembrie",
  "decembrie",
];

// ---------------- Utils ----------------
const safe = (x) => (x ?? "").toString().trim();

function toBucharestDateWithOffset(offsetDays) {
  // Create a "local date" in Europe/Bucharest without relying on system TZ:
  // We approximate by using Intl.DateTimeFormat parts.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  // Construct a Date in UTC from these components, then add offset days
  const baseUtc = new Date(Date.UTC(y, m - 1, d));
  baseUtc.setUTCDate(baseUtc.getUTCDate() + offsetDays);

  // Return components
  return {
    year: baseUtc.getUTCFullYear(),
    month: baseUtc.getUTCMonth() + 1,
    day: baseUtc.getUTCDate(),
  };
}

function buildClaudiuUrls({ year, month, day }) {
  const monthName = RO_MONTH[month - 1];
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");

  return {
    cota2: `https://www.claudiuhood.ro/cota-2-zilnica-${day}-${monthName}-${year}/`,
    zi: `https://www.claudiuhood.ro/biletul-zilei-${dd}-${mm}-${year}/`,
  };
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

const product = (arr) => arr.reduce((x, y) => x * y, 1);
const within = (v, a, b) => v >= a && v <= b;

function distRange(v, a, b) {
  return v < a ? a - v : v > b ? v - b : 0;
}

function normalizeTeamStr(s) {
  // Normalize: lowercase, remove diacritics, punctuation, common suffixes
  const noDiacritics = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return noDiacritics
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[’'".,()]/g, " ")
    .replace(/\b(fc|cf|c\.f\.|a\.f\.c\.|afc|sc|acs|as|ss|cd|fk|sk)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTeams(teamsRaw) {
  const t = safe(teamsRaw)
    .replace(/\u2013|\u2014/g, "-") // en dash / em dash -> hyphen
    .replace(/\s+-\s+/g, "-");
  const parts = t.split("-").map((x) => safe(x));
  if (parts.length >= 2) return [parts[0], parts.slice(1).join("-")].map(safe);
  return [safe(teamsRaw), ""];
}

function parseOddFromText(s) {
  // Examples: "Cotă 1.37", "Cota 2.11", "Cotă 4.95"
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(s || ""));
  if (!m) return NaN;
  return Number(m[1].replace(",", "."));
}

// ---------------- Extract from Claudiu Hood ----------------
// The pages contain WP tables like:
// <figure class="wp-block-table"><table><tbody>
// <tr><td><strong>Rapid – Metaloglobus</strong></td><td><em>Rapid minim 2 goluri...</em></td><td><strong>Cotă 1.54</strong></td></tr>
// ...
// <tr><td><strong>Cota 2 zilnică ...</strong></td><td><strong>Unibet</strong></td><td><strong>Cotă 2.11</strong></td></tr>
function extractSelectionsFromWpTables(html, ticketType /* "cota2"|"zi" */) {
  const $ = cheerio.load(html, { decodeEntities: false });

  const selections = [];
  const tables = $("figure.wp-block-table table");

  tables.each((_, table) => {
    const rows = $(table).find("tbody tr");
    rows.each((__, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 2) return;

      const col1 = safe($(tds[0]).text());
      const col2 = safe($(tds[1]).text());
      const col3 = tds.length >= 3 ? safe($(tds[2]).text()) : "";

      // Skip header-ish rows: first cell includes "Cota 2 zilnică" or "Biletul Zilei"
      const isSummary =
        /cota\s*2\s*zilnic/i.test(col1) ||
        /biletul\s*zilei/i.test(col1) ||
        /unibet/i.test(col1);

      // We want rows that look like: Teams | Market | Cotă x.xx
      const odd = parseOddFromText(col3 || col2);
      const hasTeamsDash = /[\u2013\u2014-]/.test(col1) && col1.length > 5;
      const hasOdd = Number.isFinite(odd) && odd > 1.01 && odd < 100;

      if (isSummary) return;
      if (!hasTeamsDash) return;
      if (!hasOdd) return;

      // Market text usually in col2 (often <em>), but fallback to col2 anyway
      const marketRaw = col2;

      selections.push({
        source: "claudiuhood",
        ticket: ticketType,
        teams_raw: col1,
        market_raw: marketRaw,
        odd,
      });
    });
  });

  // Most relevant tables are the ones that actually contain odds.
  // If multiple tables exist and include the same selections, dedupe by teams+odd+market.
  const seen = new Set();
  const out = [];
  for (const s of selections) {
    const key = `${normalizeTeamStr(s.teams_raw)}|${normalizeTeamStr(
      s.market_raw
    )}|${s.odd.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ---------------- Market normalization ----------------
function normalizeMarket(marketRaw) {
  const m = safe(marketRaw)
    .replace(/\s+/g, " ")
    .replace(/Șansă dublă/gi, "Sansa dubla")
    .trim()
    .toLowerCase();

  // 1X2
  if (m === "1" || m === "x" || m === "2") return m.toUpperCase();

  // Double Chance
  if (/\b(1x|x2|12)\b/i.test(m)) {
    const mm = m.match(/\b(1x|x2|12)\b/i)?.[1];
    return mm ? mm.toUpperCase() : null;
  }
  if (m.includes("sansa dubla")) {
    // e.g. "Sansa dubla X2"
    const mm = m.match(/\b(1x|x2|12)\b/i)?.[1];
    return mm ? mm.toUpperCase() : null;
  }

  // Over/Under patterns (Romanian)
  // e.g. "Peste 2.5 goluri" / "Sub 2.5 goluri"
  const over = m.match(/\b(peste|over)\s*(\d+(?:[.,]\d+)?)\b/);
  const under = m.match(/\b(sub|under)\s*(\d+(?:[.,]\d+)?)\b/);
  if (over) return `O${over[2].replace(",", ".")}`;
  if (under) return `U${under[2].replace(",", ".")}`;

  // Team goals: "Rapid minim 2 goluri marcate in meci"
  // We can’t map this to your current market set deterministically, so keep as a special market:
  // (still OK for publishing; but if you require only a fixed market set, make this return null)
  if (/\bminim\s+(\d+)\s+gol/i.test(m)) return `TEAM_GOALS_MIN_${m.match(/\bminim\s+(\d+)\s+gol/i)?.[1]}`;

  // Default: preserve cleaned text as a custom market
  return marketRaw ? `CUSTOM:${safe(marketRaw)}` : null;
}

// ---------------- Flashscore mapping ----------------
function mapToFlashscore(selections, flashMatches) {
  const mapped = [];
  const failures = [];

  for (const s of selections) {
    const [t1, t2] = splitTeams(s.teams_raw);
    const nt1 = normalizeTeamStr(t1);
    const nt2 = normalizeTeamStr(t2);

    // find best candidate by substring containment
    let best = null;
    let bestScore = -1;

    for (const m of flashMatches) {
      const mt = normalizeTeamStr(m.teams || "");
      if (!mt) continue;

      const has1 = nt1 && mt.includes(nt1);
      const has2 = nt2 && mt.includes(nt2);
      if (!(has1 && has2)) continue;

      // score by how "tight" it is (shorter remaining unmatched)
      const score = 1000 - Math.abs(mt.length - (nt1.length + nt2.length));
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }

    if (!best) {
      failures.push({ selection: s, reason: "no_flashscore_match" });
      continue;
    }

    const market = normalizeMarket(s.market_raw);
    if (!market) {
      failures.push({ selection: s, reason: "unsupported_market" });
      continue;
    }

    mapped.push({
      id: safe(best.id),
      teams: safe(best.teams || s.teams_raw),
      market,
      odd: Number(s.odd),
      url: safe(best.url || ""),
      status: safe(best.status || "sched"),
      sport: safe(best.sport || "football"),
      competition: safe(best.competition || ""),
      country: safe(best.country || ""),
      time: safe(best.time || ""),
      meta: {
        source: "claudiuhood",
        market_raw: s.market_raw,
      },
    });
  }

  return { mapped, failures };
}

// ---------------- Ticket objects & output ----------------
function makeTicketObject(title, selections, rule, sourceUrl) {
  if (!selections || selections.length !== rule.size) return null;

  // Validate unique match IDs
  const ids = new Set(selections.map((x) => x.id));
  if (ids.size !== selections.length) return null;

  const p = Number(product(selections.map((s) => s.odd)).toFixed(3));
  const lo = rule.min,
    hi = rule.max;
  const loT = lo * (1 - rule.tol),
    hiT = hi * (1 + rule.tol);

  const status = within(p, lo, hi)
    ? "exact"
    : within(p, loT, hiT)
    ? "aproape"
    : "cel_mai_apropiat";

  return {
    title,
    source: "claudiuhood",
    source_url: sourceUrl,
    selections,
    product: p,
    status,
    range: { min: lo, max: hi },
    tolRange: { min: loT, max: hiT },
  };
}

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
    `- **Cota totală:** ${c.product}  _(${badge}, țintă ${c.range.min}-${c.range.max})_`
  );
  if (c.source_url) out.push(`- **Sursă:** ${c.source_url}`);
  out.push("");

  for (const s of c.selections) {
    out.push(`- ${s.teams} — **${s.market} @ ${Number(s.odd).toFixed(2)}**`);
    if (s.country) out.push(`  - Țară: ${s.country}`);
    if (s.competition) out.push(`  - Competiție: ${s.competition}`);
    if (s.time) out.push(`  - Ora: ${s.time}`);
    if (s.url) out.push(`  - Link: ${s.url}`);
    out.push("");
  }
  return out;
}

function sha1(x) {
  return crypto.createHash("sha1").update(String(x)).digest("hex").slice(0, 10);
}

function fallbackToCurrentGenerator(reason) {
  console.log(`[fallback] ${reason} -> running: node generate_tickets.js`);
  execSync("node generate_tickets.js", { stdio: "inherit" });
  process.exit(0);
}

// ---------------- Main ----------------
(async () => {
  // Load Flashscore matches
  let flashMatches = [];
  try {
    const rawMatches = await fs.readFile(MATCHES_JSON, "utf8");
    const parsed = JSON.parse(rawMatches);
    flashMatches = parsed?.matches || [];
  } catch {
    fallbackToCurrentGenerator("matches.json missing/unreadable");
  }

  const dateParts = toBucharestDateWithOffset(DAY_OFFSET);
  const { cota2: urlCota2, zi: urlZi } = buildClaudiuUrls(dateParts);
  const dt = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(
    dateParts.day
  ).padStart(2, "0")}`;

  // Fetch pages
  let htmlCota2 = "";
  let htmlZi = "";
  try {
    htmlCota2 = await fetchHtml(urlCota2);
    htmlZi = await fetchHtml(urlZi);
    await fs.writeFile("claudiu_cota2.html", htmlCota2, "utf8");
    await fs.writeFile("claudiu_zi.html", htmlZi, "utf8");
  } catch (e) {
    fallbackToCurrentGenerator(`Claudiu pages fetch failed: ${e.message}`);
  }

  // Extract selections from WP tables
  const selCota2 = extractSelectionsFromWpTables(htmlCota2, "cota2");
  const selZi = extractSelectionsFromWpTables(htmlZi, "zi");

  // Validate basic sizes (must match exactly 2 and 4)
  if (selCota2.length < RULE_COTA2.size) {
    fallbackToCurrentGenerator(`Claudiu Cota2 selections < ${RULE_COTA2.size}`);
  }
  if (selZi.length < RULE_ZI.size) {
    fallbackToCurrentGenerator(`Claudiu ZI selections < ${RULE_ZI.size}`);
  }

  // Use the first N selections (the table usually contains exactly the ticket rows)
  const chosenCota2 = selCota2.slice(0, RULE_COTA2.size);
  const chosenZi = selZi.slice(0, RULE_ZI.size);

  // Map to Flashscore
  const map1 = mapToFlashscore(chosenCota2, flashMatches);
  const map2 = mapToFlashscore(chosenZi, flashMatches);

  if (map1.mapped.length !== RULE_COTA2.size) {
    await fs.writeFile(
      "claudiu_map_fail_cota2.json",
      JSON.stringify(map1, null, 2),
      "utf8"
    );
    fallbackToCurrentGenerator("Cota2 mapping incomplete (see claudiu_map_fail_cota2.json)");
  }
  if (map2.mapped.length !== RULE_ZI.size) {
    await fs.writeFile(
      "claudiu_map_fail_zi.json",
      JSON.stringify(map2, null, 2),
      "utf8"
    );
    fallbackToCurrentGenerator("ZI mapping incomplete (see claudiu_map_fail_zi.json)");
  }

  // Ensure no overlap between tickets (same Flashscore match id)
  const used = new Set(map1.mapped.map((x) => x.id));
  const overlap = map2.mapped.find((x) => used.has(x.id));
  if (overlap) {
    fallbackToCurrentGenerator(`Overlap between tickets on match id=${overlap.id}`);
  }

  // Build ticket objects
  const cota2Obj = makeTicketObject(
    `Bilet Cota 2 (ClaudiuHood)`,
    map1.mapped,
    RULE_COTA2,
    urlCota2
  );
  const ziObj = makeTicketObject(
    `Biletul Zilei (ClaudiuHood)`,
    map2.mapped,
    RULE_ZI,
    urlZi
  );

  if (!cota2Obj || !ziObj) {
    fallbackToCurrentGenerator("Ticket object validation failed");
  }

  // Additional range check (if Claudiu ticket is way off, fallback)
  // (You can relax/remove this if you want to always publish Claudiu picks even if outside range.)
  const c2Ok = within(cota2Obj.product, RULE_COTA2.min * (1 - RULE_COTA2.tol), RULE_COTA2.max * (1 + RULE_COTA2.tol));
  const ziOk = within(ziObj.product, RULE_ZI.min * (1 - RULE_ZI.tol), RULE_ZI.max * (1 + RULE_ZI.tol));
  if (!c2Ok || !ziOk) {
    fallbackToCurrentGenerator("Claudiu ticket odds outside tolerance");
  }

  // Write outputs compatible with your pipeline
  const md = [
    `# Pariu Verde — ${dt}`,
    "",
    ...mdTicket(
      `Bilet Cota 2 (2 selecții; țintă ${RULE_COTA2.min}-${RULE_COTA2.max}; tol ±${Math.round(
        RULE_COTA2.tol * 100
      )}%) — sursă ClaudiuHood`,
      cota2Obj
    ),
    "",
    ...mdTicket(
      `Biletul Zilei (4 selecții; țintă ${RULE_ZI.min}-${RULE_ZI.max}; tol ±${Math.round(
        RULE_ZI.tol * 100
      )}%) — sursă ClaudiuHood`,
      ziObj
    ),
    "",
  ];

  await fs.writeFile(
    "tickets.json",
    JSON.stringify(
      {
        date: dt,
        source: "claudiuhood",
        claudiu_urls: { cota2: urlCota2, biletul_zilei: urlZi },
        bilet_cota2: cota2Obj,
        biletul_zilei: ziObj,
        debug: {
          signature: sha1(JSON.stringify({ cota2Obj, ziObj })),
        },
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile("tickets.md", md.join("\n"), "utf8");

  console.log(
    `[OK] tickets.json & tickets.md generated from ClaudiuHood (c2=${cota2Obj.product}, zi=${ziObj.product})`
  );
})();
