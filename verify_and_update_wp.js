// verify_and_update_wp.js
// Node 18/20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/** =========================
 *  CONFIG
 *  ========================= */
const WP_BASE = process.env.WP_BASE;              // e.g. https://pariuverde.ro
const WP_USER = process.env.WP_USER;              // REST user
const WP_APP_PASSWORD = process.env.WP_APP_PASS;  // Application Password
const HOMEPAGE_ID = 11;                           // Home page post id
const POSTS_TO_CHECK = [
  // Add/keep your post IDs here; the script can also auto-discover by category if you prefer
  1303,1297,1292,1285,1281,1257,1255,1253,1304,1298,1293,1286,1282,1258,1256,
];

const authHeader = "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");

const FS_BASE = "https://www.flashscore.mobi/match/";
const PENDING = "pending", WIN = "win", LOSS = "loss";

/** =========================
 *  HELPERS
 *  ========================= */
const get = (url) =>
  fetch(url, { headers: { Authorization: authHeader, "Content-Type": "application/json" } });

const put = (url, body) =>
  fetch(url, {
    method: "PUT",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function outcomeFromScoreText(scoreText, pickMarket, pickSide) {
  // scoreText like "2:1" or "0:0 (pens 4:5)"; keep it simple
  const m = scoreText.trim().match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  const h = parseInt(m[1], 10), a = parseInt(m[2], 10);
  let outcome;
  if (h > a) outcome = "1";
  else if (h < a) outcome = "2";
  else outcome = "X";

  // current impl supports 1X2 (market "1")
  if (pickMarket === "1") {
    if (pickSide === "1") return outcome === "1" ? WIN : (outcome === "X" || outcome === "2") ? LOSS : null;
    if (pickSide === "2") return outcome === "2" ? WIN : (outcome === "1" || outcome === "X") ? LOSS : null;
    if (pickSide?.toUpperCase() === "X") return outcome === "X" ? WIN : LOSS;
  }
  return null;
}

async function fetchFlashscoreOutcome(matchId) {
  try {
    const url = `${FS_BASE}${matchId}/?s=5&d=0`;
    const res = await fetch(url);
    const html = await res.text();
    // crude parse: find something like <div class="...">FT ... 2:0</div>
    const $ = cheerio.load(html);
    const text = $("body").text();
    // prefer last score pattern
    const m = text.match(/(\d+)\s*:\s*(\d+)/g);
    if (!m || m.length === 0) return { finished: false };
    const score = m[m.length - 1];
    // detect finished keywords
    const finished = /FT|Full\s*Time|Ended|Final/.test(text) || /min\.\)/i.test(text) === false;
    return { finished, scoreText: score };
  } catch {
    return { finished: false };
  }
}

function computeTicketStatusFromTable($table) {
  let hasPending = false, hasLoss = false;
  $table.find("tbody tr[data-status]").each((_, tr) => {
    const s = $table($(tr)).attr("data-status");
    if (s === PENDING) hasPending = true;
    else if (s === LOSS) hasLoss = true;
  });
  if (hasPending) return PENDING;
  if (hasLoss) return LOSS;
  return WIN;
}

function paintIconCell($, row, status) {
  // ensure 6th cell exists and show matching icon
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

/** =========================
 *  MAIN: verify posts, then sync homepage
 *  ========================= */
async function verifyOnePost(postId, statusCache) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) throw new Error(`Cannot load post ${postId}`);
  const post = await res.json();
  const $ = cheerio.load(post.content?.rendered || post.content?.raw || "");

  let changed = false;

  // For every event row
  const rows = $("table.bilet-pariu tbody tr[data-id]");
  for (const row of rows.toArray()) {
    const $row = $(row);
    const matchId = $row.attr("data-id");
    const current = $row.attr("data-status") || PENDING;
    const market = $row.attr("data-market") || "1";
    const pickText = ($row.find("td").eq(3).text() || "").trim(); // e.g., "1 (gazde)"
    const pickSide = pickText[0] === "1" ? "1" : pickText[0] === "2" ? "2" : pickText[0]?.toUpperCase();

    // If already decided, just cache and move on
    if (current === WIN || current === LOSS) {
      statusCache[matchId] = current;
      continue;
    }

    // Query Flashscore
    const info = await fetchFlashscoreOutcome(matchId);
    if (!info.finished) {
      statusCache[matchId] = current; // pending
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

  // Ensure header ✔ column exists
  $("table.bilet-pariu").each((_, t) => {
    const $t = $(t);
    const ths = $t.find("thead tr th");
    if (ths.length < 6) {
      $t.find("thead tr").append(`<th>✔</th>`);
    }
    // paint icon cells for existing statuses
    $t.find("tbody tr[data-status]").each((_, tr) => {
      paintIconCell($, tr, $(tr).attr("data-status"));
    });
    // Update the ticket badge above table (div with the emoji)
    const ticketWrap = $t.closest("div");
    const status = computeTicketStatusFromTable($t);
    const badge = ticketWrap.find("div")
      .filter((_, el) => $(el).text().match(/În așteptare|Câștigat|Pierdut|⏳|✅|❌/)).first();
    if (badge.length) {
      if (status === WIN) badge.html(`✅ Câștigat`).attr("style", (badge.attr("style")||"").replace(/background-color:[^;]+;/,'') + " background-color:#4CAF50; color:#fff; padding:6px 10px; border-radius:4px; font-weight:bold;");
      else if (status === LOSS) badge.html(`❌ Pierdut`).attr("style", (badge.attr("style")||"").replace(/background-color:[^;]+;/,'') + " background-color:#F44336; color:#fff; padding:6px 10px; border-radius:4px; font-weight:bold;");
      else badge.html(`⏳ În așteptare`).attr("style", (badge.attr("style")||"").replace(/background-color:[^;]+;/,'') + " background-color:#FFC107; color:#fff; padding:6px 10px; border-radius:4px; font-weight:bold;");
    }
  });

  if (changed) {
    // Update post content
    const newHtml = $.html();
    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, { content: newHtml });
    console.log(`Post #${postId}: actualizat`);
  } else {
    console.log(`Post #${postId}: fără schimbări`);
  }
}

function recalcAndBadge($, $table) {
  const status = computeTicketStatusFromTable($table);
  const ticketWrap = $table.closest("div");
  const badge = ticketWrap.find("div")
    .filter((_, el) => $(el).text().match(/În așteptare|Câștigat|Pierdut|⏳|✅|❌/)).first();
  if (badge.length) {
    if (status === WIN) badge.html(`✅ Câștigat`).attr("style", (badge.attr("style")||"").replace(/background-color:[^;]+;/,'') + " background-color:#4CAF50; color:#fff; padding:6px 10px; border-radius:4px; font-weight:bold;");
    else if (status === LOSS) badge.html(`❌ Pierdut`).attr("style", (badge.attr("style")||"").replace(/background-color:[^;]+;/,'') + " background-color:#F44336; color:#fff; padding:6px 10px; border-radius:4px; font-weight:bold;");
    else badge.html(`⏳ În așteptare`).attr("style", (badge.attr("style")||"").replace(/background-color:[^;]+;/,'') + " background-color:#FFC107; color:#fff; padding:6px 10px; border-radius:4px; font-weight:bold;");
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
  // Update every event row found on homepage
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
      // ensure icon exists even if same status
      paintIconCell($, tr, cur);
    }
  });

  // Recompute ticket badges for each table block
  $("table.bilet-pariu").each((_, t) => recalcAndBadge($, $(t)));

  // If any decided exists, replace “Niciun eveniment finalizat.”
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

(async function run() {
  if (!WP_BASE || !WP_USER || !WP_APP_PASSWORD) {
    console.error("Set WP_BASE, WP_USER, WP_APP_PASS env vars.");
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

  // also try to auto-discover newest posts in the two series, in case the list above lags
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
