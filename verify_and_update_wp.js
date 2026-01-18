// verify_and_update_wp.js — FINAL (Summary s=1 + Stats t=stats) — NO STATIC IDS
// Node 18/20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;          // https://pariuverde.ro
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const MAX_POSTS_PER_CAT = parseInt(process.env.MAX_POSTS_PER_CAT || "8", 10);
const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

const FS_BASE = "https://www.flashscore.mobi/match/";

const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

/* ================= AUTH ================= */
const authHeader =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const wpGet = (url) => fetch(url, { headers: { Authorization: authHeader } });

const wpPut = (url, body) =>
  fetch(url, {
    method: "PUT",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/* ================= WP HELPERS ================= */
async function getCategoryIdBySlug(slug) {
  const r = await wpGet(`${WP_BASE}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}`);
  if (!r.ok) return null;
  const j = await r.json();
  return j?.[0]?.id || null;
}

async function getLatestPostsByCategorySlug(slug, n) {
  const catId = await getCategoryIdBySlug(slug);
  if (!catId) return [];
  const r = await wpGet(
    `${WP_BASE}/wp-json/wp/v2/posts?per_page=${n}&orderby=date&order=desc&categories=${catId}&context=edit`
  );
  if (!r.ok) return [];
  return await r.json();
}

/* ================= FLASH SCORE: SUMMARY (s=1) =================
   Use s=1 page for status + final score. Works with d=-1, d=-2 etc.
================================================================ */
function parseFinishedAndScoreFromSummaryHtml(html) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");

  const isFinished = /\bFinished\b/i.test(text) ||
    /\bFull Time\b/i.test(text) ||
    /\bAfter Extra Time\b/i.test(text) ||
    /\bPenalties\b/i.test(text);

  // Score typically in: <div class="detail"><b>3:3</b></div>
  const scoreText =
    $("div.detail b").first().text().trim() ||
    text.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1] ||
    "";

  const hasScore = /^\d{1,2}\s*:\s*\d{1,2}$/.test(scoreText);

  return { finished: isFinished && hasScore, scoreText: hasScore ? scoreText : null };
}

async function fetchFlashscoreSummary(matchId, dParam) {
  const url = `${FS_BASE}${matchId}/?s=1&d=${encodeURIComponent(dParam)}`;
  const res = await fetch(url);
  if (!res.ok) return { finished: false };
  const html = await res.text();
  return parseFinishedAndScoreFromSummaryHtml(html);
}

/* ================= FLASH SCORE: STATS (t=stats) ================= */
async function fetchFlashscoreStats(matchId, dParam) {
  const url = `${FS_BASE}${matchId}/?s=1&d=${encodeURIComponent(dParam)}&t=stats`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);

  const stats = {};

  // This parser is generic: scans table rows with 3 TDs: label | home | away
  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 3) return;

    const label = $(tds[0]).text().trim().toLowerCase();
    const homeRaw = $(tds[1]).text().trim();
    const awayRaw = $(tds[2]).text().trim();

    // handle numbers and % (possession)
    const num = (x) => {
      const m = x.match(/(\d+(\.\d+)?)/);
      return m ? Number(m[1]) : NaN;
    };
    const h = num(homeRaw);
    const a = num(awayRaw);
    if (!Number.isFinite(h) || !Number.isFinite(a)) return;

    if (label.includes("corner")) {
      stats.corners = h + a;
      stats.corners_home = h;
      stats.corners_away = a;
    }
    if (label.includes("shot") && label.includes("on")) {
      stats.shots_on_target = h + a;
      stats.shots_on_target_home = h;
      stats.shots_on_target_away = a;
    }
    if (label.includes("total shots")) {
      stats.shots = h + a;
      stats.shots_home = h;
      stats.shots_away = a;
    }
    if (label.includes("ball possession") || label === "possession") {
      stats.possession_home = h; // percent
      stats.possession_away = a;
    }
    if (label.includes("yellow")) {
      stats.yellow_cards = h + a;
      stats.yellow_cards_home = h;
      stats.yellow_cards_away = a;
    }
  });

  return stats;
}

