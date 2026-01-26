// verify_and_update_wp.js — FIXED + EXTENDED (TEAM GOALS SUPPORTED RO + EN)
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
  const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
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

/* ================= PARSE BET FROM TEXT ================= */
function parseBetFromText(text, teams) {
  if (!text) return null;
  const t = text.toLowerCase().replace(/\s+/g," ").trim();

  // 1X2
  if (t.includes("victorie gazde") || t.includes("home win")) return { type:"1x2", side:"1" };
  if (t.includes("victorie oaspe") || t.includes("away win")) return { type:"1x2", side:"2" };
  if (t === "egal" || t.includes("draw")) return { type:"1x2", side:"x" };

  // Double chance
  if (t.includes("șansă dublă 1x") || t.includes("double chance 1x")) return { type:"double", sides:["1","x"] };
  if (t.includes("șansă dublă x2") || t.includes("double chance x2")) return { type:"double", sides:["x","2"] };
  if (t.includes("șansă dublă 12") || t.includes("double chance 12")) return { type:"double", sides:["1","2"] };

  // TEAM goals (ex: FCSB minim 1.5 goluri / Galati sub 3 goluri)
  if (teams) {
    for (const side of ["home","away"]) {
      const team = teams[side];
      if (!team) continue;

      if (t.includes(team)) {
        let m =
          t.match(/(minim|min|minimum)\s*(\d+(?:\.\d+)?)/) ||
          t.match(/(peste|over)\s*(\d+(?:\.\d+)?)/);
        if (m) {
          return {
            type:"team_goals",
            team: side,
            side:"over",
            threshold: parseFloat(m[2])
          };
        }

        m =
          t.match(/(sub|under)\s*(\d+(?:\.\d+)?)/);
        if (m) {
          return {
            type:"team_goals",
            team: side,
            side:"under",
            threshold: parseFloat(m[2])
          };
        }
      }
    }
  }

  // MINIMUM total goals
  let m =
    t.match(/minim\s*(\d+(?:\.\d+)?).*goluri/) ||
    t.match(/minimum\s*(\d+(?:\.\d+)?).*goals/);
  if (m) {
    return { type:"goals_min", threshold: parseFloat(m[1]) };
  }

  // Over / Under total goals
  m =
    t.match(/(peste|over)\s*(\d+(?:\.\d+)?)/) ||
    t.match(/(sub|under)\s*(\d+(?:\.\d+)?)/);
  if (m) {
    return {
      type:"goals",
      side: (m[1]==="peste"||m[1]==="over") ? "over" : "under",
      threshold: parseFloat(m[2])
    };
  }

  // BTTS
  if (
    (t.includes("ambele") && t.includes("marchează")) ||
    (t.includes("both") && t.includes("score"))
  ) {
    return { type:"btts" };
  }

  return null;
}

/* ================= EVAL BET ================= */
function evalOutcome(bet, score) {
  const total = score.h + score.a;

  switch (bet.type) {

    case "1x2": {
      const res =
        score.h > score.a ? "1" :
        score.h < score.a ? "2" : "x";
      return res === bet.side ? WIN : LOSS;
    }

    case "double": {
      const res =
        score.h > score.a ? "1" :
        score.h < score.a ? "2" : "x";
      return bet.sides.includes(res) ? WIN : LOSS;
    }

    case "goals":
      return bet.side === "over"
        ? total > bet.threshold ? WIN : LOSS
        : total < bet.threshold ? WIN : LOSS;

    case "goals_min":
      return total >= bet.threshold ? WIN : LOSS;

    case "team_goals": {
      const g = bet.team === "home" ? score.h : score.a;
      return bet.side === "over"
        ? g >= bet.threshold ? WIN : LOSS
        : g < bet.threshold ? WIN : LOSS;
    }

    case "btts":
      return score.h > 0 && score.a > 0 ? WIN : LOSS;

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

  const scoreText =
    $("div.detail b").first().text() ||
    body.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

  if (!scoreText) return null;
  return parseScore(scoreText);
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

    const score = await fetchFlashscore(matchId);
    if (!score) continue;

    const verdict = evalOutcome(bet, score);
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
