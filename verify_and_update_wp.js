// verify_and_update_wp.js — FINAL ROBUST VERSION
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

function getMatchId($row) {
  let id = $row.attr("data-id");
  if (id && id !== "undefined") return id;

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

/* ================= MARKET NORMALIZER ================= */
/**
 * Normalizează orice bet într-un "tip logic"
 * Tot ce nu e sigur → null
 */
function normalizeBet({ market, stat, side, threshold }) {
  market = (market || "").toLowerCase();
  stat   = (stat || "").toLowerCase();
  side   = (side || "").toLowerCase();

  // 1X2
  if (market.includes("1x2")) {
    return { type:"1x2", side };
  }

  // BTTS
  if (market.includes("btts") || stat.includes("btts")) {
    return { type:"btts" };
  }

  // Over / Under TOTAL GOALS
  if (
    market.includes("over") ||
    market.includes("under") ||
    stat.includes("goal")
  ) {
    if (isNaN(threshold)) return null;

    return {
      type: "goals",
      side,
      threshold
    };
  }

  // Interval goluri (ex: 1-3)
  if (market.includes("interval") || stat.includes("range")) {
    if (isNaN(threshold)) return null;

    const [min, max] = threshold.toString().split("-").map(Number);
    if (isNaN(min) || isNaN(max)) return null;

    return {
      type: "range",
      min,
      max
    };
  }

  // Prima repriză → NU putem evalua sigur din FT
  if (market.includes("first half") || market.includes("1st half")) {
    return null;
  }

  return null;
}

/* ================= OUTCOME ================= */

function evalOutcome(bet, score) {
  if (!bet || !score) return null;

  const total = score.h + score.a;

  switch (bet.type) {

    case "1x2": {
      const res =
        score.h > score.a ? "1" :
        score.h < score.a ? "2" : "x";
      return res === bet.side ? WIN : LOSS;
    }

    case "btts":
      return score.h > 0 && score.a > 0 ? WIN : LOSS;

    case "goals":
      return bet.side === "over"
        ? total > bet.threshold ? WIN : LOSS
        : total < bet.threshold ? WIN : LOSS;

    case "range":
      return total >= bet.min && total <= bet.max ? WIN : LOSS;

    default:
      return null;
  }
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

    const finished =
      /Finished|FT|After Penalties|AET/i.test(body);

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

    const cur = ($r.attr("data-status") || PENDING).toLowerCase();
    if (!RECHECK_ONCE && cur !== PENDING) continue;

    const matchId = getMatchId($r);
    console.log(`[ROW] Match ${matchId}`);
    if (!matchId) continue;

    const bet = normalizeBet({
      market: $r.attr("data-market"),
      stat:   $r.attr("data-stat"),
      side:   $r.attr("data-side"),
      threshold: $r.attr("data-threshold")
    });

    console.log(`   [BET]`, bet);
    if (!bet) continue;

    const score = await fetchFlashscore(matchId);
    if (!score) continue;

    const verdict = evalOutcome(bet, score);
    if (!verdict) continue;

    if (verdict !== cur) {
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
  if (!r.ok) return;

  const posts = await r.json();
  console.log(`[MAIN] Posts found: ${posts.length}`);

  for (const p of posts) {
    await verifyPost(p.id);
  }

  console.log("=== VERIFY FLOW END ===");
})();
