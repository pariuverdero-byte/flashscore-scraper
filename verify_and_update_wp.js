// verify_and_update_wp.js
// FINAL — score + stats verification, WordPress REST safe
// Node 18 / 20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const RECHECK_ONCE =
  /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

const authHeader =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const FS_BASE = "https://www.flashscore.mobi/match/";

const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

/* ================= HTTP HELPERS ================= */
async function wpGet(url) {
  const r = await fetch(url, {
    headers: { Authorization: authHeader }
  });

  const text = await r.text();

  // CAPTCHA / firewall protection
  if (!text.trim().startsWith("{")) {
    console.error("⚠️ NON-JSON RESPONSE from WP (firewall / captcha?)");
    console.error(text.slice(0, 200));
    return null;
  }

  return JSON.parse(text);
}

async function wpPut(url, body) {
  await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

/* ================= SCORE LOGIC (1X2) ================= */
function outcomeFromScore(scoreText, side) {
  const m = scoreText.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;

  const h = +m[1];
  const a = +m[2];

  if (side === "1") return h > a ? WIN : LOSS;
  if (side === "2") return a > h ? WIN : LOSS;
  if (side === "x") return h === a ? WIN : LOSS;

  return null;
}

/* ================= FETCH FINAL SCORE ================= */
async function fetchFlashscoreScore(matchId) {
  try {
    const r = await fetch(`${FS_BASE}${matchId}/?s=5&d=0`);
    if (!r.ok) return null;

    const html = await r.text();
    const $ = cheerio.load(html);
    const bodyText = $("body").text();

    if (!/Finished|Full Time|After Extra Time|Penalties/i.test(bodyText))
      return null;

    const score =
      $("div.detail b").first().text() ||
      bodyText.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

    return score || null;
  } catch {
    return null;
  }
}

/* ================= FETCH STATS ================= */
async function fetchFlashscoreStats(matchId) {
  try {
    const r = await fetch(`${FS_BASE}${matchId}/?s=1&d=-1&t=stats`);
    if (!r.ok) return null;

    const html = await r.text();
    const $ = cheerio.load(html);

    const stats = {};

    $("tr").each((_, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 3) return;

      const label = $(tds[0]).text().toLowerCase();
      const h = parseInt($(tds[1]).text(), 10);
      const a = parseInt($(tds[2]).text(), 10);

      if (!Number.isFinite(h) || !Number.isFinite(a)) return;

      if (label.includes("goal")) stats.goals = h + a;
      if (label.includes("corner")) stats.corners = h + a;
      if (label.includes("shot") && label.includes("on"))
        stats.shots_on_target = h + a;
    });

    return stats;
  } catch {
    return null;
  }
}

function evaluateStat(stats, stat, side, threshold) {
  if (!stats || stats[stat] == null) return null;

  const value = stats[stat];
  const t = Number(threshold);

  if (!Number.isFinite(t)) return null;

  if (side === "over")  return value > t ? WIN : LOSS;
  if (side === "under") return value < t ? WIN : LOSS;

  return null;
}

/* ================= UI ================= */
function paintStatus($row, status) {
  $row.attr("data-status", status);
  $row.find("td").eq(5).html(
    status === WIN ? "✅" :
    status === LOSS ? "❌" : "⏳"
  );
}

/* ================= VERIFY ONE POST ================= */
async function verifyPost(post) {
  const postId = post.id;
  const raw = post.content.raw || post.content.rendered;
  const $ = cheerio.load(raw);

  let changed = false;
  let events = 0;

  for (const tr of $("table.bilet-pariu tbody tr").toArray()) {
    const $tr = $(tr);

    const matchId = $tr.attr("data-id");
    if (!matchId) continue;

    const current = $tr.attr("data-status") || PENDING;
    if (!RECHECK_ONCE && current !== PENDING) continue;

    const market = ($tr.attr("data-market") || "").toLowerCase();
    const stat   = ($tr.attr("data-stat") || "").toLowerCase();
    const side   = ($tr.attr("data-side") || "").toLowerCase();
    const thr    = $tr.attr("data-threshold");

    let verdict = null;

    // SCORE
    if (market === "1") {
      const score = await fetchFlashscoreScore(matchId);
      if (score) verdict = outcomeFromScore(score, side);
    }

    // STATS
    if (market === "stat" && stat) {
      const stats = await fetchFlashscoreStats(matchId);
      verdict = evaluateStat(stats, stat, side, thr);
    }

    if (verdict && verdict !== current) {
      paintStatus($tr, verdict);
      changed = true;
    }

    events++;
  }

  if (changed) {
    await wpPut(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html()
    });
    console.log(`[UPDATED] Post ${postId} → ${events} events`);
  } else {
    console.log(`[VERIFY] Post ${postId} → ${events} events (no change)`);
  }
}

/* ================= RUN ================= */
(async () => {
  if (!WP_BASE || !WP_USER || !WP_APP_PASS) {
    console.error("❌ Missing WP credentials");
    process.exit(1);
  }

  // Load latest posts containing tickets
  const posts = await wpGet(
    `${WP_BASE}/wp-json/wp/v2/posts?per_page=10&orderby=date&order=desc&search=Bilet`
  );

  if (!posts) {
    console.error("❌ Cannot load posts list");
    process.exit(1);
  }

  for (const post of posts) {
    try {
      await verifyPost(post);
    } catch (e) {
      console.error(`⚠️ Post ${post.id} failed`, e.message);
    }
  }
})();
