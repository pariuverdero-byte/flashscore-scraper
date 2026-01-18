// verify_and_update_wp.js — FINAL (AUTO-DISCOVERY, NO STATIC IDS)
// Node 18 / 20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const RECHECK_ONCE   = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");
const MAX_POSTS_PER_CAT = parseInt(process.env.MAX_POSTS_PER_CAT || "8", 10);

const FS_BASE = "https://www.flashscore.mobi/match/";
const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

/* ================= AUTH ================= */
const authHeader =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const get = (url) =>
  fetch(url, { headers:{ Authorization:authHeader } });

const put = (url, body) =>
  fetch(url, {
    method:"PUT",
    headers:{
      Authorization:authHeader,
      "Content-Type":"application/json"
    },
    body: JSON.stringify(body),
  });

/* ================= SCORE ================= */
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
      $("div.detail b").first().text().trim() ||
      text.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

    if (!score) return { finished:false };

    return { finished:true, scoreText:score };
  } catch {
    return { finished:false };
  }
}

/* ================= VERIFY ONE POST ================= */
async function verifyOnePost(postId) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) return;

  const data = await res.json();
  const $ = cheerio.load(data.content?.raw || data.content?.rendered || "");
  let changed=false;

  const rows = $("table.bilet-pariu tbody tr[data-match-id]").toArray();
  if (!rows.length) return;

  console.log(`[VERIFY] Post ${postId} → ${rows.length} events`);

  for (const row of rows) {
    const $r = $(row);
    const matchId = $r.attr("data-match-id");
    const cur = $r.attr("data-status") || PENDING;

    if (!RECHECK_ONCE && cur !== PENDING) continue;

    const market = ($r.attr("data-market") || "1").toUpperCase();
    const side = market;

    const o = await fetchFlashscoreOutcome(matchId);
    if (!o.finished) continue;

    const verdict = outcomeFromScore(o.scoreText, side);
    if (!verdict || verdict === cur) continue;

    $r.attr("data-status", verdict);
    $r.find("td").eq(5).html(verdict === WIN ? "✅" : "❌");
    changed=true;

    console.log(`[VERIFY] ${matchId} → ${verdict}`);
  }

  if (changed) {
    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html()
    });
    console.log(`Post #${postId}: actualizat`);
  }
}

/* ================= RUN ================= */
(async ()=>{
  if (!WP_BASE || !WP_USER || !WP_APP_PASS) {
    console.error("Missing WP credentials");
    process.exit(1);
  }

  const postIds = new Set();

  // 🔹 COTA 2
  const r1 = await get(`${WP_BASE}/wp-json/wp/v2/posts?categories_slug=cota-2&per_page=${MAX_POSTS_PER_CAT}`);
  if (r1.ok) (await r1.json()).forEach(p => postIds.add(p.id));

  // 🔹 BILETUL ZILEI
  const r2 = await get(`${WP_BASE}/wp-json/wp/v2/posts?categories_slug=biletul-zilei&per_page=${MAX_POSTS_PER_CAT}`);
  if (r2.ok) (await r2.json()).forEach(p => postIds.add(p.id));

  if (!postIds.size) {
    console.log("No ticket posts found.");
    return;
  }

  for (const id of postIds) {
    try {
      await verifyOnePost(id);
    } catch (e) {
      console.error(`Eroare la post ${id}:`, e.message);
    }
  }
})();
