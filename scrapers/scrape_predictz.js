// scrapers/scrape_predictz.js
// PredictZ scraper - general + BTTS + BTTS&Win + Over/Under 2.5

import fs from "fs/promises";
import * as cheerio from "cheerio";

const DAY_OFFSET = Number(process.env.DAY_OFFSET || "0");

function log(...args) {
  console.log("[predictz]", ...args);
}

function safe(x) {
  return (x ?? "").toString().trim();
}

function clean(text = "") {
  return safe(text)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTargetDate(offset = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function buildPredictzUrls() {
  return {
    match_tips: "https://www.predictz.com/predictions/",
    btts: "https://www.predictz.com/predictions/today/both-teams-to-score/",
    btts_and_win: "https://www.predictz.com/predictions/today/both-teams-to-score-and-win/",
    over_under_25: "https://www.predictz.com/predictions/today/over-under-25-goals/",
  };
}

function detectPageMarket(sourceKey) {
  if (sourceKey === "match_tips") return "1X2";
  if (sourceKey === "btts") return "BTTS";
  if (sourceKey === "btts_and_win") return "BTTS_AND_WIN";
  if (sourceKey === "over_under_25") return "OVER_UNDER_25";
  return "UNKNOWN";
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "en-GB,en;q=0.9",
      accept: "text/html,application/xhtml+xml",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return await res.text();
}

function textHasTeams(text = "") {
  const t = clean(text);
  return t.includes(" v ") || t.includes(" vs ") || t.includes(" - ");
}

function parseRowsFromPage(html, sourceKey, url) {
  const $ = cheerio.load(html);
  const out = [];
  const pageMarket = detectPageMarket(sourceKey);

  log(`${sourceKey}: pttable=${$(".pttable").length}, pzcnt=${$(".pzcnt").length}`);

  let currentLeague = "";

  $(".pttable").each((tableIdx, table) => {
    $(table)
      .children("div")
      .each((_, row) => {
        const rowClass = $(row).attr("class") || "";
        const rowText = clean($(row).text());

        if ($(row).hasClass("pttrnh") && $(row).hasClass("ptttl")) {
          currentLeague = clean($(row).text());
          return;
        }

        if (!rowClass.includes("pzcnt") && !$(row).find(".pzcnt").length) {
          return;
        }

        const links = $(row).find("a");
        const rowHtml = $.html(row);

        let matchUrl = "";
        links.each((__, a) => {
          const href = $(a).attr("href") || "";
          if (href.includes("/predictions/") && !matchUrl) {
            matchUrl = href.startsWith("http") ? href : `https://www.predictz.com${href}`;
          }
        });

        // teams heuristic
        let teams = "";
        links.each((__, a) => {
          const txt = clean($(a).text());
          if (textHasTeams(txt) && !teams) teams = txt;
        });

        if (!teams) {
          const maybeTeams = rowText.match(/[A-Za-z0-9 .'\-()]+(?:\s[-v]{1,2}\s)[A-Za-z0-9 .'\-()]+/);
          if (maybeTeams) teams = clean(maybeTeams[0]);
        }

        // odds extraction
        const oddsMatches = rowText.match(/\b\d+\.\d{2}\b/g) || [];
        const odds = oddsMatches.length ? Number(oddsMatches[0]) : null;

        // prediction extraction by page type
        let prediction = "";
        if (pageMarket === "1X2") {
          if (/\bhome win\b/i.test(rowText)) prediction = "Home win";
          else if (/\bdraw\b/i.test(rowText)) prediction = "Draw";
          else if (/\baway win\b/i.test(rowText)) prediction = "Away win";
          else if (/\b1\b/.test(rowText)) prediction = "1";
          else if (/\bX\b/.test(rowText)) prediction = "X";
          else if (/\b2\b/.test(rowText)) prediction = "2";
        } else if (pageMarket === "BTTS") {
          if (/btts yes|both teams to score yes/i.test(rowText)) prediction = "BTTS_YES";
          else if (/btts no|both teams to score no/i.test(rowText)) prediction = "BTTS_NO";
        } else if (pageMarket === "BTTS_AND_WIN") {
          const m =
            rowText.match(/(home win & btts|away win & btts|draw & btts|1 & btts|2 & btts|x & btts)/i);
          if (m) prediction = clean(m[1]);
        } else if (pageMarket === "OVER_UNDER_25") {
          if (/over 2\.5/i.test(rowText)) prediction = "OVER_2_5";
          else if (/under 2\.5/i.test(rowText)) prediction = "UNDER_2_5";
        }

        if (!teams || !prediction) {
          return;
        }

        out.push({
          source: "predictz",
          source_key: sourceKey,
          market: pageMarket,
          prediction,
          odd: odds,
          teams,
          league: currentLeague,
          predictz_url: matchUrl || url,
          row_text: rowText,
          row_html: rowHtml,
        });
      });
  });

  return out;
}

async function scrapeOne(sourceKey, url) {
  log(`fetch ${sourceKey}: ${url}`);
  const html = await fetchHtml(url);

  const rawFile = `predictz_${sourceKey}.html`;
  await fs.writeFile(rawFile, html, "utf8");

  const rows = parseRowsFromPage(html, sourceKey, url);
  log(`${sourceKey}: extracted ${rows.length} rows`);

  return rows;
}

function dedupeRows(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = [
      item.source_key,
      item.market,
      item.teams.toLowerCase(),
      item.prediction.toLowerCase(),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

(async () => {
  const date = getTargetDate(DAY_OFFSET).toISOString().slice(0, 10);
  const urls = buildPredictzUrls();

  const all = [];
  const errors = [];

  for (const [sourceKey, url] of Object.entries(urls)) {
    try {
      const rows = await scrapeOne(sourceKey, url);
      all.push(...rows);
    } catch (err) {
      errors.push({
        source: sourceKey,
        url,
        error: err.message,
      });
      log(`FAIL ${sourceKey}: ${err.message}`);
    }
  }

  const output = {
    date,
    source: "predictz",
    selections: dedupeRows(all),
    errors,
  };

  await fs.writeFile("predictz_pool.json", JSON.stringify(output, null, 2), "utf8");
  log(`done: ${output.selections.length} selections`);
})();
