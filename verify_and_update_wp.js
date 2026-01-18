// verify_and_update_wp.js — FINAL STABLE VERSION
// Node 18 / 20 compatible

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
const WIN     = "win";
const LOSS    = "loss";

const authHeader =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

/* ================= SAFE WP FETCH ================= */
async function wpFetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  let text = await res.text();
  text = text.replace(/^\uFEFF/, "").trim();

  // taie junk / html înainte de JSON
  const i1 = text.indexOf("{");
  const i2 = text.indexOf("[");
  const start =
    i1 === -1 ? i2 :
    i2 === -1 ? i1 :
    Math.min(i1, i2);

  if (start > 0) text = text.slice(start);

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("❌ INVALID JSON from WP");
    console.error(text.slice(0, 500));
    return null;
  }
}

/* ================= FLASHCORE SCORE ================= */
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

async function fetchScore(matchId) {
  try {
    const res = await fetch(`${FS_BASE}${matchId}/?s=5&d=0`);
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const txt = $("body").text();

    if (!/Finished|Full Time|After Extra Time|Penalties/i.test(txt))
      return null;

    return (
      $("div.detail b").first().text() ||
      txt.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1] ||
      null
    );
  } catch {
    return null;
  }
}

/* ================= FLASHCORE STATS ================= */
async function fetchStats(matchId) {
  try {
    const res = await fetch(`${FS_BASE}${matchId}/?s=1&d=0&t=stats`);
    if (!res.ok) return null;

    const html = await res.text();
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
  } catch {
    return null;
  }
}

function evalStat(stats, stat, side, thr) {
  if (!stats || stats[stat] == null) return null;
  const v = stats[stat];
  const t = Number(thr);
  if (!Number.isFinite(t)) return null;
  return side === "over" ? (v > t ? WIN : LOSS)
                         : (v < t ? WIN : LOSS);
}

/* ================= VERIFY ONE POST ================= */
async function verifyPost(post) {
  const raw = post.content?.rendered || post.content?.raw || "";
  const $ = cheerio.load(raw);
  let changed = false;

  const rows = $("tr[data-id]").toArray();
  console.log(`[VERIFY] Post ${post.id} → ${rows.length} events`);

  for (const row of rows) {
    const $r = $(row);
    const id = $r.attr("data-id");
    if (!id) continue;

    const cur = $r.attr("data-status") || PENDING;
    if (!RECHECK_ONCE && cur !== PENDING) continue;

    const market = ($r.attr("data-market") || "").toLowerCase();
    const side   = $r.attr("data-side");
    const stat   = $r.attr("data-stat");
    const thr    = $r.attr("data-threshold");

    let verdict = null;

    if (!stat) {
      const score = await fetchScore(id);
      if (score) verdict = outcomeFromScore(score, side);
    } else {
      const stats = await fetchStats(id);
      verdict = evalStat(stats, stat, side, thr);
    }

    if (verdict && verdict !== cur) {
      $r.attr("data-status", verdict);
      $r.find("td").last().html(verdict === WIN ? "✅" : "❌");
      changed = true;
      console.log(` → ${id} = ${verdict}`);
    }
  }

  if (changed) {
    await wpFetchJson(
      `${WP_BASE}/wp-json/wp/v2/posts/${post.id}`,
      {
        method: "PUT",
        body: JSON.stringify({ content: $.html() })
      }
    );
    console.log(` ✔ Post ${post.id} updated`);
  }
}

/* ================= RUN ================= */
(async () => {
  if (!WP_BASE || !WP_USER || !WP_APP_PASS) {
    console.error("❌ Missing WP credentials");
    process.exit(1);
  }

  const posts = await wpFetchJson(
    `${WP_BASE}/wp-json/wp/v2/posts?per_page=20&search=Bilet`
  );

  if (!Array.isArray(posts)) {
    console.error("❌ Cannot load posts list");
    process.exit(1);
  }

  for (const p of posts) {
    await verifyPost(p);
  }

  console.log("✅ VERIFY FLOW FINISHED");
})();
