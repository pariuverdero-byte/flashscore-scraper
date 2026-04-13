// scrapers/scrape_predictz.js
// PredictZ scraper with full bypass / retry / fallback
// ESM-compatible

import fs from "fs/promises";
import * as cheerio from "cheerio";
import fetch from "node-fetch";

const DAY_OFFSET = Number(process.env.DAY_OFFSET || "0");

const SOURCES = [
  {
    key: "match_tips",
    url: "https://www.predictz.com/predictions/",
    market: "1X2",
    output_html: "predictz_match_tips.html",
  },
  {
    key: "btts",
    url: "https://www.predictz.com/predictions/today/both-teams-to-score/",
    market: "BTTS",
    output_html: "predictz_btts.html",
  },
  {
    key: "btts_and_win",
    url: "https://www.predictz.com/predictions/today/both-teams-to-score-and-win/",
    market: "BTTS_AND_WIN",
    output_html: "predictz_btts_and_win.html",
  },
  {
    key: "over_under_25",
    url: "https://www.predictz.com/predictions/today/over-under-25-goals/",
    market: "OVER_2_5",
    output_html: "predictz_over_under_25.html",
  },
];

function log(...args) {
  console.log("[predictz]", ...args);
}

function warn(...args) {
  console.warn("[predictz][warn]", ...args);
}

