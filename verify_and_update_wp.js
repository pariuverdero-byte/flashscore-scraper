// verify_and_update_wp.js
// FINAL — score + stats + BTTS, NO static IDs

import fetch from "node-fetch";
import * as cheerio from "cheerio";

const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const FS_BASE = "https://www.flashscore.mobi/match/";

const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

const auth =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const wpGet = (url) =>
  fetch(url, { headers:{ Authorization:auth } });

const wpPut = (url, body) =>
  fetch(url, {
    method:"PUT",
    headers:{ Authorization:auth, "Content-Type":"application/json" },
    body: JSON.stringify(body),
  });

/* ================= SCORE ================= */
function outcomeFromScore(scoreText, side) {
  const m = scoreText.match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  const h = +m[1], a = +m[2];
  const res = h > a ? "1" : h < a ? "2" : "X";

  if (side === "1") return res === "1" ? WIN : LOSS;
  if (side === "2") return res === "2" ? WIN : LOSS;
  if (side === "X") return res === "X" ? WIN : LOSS;
  return null;
}

/* ================= FETCH SCORE ================= */
async function fetchScore(matchId) {
  const r = await fetch(`${FS_BASE}${matchId}/?s=1&d=-1`);
  if (!r.ok) return null;

  const html = await r.text();
  const $ = cheerio.load(html);
  const text = $("body").text();

  if (!/Finished|Full Time|After Extra Time|Penalties/i.test(text))
    return null;

  return text.match(/(\d+\s*:\s*\d+)/)?.[1] || null;
}

/* ================= FETCH STATS ================= */
async function fetchStats(matchId) {
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

    if (label.includes("corner")) stats.corners = h + a;
    if (label.includes("shot") && label.includes("on"))
      stats.shots_on_target = h + a;
    if (label.includes("goal")) stats.goals = h + a;
  });

  return stats;
}

/* ================= VERIFY POSTS ================= */
async function verifyPost(post) {
  const res = await wpGet(
    `${WP_BASE}/wp-json/wp/v2/posts/${post.id}?context=edit`
  );
  if (!res.ok) return;

  const data = await res.json();
  const $ = cheerio.load(data.content.raw || data.content.rendered);
  let changed = false;

  $("table.bilet-pariu tbody tr[data-id]").each(async (_, tr) => {
    const $r = $(tr);
    const id = $r.attr("data-id");
    const status = $r.attr("data-status") || PENDING;
    if (status !== PENDING) return;

    const market = $r.attr("data-market");
    const stat   = $r.attr("data-stat");
    const side   = $r.attr("data-side");
    const thr    = Number($r.attr("data-threshold"));

    let verdict = null;

    if (market === "1") {
      const score = await fetchScore(id);
      if (score) verdict = outcomeFromScore(score, side);
    }

    if (market === "STAT") {
      const stats = await fetchStats(id);
      if (!stats) return;

      if (stat === "btts") {
        verdict = stats.goals >= 2 ? WIN : LOSS;
      } else if (side === "over") {
        verdict = stats[stat] > thr ? WIN : LOSS;
      } else if (side === "under") {
        verdict = stats[stat] < thr ? WIN : LOSS;
      }
    }

    if (verdict) {
      $r.attr("data-status", verdict);
      $r.find("td").last().text(verdict === WIN ? "✅" : "❌");
      changed = true;
      console.log(`[VERIFY] ${post.id} ${id} → ${verdict}`);
    }
  });

  if (changed) {
    await wpPut(
      `${WP_BASE}/wp-json/wp/v2/posts/${post.id}`,
      { content: $.html() }
    );
    console.log(`Post ${post.id} updated`);
  }
}

/* ================= RUN ================= */
(async () => {
  const r = await wpGet(
    `${WP_BASE}/wp-json/wp/v2/posts?per_page=20&search=Bilet`
  );
  if (!r.ok) return;

  const posts = await r.json();
  for (const p of posts) {
    await verifyPost(p);
  }
})();
