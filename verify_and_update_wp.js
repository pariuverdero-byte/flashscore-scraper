/**
 * verify_and_update_wp.js
 *
 * Verifies Flashscore outcomes and updates:
 *  - each event row's data-status + a status icon
 *  - the ticket badge / [status_bilet] in the same HTML
 * Writes back to WordPress POSTs and (NEW) to PAGEs (e.g., homepage)
 *
 * ENV:
 *  WP_URL, WP_USER, WP_APP_PASS
 *  POST_IDS="1255,1256"                 (optional)
 *  CATEGORY_SLUGS="biletul-zilei,cota-2" (optional fallback to fetch recent posts)
 *  MAX_POSTS=10                         (optional, per category)
 *  FRONT_PAGE_IDS="2,123"               (optional, pages to keep in sync)
 *  DRY_RUN=1                            (optional, print only)
 */

import fetch from "node-fetch";
import * as cheerio from "cheerio";

// -------------------- ENV --------------------
const WP_URL = (process.env.WP_URL || "").replace(/\/$/, "");
const WP_USER = process.env.WP_USER || "";
const WP_APP_PASS = process.env.WP_APP_PASS || "";
if (!WP_URL || !WP_USER || !WP_APP_PASS) {
  console.error("Missing WP_URL / WP_USER / WP_APP_PASS.");
  process.exit(1);
}

const AUTH = "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");
const DRY_RUN = process.env.DRY_RUN === "1";

