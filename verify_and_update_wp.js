// verify_and_update_wp.js — FINAL, ADAPTED TO REAL HTML
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

/* ================= PARSE BET FROM TEXT ================= */
function parseBetFromText(text) {
  if (!text) return null;
  text = text.toLowerCase().trim();

  // 1X2
  if (text.includes("victorie gazde")) return { type:"1x2", side:"1" };
  if (text.includes("victorie oaspe")) return { type:"1x2", side:"2" };
  if (text === "egal" || text.includes("rezultat egal"))
    return { type:"1x2", side:"x" };

  // Șansă dublă
  if (text.includes("șansă dublă 1x")) return { type:"double", sides:["1","x"] };
  if (text.includes("șansă dublă x2")) return { type:"double", sides:["x","2"] };
  if (text.includes("șansă dublă 12")) return { type:"double", sides:["1","2"] };

  // Over / Under goluri
  const ou = text.match(/(peste|sub)\s*([\d\.]+)/);
  if (ou) {
    return {
      type: "goals",
      side: ou[1] === "peste" ? "over" : "under",
      threshold: parseFloat(ou[2])
    };
  }

  // BTTS
  if (text.includes("ambele") && text.includes("marchează")) {
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

    case "btts":
      return score.h > 0 && score.a > 0 ? WIN : LOSS;

    default:
      return null;
  }
}

/* ================= FLASHSCORE ================= */
async function fetchFlashscore(matchId) {
  const url = `${FS_BASE}${matchId}/?s=1&d=-1`;
  console.log(`   [FS] Fetching ${url}`);

  const res = await fetch(url);
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);
  const body = $("body").text();

  const finished = /Finished|FT|After Penalties|AET/i.test(body);
  if (!finished) {
    console.log(`   ⏳ Match LIVE / NOT FINISHED`);
    return null;
  }

  const scoreText =
    $("div.detail b").first().text() ||
    body.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

  if (!scoreText) return null;

  console.log(`   [FS] Score FOUND ${scoreText}`);
  return parseScore(scoreText);
}

/* ================= UI ================= */
function setStatus($row, status) {
  $row.find("td").eq(5).html(
    status === WIN ? "✅" : "❌"
  );
}

/* ================= VERIFY POST ================= */
async function verifyPost(postId) {
  console.log(`\n[POST] Verifying post ${postId}`);

  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) return;

  const post = await res.json();
  const $ = cheerio.load(post.content.raw || post.content.rendered);

  const rows = $("table.bilet-pariu tbody tr").toArray();
  console.log(`[POST] Rows found: ${rows.length}`);

  let changed = false;

  for (const row of rows) {
    const $r = $(row);

    const statusCell = $r.find("td").eq(5).text().trim();
    if (!RECHECK_ONCE && statusCell !== "⏳") continue;

    const matchId = getMatchId($r);
    console.log(`[ROW] Match ${matchId}`);
    if (!matchId) continue;

    const betText = $r.find("td").eq(3).text();
    const bet = parseBetFromText(betText);

    console.log(`   [BET] "${betText}" →`, bet);
    if (!bet) continue;

    const score = await fetchFlashscore(matchId);
    if (!score) continue;

    const verdict = evalOutcome(bet, score);
    if (!verdict) continue;

    console.log(`   ✅ Verdict ${verdict}`);
    setStatus($r, verdict);
    changed = true;
  }

  if (changed) {
    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html()
    });
    console.log(`[POST] Updated`);
  } else {
    console.log(`[POST] No changes`);
  }
}

/* ================= RUN ================= */
(async () => {
  console.log("=== VERIFY FLOW START ===");

  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=25&search=Bilet`);
  if (!r.ok) return;

  const posts = await r.json();
  console.log(`[MAIN] Posts found: ${posts.length}`);

  for (const p of posts) {
    await verifyPost(p.id);
  }

  console.log("=== VERIFY FLOW END ===");
})();
