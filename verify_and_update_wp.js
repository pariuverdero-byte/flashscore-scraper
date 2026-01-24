// verify_and_update_wp.js — FINAL DEBUG + FIX
// Node 18 / 20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

const FS_BASE = "https://www.flashscore.mobi/match/";
const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

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

// 🔑 Extract matchId safely
function getMatchId($row) {
  let id = $row.attr("data-id");

  if (id && id !== "undefined") return id;

  // fallback: extract from href
  const href = $row.find("a[href*='flashscore']").attr("href");
  if (!href) return null;

  const m = href.match(/match\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function parseScore(text) {
  const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  return { h:+m[1], a:+m[2] };
}

/* ================= OUTCOME ================= */
function outcomeGoals(score, side, threshold) {
  if (!score || isNaN(threshold)) return null;
  const total = score.h + score.a;
  return side === "over"
    ? total > threshold ? WIN : LOSS
    : total < threshold ? WIN : LOSS;
}

function outcomeBTTS(score) {
  if (!score) return null;
  return score.h > 0 && score.a > 0 ? WIN : LOSS;
}

function outcome1X2(score, side) {
  if (!score) return null;
  const res = score.h > score.a ? "1" : score.h < score.a ? "2" : "X";
  return res === side ? WIN : LOSS;
}

/* ================= FLASHSCORE ================= */
async function fetchFlashscore(matchId) {
  const url = `${FS_BASE}${matchId}/?s=1&d=-1`;
  console.log(`   [FS] Fetching ${url}`);

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const body = $("body").text();

    if (!/Finished|Full Time|After Extra Time|Penalties/i.test(body)) {
      console.log(`   [FS] Not finished yet`);
      return null;
    }

    const scoreText =
      $("div.detail b").first().text() ||
      body.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

    if (!scoreText) {
      console.log(`   [FS] ❌ Score not found`);
      return null;
    }

    console.log(`   [FS] Score FOUND ${scoreText}`);
    return parseScore(scoreText);
  } catch (e) {
    console.log(`   [FS] ERROR`, e.message);
    return null;
  }
}

/* ================= UI ================= */
function paintRow($row, status) {
  $row.attr("data-status", status);
  $row.find("td").last().html(
    status === WIN ? "✅" : status === LOSS ? "❌" : "⏳"
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

    const cur = $r.attr("data-status") || PENDING;
    if (!RECHECK_ONCE && cur !== PENDING) continue;

    const matchId = getMatchId($r);
    console.log(`[ROW] Match ${matchId}`);

    if (!matchId) {
      console.log(`   ⚠️ No matchId → SKIP`);
      continue;
    }

    const market = ($r.attr("data-market") || "").toLowerCase();
    const stat   = ($r.attr("data-stat") || "").toLowerCase();
    const side   = ($r.attr("data-side") || "").toLowerCase();
    const thr    = parseFloat($r.attr("data-threshold"));

    const score = await fetchFlashscore(matchId);
    if (!score) continue;

    let verdict = null;
    if (market === "1") verdict = outcome1X2(score, side);
    else if (stat === "goals") verdict = outcomeGoals(score, side, thr);
    else if (stat === "btts") verdict = outcomeBTTS(score);

    if (verdict && verdict !== cur) {
      console.log(`   ✅ Verdict ${verdict}`);
      paintRow($r, verdict);
      changed = true;
    }
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
  if (!r.ok) {
    console.log("❌ Cannot load posts");
    return;
  }

  const posts = await r.json();
  console.log(`[MAIN] Posts found: ${posts.length}`);

  for (const p of posts) {
    await verifyPost(p.id);
  }

  console.log("=== VERIFY FLOW END ===");
})();
