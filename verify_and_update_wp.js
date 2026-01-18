// verify_and_update_wp.js — FINAL VERSION (scores + stats)
// Node 18 / 20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;
const HOMEPAGE_ID = 11;

const RECHECK_ONCE   = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");
const RECHECK_LAST_N = parseInt(process.env.RECHECK_LAST_N || "15", 10);

const STATIC_POSTS = [
  1303,1297,1292,1285,1281,1257,1255,1253,
  1304,1298,1293,1286,1282,1258,1256
];

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

/* ================= SCORE (1X2) ================= */
function outcomeFromScore(scoreText, market, side) {
  const m = scoreText.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;

  const h = +m[1], a = +m[2];
  const res = h > a ? "1" : h < a ? "2" : "X";

  if (market === "1") {
    if (side === "1") return res === "1" ? WIN : LOSS;
    if (side === "2") return res === "2" ? WIN : LOSS;
    if (side === "X") return res === "X" ? WIN : LOSS;
  }
  return null;
}

/* ================= FETCH SCORE ================= */
async function fetchFlashscoreOutcome(matchId) {
  try {
    const res = await fetch(`${FS_BASE}${matchId}/?s=5&d=0`);
    if (!res.ok) return { finished:false };

    const html = await res.text();
    const $ = cheerio.load(html);
    const text = $("body").text();

    if (!/Finished|Full Time|After Extra Time|Penalties/i.test(text))
      return { finished:false };

    const score =
      $("div.detail b").first().text() ||
      text.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

    if (!score) return { finished:false };

    return { finished:true, scoreText:score };
  } catch {
    return { finished:false };
  }
}

/* ================= FETCH STATS ================= */
async function fetchFlashscoreStats(matchId) {
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

function evaluateStatBet(stats, stat, side, threshold) {
  if (!stats || stats[stat] == null) return null;
  const v = stats[stat];
  const t = Number(threshold);
  if (!Number.isFinite(t)) return null;

  if (side === "over")  return v > t ? WIN : LOSS;
  if (side === "under") return v < t ? WIN : LOSS;
  return null;
}

/* ================= UI HELPERS ================= */
function paintIconCell($, row, status) {
  const td = $(row).find("td").eq(5);
  td.html(status === WIN ? "✅" : status === LOSS ? "❌" : "⏳");
}

function computeTicketStatus($, $table) {
  let pending=false, loss=false;
  $table.find("tbody tr").each((_, tr)=>{
    const s=$(tr).attr("data-status");
    if (s===PENDING) pending=true;
    if (s===LOSS) loss=true;
  });
  if (pending) return PENDING;
  if (loss) return LOSS;
  return WIN;
}

/* ================= VERIFY POST ================= */
async function verifyOnePost(postId, cache, allowRecheck) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) return;
  const data = await res.json();

  const $ = cheerio.load(data.content.raw || data.content.rendered);
  let changed=false;

  for (const row of $("tr[data-id]").toArray()) {
    const $r = $(row);
    const id = $r.attr("data-id");
    const cur = $r.attr("data-status") || PENDING;
    if (!allowRecheck && cur !== PENDING) continue;

    const market = $r.attr("data-market");
    const stat   = $r.attr("data-stat");
    const side   = $r.attr("data-side");
    const thr    = $r.attr("data-threshold");

    let verdict=null;

    if (market==="1") {
      const o = await fetchFlashscoreOutcome(id);
      if (o.finished)
        verdict = outcomeFromScore(o.scoreText, "1", side);
    } else if (stat) {
      const stats = await fetchFlashscoreStats(id);
      verdict = evaluateStatBet(stats, stat, side, thr);
    }

    if (verdict && verdict!==cur) {
      $r.attr("data-status", verdict);
      paintIconCell($, row, verdict);
      cache[id]=verdict;
      changed=true;
    }
  }

  if (changed) {
    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html()
    });
  }
}

/* ================= RUN ================= */
(async ()=>{
  if (!WP_BASE||!WP_USER||!WP_APP_PASS) process.exit(1);

  const cache = {};
  const posts = new Set(STATIC_POSTS);

  try {
    const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=20&search=Bilet`);
    if (r.ok) (await r.json()).forEach(p=>posts.add(p.id));
  } catch {}

  for (const id of posts) {
    await verifyOnePost(id, cache, RECHECK_ONCE);
  }
})();
