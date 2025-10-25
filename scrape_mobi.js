// scrape_mobi.js — FIX: parse list items with Country/League context
import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const INCLUDE_LIVE = String(process.env.INCLUDE_LIVE || "false").toLowerCase() === "true";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,ro;q=0.8" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}
const absUrl = (href) => {
  try { return new URL(href, BASE).toString(); } catch { return null; }
};
function splitComp(raw = "") {
  // e.g. "ENGLAND: Premier League Standings" -> {country:"ENGLAND", league:"Premier League"}
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
  const hasQ = href.includes("?");
  if (href.includes("d=")) return href; // already has day
  return hasQ ? `${href}&d=${offset}` : `${href}?d=${offset}`;
}

function parseList(html, offset) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const root = $("#score-data");
  const out = [];
  if (!root.length) return out;

  let compText = "";
  root.contents().each((_, node) => {
    // Track current competition header
    if (node.type === "tag" && node.name === "h4") {
      compText = $(node).text().trim();
      return;
    }

    // A line starts with a <span>HH:MM</span>
    if (node.type === "tag" && node.name === "span") {
      const timeTxt = $(node).text().trim();
      if (!/^\d{1,2}:\d{2}$/.test(timeTxt)) return;

      // Gather teams until we hit the <a href="/match/...">
      let teams = "";
      let aEl = null;
      let p = node.nextSibling;
      while (p) {
        if (p.type === "tag" && p.name === "a" && /^\/match\//i.test($(p).attr("href") || "")) {
          aEl = p;
          break;
        }
        if (p.type === "text") {
          teams += String(p.data || "").trim();
        }
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
      if (!INCLUDE_LIVE && (status === "live" || status === "fin")) return;

      const { country, league } = splitComp(compText);
      out.push({
        id,
        url,
        teams,
        time: timeTxt,
        competition: league,
        country,
        sport: "football",
        status,
      });
    }
  });

  return out;
}

(async () => {
  const url = `${BASE}/?d=${DAY_OFFSET}&s=1`; // All Games
  const html = await fetchText(url);
  await fs.writeFile("list.html", html, "utf8");

  const matches = parseList(html, DAY_OFFSET);
  console.log(`[list] found ${matches.length} fixtures (d=${DAY_OFFSET})`);
  await fs.writeFile("matches.json", JSON.stringify({ day: DAY_OFFSET, matches }, null, 2), "utf8");
})();
