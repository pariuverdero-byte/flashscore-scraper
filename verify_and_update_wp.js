// verify_and_update_wp.js
// Node 18/20 compatible (ESM)

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/** =========================
 *  CONFIG
 *  ========================= */
// Accept WP_BASE or WP_URL (fallback to WP_URL for backward compat)
const WP_BASE = process.env.WP_BASE || process.env.WP_URL;     // e.g. https://pariuverde.ro
const WP_USER = process.env.WP_USER;                           // REST user
const WP_APP_PASSWORD = process.env.WP_APP_PASS;               // Application Password
const HOMEPAGE_ID = Number(process.env.WP_HOMEPAGE_ID || 11);  // Home page post id

const POSTS_TO_CHECK = [
  1303,1297,1292,1285,1281,1257,1255,1253,1304,1298,1293,1286,1282,1258,1256,
];

const authHeader = "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");

const FS_BASE = "https://www.flashscore.mobi/match/";
const PENDING = "pending", WIN = "win", LOSS = "loss";

/** =========================
 *  HTTP helpers
 *  ========================= */
const get = (url) =>
  fetch(url, { headers: { Authorization: authHeader, "Content-Type": "application/json" } });

const put = (url, body) =>
  fetch(url, {
    method: "PUT",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** =========================
 *  Flashscore parsing helpers
 *  ========================= */
function outcomeFromScoreText(scoreText, pickMarket, pickSide) {
  const m = scoreText.trim().match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  const h = parseInt(m[1], 10), a = parseInt(m[2], 10);
  let outcome;
  if (h > a) outcome = "1";
  else if (h < a) outcome = "2";
  else outcome = "X";

  if (pickMarket === "1") {
    if (pickSide === "1") return outcome === "1" ? WIN : LOSS;
    if (pickSide === "2") return outcome === "2" ? WIN : LOSS;
    if (pickSide?.toUpperCase() === "X") return outcome === "X" ? WIN : LOSS;
  }
  return null;
}

async function fetchFlashscoreOutcome(matchId) {
  try {
    const url = `${FS_BASE}${matchId}/?s=5&d=0`;
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);
    const text = $("body").text();
    const m = text.match(/(\d+)\s*:\s*(\d+)/g);
    if (!m || m.length === 0) return { finished: false };
    const score = m[m.length - 1];

    // Very loose finished heuristics (works well enough for mobi pages)
    const finished = /FT|Full\s*Time|Ended|Final/i.test(text) || !/\b\d{1,2}\s*min\./i.test(text);
    return { finished, scoreText: score };
  } catch {
    return { finished: false };
  }
}

/** =========================
 *  DOM helpers
 *  ========================= */
function computeTicketStatusFromTable($table) {
  let hasPending = false, hasLoss = false;
  $table.find("tbody tr[data-status]").each((_, tr) => {
    const s = $table(tr).attr("data-status");
    if (s === PENDING) hasPending = true;
    else if (s === LOSS) hasLoss = true;
  });
  if (hasPending) return PENDING;
  if (hasLoss) return LOSS;
  return WIN;
}

function paintIconCell($, row, status) {
  const $row = $(row);
  let $cells = $row.find("td");
  if ($cells.length < 6) {
    $row.append(`<td style="text-align:center;font-weight:bold;"></td>`);
    $cells = $row.find("td");
  }
  const $iconTd = $cells.eq(5);
  $iconTd.attr("style", "text-align:center;font-weight:bold;");
  if (status === WIN) $iconTd.html("✅");
  else if (status === LOSS) $iconTd.html("❌");
  else $iconTd.html("⏳");
}

function recalcAndBadge($, $table) {
  const status = computeTicketStatusFromTable($table);
  const ticketWrap = $table.closest("div");
  const badge = ticketWrap.find("div")
    .filter((_, el) => $(el).text().match(/În așteptare|Câștigat|Pierdut|⏳|✅|❌/)).first();

  const paint = (html, bg) =>
    (badge.attr("style") || "").replace(/background-color:[^;]+;/, "") +
    ` background-color:${bg}; color:#fff; padding:6px 10px; border-radius:4px; font-weight:bold;`;

  if (badge.length) {
    if (status === WIN) badge.html("✅ Câștigat").attr("style", paint(badge.html(), "#4CAF50"));
    else if (status === LOSS) badge.html("❌ Pierdut").attr("style", paint(badge.html(), "#F44336"));
    else badge.html("⏳ În așteptare").attr("style", paint(badge.html(), "#FFC107"));
  }
}

/** =========================
 *  Verify a post, then sync homepage
 *  ========================= */
async function verifyOnePost(postId, statusCache) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) throw new Error(`Cannot load post ${postId}`);
  const post = await res.json();
  const $ = cheerio.load(post.content?.rendered || post.content?.raw || "");

  let changed = false;

  const rows = $("table.bilet-pariu tbody tr[data-id]");
  for (const row of rows.toArray()) {
    const $row = $(row);
    const matchId = $row.attr("data-id");
    const current = $row.attr("data-status") || PENDING;
    const market = $row.attr("data-market") || "1";
    const pickText = ($row.find("td").eq(3).text() || "").trim();
    const pickSide = pickText[0] === "1" ? "1" : pickText[0] === "2" ? "2" : pickText[0]?.toUpperCase();

    if (current === WIN || current === LOSS) {
      statusCache[matchId] = current;
      continue;
    }

    const info = await fetchFlashscoreOutcome(matchId);
    if (!info.finished) {
      statusCache[matchId] = current;
      continue;
    }
    const verdict = outcomeFromScoreText(info.scoreText, market, pickSide);
    if (verdict && verdict !== current) {
      $row.attr("data-status", verdict);
      paintIconCell($, row, verdict);
      statusCache[matchId] = verdict;
      changed = true;
      const title = $("h1,h2,h3").first().text() || post.title?.rendered;
      console.log(`[VERIFY] ${title} :: ${matchId} -> ${verdict}`);
    }
  }

  // Ensure ✔ column + badges
  $("table.bilet-pariu").each((_, t) => {
    const $t = $(t);
    const ths = $t.find("thead tr th");
    if (ths.length < 6) $t.find("thead tr").append(`<th>✔</th>`);
    $t.find("tbody tr[data-status]").each((_, tr) => paintIconCell($, tr, $(tr).attr("data-status")));
    recalcAndBadge($, $t);
  });

  if (changed) {
    const newHtml = $.html();
    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, { content: newHtml });
    console.log(`Post #${postId}: actualizat`);
  } else {
    console.log(`Post #${postId}: fără schimbări`);
  }
}