const POST_IDS = (process.env.POST_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const CATEGORY_SLUGS = (process.env.CATEGORY_SLUGS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const MAX_POSTS = parseInt(process.env.MAX_POSTS || "10", 10) || 10;

const FRONT_PAGE_IDS = (process.env.FRONT_PAGE_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// -------------------- WordPress helpers --------------------
async function wpGetJson(url) {
  const r = await fetch(url, { headers: { Authorization: AUTH } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
async function readPost(id) { return wpGetJson(`${WP_URL}/wp-json/wp/v2/posts/${id}`); }
async function readPage(id) { return wpGetJson(`${WP_URL}/wp-json/wp/v2/pages/${id}`); }

async function updatePost(id, content) {
  if (DRY_RUN) { console.log(`(dry-run) POST #${id} not updated`); return; }
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/posts/${id}`, {
    method: "PUT",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) throw new Error(`Update post ${id} failed: ${r.status} ${await r.text()}`);
  console.log(`✅ Updated post #${id}`);
}
async function updatePage(id, content) {
  if (DRY_RUN) { console.log(`(dry-run) PAGE #${id} not updated`); return; }
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/pages/${id}`, {
    method: "PUT",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) throw new Error(`Update page ${id} failed: ${r.status} ${await r.text()}`);
  console.log(`✅ Updated page #${id}`);
}

async function getRecentPostsByCategorySlug(slug, limit = 10) {
  // 1) slug -> category id
  const cats = await wpGetJson(`${WP_URL}/wp-json/wp/v2/categories?per_page=100&slug=${encodeURIComponent(slug)}`);
  if (!cats?.length) return [];
  const id = cats[0].id;
  // 2) recent posts
  const posts = await wpGetJson(`${WP_URL}/wp-json/wp/v2/posts?per_page=${limit}&categories=${id}&orderby=date&order=desc`);
  return posts.map(p => p.id);
}

// -------------------- Flashscore scraping --------------------
async function fetchFlashOutcome(mobiUrl) {
  // Returns { finished, score, outcome }, where outcome = "1"|"2"|"X" or null
  try {
    const res = await fetch(mobiUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return { finished: false, score: null, outcome: null };

    const html = await res.text();
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();

    const finished =
      /Finished|FT|AET|After Penalties|Penalties|Final|Ended/i.test(bodyText) ||
      /Terminat|Finalizat|S-a terminat/i.test(bodyText);

    const m = bodyText.match(/(\d+)\s*:\s*(\d+)/);
    let score = null, outcome = null;
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      score = `${a}:${b}`;
      outcome = a > b ? "1" : a < b ? "2" : "X";
    }
    return { finished, score, outcome };
  } catch {
    return { finished: false, score: null, outcome: null };
  }
}

// -------------------- HTML update helpers --------------------
function parsePickFromRowText(text) {
  const m = text.match(/\b(1|2|X)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function setRowStatusIcon($, $tr, status) {
  $tr.attr("data-status", status); // win|loss|pending

  // Try to place/toggle a symbol in the last cell
  const $cell = $tr.find("td,th").last();
  const base = ($cell.text() || "").replace(/[✅❌⏳]/g, "").trim();
  const mark = status === "win" ? " ✅" : status === "loss" ? " ❌" : " ⏳";
  $cell.text(base + mark);

  // Optional: set a class for styling
  const cls = ($tr.attr("class") || "").split(/\s+/).filter(Boolean).filter(c => !/^status-/.test(c));
  cls.push(`status-${status}`);
  $tr.attr("class", cls.join(" "));
}

function computeTicketStatus($, $table) {
  let pending = 0, loss = 0;
  $table.find("tr").each((_, tr) => {
    const st = ($(tr).attr("data-status") || "").toLowerCase();
    if (st === "pending") pending++;
    else if (st === "loss") loss++;
  });
  if (pending > 0) return "in asteptare";
  if (loss > 0) return "pierdut";
  return "castigator";
}

function updateTicketBadgeAndShortcode($, $table, status) {
  // 1) Replace any [status_bilet] text nodes in the whole document
  $("*").contents().each((_, node) => {
    if (node.type === "text" && /\[status_bilet\]/.test(node.data || "")) {
      node.data = node.data.replace(/\[status_bilet\]/g, status);
    }
  });

  // 2) Also put a small symbol on "Cota totală" row if present
  const $total = $table.find("tr").filter((_, r) => {
    const txt = $(r).text().toLowerCase();
    return /cota total|cotă total/.test(txt);
  }).first();

  if ($total.length) {
    const $td = $total.find("td,th").last();
    const clean = ($td.text() || "").replace(/[✅❌⏳]/g, "").trim();
    const mark = status === "castigator" ? " ✅" : status === "pierdut" ? " ❌" : " ⏳";
    $td.text(clean + mark);
  }
}

// Verify tables inside HTML; return { html, changed, debugLog }
async function verifyHtmlAndReturn(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  let changed = false;
  let debug = [];

  // Process every table that contains a Flashscore mobile link
  $("table").each((_, table) => {
    const $table = $(table);
    const rows = $table.find("tr").filter((__, tr) =>
      $(tr).find("a[href*='flashscore.mobi']").length > 0
    );

    if (!rows.length) return;

    const rowPromises = [];
    rows.each((__, tr) => rowPromises.push((async () => {
      const $tr = $(tr);
      const rowText = $tr.text().replace(/\s+/g, " ").trim();
      const link = $tr.find("a[href*='flashscore.mobi']").first().attr("href");
      const pick = parsePickFromRowText(rowText);

      debug.push(`[VERIFY] Event: ${rowText.slice(0, 80)}\n         URL:   ${link}\n         Pick:  ${pick || "?"}`);

      if (!link) {
        debug.push("         Cur:   pending\n         No link -> leaving as is.");
        if (($tr.attr("data-status") || "") !== "pending") {
          setRowStatusIcon($, $tr, "pending");
          changed = true;
        }
        return;
      }

      const { finished, score, outcome } = await fetchFlashOutcome(link);

      if (!finished || !outcome) {
        debug.push("         Cur:   pending\n         Not finished yet -> leaving as is.");
        if (($tr.attr("data-status") || "") !== "pending") {
          setRowStatusIcon($, $tr, "pending");
          changed = true;
        }
        return;
      }

      if (!pick) {
        // Unknown pick -> mark as pending to avoid wrong grading
        debug.push(`         Cur:   pending\n         Score: ${score || "?"} | outcome=${outcome} | Missing pick -> leaving as pending`);
        if (($tr.attr("data-status") || "") !== "pending") {
          setRowStatusIcon($, $tr, "pending");
          changed = true;
        }
        return;
      }

      const status = (pick === outcome) ? "win" : "loss";
      const prev = ($tr.attr("data-status") || "").toLowerCase();
      debug.push(`         Cur:   ${status}\n         Score: ${score || "?"} | outcome=${outcome} | OK (${status})`);

      if (prev !== status) {
        setRowStatusIcon($, $tr, status);
        changed = true;
      }
    })()));

    rowPromises.push(Promise.resolve());
    // After all rows in this table, compute ticket
    rowPromises.push((async () => {
      // wait for row updates to finish (simple chaining)
    })());

    // Wait rows, then compute ticket status & update badges
    (async () => {
      await Promise.all(rowPromises);
      const status = computeTicketStatus($, $table);
      updateTicketBadgeAndShortcode($, $table, status);
    })();
  });

  // Ensure all async inside .each are done by re-wrapping with a microtask tick
  await new Promise(r => setTimeout(r, 0));

  return { html: $.root().html(), changed, debug: debug.join("\n") };
}

// -------------------- Driver --------------------
async function collectTargetPostIds() {
  if (POST_IDS.length) return POST_IDS.map(id => parseInt(id, 10)).filter(Boolean);
  // Fallback: categories
  const ids = new Set();
  for (const slug of CATEGORY_SLUGS) {
    try {
      const list = await getRecentPostsByCategorySlug(slug, MAX_POSTS);
      list.forEach(id => ids.add(id));
    } catch (e) {
      console.error(`Failed to fetch posts for category '${slug}':`, e.message);
    }
  }
  return Array.from(ids);
}

async function processOnePost(postId) {
  const post = await readPost(postId);
  const orig = post?.content?.rendered || "";
  const { html, changed, debug } = await verifyHtmlAndReturn(orig);

  console.log(debug || "");
  if (!changed) {
    console.log(`Post #${postId}: fără schimbări`);
    return;
  }
  await updatePost(postId, html);
}

async function processOnePage(pageId) {
  const page = await readPage(pageId);
  const orig = page?.content?.rendered || "";
  const { html, changed, debug } = await verifyHtmlAndReturn(orig);

  // Print a short header to make it obvious this was a PAGE
  if (debug) {
    console.log(`\n=== PAGE #${pageId} ===`);
    console.log(debug);
  }

  if (!changed) {
    console.log(`Pagina #${pageId}: fără schimbări`);
    return;
  }
  await updatePage(pageId, html);
}

async function run() {
  // 1) Posts
  const targets = await collectTargetPostIds();
  for (const id of targets) {
    try { await processOnePost(id); }
    catch (e) { console.error(`Post #${id} error:`, e.message); }
  }

  // 2) Front page / other pages
  for (const pid of FRONT_PAGE_IDS) {
    try { await processOnePage(parseInt(pid, 10)); }
    catch (e) { console.error(`Page #${pid} error:`, e.message); }
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
