// scrape_odds_tab.js — MULTI-SPORT (Football, Basketball, Handball, Tennis)
// Flashscore mobile Odds tab scraper → odds_tab.json + odds.json

import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

// Flashscore sport codes
const SPORTS = [
  { key: "football",   s: 5 },
  { key: "basketball", s: 2 },
  { key: "handball",   s: 4 },
  { key: "tennis",     s: 3 },
];

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9,ro;q=0.8"
    }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

const absUrl = (href) => {
  try { return new URL(href, BASE).toString(); }
  catch { return null; }
};

function splitComp(raw = "") {
  const t = raw
    .replace(/\bStandings\b/i, "")
    .replace(/\s+\u00BB.*$/, "")
    .trim();

  const m = t.split(":");
  if (m.length >= 2) {
    return { country: m[0].trim(), league: m.slice(1).join(":").trim() };
  }
  return { country: "", league: t };
}

function extractId(url = "") {
  const m =
    /\/match\/([^/?#]+)\//i.exec(url) ||
    /\/match\/([^/?#]+)\b/i.exec(url);
  return m ? m[1] : null;
}

function normTeams(s = "") {
  return s.replace(/\s+/g, " ").replace(/^\-+|\-+$/g, "").trim();
}

function ensureOffset(href, offset) {
  if (!href) return href;
  if (href.includes("d=")) return href;
  return href.includes("?") ? `${href}&d=${offset}` : `${href}?d=${offset}`;
}

function parseOddsTab(html, offset, sportKey) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const root = $("#score-data");
  const rows = [];
  if (!root.length) return rows;

  let compText = "";

  root.contents().each((_, node) => {
    // Competition header
    if (node.type === "tag" && node.name === "h4") {
      compText = $(node).text().trim();
      return;
    }

    // Time span (HH:MM)
    if (node.type === "tag" && node.name === "span") {
      const timeTxt = $(node).text().trim();
      if (!/^\d{1,2}:\d{2}$/.test(timeTxt)) return;

      let teams = "";
      let aEl = null;
      let oddsEl = null;

      let p = node.nextSibling;
      while (p) {
        if (p.type === "tag" && p.name === "a" && /^\/match\//i.test($(p).attr("href") || "")) {
          aEl = p;

          let q = p.nextSibling;
          while (q) {
            if (q.type === "tag" && q.name === "span" && $(q).hasClass("mobi-odds")) {
              oddsEl = q;
              break;
            }
            if (q.type === "tag" && q.name === "br") break;
            q = q.nextSibling;
          }
          break;
        }
        if (p.type === "text") teams += String(p.data || "");
        p = p.nextSibling;
      }

      teams = normTeams(teams);
      if (!aEl || !teams) return;

      let href = $(aEl).attr("href") || "";
      href = ensureOffset(href, offset);
      const url = absUrl(href);
      const id = extractId(url);
      if (!id) return;

      const aClass = (($(aEl).attr("class") || "") + " ").toLowerCase();
      const status =
        aClass.includes("live") ? "live" :
        aClass.includes("fin")  ? "fin"  :
        "sched";

      const { country, league } = splitComp(compText);

      // Parse odds (2 or 3 numbers)
      let o1 = null, ox = null, o2 = null;

      if (oddsEl) {
        const nums = $(oddsEl)
          .text()
          .match(/\d+(?:[.,]\d+)?/g)
          ?.map(x => parseFloat(x.replace(",", ".")));

        if (nums && nums.length >= 2) {
          o1 = nums[0];
          if (nums.length >= 3) {
            ox = nums[1];
            o2 = nums[2];
          } else {
            // non-football sports: 1 / 2 only
            o2 = nums[1];
          }
        }
      }

      rows.push({
        id,
        url,
        teams,
        time: timeTxt,
        competition: league,
        country,
        sport: sportKey,
        status,
        odds_raw: { o1, ox, o2 }
      });
    }
  });

  return rows;
}

(async () => {
  let allEvents = [];
  let flat = [];

  for (const sp of SPORTS) {
    const url = `${BASE}/?d=${DAY_OFFSET}&s=${sp.s}`;
    const html = await fetchText(url);

    const events = parseOddsTab(html, DAY_OFFSET, sp.key);
    allEvents.push(...events);

    for (const e of events) {
      const { o1, ox, o2 } = e.odds_raw || {};
      if (!o1 || !o2) continue;

      if (sp.key === "football" && ox) {
        flat.push({
          id: e.id, teams: e.teams, market: "1", odd: o1,
          url: e.url, sport: e.sport, competition: e.competition,
          country: e.country, time: e.time, status: e.status
        });
        flat.push({
          id: e.id, teams: e.teams, market: "X", odd: ox,
          url: e.url, sport: e.sport, competition: e.competition,
          country: e.country, time: e.time, status: e.status
        });
        flat.push({
          id: e.id, teams: e.teams, market: "2", odd: o2,
          url: e.url, sport: e.sport, competition: e.competition,
          country: e.country, time: e.time, status: e.status
        });
      } else {
        // Basketball, Handball, Tennis → 1 / 2 only
        flat.push({
          id: e.id, teams: e.teams, market: "1", odd: o1,
          url: e.url, sport: e.sport, competition: e.competition,
          country: e.country, time: e.time, status: e.status
        });
        flat.push({
          id: e.id, teams: e.teams, market: "2", odd: o2,
          url: e.url, sport: e.sport, competition: e.competition,
          country: e.country, time: e.time, status: e.status
        });
      }
    }
  }

  await fs.writeFile(
    "odds_tab.json",
    JSON.stringify({ day: DAY_OFFSET, events: allEvents }, null, 2),
    "utf8"
  );

  await fs.writeFile(
    "odds.json",
    JSON.stringify({ events: flat }, null, 2),
    "utf8"
  );

  console.log(
    `[OK] ${allEvents.length} events parsed | ${flat.length} odds generated (multi-sport)`
  );
})();