async function syncHomepage(statusCache) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}?context=edit`);
  if (!res.ok) {
    console.log(`Homepage (${HOMEPAGE_ID}) not accessible`);
    return;
  }
  const page = await res.json();
  const raw = page.content?.raw || page.content?.rendered || "";
  const $ = cheerio.load(raw);

  let changed = false;

  $("table.bilet-pariu tbody tr[data-id]").each((_, tr) => {
    const $tr = $(tr);
    const id = $tr.attr("data-id");
    const cur = $tr.attr("data-status") || PENDING;
    const newS = statusCache[id];
    if (!newS) return;
    if (newS !== cur) {
      $tr.attr("data-status", newS);
      paintIconCell($, tr, newS);
      changed = true;
    } else {
      paintIconCell($, tr, cur);
    }
  });

  $("table.bilet-pariu").each((_, t) => recalcAndBadge($, $(t)));

  const anyDecided = $("table.bilet-pariu tbody tr[data-status='win'], table.bilet-pariu tbody tr[data-status='loss']").length > 0;
  if (anyDecided) {
    $(`.elementor-shortcode:contains("Niciun eveniment finalizat.")`).each((_, el) => {
      const p = $(el).find("p");
      if (p.length) {
        p.text("Evenimentele au fost actualizate.");
        changed = true;
      }
    });
  }

  if (changed) {
    const newHtml = $.html();
    await put(`${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}`, { content: newHtml });
    console.log(`Homepage #${HOMEPAGE_ID}: sincronizat cu rezultatele.`);
  } else {
    console.log(`Homepage #${HOMEPAGE_ID}: fără schimbări`);
  }
}

/** =========================
 *  Runner
 *  ========================= */
(async function run() {
  const missing = [];
  if (!WP_BASE) missing.push("WP_BASE or WP_URL");
  if (!WP_USER) missing.push("WP_USER");
  if (!WP_APP_PASSWORD) missing.push("WP_APP_PASS");
  if (missing.length) {
    console.error("Missing required env vars:", missing.join(", "));
    process.exit(1);
  }

  const statusCache = {}; // matchId -> status

  for (const id of POSTS_TO_CHECK) {
    try {
      await verifyOnePost(id, statusCache);
    } catch (e) {
      console.error(`Eroare la post ${id}:`, e.message);
    }
  }

  try {
    const q1 = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=6&search=Bilet%20Cota%202`);
    const q2 = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=6&search=Biletul%20Zilei`);
    for (const r of [q1, q2]) {
      if (r.ok) {
        const items = await r.json();
        for (const p of items) {
          if (!POSTS_TO_CHECK.includes(p.id)) {
            await verifyOnePost(p.id, statusCache);
          }
        }
      }
    }
  } catch {}

  await syncHomepage(statusCache);
})();
