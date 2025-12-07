// verify_and_update_wp.js — Node 18/20 compatible
import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE       = process.env.WP_BASE;            // e.g. https://pariuverde.ro
const WP_USER       = process.env.WP_USER;
const WP_APP_PASS   = process.env.WP_APP_PASS;
const HOMEPAGE_ID   = 11;

// One-off rescue mode: re-check already-decided rows for the most recent N posts.
// Use in CI for a single run: RECHECK_ONCE=1 RECHECK_LAST_N=15
const RECHECK_ONCE   = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");
const RECHECK_LAST_N = parseInt(process.env.RECHECK_LAST_N || "15", 10);

// Some fixed older IDs; auto-discovery will also add newest posts:
const STATIC_POSTS = [
  1303,1297,1292,1285,1281,1257,1255,1253,1304,1298,1293,1286,1282,1258,1256
];

const FS_BASE  = "https://www.flashscore.mobi/match/";
const PENDING  = "pending";
const WIN      = "win";
const LOSS     = "loss";

const authHeader = "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const get = (url) =>
  fetch(url, { headers: { Authorization: authHeader, "Content-Type": "application/json" } });

const put = (url, body) =>
  fetch(url, {
    method: "PUT",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/* ====== SAFE JSON HELPER (handles sgcaptcha HTML) ====== */
async function fetchJson(url) {
  const res = await get(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url} – body: ${txt.slice(0,120)}...`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Non-JSON response (content-type=${ct || "unknown"}) for ${url} – first 120 chars: ${txt.slice(0,120)}...`
    );
  }
  return res.json();
}

/* ================= FLASHSCORE PARSER =================
   Considerăm meciul "finished" doar dacă apare un text clar
   de final: Finished / After Extra Time / After Penalties etc.
   Scorul îl luăm dintr-o fereastră ±200 caractere în jurul
   acelui text, ca să evităm orele de tip 16:00.
================================================================ */
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

    // Normalizăm textul
    const text = $("body").text().replace(/\s+/g, " ").trim();

    const finishMarkers = [
      "Finished",
      "After Extra Time",
      "After Penalties",
      "AET",
      "FT"
    ];

    let finishedIdx = -1;
    for (const marker of finishMarkers) {
      const idx = text.toLowerCase().indexOf(marker.toLowerCase());
      if (idx >= 0 && (finishedIdx === -1 || idx < finishedIdx)) {
        finishedIdx = idx;
      }
    }
    if (finishedIdx < 0) return { finished: false };

    const windowStart = Math.max(0, finishedIdx - 200);
    const windowEnd   = Math.min(text.length, finishedIdx + 200);
    const near = text.slice(windowStart, windowEnd);

    const scoreRe = /(\d{1,2})\s*:\s*(\d{1,2})/g;
    let m, lastScore = null;
    while ((m = scoreRe.exec(near)) !== null) lastScore = m[0];

    if (!lastScore) return { finished: false };
    return { finished: true, scoreText: lastScore };
  } catch (e) {
    console.error("⚠️ Flashscore parse error:", e.message);
    return { finished: false };
  }
}

/* ================= DOM HELPERS ================= */
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
    const s = $table(tr).attr("data-status");
    if (s === PENDING) hasPending = true;
    else if (s === LOSS) hasLoss = true;
  });
  if (hasPending) return PENDING;
  if (hasLoss) return LOSS;
  return WIN;
}

function recalcAndBadge($, $table) {
  const status = computeTicketStatusFromTable($table);
  const badge = $table
    .closest("div")
    .find("div")
    .filter((_, el) => $(el).text().match(/În așteptare|Câștigat|Pierdut|⏳|✅|❌/))
    .first();

  const styleBase =
    " color:#fff; padding:6px 10px; border-radius:4px; font-weight:bold;";
  if (badge.length) {
    if (status === WIN)
      badge.html("✅ Câștigat").attr("style", "background-color:#4CAF50;" + styleBase);
    else if (status === LOSS)
      badge.html("❌ Pierdut").attr("style", "background-color:#F44336;" + styleBase);
    else
      badge.html("⏳ În așteptare").attr("style", "background-color:#FFC107;" + styleBase);
  }
}