/* ================= DECIDERS ================= */
function outcomeFromScore(scoreText, side) {
  const m = scoreText.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  const h = +m[1], a = +m[2];
  const res = h > a ? "1" : h < a ? "2" : "X";

  if (side === "1") return res === "1" ? WIN : LOSS;
  if (side === "2") return res === "2" ? WIN : LOSS;
  if (side === "X") return res === "X" ? WIN : LOSS;
  return null;
}

function evaluateStatBet(stats, statKey, side, threshold) {
  if (!stats || stats[statKey] == null) return null;
  const v = Number(stats[statKey]);
  const t = Number(threshold);
  if (!Number.isFinite(v) || !Number.isFinite(t)) return null;

  if (side === "over")  return v > t ? WIN : LOSS;
  if (side === "under") return v < t ? WIN : LOSS;
  return null;
}

/* ================= VERIFY ONE POST ================= */
async function verifyOnePost(post) {
  const postId = post.id;
  const raw = post.content?.raw || post.content?.rendered || "";
  const $ = cheerio.load(raw);

  // Accept both attribute names (old/new): data-match-id OR data-id
  const rows = $("table.bilet-pariu tbody tr[data-match-id], table.bilet-pariu tbody tr[data-id]").toArray();
  if (!rows.length) return;

  let changed = false;

  console.log(`[VERIFY] Post ${postId} → ${rows.length} events`);

  for (const row of rows) {
    const $r = $(row);

    const matchId = $r.attr("data-match-id") || $r.attr("data-id");
    const cur = $r.attr("data-status") || PENDING;

    if (!RECHECK_ONCE && cur !== PENDING) continue;

    // Prefer row-level d; fallback to 0
    const dParam = $r.attr("data-d") ?? "0";

    const market = ($r.attr("data-market") || "").toUpperCase(); // "1","X","2" or "STAT"
    const statKey = $r.attr("data-stat");                        // e.g. corners, shots_on_target
    const statSide = $r.attr("data-side");                       // over/under
    const threshold = $r.attr("data-threshold");                 // number

    // 1) must be finished based on SUMMARY (s=1)
    const summary = await fetchFlashscoreSummary(matchId, dParam);
    if (!summary.finished) {
      // still pending
      continue;
    }

    let verdict = null;

    // 2) 1X2
    if (market === "1" || market === "X" || market === "2") {
      verdict = outcomeFromScore(summary.scoreText, market);
    }

    // 3) stats bet
    if (!verdict && statKey) {
      const stats = await fetchFlashscoreStats(matchId, dParam);
      verdict = evaluateStatBet(stats, statKey, statSide, threshold);
    }

    if (verdict && verdict !== cur) {
      $r.attr("data-status", verdict);

      // update icon cell (assume last TD is status icon)
      const $tds = $r.find("td");
      if ($tds.length) {
        $tds.last().html(verdict === WIN ? "✅" : "❌");
      }

      changed = true;
      console.log(`[VERIFY] Post ${postId} :: ${matchId} -> ${verdict}`);
    }
  }

  if (changed) {
    await wpPut(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, { content: $.html() });
    console.log(`Post #${postId}: actualizat`);
  }
}

/* ================= RUN ================= */
(async () => {
  if (!WP_BASE || !WP_USER || !WP_APP_PASS) {
    console.error("Set WP_BASE, WP_USER, WP_APP_PASS env vars.");
    process.exit(1);
  }

  const posts = new Map();

  // auto-discovery by categories (robust)
  const c2 = await getLatestPostsByCategorySlug("cota-2", MAX_POSTS_PER_CAT);
  const zi = await getLatestPostsByCategorySlug("biletul-zilei", MAX_POSTS_PER_CAT);

  for (const p of [...c2, ...zi]) posts.set(p.id, p);

  const all = [...posts.values()];
  if (!all.length) {
    console.log("No ticket posts found.");
    return;
  }

  // If manual recheck requested and RECHECK_LAST_N is set, only take newest N across both cats
  let toCheck = all.sort((a, b) => new Date(b.date) - new Date(a.date));
  if (RECHECK_ONCE) toCheck = toCheck.slice(0, RECHECK_LAST_N);

  for (const post of toCheck) {
    try {
      await verifyOnePost(post);
    } catch (e) {
      console.error(`Eroare la post ${post.id}: ${e.message}`);
    }
  }
})();
