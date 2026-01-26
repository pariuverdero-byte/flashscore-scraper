// verify_and_update_wp.js — DEBUG VERSION (DETAILED LOGS, GREENBETTIPS SAFE)
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

const get = (url) => {
  console.log("[HTTP GET]", url);
  return fetch(url, { headers:{ Authorization: auth } });
};

const put = (url, body) => {
  console.log("[HTTP PUT]", url);
  return fetch(url, {
    method:"PUT",
    headers:{
      Authorization: auth,
      "Content-Type":"application/json"
    },
    body: JSON.stringify(body),
  });
};

/* ================= HELPERS ================= */

function getMatchId($row) {
  const href = $row.find("td").eq(0).find("a[href*='flashscore']").attr("href");
  console.log("   [MATCH LINK]", href);
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
  console.log("   [RAW TEAMS]", raw);
  const parts = raw.split("–").map(t => normalizeTeam(t));
  if (parts.length !== 2) return null;
  return { home: parts[0], away: parts[1] };
}

/* ================= PARSE BET ================= */
function parseBetFromText(text, teams) {
  if (!text) return null;
  const t = text.toLowerCase().replace(/\s+/g," ").trim();
  console.log("   [BET TEXT]", t);

  if (t.includes("double chance 1x") || t.includes("șansă dublă 1x"))
    return { type:"double", sides:["1","x"] };

  let m =
    t.match(/minim\s*(\d+(?:\.\d+)?).*goluri/) ||
    t.match(/minimum\s*(\d+(?:\.\d+)?).*goals/);
  if (m) return { type:"goals_min", threshold:parseFloat(m[1]) };

  if (teams) {
    for (const side of ["home","away"]) {
      const team = teams[side];
      if (!team) continue;

      if (t.includes(team)) {
        m =
          t.match(/(minim|min|minimum|peste|over)\s*(\d+(?:\.\d+)?)/);
        if (m) {
          console.log("   [TEAM GOALS DETECTED]", team);
          return {
            type:"team_goals",
            team:side,
            side:"over",
            threshold:parseFloat(m[2])
          };
        }
      }
    }
  }

  return null;
}

/* ================= EVAL ================= */
function evalOutcome(bet, score) {
  console.log("   [EVAL]", bet, score);
  const total = score.h + score.a;

  if (bet.type === "goals_min")
    return total >= bet.threshold ? WIN : LOSS;

  if (bet.type === "team_goals") {
    const g = bet.team === "home" ? score.h : score.a;
    return g >= bet.threshold ? WIN : LOSS;
  }

  if (bet.type === "double") {
    const r = score.h > score.a ? "1" : score.h < score.a ? "2" : "x";
    return bet.sides.includes(r) ? WIN : LOSS;
  }

  return null;
}

/* ================= FLASHSCORE ================= */
async function fetchFlashscore(matchId) {
  const url = `${FS_BASE}${matchId}/?s=1&d=-1`;
  console.log("   [FS FETCH]", url);

  const res = await fetch(url);
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);
  const body = $("body").text();

  if (!/Finished|FT|AET|After Penalties/i.test(body)) {
    console.log("   [FS] NOT FINISHED");
    return null;
  }

  const scoreText =
    $("div.detail b").first().text() ||
    body.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

  console.log("   [FS SCORE RAW]", scoreText);
  if (!scoreText) return null;

  return parseScore(scoreText);
}

/* ================= UI ================= */
function setStatus($row, status) {
  console.log("   [SET STATUS]", status);
  $row.find("td").eq(5).html(status === WIN ? "✅" : "❌");
}

/* ================= VERIFY ================= */
async function verifyPost(postId) {
  console.log("\n[POST]", postId);

  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) {
    console.log("   [ERROR] Cannot load post");
    return;
  }

  const post = await res.json();
  const $ = cheerio.load(post.content.raw || post.content.rendered);

  const rows = $("table.bilet-pariu tbody tr").toArray();
  console.log("   [ROWS FOUND]", rows.length);

  let changed = false;

  for (const row of rows) {
    const $r = $(row);
    const statusCell = $r.find("td").eq(5).text().trim();
    console.log(" [ROW STATUS]", statusCell);

    if (!RECHECK_ONCE && statusCell !== "⏳") continue;

    const matchId = getMatchId($r);
    if (!matchId) continue;

    const teams = extractTeamsFromRow($r);
    const betText = $r.find("td").eq(3).text();

    const bet = parseBetFromText(betText, teams);
    if (!bet) {
      console.log("   [SKIP] BET NOT PARSED");
      continue;
    }

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
    console.log("   [POST UPDATED]");
  } else {
    console.log("   [NO CHANGE]");
  }
}

/* ================= RUN ================= */
(async () => {
  console.log("=== VERIFY FLOW START ===");

  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=50`);
  if (!r.ok) return;

  const posts = await r.json();
  console.log("[POSTS FOUND]", posts.length);

  for (const p of posts) {
    await verifyPost(p.id);
  }

  console.log("=== VERIFY FLOW END ===");
})();
