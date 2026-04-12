import fs from "fs/promises";
import * as cheerio from "cheerio";

const DAY_OFFSET = Number(process.env.DAY_OFFSET || "0");

const MONTHS_RO = [
  "ianuarie", "februarie", "martie", "aprilie", "mai", "iunie",
  "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"
];

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
    varianta_islanda: `https://www.claudiuhood.ro/varianta-islanda-${date.getDate()}-${monthRo}-${yyyy}/`
  };
}

function clean(text = "") {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOdd(text = "") {
  const m = clean(text).match(/cota\s*([0-9]+(?:[.,][0-9]+)?)/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

function looksLikeMatch(text = "") {
  const t = clean(text);
  if (!t.includes(" - ")) return false;
  if (/^cota/i.test(t)) return false;
  if (/unibet/i.test(t)) return false;
  return true;
}

function slugify(text = "") {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseSelectionsFromTables(html, url, sourceKey) {
  const $ = cheerio.load(html);
  const selections = [];

  $("figure.wp-block-table table").each((_, table) => {
    $(table).find("tr").each((__, tr) => {
      const cells = $(tr)
        .find("td, th")
        .map((___, el) => clean($(el).text()))
        .get()
        .filter(Boolean);

      if (cells.length < 3) return;

      const teams = cells[0];
      const market = cells[1];
      const oddText = cells[2];
      const odd = extractOdd(oddText);

      if (!looksLikeMatch(teams)) return;
      if (!market) return;
      if (!odd || !Number.isFinite(odd)) return;

      selections.push({
        source: sourceKey,
        teams,
        market_raw: market,
        odd,
        url,
        match_id: slugify(teams)
      });
    });
  });

  return selections;
}

function dedupeSelections(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = [
      item.source,
      item.match_id,
      item.market_raw.toLowerCase(),
      item.odd.toFixed(2)
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "ro-RO,ro;q=0.9,en;q=0.8",
      "accept": "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return await res.text();
}

async function scrapeOne(url, sourceKey) {
  const html = await fetchHtml(url);
  await fs.writeFile(`claudiu_${sourceKey}.html`, html, "utf8");

  const selections = parseSelectionsFromTables(html, url, sourceKey);

  console.log(`[claudiu] ${sourceKey}: ${selections.length} selections`);
  return selections;
}

async function main() {
  const targetDate = getTargetDate(DAY_OFFSET);
  const urls = buildClaudiuUrls(targetDate);

  const allSelections = [];
  const errors = [];

  for (const [sourceKey, url] of Object.entries({
    cota2: urls.cota2,
    biletul_zilei: urls.biletul_zilei,
    varianta_speciala: urls.varianta_speciala,
    varianta_rezerva: urls.varianta_rezerva,
    varianta_islanda: urls.varianta_islanda
  })) {
    try {
      const selections = await scrapeOne(url, sourceKey);
      allSelections.push(...selections);
    } catch (err) {
      console.error(`[claudiu] FAIL ${sourceKey}: ${err.message}`);
      errors.push({
        source: sourceKey,
        url,
        error: err.message
      });
    }
  }

  const output = {
    date: urls.dateISO,
    source: "claudiuhood",
    selections: dedupeSelections(allSelections),
    errors
  };

  await fs.writeFile("claudiu_pool.json", JSON.stringify(output, null, 2), "utf8");
  console.log(`[claudiu] total selections: ${output.selections.length}`);
}

main().catch(async (err) => {
  console.error("[claudiu] fatal:", err.message);

  await fs.writeFile(
    "claudiu_pool.json",
    JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      source: "claudiuhood",
      selections: [],
      errors: [{ source: "fatal", error: err.message }]
    }, null, 2),
    "utf8"
  );

  process.exit(1);
});
