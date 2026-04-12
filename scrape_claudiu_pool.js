// scrape_claudiu_pool.js
// FULL VERSION with verbose logging for Claudiu Hood pages
// ESM-compatible

import fs from "fs/promises";
import * as cheerio from "cheerio";

const DAY_OFFSET = Number(process.env.DAY_OFFSET || "0");

const MONTHS_RO = [
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

function log(...args) {
  console.log("[claudiu]", ...args);
}

function warn(...args) {
  console.warn("[claudiu][warn]", ...args);
}

function errlog(...args) {
  console.error("[claudiu][error]", ...args);
}

function getTargetDate(offset = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function buildClaudiuUrls(date) {
  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yyyy = date.getFullYear();
  const monthRo = MONTHS_RO[date.getMonth()];

  return {
    dateISO: `${yyyy}-${mm}-${dd}`,
    cota2: `https://www.claudiuhood.ro/cota-2-zilnica-${date.getDate()}-${monthRo}-${yyyy}/`,
    biletul_zilei: `https://www.claudiuhood.ro/biletul-zilei-${dd}-${mm}-${yyyy}/`,
    varianta_speciala: `https://www.claudiuhood.ro/variante-speciale-${date.getDate()}-${monthRo}-${yyyy}/`,
    varianta_rezerva: `https://www.claudiuhood.ro/varianta-rezerva-${dd}-${mm}-${yyyy}/`,
    varianta_islanda: `https://www.claudiuhood.ro/varianta-islanda-${date.getDate()}-${monthRo}-${yyyy}/`,
  };
}

function clean(text = "") {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function stripDiacritics(text = "") {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function slugify(text = "") {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractOdd(text = "") {
  const normalized = stripDiacritics(clean(text)).toLowerCase();
  const match = normalized.match(/cota\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (!match) return null;
  return Number(match[1].replace(",", "."));
}

function looksLikeMatch(text = "") {
  const t = stripDiacritics(clean(text)).toLowerCase();
  if (!t.includes(" - ")) return false;
  if (/^cota/i.test(t)) return false;
  if (/unibet/i.test(t)) return false;
  if (/^event$/i.test(t)) return false;
  return true;
}

function looksLikeSummaryRow(teams = "", market = "", oddText = "") {
  const t = stripDiacritics(clean(teams)).toLowerCase();
  const m = stripDiacritics(clean(market)).toLowerCase();

  if (t.includes("cota 2 zilnica")) return true;
  if (t.includes("biletul zilei")) return true;
  if (t.includes("varianta speciala")) return true;
  if (t.includes("varianta rezerva")) return true;
  if (t.includes("varianta islanda")) return true;
  if (m === "unibet") return true;

  return false;
}

function getTableStats($) {
  return {
    wpBlockTables: $("figure.wp-block-table").length,
    tables: $("table").length,
    trs: $("tr").length,
    tds: $("td").length,
  };
}

function parseSelectionsFromTables(html, url, sourceKey) {
  const $ = cheerio.load(html);
  const selections = [];

  const preferredTables = $("figure.wp-block-table table");
  const fallbackTables = $("table");
  const tables = preferredTables.length ? preferredTables : fallbackTables;

  log(
    `${sourceKey}: preferredTables=${preferredTables.length}, fallbackTables=${fallbackTables.length}, using=${tables.length}`
  );

  tables.each((tableIndex, table) => {
    const rows = $(table).find("tr");
    log(`${sourceKey}: table #${tableIndex + 1} rows=${rows.length}`);

    rows.each((rowIndex, tr) => {
      const cells = $(tr)
        .find("td, th")
        .map((_, el) => clean($(el).text()))
        .get()
        .filter(Boolean);

      if (cells.length < 3) {
        if (cells.length > 0) {
          log(
            `${sourceKey}: skip row #${rowIndex + 1} cells=${cells.length} content=${JSON.stringify(cells)}`
          );
        }
        return;
      }

      const [teams, market, oddText] = cells;
      const odd = extractOdd(oddText);

      if (looksLikeSummaryRow(teams, market, oddText)) {
        log(`${sourceKey}: summary row skipped -> ${teams} | ${market} | ${oddText}`);
        return;
      }

      if (!looksLikeMatch(teams)) {
        log(`${sourceKey}: invalid match row skipped -> ${teams} | ${market} | ${oddText}`);
        return;
      }

      if (!market) {
        log(`${sourceKey}: empty market skipped -> ${teams}`);
        return;
      }

      if (!odd || !Number.isFinite(odd)) {
        log(`${sourceKey}: invalid odd skipped -> ${teams} | ${market} | ${oddText}`);
        return;
      }

      const selection = {
        source: sourceKey,
        teams,
        market_raw: market,
        odd,
        url,
        match_id: slugify(teams),
      };

      selections.push(selection);
      log(`${sourceKey}: added -> ${teams} | ${market} | ${odd}`);
    });
  });

  return { selections, stats: getTableStats($) };
}

function dedupeSelections(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = [
      item.source,
      item.match_id,
      item.market_raw.toLowerCase(),
      item.odd.toFixed(2),
    ].join("|");

    if (seen.has(key)) {
      log(`dedupe: removed duplicate ${key}`);
      continue;
    }

    seen.add(key);
    out.push(item);
  }

  return out;
}

async function fetchHtml(url) {
  log(`fetch: ${url}`);

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "ro-RO,ro;q=0.9,en;q=0.8",
      accept: "text/html,application/xhtml+xml",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
    redirect: "follow",
  });

  log(`fetch status: ${url} -> ${res.status}`);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const html = await res.text();
  log(`fetch size: ${url} -> ${html.length} chars`);
  return html;
}

async function scrapeOne(url, sourceKey) {
  const html = await fetchHtml(url);

  const htmlFile = `claudiu_${sourceKey}.html`;
  await fs.writeFile(htmlFile, html, "utf8");
  log(`${sourceKey}: saved raw html to ${htmlFile}`);

  const { selections, stats } = parseSelectionsFromTables(html, url, sourceKey);

  log(
    `${sourceKey}: stats tables=${stats.tables}, wpBlockTables=${stats.wpBlockTables}, trs=${stats.trs}, tds=${stats.tds}, selections=${selections.length}`
  );

  if (selections.length === 0) {
    warn(`${sourceKey}: ZERO selections extracted`);
  }

  return {
    sourceKey,
    url,
    htmlFile,
    selections,
    stats,
  };
}

async function main() {
  const targetDate = getTargetDate(DAY_OFFSET);
  const urls = buildClaudiuUrls(targetDate);

  log(`target date=${urls.dateISO}`);
  log(`urls=${JSON.stringify(urls, null, 2)}`);

  const allSelections = [];
  const errors = [];
  const diagnostics = [];

  const sources = {
    cota2: urls.cota2,
    biletul_zilei: urls.biletul_zilei,
    varianta_speciala: urls.varianta_speciala,
    varianta_rezerva: urls.varianta_rezerva,
    varianta_islanda: urls.varianta_islanda,
  };

  for (const [sourceKey, url] of Object.entries(sources)) {
    try {
      const result = await scrapeOne(url, sourceKey);
      allSelections.push(...result.selections);

      diagnostics.push({
        source: sourceKey,
        url,
        html_file: result.htmlFile,
        selections_found: result.selections.length,
        stats: result.stats,
      });
    } catch (error) {
      errlog(`${sourceKey}: ${error.message}`);

      errors.push({
        source: sourceKey,
        url,
        error: error.message,
      });

      diagnostics.push({
        source: sourceKey,
        url,
        html_file: null,
        selections_found: 0,
        stats: null,
        error: error.message,
      });
    }
  }

  const deduped = dedupeSelections(allSelections);

  const output = {
    date: urls.dateISO,
    source: "claudiuhood",
    selections: deduped,
    errors,
    diagnostics,
  };

  await fs.writeFile("claudiu_pool.json", JSON.stringify(output, null, 2), "utf8");

  log(`raw selections total=${allSelections.length}`);
  log(`deduped selections total=${deduped.length}`);
  log(`errors total=${errors.length}`);
  log(`claudiu_pool.json written successfully`);
}

main().catch(async (error) => {
  errlog(`fatal: ${error.message}`);

  const fallback = {
    date: new Date().toISOString().slice(0, 10),
    source: "claudiuhood",
    selections: [],
    errors: [{ source: "fatal", error: error.message }],
    diagnostics: [],
  };

  try {
    await fs.writeFile("claudiu_pool.json", JSON.stringify(fallback, null, 2), "utf8");
    errlog(`fallback claudiu_pool.json written`);
  } catch (writeErr) {
    errlog(`failed writing fallback claudiu_pool.json: ${writeErr.message}`);
  }

  process.exit(1);
});
