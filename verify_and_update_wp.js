// verify_and_update_wp.js — DEBUG MAX
// Compatible RO + EN (pariuverde.ro + greenbettips.com)

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= ENV ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;
const HOMEPAGE_ID = process.env.HOMEPAGE_ID || null;

const MAX_POSTS   = parseInt(process.env.MAX_POSTS_PER_CAT || "10", 10);
const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");
const RECHECK_LAST_N = parseInt(process.env.RECHECK_LAST_N || "10", 10);

const LANG = process.env.LANG || "ro";

/* ================= CONST ================= */
const FS_BASE = "https://www.flashscore.mobi/match/";
const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

/* ================= AUTH ================= */
const authHeader =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const GET = (url) =>
  fetch(url, { headers: { Authorization: authHeader } });

const PUT = (url, body) =>
  fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

/* ================= HELPERS ================= */
function log(...args) {
  console.log("[VERIFY]", ...args);
}

/* ================= SCORE ================= */
function parseScore(text) {
  const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  return { h: +m[1], a: +m[2] };
}

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

/* ================= FLASHCORE ================= */
async function fetchFlashscore(matchId) {
  const url = `${FS_BASE}${matchId}/?s=1&d=-1`;
  log("Fetching Flashscore:", url);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      log("❌ Flashscore HTTP error", res.status);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const body = $("body").text();

    if (!/Finished|Full Time|After Extra Time|Penalties/i.test(body)) {
      log("⏳ Match not finished yet");
      return null;
    }

    const scoreText =
      $("div.detail b").first().text() ||
      body.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

    if (!scoreText) {
      log("❌ Score not found");
      return null;
    }

    const score = parseScore(scoreText);
    log("✅ Score parsed:", score);
    return score;

  } catch (e) {
    log("❌ Flashscore fetch failed:", e.message);
    return null;
  }
}

/* ================= UI ================= */
function paintRow($, row, status) {
  $(row).attr("data-status", status);
  $(row).find("td").last().html(
    status === WIN ? "✅" : status === LOSS ? "❌" : "⏳"
  );
}

/* ================= VERIFY POST ================= */
async function verifyPost(postId) {
  log("------");
  log("Loading post", postId);

  const res = await GET(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) {
    log("❌ Cannot load post", postId);
    return;
  }

  const post = await res.json();
  const html = post.content.raw || post.content.rendered;
  const $ = cheerio.load(html);

  const rows = $("table.bilet-pariu tbody tr").toArray();
  log(`Rows found: ${rows.length}`);

  if (!rows.length) return;

  let changed = false;

  for (const row of rows) {
    const $r = $(row);

    const matchId = $r.attr("data-id");
    const cur = $r.attr("data-status") || PENDING;
    const market = ($r.attr("data-market") || "").toLowerCase();
    const stat = ($r.attr("data-stat") || "").toLowerCase();
    const side = ($r.attr("data-side") || "").toLowerCase();
    const thr = parseFloat($r.attr("data-threshold"));

    log("Row:", { matchId, cur, market, stat, side, thr });

    if (!matchId) {
      log("⚠ No matchId → skip row");
      continue;
    }

    if (!RECHECK_ONCE && cur !== PENDING) {
      log("⏭ Skip (already decided)");
      continue;
    }

    const score = await fetchFlashscore(matchId);
    if (!score) continue;

    let verdict = null;
    if (market === "1") verdict = outcome1X2(score, side);
    else if (stat === "goals") verdict = outcomeGoals(score, side, thr);
    else if (stat === "btts") verdict = outcomeBTTS(score);

    log("Verdict:", verdict);

    if (verdict) {
      if (verdict !== cur || RECHECK_ONCE) {
        log("✏ Update row", cur, "→", verdict);
        paintRow($, row, verdict);
        changed = true;
      }
    }
  }

  if (!changed) {
    log("ℹ No changes for post", postId);
    return;
  }

  log("💾 Saving post", postId);
  await PUT(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
    content: $.html(),
  });
}

/* ================= RUN ================= */
(async () => {
  log("START VERIFY FLOW");
  log("LANG =", LANG);
  log("RECHECK_ONCE =", RECHECK_ONCE);

  const r = await GET(
    `${WP_BASE}/wp-json/wp/v2/posts?per_page=${RECHECK_LAST_N}&orderby=date&order=desc`
  );

  if (!r.ok) {
    log("❌ Cannot load posts list");
    return;
  }

  const posts = await r.json();
  log(`Posts loaded: ${posts.length}`);

  for (const p of posts) {
    await verifyPost(p.id);
  }

  log("✅ VERIFY FLOW FINISHED");
})();
