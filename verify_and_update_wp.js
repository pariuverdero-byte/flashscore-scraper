// verify_and_update_wp.js — FULL VERSION (MATCH + HALF INTERVALS, RO + EN)
// Node 18 / 20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

const FS_BASE = "https://www.flashscore.mobi/match/";
const WIN  = "win";
const LOSS = "loss";

/* ================= AUTH ================= */
const auth =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const get = (url) =>
  fetch(url, { headers:{ Authorization: auth } });

const put = (url, body) =>
  fetch(url, {
    method:"PUT",
    headers:{
      Authorization: auth,
      "Content-Type":"application/json"
    },
    body: JSON.stringify(body),
  });

/* ================= HELPERS ================= */

function getMatchId($row) {
  const href = $row.find("td").eq(0).find("a[href*='flashscore']").attr("href");
  if (!href) return null;
  const m = href.match(/match\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function parseScore(text) {
  const m = text.match(/(\d{1,2})\s*[:\-]\s*(\d{1,2})/);
  if (!m) return null;
  return { h:+m[1], a:+m[2] };
}

function parseHTScore(body) {
  const m =
    body.match(/HT\s*(\d{1,2})\s*[-:]\s*(\d{1,2})/i) ||
    body.match(/half[-\s]?time\s*(\d{1,2})\s*[-:]\s*(\d{1,2})/i);
  if (!m) return null;
  return { h:+m[1], a:+m[2] };
}

function normalizeTeam(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g,"")
    .replace(/\s+/g," ")
    .trim();
}

function extractTeamsFromRow($row) {
  const raw = $row.find("td").eq(0).text();
  const parts = raw.split("–").map(t => normalizeTeam(t));
  if (parts.length !== 2) return null;
  return { home: parts[0], away: parts[1] };
}

/* ================= PARSE BET ================= */
function parseBetFromText(text, teams) {
  if (!text) return null;
  const t = text.toLowerCase().replace(/\s+/g," ").trim();

  // 1X2
  if (t === "1 (gazde)" || t.includes("victorie gazde") || t === "home win")
    return { type:"1x2", side:"1" };
  if (t === "2 (oaspeți)" || t.includes("victorie oaspe") || t === "away win")
    return { type:"1x2", side:"2" };
  if (t === "x" || t.includes("draw"))
    return { type:"1x2", side:"x" };

  // Double chance
  if (t.includes("șansă dublă 1x") || t.includes("double chance 1x"))
    return { type:"double", sides:["1","x"] };
  if (t.includes("șansă dublă x2") || t.includes("double chance x2"))
    return { type:"double", sides:["x","2"] };

  // BTTS
  if (
    t.includes("ambele echipe marchează") ||
    t.includes("both teams to score")
  ) {
    return { type:"btts" };
  }

  // Team goals
  if (teams) {
    for (const side of ["home","away"]) {
      if (t.includes(teams[side])) {
        let m = t.match(/(minim|min|minimum|at least|over)\s*(\d+(?:\.\d+)?)/);
        if (m)
          return { type:"team_goals", team:side, mode:"over", val:+m[2] };
        m = t.match(/(sub|under)\s*(\d+(?:\.\d+)?)/);
        if (m)
          return { type:"team_goals", team:side, mode:"under", val:+m[2] };
      }
    }
  }

  // Interval total match
  let m = t.match(/interval\s*(\d+)\s*[-–]\s*(\d+).*total.*meci/);
  if (m) return { type:"interval_match", min:+m[1], max:+m[2] };

  // Interval first half
  m = t.match(/interval\s*(\d+)\s*[-–]\s*(\d+).*prima repriz/);
  if (m) return { type:"interval_ht", min:+m[1], max:+m[2] };

  // Interval second half
  m = t.match(/interval\s*(\d+)\s*[-–]\s*(\d+).*repriza a doua|repriza secund/);
  if (m) return { type:"interval_sh", min:+m[1], max:+m[2] };

  // Total goals min / over
  m =
    t.match(/minim\s*(\d+(?:\.\d+)?).*goluri/) ||
    t.match(/over\s*(\d+(?:\.\d+)?)/);
  if (m) return { type:"goals_min", val:+m[1] };

  return null;
}

/* ================= EVAL ================= */
function evalOutcome(bet, data) {
  const ft = data.ft;
  const ht = data.ht;
  const totalFT = ft.h + ft.a;

  switch (bet.type) {

    case "1x2": {
      const r = ft.h > ft.a ? "1" : ft.h < ft.a ? "2" : "x";
      return r === bet.side ? WIN : LOSS;
    }

    case "double": {
      const r = ft.h > ft.a ? "1" : ft.h < ft.a ? "2" : "x";
      return bet.sides.includes(r) ? WIN : LOSS;
    }

    case "btts":
      return ft.h > 0 && ft.a > 0 ? WIN : LOSS;

    case "team_goals": {
      const g = bet.team === "home" ? ft.h : ft.a;
      return bet.mode === "over"
        ? g >= bet.val ? WIN : LOSS
        : g < bet.val ? WIN : LOSS;
    }

    case "goals_min":
      return totalFT >= bet.val ? WIN : LOSS;

    case "interval_match":
      return totalFT >= bet.min && totalFT <= bet.max ? WIN : LOSS;

    case "interval_ht":
      if (!ht) return null;
      const totalHT = ht.h + ht.a;
      return totalHT >= bet.min && totalHT <= bet.max ? WIN : LOSS;

    case "interval_sh":
      if (!ht) return null;
      const sh = (ft.h + ft.a) - (ht.h + ht.a);
      return sh >= bet.min && sh <= bet.max ? WIN : LOSS;

    default:
      return null;
  }
}

/* ================= FLASHSCORE ================= */
async function fetchFlashscore(matchId) {
  const res = await fetch(`${FS_BASE}${matchId}/?s=1&d=-1`);
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);
  const body = $("body").text();

  if (!/Finished|FT|After Penalties|AET/i.test(body)) return null;

  const ftText =
    $("div.detail b").first().text() ||
    body.match(/(\d{1,2}\s*[:\-]\s*\d{1,2})/)?.[1];
  if (!ftText) return null;

  const ft = parseScore(ftText);
  const ht = parseHTScore(body);

  return { ft, ht };
}

/* ================= UI ================= */
function setStatus($row, status) {
  $row.find("td").eq(5).html(status === WIN ? "✅" : "❌");
}

/* ================= VERIFY POST ================= */
async function verifyPost(postId) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) return;

  const post = await res.json();
  const $ = cheerio.load(post.content.raw || post.content.rendered);

  const rows = $("table.bilet-pariu tbody tr").toArray();
  let changed = false;

  for (const row of rows) {
    const $r = $(row);
    const statusCell = $r.find("td").eq(5).text().trim();
    if (!RECHECK_ONCE && statusCell !== "⏳") continue;

    const matchId = getMatchId($r);
    if (!matchId) continue;

    const teams = extractTeamsFromRow($r);
    const betText = $r.find("td").eq(3).text();
    const bet = parseBetFromText(betText, teams);
    if (!bet) continue;

    const data = await fetchFlashscore(matchId);
    if (!data) continue;

    const verdict = evalOutcome(bet, data);
    if (!verdict) continue;

    setStatus($r, verdict);
    changed = true;
  }

  if (changed) {
    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html()
    });
  }
}

/* ================= RUN ================= */
(async () => {
  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=50`);
  if (!r.ok) return;

  const posts = await r.json();
  for (const p of posts) {
    await verifyPost(p.id);
  }
})();
