// verify_and_update_wp.js — FINAL ROBUST VERSION
// Supports: 1X2, Goals Over/Under, BTTS
// Works for: pariuverde.ro + greenbettips.com

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;
const HOMEPAGE_ID = Number(process.env.HOMEPAGE_ID || 11);
const LANG        = process.env.LANG || "ro";

const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

const FS_BASE = "https://www.flashscore.mobi/match/";
const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

const authHeader =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const get = (url) =>
  fetch(url, { headers:{ Authorization:authHeader } });

const put = (url, body) =>
  fetch(url, {
    method:"PUT",
    headers:{ Authorization:authHeader, "Content-Type":"application/json" },
    body: JSON.stringify(body),
  });

/* ================= HELPERS ================= */
function parseScore(text) {
  const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  return { h:+m[1], a:+m[2] };
}

/* ================= OUTCOMES ================= */
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

/* ================= FLASHSCORE FETCH ================= */
async function fetchFlashscoreScore(matchId) {
  const urls = [
    `${FS_BASE}${matchId}/?s=1&d=-1`,
    `${FS_BASE}${matchId}/?s=5&d=-1`,
  ];

  for (const url of urls) {
    console.log(`[VERIFY] Fetching Flashscore: ${url}`);
    try {
      const res = await fetch(url);
      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);
      const bodyText = $("body").text();

      if (!/Finished|Full Time|After Extra Time|Penalties/i.test(bodyText)) {
        console.log("  ↳ match not finished yet");
        continue;
      }

      const scoreText =
        $("div.detail b").first().text() ||
        bodyText.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

      if (!scoreText) {
        console.log("  ↳ no score found");
        continue;
      }

      const score = parseScore(scoreText);
      if (score) {
        console.log("  ✅ Score parsed:", score);
        return score;
      }
    } catch (e) {
      console.log("  ⚠ fetch error", e.message);
    }
  }

  console.log("  ❌ Score not available on Flashscore");
  return null;
}

/* ================= UI ================= */
function paintRow($, row, status) {
  $(row).attr("data-status", status);
  $(row).find("td").last().html(
    status === WIN ? "✅" : status === LOSS ? "❌" : "⏳"
  );
}

function computeTicketStatus($, table) {
  let hasPending = false;
  let hasLoss = false;

  $(table).find("tbody tr").each((_, tr) => {
    const s = $(tr).attr("data-status");
    if (s === PENDING) hasPending = true;
    if (s === LOSS) hasLoss = true;
  });

  if (hasPending) return PENDING;
  if (hasLoss) return LOSS;
  return WIN;
}

function updateGlobalBadge($, status) {
  const map = {
    ro: {
      pending: ["⏳","Rezultat în așteptare"],
      win: ["✅","Bilet câștigat"],
      loss: ["❌","Bilet pierdut"],
    },
    en: {
      pending: ["⏳","Pending"],
      win: ["✅","Won"],
      loss: ["❌","Lost"],
    }
  };

  let box = $(".pv-status-bilet");
  if (!box.length) {
    $("table.bilet-pariu").first().before(`
      <div class="pv-status-bilet">
        <span class="pv-status-icon"></span>
        <span class="pv-status-label"></span>
      </div>
    `);
    box = $(".pv-status-bilet");
  }

  box.find(".pv-status-icon").text(map[LANG][status][0]);
  box.find(".pv-status-label").text(map[LANG][status][1]);
}

/* ================= VERIFY POST ================= */
async function verifyPost(postId) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) return;

  const post = await res.json();
  const $ = cheerio.load(post.content.raw || post.content.rendered);
  let changed = false;

  const rows = $("table.bilet-pariu tbody tr").toArray();
  console.log(`\n[VERIFY] ===== Post ${postId} =====`);
  console.log(`[VERIFY] Found ${rows.length} rows`);

  for (const row of rows) {
    const $r = $(row);
    const matchId = $r.attr("data-id");
    const cur = $r.attr("data-status") || PENDING;

    console.log("[VERIFY] Row:", {
      matchId,
      cur,
      market: $r.attr("data-market"),
      stat: $r.attr("data-stat"),
      side: $r.attr("data-side"),
      thr: $r.attr("data-threshold"),
    });

    if (!matchId || matchId === "undefined") {
      console.log("  ⚠ No matchId → skip");
      continue;
    }

    if (!RECHECK_ONCE && cur !== PENDING) continue;

    const market = ($r.attr("data-market") || "").toLowerCase();
    const stat   = ($r.attr("data-stat") || "").toLowerCase();
    const side   = ($r.attr("data-side") || "").toLowerCase();
    const thr    = parseFloat($r.attr("data-threshold"));

    const score = await fetchFlashscoreScore(matchId);
    if (!score) continue;

    let verdict = null;
    if (market === "1") verdict = outcome1X2(score, side);
    else if (stat === "goals") verdict = outcomeGoals(score, side, thr);
    else if (stat === "btts") verdict = outcomeBTTS(score);

    console.log("  → Verdict:", verdict);

    if (verdict && verdict !== cur) {
      paintRow($, row, verdict);
      changed = true;
    }
  }

  if (changed) {
    const table = $("table.bilet-pariu").first();
    const globalStatus = computeTicketStatus($, table);
    updateGlobalBadge($, globalStatus);

    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html()
    });

    console.log(`  ✅ Post ${postId} updated`);
  } else {
    console.log(`  ℹ No changes for post ${postId}`);
  }
}

/* ================= RUN ================= */
(async () => {
  console.log("🚀 VERIFY FLOW START");
  console.log("WP_BASE:", WP_BASE);
  console.log("LANG:", LANG);

  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=25&search=Bilet`);
  if (!r.ok) {
    console.error("❌ Cannot load posts list");
    return;
  }

  const posts = await r.json();
  for (const p of posts) {
    await verifyPost(p.id);
  }

  console.log("✅ VERIFY FLOW FINISHED");
})();