/* ================= VERIFY ONE POST ================= */
async function verifyOnePost(post, statusCache, allowRecheck) {
  const postId = typeof post === "number" ? post : post.id;

  const data = await fetchJson(
    `${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`
  );

  const raw = data.content?.rendered || data.content?.raw || "";
  const $ = cheerio.load(raw);

  let changed = false;

  const rows = $("table.bilet-pariu tbody tr[data-id]").toArray();
  for (const row of rows) {
    const $row    = $(row);
    const matchId = $row.attr("data-id");
    const current = $row.attr("data-status") || PENDING;
    const market  = $row.attr("data-market") || "1";
    const pickTxt = ($row.find("td").eq(3).text() || "").trim();
    const side    = pickTxt.startsWith("1") ? "1"
                    : pickTxt.startsWith("2") ? "2"
                    : (pickTxt[0] || "").toUpperCase();

    // Skip already decided rows unless this is the one-off rescue pass
    if (!allowRecheck && (current === WIN || current === LOSS)) {
      statusCache[matchId] = current;
      continue;
    }

    const info = await fetchFlashscoreOutcome(matchId);
    if (!info.finished) {
      statusCache[matchId] = current;
      paintIconCell($, row, current);
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

  // Ensure ✔ column and ticket badge(s)
  $("table.bilet-pariu").each((_, t) => {
    const $t = $(t);
    if ($t.find("thead tr th").length < 6) $t.find("thead tr").append("<th>✔</th>");
    $t.find("tbody tr[data-status]").each((_, tr) =>
      paintIconCell($, tr, $(tr).attr("data-status"))
    );
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
  try {
    const page = await fetchJson(
      `${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}?context=edit`
    );

    let raw  = page.content?.raw || page.content?.rendered || "";
    const $  = cheerio.load(raw);

    let changed = false;

    $("table.bilet-pariu tbody tr[data-id]").each((_, tr) => {
      const $tr = $(tr);
      const id  = $tr.attr("data-id");
      const cur = $tr.attr("data-status") || PENDING;
      const next = statusCache[id];
      if (!next) {
        paintIconCell($, tr, cur);
        return;
      }
      if (cur !== next) {
        $tr.attr("data-status", next);
        changed = true;
      }
      paintIconCell($, tr, $tr.attr("data-status"));
    });

    $("table.bilet-pariu").each((_, t) => recalcAndBadge($, $(t)));

    // cache-buster pentru shortcodes
    const marker = "<!-- pv-last-sync:";
    const nowStr = new Date().toISOString();
    if (raw.includes(marker)) {
      raw = raw.replace(
        /<!-- pv-last-sync:[^>]*-->/,
        `<!-- pv-last-sync:${nowStr}-->`
      );
    } else {
      raw += `\n<!-- pv-last-sync:${nowStr}-->`;
    }

    await put(`${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}`, { content: raw });

    console.log(
      `Homepage #${HOMEPAGE_ID}: cache-busted to refresh shortcodes.`
    );
  } catch (e) {
    console.error("Homepage sync error:", e.message);
  }
}

/* ================= RUN ================= */
(async function run() {
  if (!WP_BASE || !WP_USER || !WP_APP_PASS) {
    console.error("Set WP_BASE, WP_USER, WP_APP_PASS env vars.");
    process.exit(1);
  }

  const statusCache = {};

  // 1) Build the list of posts: static + newest (covers day-by-day)
  const postsSet = new Set(STATIC_POSTS);
  try {
    const q1 = await fetchJson(
      `${WP_BASE}/wp-json/wp/v2/posts?per_page=20&orderby=date&order=desc&search=Bilet`
    );
    for (const p of q1) postsSet.add(p.id);
  } catch (e) {
    console.error("Error auto-discovering posts:", e.message);
  }

  const ids = [...postsSet];

  // 2) If RECHECK_ONCE=true, get newest N posts and force recheck for them
  let newestIds = [];
  if (RECHECK_ONCE) {
    try {
      const r = await fetchJson(
        `${WP_BASE}/wp-json/wp/v2/posts?per_page=${RECHECK_LAST_N}&orderby=date&order=desc`
      );
      newestIds = r.map((p) => p.id);
    } catch (e) {
      console.error("Error fetching newest posts for recheck:", e.message);
    }
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