function clean(s = "") {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripDiacritics(s = "") {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function norm(s = "") {
  return stripDiacritics(clean(s)).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDateISO(offset = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function buildHeaders(profile = "standard", referer = "https://www.predictz.com/") {
  const base = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,*/*;q=0.8",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: referer,
    Origin: "https://www.predictz.com",
    "Upgrade-Insecure-Requests": "1",
  };

  if (profile === "aggressive") {
    return {
      ...base,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
      "sec-ch-ua":
        '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    };
  }

  return base;
}

async function fetchAttempt(url, headers, label) {
  log(`fetch attempt (${label}) -> ${url}`);

  const res = await fetch(url, {
    method: "GET",
    headers,
    redirect: "follow",
  });

  const text = await res.text();
  log(`status (${label}) -> ${res.status}, size=${text.length}`);

  return {
    ok: res.ok,
    status: res.status,
    text,
    finalUrl: res.url,
  };
}

function isBlockedResponse(status, html = "") {
  const t = norm(html);

  if ([403, 406, 429, 500, 502, 503, 504].includes(status)) return true;

  if (
    t.includes("access denied") ||
    t.includes("forbidden") ||
    t.includes("captcha") ||
    t.includes("cloudflare") ||
    t.includes("ddos") ||
    t.includes("blocked")
  ) {
    return true;
  }

  return false;
}

async function fetchPredictzWithBypass(url) {
  // 1) normal browser-like request
  let attempt = await fetchAttempt(url, buildHeaders("standard", "https://www.predictz.com/"), "direct-standard");
  if (attempt.ok && !isBlockedResponse(attempt.status, attempt.text)) return attempt;

  await sleep(1500);

  // 2) more aggressive browser-like request
  attempt = await fetchAttempt(url, buildHeaders("aggressive", url), "direct-aggressive");
  if (attempt.ok && !isBlockedResponse(attempt.status, attempt.text)) return attempt;

  await sleep(1500);

  // 3) textise fallback
  const textiseUrl = `https://textise dot iitty/showtext.aspx?strURL=${encodeURIComponent(url)}`.replace(" dot iitty", ".net");
  attempt = await fetchAttempt(
    textiseUrl,
    {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      Referer: "https://textise.net/",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
    },
    "textise-fallback"
  );
  if (attempt.ok && !isBlockedResponse(attempt.status, attempt.text)) return attempt;

  throw new Error(`Blocked by PredictZ / fallback failed. Last status=${attempt.status}`);
}

function extractRowsGeneric($, market, sourceUrl) {
  const selections = [];
  let currentLeague = "";

  // PredictZ pages are grouped around pttable / pzcnt / pttrnh blocks in the saved files.
  // We use broad selectors to survive layout variations.
  $("div.pttable, div.pttablefull, div[class*='pttable']").each((_, table) => {
    const children = $(table).find("div.pttr, div.pzcnt, div.pttrnh, tr");

    children.each((__, row) => {
      const rowEl = $(row);
      const rowText = clean(rowEl.text());

      if (!rowText) return;

      if (rowEl.hasClass("pttrnh") || rowEl.hasClass("ptttl")) {
        currentLeague = rowText;
        return;
      }

      const links = rowEl.find("a");
      const linkTexts = links
        .map((___, a) => clean($(a).text()))
        .get()
        .filter(Boolean);

      let teams = "";
      for (const txt of linkTexts) {
        const n = norm(txt);
        if (txt.includes(" - ") || txt.includes(" v ") || txt.includes(" vs ") || n.includes(" v ")) {
          teams = txt.replace(/\s+v\s+/i, " - ").replace(/\s+vs\s+/i, " - ");
          break;
        }
      }

      if (!teams) {
        const m = rowText.match(/([A-Za-z0-9 .,'&()\/-]+)\s(?:v|vs|-)\s([A-Za-z0-9 .,'&()\/-]+)/i);
        if (m) {
          teams = `${clean(m[1])} - ${clean(m[2])}`;
        }
      }

      if (!teams) return;

      let prediction = "";
      const rt = norm(rowText);

      if (market === "1X2") {
        if (/\bhome win\b/.test(rt)) prediction = "1";
        else if (/\baway win\b/.test(rt)) prediction = "2";
        else if (/\bdraw\b/.test(rt)) prediction = "X";
        else if (/\btip 1\b/.test(rt)) prediction = "1";
        else if (/\btip 2\b/.test(rt)) prediction = "2";
        else if (/\btip x\b/.test(rt)) prediction = "X";
      }

      if (market === "BTTS") {
        if (/\bbtts yes\b|\bboth teams to score yes\b/.test(rt)) prediction = "BTTS_YES";
        else if (/\bbtts no\b|\bboth teams to score no\b/.test(rt)) prediction = "BTTS_NO";
        else if (/\bboth teams to score\b/.test(rt)) prediction = "BTTS_YES";
      }

      if (market === "BTTS_AND_WIN") {
        if (/\bhome win.*btts\b|\bbtts.*home win\b/.test(rt)) prediction = "HOME_WIN_AND_BTTS";
        else if (/\baway win.*btts\b|\bbtts.*away win\b/.test(rt)) prediction = "AWAY_WIN_AND_BTTS";
        else if (/\bdraw.*btts\b|\bbtts.*draw\b/.test(rt)) prediction = "DRAW_AND_BTTS";
      }

      if (market === "OVER_2_5") {
        if (/\bover 2\.5\b/.test(rt)) prediction = "OVER_2_5";
        else if (/\bunder 2\.5\b/.test(rt)) prediction = "UNDER_2_5";
        else if (/\bover\/under 2\.5\b/.test(rt)) prediction = "OVER_2_5";
      }

      if (!prediction) return;

      let predictzUrl = sourceUrl;
      links.each((___, a) => {
        const href = $(a).attr("href") || "";
        if (href.includes("/predictions/") && !href.includes("/today/")) {
          predictzUrl = href.startsWith("http") ? href : `https://www.predictz.com${href}`;
          return false;
        }
      });

      selections.push({
        source: "predictz",
        teams,
        market,
        prediction,
        league: currentLeague || "",
        predictz_url: predictzUrl,
        row_text: rowText,
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
      norm(item.teams),
      norm(item.market),
      norm(item.prediction),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

async function scrapeSource(source) {
  try {
    const fetched = await fetchPredictzWithBypass(source.url);
    await fs.writeFile(source.output_html, fetched.text, "utf8");

    const $ = cheerio.load(fetched.text);
    const extracted = extractRowsGeneric($, source.market, source.url);

    log(`${source.key}: extracted=${extracted.length}`);

    return {
      key: source.key,
      market: source.market,
      url: source.url,
      selections: extracted,
      error: null,
      final_url: fetched.finalUrl,
    };
  } catch (err) {
    warn(`${source.key}: ${err.message}`);

    // always create a raw file placeholder for debugging
    await fs.writeFile(
      source.output_html,
      `<!-- predictz fetch failed for ${source.url}: ${err.message} -->`,
      "utf8"
    );

    return {
      key: source.key,
      market: source.market,
      url: source.url,
      selections: [],
      error: err.message,
      final_url: null,
    };
  }
}

(async () => {
  const date = getDateISO(DAY_OFFSET);
  const diagnostics = [];
  const allSelections = [];

  for (const source of SOURCES) {
    const result = await scrapeSource(source);
    diagnostics.push({
      key: result.key,
      market: result.market,
      url: result.url,
      final_url: result.final_url,
      extracted: result.selections.length,
      error: result.error,
    });
    allSelections.push(...result.selections);
  }

  const output = {
    date,
    source: "predictz",
    selections: dedupeSelections(allSelections),
    diagnostics,
    errors: diagnostics.filter((x) => x.error).map((x) => ({
      source: x.key,
      url: x.url,
      error: x.error,
    })),
  };

  await fs.writeFile("predictz_pool.json", JSON.stringify(output, null, 2), "utf8");

  log(`final selections=${output.selections.length}`);
  log(`errors=${output.errors.length}`);
})();
