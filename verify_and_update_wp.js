// verify_and_update_wp.js — FINAL ROBUST VERSION
// Works for recent & older Flashscore matches
// Node 18 / 20

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const RECHECK_ONCE =
  /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

const FS_BASE = "https://www.flashscore.mobi/match/";

const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

const authHeader =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const get = (url) =>
  fetch(url, { headers: { Authorization: authHeader } });

const put = (url, body) =>
  fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

/* ================= SCORE PARSER ================= */
function parseScore(text) {
  const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  return { h: +m[1], a: +m[2] };
}

/* ================= OUTCOME ================= */
function outcome1X2(score, side) {
  const res = score.h > score.a ? "1" : score.h < score.a ? "2" : "X";
  return res === side ? WIN : LOSS;
}

function outcomeGoals(score, side, threshold) {
  const total = score.h + score.a;
  return side === "over"
    ? total > threshold ? WIN : LOSS
    : total < threshold ? WIN : LOSS;
}

function outcomeBTTS(score) {
  return score.h > 0 && score.a > 0 ? WIN : LOSS;
}

/* ================= FLASHSCORE FETCH (ROBUST) ================= */
async function fetchFlashscoreScore(matchId) {
  const urls = [
    `${FS_BASE}${matchId}/?s=5`,        // SUMMARY (most reliable)
    `${FS_BASE}${matchId}/?s=1&d=-1`,   // fallback
  ];

  for (const url of urls) {
    try {
      console.log(`[FS] Fetching ${url}`);
      const res = await fetch(url);
      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);
      const text = $("body").text();

      const scoreText =
        $("div.detail b").first().text() ||
        text.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

      if (!scoreText) {
        console.log(`[FS] No score found on ${url}`);
        continue;
      }

      const score = parseScore(scoreText);
      if (!score) continue;

      console.log(`[FS] Score FOUND ${score.h}:${score.a}`);
      return score;
    } catch (e) {
      console.log(`[FS] Error ${url}`, e.message);
    }
  }

  console.log(`[FS] ❌ No score for match ${matchId}`);
  return null;
}

/* ================= UI ================= */
function paintRow($, row, status) {
  $(row).attr("data-status", status);
  $(row).find("td").last().html(
    status === WIN ? "✅" : status === LOSS ? "❌" : "⏳"
  );
}

/* ================= VERIFY ONE POST ================= */
async function verifyPost(postId) {
  console.log(`\n[POST] Verifying post ${postId}`);

  const res = await get(
    `${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`
  );
  if (!res.ok) {
    console.log(`[POST] ❌ Cannot load post ${postId}`);
    return;
  }

  const post = await res.json();
  const $ = cheerio.load(post.content.raw || post.content.rendered);
  let changed = false;

  const rows = $("table.bilet-pariu tbody tr").toArray();
  console.log(`[POST] Rows found: ${rows.length}`);

  for (const row of rows) {
    const $r = $(row);
    const cur = $r.attr("data-status") || PENDING;

    if (!RECHECK_ONCE && cur !== PENDING) {
      console.log(`[ROW] Skip decided`);
      continue;
    }

    const matchId = $r.attr("data-id");
    if (!matchId) continue;

    const market = ($r.attr("data-market") || "").toLowerCase();
    const stat   = ($r.attr("data-stat") || "").toLowerCase();
    const side   = ($r.attr("data-side") || "").toLowerCase();
    const thr    = parseFloat($r.attr("data-threshold"));

    console.log(`[ROW] Match ${matchId} | ${market} ${stat} ${side}`);

    const score = await fetchFlashscoreScore(matchId);
    if (!score) continue;

    let verdict = null;

    if (market === "1") verdict = outcome1X2(score, side);
    else if (stat === "goals") verdict = outcomeGoals(score, side, thr);
    else if (stat === "btts") verdict = outcomeBTTS(score);

    if (verdict && verdict !== cur) {
      console.log(`[ROW] ✔ Verdict ${verdict}`);
      paintRow($, row, verdict);
      changed = true;
    }
  }

  if (changed) {
    console.log(`[POST] Updating post ${postId}`);
    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html(),
    });
  } else {
    console.log(`[POST] No changes`);
  }
}

/* ================= RUN ================= */
(async () => {
  console.log("=== VERIFY FLOW START ===");

  const res = await get(
    `${WP_BASE}/wp-json/wp/v2/posts?per_page=20&search=Bilet`
  );

  if (!res.ok) {
    console.error("❌ Cannot list posts");
    return;
  }

  const posts = await res.json();
  console.log(`[MAIN] Posts found: ${posts.length}`);

  for (const p of posts) {
    await verifyPost(p.id);
  }

  console.log("=== VERIFY FLOW END ===");
})();
