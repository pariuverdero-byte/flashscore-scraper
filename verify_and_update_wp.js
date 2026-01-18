// verify_and_update_wp.js — FINAL FIX (TEAM GOALS via SCORE)
// Node 18 / 20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

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

/* ================= FETCH FINAL SCORE ================= */
async function fetchFinalScore(matchId) {
  try {
    const res = await fetch(`${FS_BASE}${matchId}/?s=5&d=-1`);
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const text = $("body").text();

    if (!/Finished|Full Time|After Extra Time|Penalties/i.test(text))
      return null;

    const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    if (!m) return null;

    return {
      home: parseInt(m[1], 10),
      away: parseInt(m[2], 10),
    };
  } catch {
    return null;
  }
}

/* ================= VERIFY POSTS ================= */
async function verifyPost(postId) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) return;

  const post = await res.json();
  const $ = cheerio.load(post.content.raw || post.content.rendered);
  let changed = false;

  const rows = $("table.bilet-pariu tbody tr").toArray();
  console.log(`[VERIFY] Post ${postId} → ${rows.length} events`);

  for (const row of rows) {
    const $r = $(row);

    const matchId = $r.attr("data-id");
    const status  = $r.attr("data-status") || PENDING;
    if (!matchId || status !== PENDING) continue;

    const threshold = parseFloat($r.attr("data-threshold") || "0");
    const betText = $r.find("td").eq(3).text().toLowerCase();

    const score = await fetchFinalScore(matchId);
    if (!score) continue;

    // Detect home / away team from text
    const teamsText = $r.find("td").eq(0).text().toLowerCase();
    const homeTeam = teamsText.split("–")[0].trim();
    const awayTeam = teamsText.split("–")[1].trim();

    let goals = null;
    if (betText.includes(homeTeam)) goals = score.home;
    else if (betText.includes(awayTeam)) goals = score.away;
    else continue;

    const verdict = goals >= threshold ? WIN : LOSS;

    $r.attr("data-status", verdict);
    $r.find("td").last().text(verdict === WIN ? "✅" : "❌");
    changed = true;
  }

  if (changed) {
    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html()
    });
    console.log(`✔ Post ${postId} updated`);
  }
}

/* ================= RUN ================= */
(async () => {
  if (!WP_BASE || !WP_USER || !WP_APP_PASS) {
    console.error("Missing WP credentials");
    process.exit(1);
  }

  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=20&search=Bilet`);
  if (!res.ok) process.exit(0);

  const posts = await res.json();
  for (const p of posts) {
    await verifyPost(p.id);
  }

  console.log("✅ VERIFY FLOW FINISHED");
})();
