// verify_and_update_wp.js  — Node 18/20
import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE       = process.env.WP_BASE;            // e.g. https://pariuverde.ro
const WP_USER       = process.env.WP_USER;
const WP_APP_PASS   = process.env.WP_APP_PASS;
const HOMEPAGE_ID   = 11;

// One-off rescue mode: recheck already-decided rows for the most recent N posts.
// Use in CI env for a single run: RECHECK_ONCE=1 RECHECK_LAST_N=15
const RECHECK_ONCE  = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");
const RECHECK_LAST_N = parseInt(process.env.RECHECK_LAST_N || "15", 10);

// You can keep some fixed IDs; auto-discovery will also add the newest posts:
const STATIC_POSTS = [1303,1297,1292,1285,1281,1257,1255,1253,1304,1298,1293,1286,1282,1258,1256];

const FS_BASE = "https://www.flashscore.mobi/match/";

const PENDING = "pending";
const WIN     = "win";
const LOSS    = "loss";

const authHeader = "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const get = (url) => fetch(url, { headers: { Authorization: authHeader, "Content-Type": "application/json" } });
const put = (url, body) =>
  fetch(url, { method: "PUT", headers: { Authorization: authHeader, "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* ================ FLASHCORE PARSER (robust) =================
   Only decide a match if we positively detect a finished signal.
   Score extraction avoids odds like 1.53 / 3.85 / 6.50.
---------------------------------------------------------------- */
function outcomeFromScore(scoreText, market, side) {
  const m = scoreText.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  const h = +m[1], a = +m[2];
  const result = h > a ? "1" : h < a ? "2" : "X";
  if (market === "1") {
    if (side === "1") return result === "1" ? WIN : LOSS;
    if (side === "2") return result === "2" ? WIN : LOSS;
    if ((side || "").toUpperCase() === "X") return result === "X" ? WIN : LOSS;
  }
  return null;
}

async function fetchFlashscoreOutcome(matchId) {
  try {
    const url = `${FS_BASE}${matchId}/?s=5&d=0`;
    const res = await fetch(url);
    if (!res.ok) return { finished: false };
    const html = await res.text();
    const $ = cheerio.load(html);

    // Normalize body text for reliable searching
    const text = $("body").text().replace(/\s+/g, " ").trim();

    // 1) Finished signal
    const finishRe = /\b(Finished|Full\s*Time|After\s*Extra\s*Time|AET|After\s*penalties|Penalties|Abandoned|Awarded)\b/i;
    const finishedIdx = text.search(finishRe);
    if (finishedIdx < 0) return { finished: false };

    // 2) Extract a score NEAR the finished token (±200 chars) and NOT part of decimals
    const near = text.slice(Math.max(0, finishedIdx - 200), finishedIdx + 200);
    // Require non-digit-or-dot before and not followed by digit or dot after
    const scoreRe = /(?:^|[^0-9.])(\d{1,2}\s*:\s*\d{1,2})(?![0-9.])/g;
    let match, lastScore = null;
    while ((match = scoreRe.exec(near)) !== null) lastScore = match[1];
    if (!lastScore) {
      // fallback: try header big score (frequently in the first lines)
      const headerText = ($("h1,h2,h3").first().text() + " " + $(".participant__score").text()).replace(/\s+/g, " ");
      const m2 = headerText.match(/(\d{1,2}\s*:\s*\d{1,2})(?![0-9.])/);
      if (m2) lastScore = m2[1];
    }

    if (!lastScore) return { finished: false };
    return { finished: true, scoreText: lastScore };
  } catch {
    return { finished: false };
  }
}

/* ================== DOM HELPERS ================== */
function paintIconCell($, row, status) {
  const $row = $(row);
  let $cells = $row.find("td");
  if ($cells.length < 6) {
    $row.append('<td style="text-align:center;font-weight:bold;"></td>');
    $cells = $row.find("td");
  }
  const $iconTd = $cells.eq(5);
  $iconTd.attr("style", "text-align:center;font-weight:bold;");
  $iconTd.html(status === WIN ? "✅" : status === LOSS ? "❌" : "⏳");
}

function computeTicketStatusFromTable($table) {
  let hasPending = false, hasLoss = false;
  $table.find("tbody tr[data-status]").each((_, tr) => {
    const s = (typeof $table === "function" ? $table(tr) : $table.find(tr)).attr("data-status");
    if (s === PENDING) hasPending = true;
    else if (s === LOSS) hasLoss = true;
  });
  if (hasPending) return PENDING;
  if (hasLoss) return LOSS;
  return WIN;
}

function recalcAndBadge($, $table) {
  const status = computeTicketStatusFromTable($table);
  const badge = $table.closest("div").find("div")
    .filter((_, el) => $(el).text().match(/În așteptare|Câștigat|Pierdut|⏳|✅|❌/)).first();
  const styleBase = " color:#fff; padding:6px 10px; border-radius:4px; font-weight:bold;";
  if (badge.length) {
    if (status === WIN)  badge.html("✅ Câștigat").attr("style", "background-color:#4CAF50;" + styleBase);
    else if (status === LOSS) badge.html("❌ Pierdut").attr("style", "background-color:#F44336;" + styleBase);
    else                   badge.html("⏳ În așteptare").attr("style", "background-color:#FFC107;" + styleBase);
  }
}

/* ================= VERIFY ONE POST ================= */
async function verifyOnePost(post, statusCache, allowRecheck) {
  const postId = typeof post === "number" ? post : post.id;
  const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!res.ok) throw new Error(`Cannot load post ${postId}`);
  const data = await res.json();
  const raw = data.content?.rendered || data.content?.raw || "";
  const $ = cheerio.load(raw);

  let changed = false;

  // rows
  const rows = $("table.bilet-pariu tbody tr[data-id]").toArray();
  for (const row of rows) {
    const $row = $(row);
    const matchId = $row.attr("data-id");
    const current = $row.attr("data-status") || PENDING;
    const market  = $row.attr("data-market") || "1";
    const pickTxt = ($row.find("td").eq(3).text() || "").trim();
    const side = pickTxt.startsWith("1") ? "1" : pickTxt.startsWith("2") ? "2" : (pickTxt[0] || "").toUpperCase();

    // Skip decided unless recheck is permitted (one-off)
    if (!allowRecheck && (current === WIN || current === LOSS)) {
      statusCache[matchId] = current;
      continue;
    }

    const info = await fetchFlashscoreOutcome(matchId);
    if (!info.finished) {
      statusCache[matchId] = current;
      continue;
    }

    const verdict = outcomeFromScore(info.scoreText, market, side);
    if (verdict && verdict !== current) {
      $row.attr("data-status", verdict);
      paintIconCell($, row, verdict);
      statusCache[matchId] = verdict;
      changed = true;
      console.log(`[VERIFY] ${data.slug} :: ${matchId} -> ${verdict}`);
    } else {
      statusCache[matchId] = current;
      paintIconCell($, row, current);
    }
  }

  // header ✔ column + ticket badge(s)
  $("table.bilet-pariu").each((_, t) => {
    const $t = $(t);
    if ($t.find("thead tr th").length < 6) $t.find("thead tr").append("<th>✔</th>");
    $t.find("tbody tr[data-status]").each((_, tr) => paintIconCell($, tr, $(tr).attr("data-status")));
    recalcAndBadge($, $t);
  });

  if (changed) {
    await put(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, { content: $.html() });
    console.log(`Post #${postId}: actualizat`);
  } else {
    console.log(`Post #${postId}: fără schimbări`);
  }
}

/* ================= SYNC HOMEPAGE ================= */
async function syncHomepage(statusCache) {
  const res = await get(`${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}?context=edit`);
  if (!res.ok) return console.log(`Homepage (${HOMEPAGE_ID}) not accessible`);
  const page = await res.json();
  const raw = page.content?.raw || page.content?.rendered || "";
  const $ = cheerio.load(raw);

  let changed = false;

  $("table.bilet-pariu tbody tr[data-id]").each((_, tr) => {
    const $tr = $(tr);
    const id = $tr.attr("data-id");
    const cur = $tr.attr("data-status") || PENDING;
    const next = statusCache[id];
    if (!next) return;
    if (cur !== next) {
      $tr.attr("data-status", next);
      changed = true;
    }
    paintIconCell($, tr, $tr.attr("data-status"));
  });

  $("table.bilet-pariu").each((_, t) => recalcAndBadge($, $(t)));

  if (changed) {
    await put(`${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}`, { content: $.html() });
    console.log(`Homepage #${HOMEPAGE_ID}: sincronizat cu rezultatele.`);
  } else {
    console.log(`Homepage #${HOMEPAGE_ID}: fără schimbări`);
  }
}

/* ================= RUN ================= */
(async function run() {
  if (!WP_BASE || !WP_USER || !WP_APP_PASS) {
    console.error("Set WP_BASE, WP_USER, WP_APP_PASS env vars.");
    process.exit(1);
  }

  const statusCache = {};

  // 1) Build the list of posts: static + newest (to cover day-by-day)
  const postsSet = new Set(STATIC_POSTS);
  try {
    // pull newest 20 posts that likely include “Biletul Zilei” or “Bilet Cota 2”
    const q1 = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=20&orderby=date&order=desc&search=Bilet`);
    if (q1.ok) for (const p of await q1.json()) postsSet.add(p.id);
  } catch {}

  const ids = [...postsSet];

  // 2) If RECHECK_ONCE=true, figure out newest N posts and force recheck for them
  let newestIds = [];
  if (RECHECK_ONCE) {
    try {
      const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=${RECHECK_LAST_N}&orderby=date&order=desc`);
      if (r.ok) newestIds = (await r.json()).map(p => p.id);
    } catch {}
  }

  for (const id of ids) {
    try {
      await verifyOnePost(id, statusCache, RECHECK_ONCE && newestIds.includes(id));
    } catch (e) {
      console.error(`Eroare la post ${id}: ${e.message}`);
    }
  }

  await syncHomepage(statusCache);
})();
