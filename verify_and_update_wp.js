// verify_and_update_wp.js — FINAL STABLE (1X2 + Goals + BTTS)
// Node 18 / 20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;
const HOMEPAGE_ID = 11;

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

/* ================= SCORE PARSER ================= */
function parseScore(text) {
  const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  return { h:+m[1], a:+m[2] };
}

/* ================= OUTCOME ================= */
function outcome1X2(score, side) {
  if (!score) return null;
  const res = score.h > score.a ? "1" : score.h < score.a ? "2" : "X";
  return res === side ? WIN : LOSS;
}

function outcomeGoals(score, side, threshold) {
  if (!score) return null;
  const total = score.h + score.a;
  return side === "over"
    ? total > threshold ? WIN : LOSS
    : total < threshold ? WIN : LOSS;
}

function outcomeBTTS(score) {
  if (!score) return null;
  return score.h > 0 && score.a > 0 ? WIN : LOSS;
}

/* ================= FETCH FLASHCORE ================= */
async function fetchFlashscore(matchId) {
  try {
    const res = await fetch(`${FS_BASE}${matchId}/?s=1&d=-1`);
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const bodyText = $("body").text();

    if (!/Finished|Full Time|After Extra Time|Penalties/i.test(bodyText))
      return null;

    const scoreText =
      $("div.detail b").first().text() ||
      bodyText.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

    if (!scoreText) return null;
    return parseScore(scoreText);
  } catch {
    return null;
  }
}

/* ================= UI HELPERS ================= */
function paintRow($, row, status) {
  $(row).attr("data-status", status);
  $(row).find("td").last().html(
    status === WIN ? "✅" : status === LOSS ? "❌" : "⏳"
  );
}

function computeTicketStatus($table) {
  let pending=false, loss=false;
  $table.find("tbody tr").each((_, tr)=>{
    const s = $(tr).attr("data-status");
    if (s===PENDING) pending=true;
    if (s===LOSS) loss=true;
  });
  if (pending) return PENDING;
  if (loss) return LOSS;
  return WIN;
}

function updateGlobalBadge($, status) {
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

  const map = {
    pending: ["⏳","Rezultat în așteptare","pv-status-yellow"],
    win: ["✅","Bilet câștigat","pv-status-green"],
    loss: ["❌","Bilet pierdut","pv-status-red"],
  };

  box
    .removeClass("pv-status-yellow pv-status-green pv-status-red")
    .addClass(map[status][2]);

  box.find(".pv-status-icon").text(map[status][0]);
  box.find(".pv-status-label").text(map[status][1]);
}

/* ================= VERIFY POST ================= */
async function verifyPost(postId) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) return;

  const post = await res.json();
  const $ = cheerio.load(post.content.raw || post.content.rendered);
  let changed=false;

  const rows = $("table.bilet-pariu tbody tr").toArray();
  console.log(`[VERIFY] Post ${postId} → ${rows.length} events`);

  for (const row of rows) {
    const $r = $(row);
    const cur = $r.attr("data-status") || PENDING;
    if (!RECHECK_ONCE && cur !== PENDING) continue;

    const matchId = $r.attr("data-id");
    if (!matchId) continue;

    const market = ($r.attr("data-market") || "").toLowerCase();
    const stat   = ($r.attr("data-stat") || "").toLowerCase();
    const side   = ($r.attr("data-side") || "").toLowerCase();
    const thr    = parseFloat($r.attr("data-threshold"));

    const score = await fetchFlashscore(matchId);
    if (!score) continue;

    let verdict=null;

    if (market==="1") verdict = outcome1X2(score, side);
    else if (stat==="goals") verdict = outcomeGoals(score, side, thr);
    else if (stat==="btts") verdict = outcomeBTTS(score);

    if (verdict && verdict!==cur) {
      paintRow($, row, verdict);
      changed=true;
    }
  }

  if (changed) {
    const table = $("table.bilet-pariu").first();
    const globalStatus = computeTicketStatus(table);
    updateGlobalBadge($, globalStatus);

    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html()
    });
  }
}

/* ================= HOMEPAGE REFRESH ================= */
async function refreshHomepage() {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}?context=edit`);
  if (!res.ok) return;

  const page = await res.json();
  let raw = page.content.raw || page.content.rendered;

  const stamp = `<!-- pv-cache-buster:${Date.now()} -->`;
  raw = raw.replace(/<!-- pv-cache-buster:\d+ -->/,"");
  raw += "\n"+stamp;

  await put(`${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}`,{ content:raw });
}

/* ================= RUN ================= */
(async ()=>{
  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=25&search=Bilet`);
  if (!r.ok) {
    console.error("Cannot load posts");
    return;
  }

  const posts = await r.json();
  for (const p of posts) await verifyPost(p.id);

  await refreshHomepage();
  console.log("✅ VERIFY FLOW FINISHED");
})();
