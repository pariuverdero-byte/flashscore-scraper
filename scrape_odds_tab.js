// scrape_odds_tab.js — FIX: parse Odds tab with Country/League and 1X2 odds
import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,ro;q=0.8" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}
const absUrl = (href) => { try { return new URL(href, BASE).toString(); } catch { return null; } };
function splitComp(raw = "") {
  const t = raw.replace(/\bStandings\b/i, "").replace(/\s+\u00BB.*$/,"").trim();
  const m = t.split(":");
  if (m.length >= 2) return { country: m[0].trim(), league: m.slice(1).join(":").trim() };
  return { country: "", league: t.trim() };
}
function extractId(url = "") {
  const m = /\/match\/([^/?#]+)\//i.exec(url) || /\/match\/([^/?#]+)\b/i.exec(url);
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

function parseOddsTab(html, offset) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const root = $("#score-data");
  const rows = [];
  if (!root.length) return rows;

  let compText = "";
  root.contents().each((_, node) => {
    if (node.type === "tag" && node.name === "h4") {
      compText = $(node).text().trim();
      return;
    }

    if (node.type === "tag" && node.name === "span") {
      const timeTxt = $(node).text().trim();
      if (!/^\d{1,2}:\d{2}$/.test(timeTxt)) return;

      // Find teams & the <a href="/match/...">
      let teams = "";
      let aEl = null;
      let oddsEl = null;

      let p = node.nextSibling;
      while (p) {
        if (p.type === "tag" && p.name === "a" && /^\/match\//i.test($(p).attr("href") || "")) {
          aEl = p;
          // We expect odds span right after (or after a space)
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
        if (p.type === "text") teams += String(p.data || "").trim();
        p = p.nextSibling;
      }
      teams = normTeams(teams);
      if (!aEl) return;

      let href = $(aEl).attr("href") || "";
      href = ensureOffset(href, offset);
      const url = absUrl(href);
      const id = extractId(url);
      if (!id || !teams) return;

      const aClass = (($(aEl).attr("class") || "") + " ").toLowerCase();
      const status = aClass.includes("live") ? "live" : aClass.includes("fin") ? "fin" : "sched";
      const { country, league } = splitComp(compText);

      // Parse 1X2 odds if present
      let o1 = null, ox = null, o2 = null;
      if (oddsEl) {
        const nums = $(oddsEl).text().match(/\d+(?:[.,]\d+)?/g);
        if (nums && nums.length >= 3) {
          o1 = parseFloat(nums[0].replace(",", "."));
          ox = parseFloat(nums[1].replace(",", "."));
          o2 = parseFloat(nums[2].replace(",", "."));
        }
      }

      // Push event row(s); (if odds absent, they’ll be filled by other steps or ignored)
      rows.push({
        id, url, teams, time: timeTxt, competition: league, country,
        sport: "football", status,
        odds_1x2: o1 && ox && o2 ? { "1": o1, "X": ox, "2": o2 } : null
      });
    }
  });

  return rows;
}

(async () => {
  const url = `${BASE}/?d=${DAY_OFFSET}&s=5`; // Odds tab
  const html = await fetchText(url);
  await fs.writeFile("list-odds.html", html, "utf8");

  const events = parseOddsTab(html, DAY_OFFSET);

  // Also flatten into odds.json 1X2 (same shape your pipeline expects)
  const flat = [];
  for (const e of events) {
    if (e.odds_1x2) {
      flat.push({ id: e.id, teams: e.teams, market: "1", odd: e.odds_1x2["1"], url: e.url,
                  sport: "football", competition: e.competition, country: e.country, time: e.time, status: e.status });
      flat.push({ id: e.id, teams: e.teams, market: "X", odd: e.odds_1x2["X"], url: e.url,
                  sport: "football", competition: e.competition, country: e.country, time: e.time, status: e.status });
      flat.push({ id: e.id, teams: e.teams, market: "2", odd: e.odds_1x2["2"], url: e.url,
                  sport: "football", competition: e.competition, country: e.country, time: e.time, status: e.status });
    }
  }

  // If your later step merges multiple sources, keep both files:
  await fs.writeFile("odds_tab.json", JSON.stringify({ day: DAY_OFFSET, events }, null, 2), "utf8");

  // (Optional) If no other odds combiner runs, write odds.json directly from tab:
  // Comment this out if you already have a dedicated merger.
  await fs.writeFile("odds.json", JSON.stringify({ events: flat }, null, 2), "utf8");

  console.log(`[odds-tab] parsed ${events.length} rows; flattened ${flat.length} 1X2 odds`);
})();
