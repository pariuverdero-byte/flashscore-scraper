// verify_and_update_wp.js — DEBUG MAX + FIX FINAL
// Works for pariuverde.ro & greenbettips.com
// Node 18 / 20

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;
const LANG        = process.env.LANG || "ro";

const HOMEPAGE_ID = process.env.HOMEPAGE_ID || null;

const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");
const RECHECK_LAST_N = parseInt(process.env.RECHECK_LAST_N || "15", 10);

const FS_BASE = "https://www.flashscore.mobi/match/";

const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

const authHeader =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

/* ================= HTTP HELPERS ================= */
async function wpGet(url) {
  const r = await fetch(url, { headers: { Authorization: authHeader } });
  const t = await r.text();
  if (!r.ok) {
    console.error("❌ WP GET failed:", r.status, t.slice(0,200));
    return null;
  }
  try { return JSON.parse(t); }
  catch {
    console.error("❌ NON-JSON from WP:", t.slice(0,200));
    return null;
  }
}

async function wpPut(url, body) {
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) {
    console.error("❌ WP PUT failed:", r.status, t.slice(0,200));
    return false;
  }
  return true;
}

/* ================= FLASHCORE ================= */
function parseScore(text) {
  const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  return { h: +m[1], a: +m[2] };
}

async function fetchFlashscore(matchId) {
  const url = `${FS_BASE}${matchId}/?s=1&d=-1`;
  console.log(`[VERIFY] Fetching Flashscore: ${url}`);

  try {
    const r = await fetch(url);
    if (!r.ok) return null;

    const html = await r.text();
    const $ = cheerio.load(html);
    const text = $("body").text();

    if (!/Finished|Full Time|After Extra Time|Penalties/i.test(text)) {
      console.log(`[VERIFY] ⏳ Match ${matchId} not finished`);
      return null;
    }

    const scoreText =
      $("div.detail b").first().text() ||
      text.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

    if (!scoreText) return null;

    const score = parseScore(scoreText);
    console.log(`[VERIFY] ✅ Score parsed:`, score);
    return score;
  } catch (e) {
    console.error("❌ Flashscore error:", e.message);
    return null;
  }
}

/* ================= BET EVALUATION ================= */
function eval1X2(score, side) {
  const r = score.h > score.a ? "1" : score.h < score.a ? "2" : "X";
  return r === side ? WIN : LOSS;
}

function evalGoals(score, side, thr) {
  const t = score.h + score.a;
  return side === "over"
    ? t > thr ? WIN : LOSS
    : t < thr ? WIN : LOSS;
}

function evalBTTS(score) {
  return score.h > 0 && score.a > 0 ? WIN : LOSS;
}

/* ================= MAIN VERIFY ================= */
async function verifyPost(post) {
  const postId = post.id;
  console.log(`\n[VERIFY] ===== Post ${postId} =====`);

  const raw = post.content?.raw || post.content?.rendered;
  if (!raw) {
    console.log("⚠ Empty content");
    return;
  }

  const $ = cheerio.load(raw);
  const rows = $("table.bilet-pariu tbody tr").toArray();

  console.log(`[VERIFY] Found ${rows.length} rows`);
  let changed = false;

  for (const row of rows) {
    const $r = $(row);

    let matchId = $r.attr("data-id");

    // 🔑 FALLBACK: extrage ID din link Flashscore
    if (!matchId) {
      const href = $r.find("a[href*='flashscore']").attr("href");
      const m = href?.match(/match\/([A-Za-z0-9]+)/);
      if (m) {
        matchId = m[1];
        console.log(`🔧 data-id recovered from link → ${matchId}`);
        $r.attr("data-id", matchId);
      }
    }

    const cur = $r.attr("data-status") || PENDING;
    if (!RECHECK_ONCE && cur !== PENDING) continue;

    const market = ($r.attr("data-market") || "").toLowerCase();
    const stat   = ($r.attr("data-stat") || "").toLowerCase();
    const side   = ($r.attr("data-side") || "").toLowerCase();
    const thr    = parseFloat($r.attr("data-threshold"));

    console.log("[VERIFY] Row:", { matchId, cur, market, stat, side, thr });

    if (!matchId) {
      console.log("⚠ No matchId → skip row");
      continue;
    }

    const score = await fetchFlashscore(matchId);
    if (!score) continue;

    let verdict = null;

    if (market === "1") verdict = eval1X2(score, side);
    else if (stat === "goals") verdict = evalGoals(score, side, thr);
    else if (stat === "btts") verdict = evalBTTS(score);

    console.log("[VERIFY] Verdict:", verdict);

    if (verdict && verdict !== cur) {
      $r.attr("data-status", verdict);
      $r.find("td").last().html(
        verdict === WIN ? "✅" : verdict === LOSS ? "❌" : "⏳"
      );
      changed = true;
    }
  }

  if (!changed) {
    console.log(`[VERIFY] ℹ No changes for post ${postId}`);
    return;
  }

  console.log(`[VERIFY] 🔄 Updating post ${postId} in WP`);
  await wpPut(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
    content: $.html(),
  });
}

/* ================= RUN ================= */
(async () => {
  console.log("🚀 VERIFY FLOW START");
  console.log("WP_BASE:", WP_BASE);
  console.log("LANG:", LANG);

  const posts = await wpGet(
    `${WP_BASE}/wp-json/wp/v2/posts?per_page=${RECHECK_LAST_N}&search=Bilet`
  );

  if (!Array.isArray(posts)) {
    console.error("❌ Cannot load posts list");
    return;
  }

  for (const post of posts) {
    await verifyPost(post);
  }

  console.log("✅ VERIFY FLOW FINISHED");
})();
