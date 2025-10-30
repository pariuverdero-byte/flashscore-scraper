// verify_and_update_wp.js — robust updater with fallback via list pages
// - Verifies each event row and sets data-status=win/loss/pending
// - Computes the whole ticket result and updates the badge/button text
// - Works against latest N modern Cheerio/Node versions

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs/promises";

// === ENV ===
const { WP_URL, WP_USER, WP_APP_PASS } = process.env;
const AUTH =
  WP_URL && WP_USER && WP_APP_PASS
    ? "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64")
    : null;

const MAX_POSTS_PER_CAT = Number(process.env.MAX_POSTS_PER_CAT || 6);
const DRY_RUN =
  String(process.env.DRY_RUN || "0").toLowerCase() === "1" ||
  String(process.env.DRY_RUN || "").toLowerCase() === "true";

const TEST_HTML_PATH = process.env.TEST_HTML_PATH || ""; // local testing on a file
const OUTPUT_HTML_PATH = process.env.OUTPUT_HTML_PATH || "updated.html";
const ONLY_POST_ID = process.env.POST_ID ? String(process.env.POST_ID) : "";

// ---------- WordPress helpers ----------
async function getCategoryId(slug) {
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/categories?slug=${slug}`, {
    headers: { Authorization: AUTH },
  });
  const j = await r.json();
  return j?.[0]?.id || null;
}

async function listPostsByCategory(catId, perPage = 6) {
  const r = await fetch(
    `${WP_URL}/wp-json/wp/v2/posts?categories=${catId}&per_page=${perPage}&orderby=date&order=desc`,
    { headers: { Authorization: AUTH } }
  );
  if (!r.ok) {
    console.error("❌ list posts:", r.status, await r.text());
    return [];
  }
  return await r.json();
}

async function readPost(postId) {
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/posts/${postId}`, {
    headers: { Authorization: AUTH },
  });
  if (!r.ok) return null;
  return await r.json();
}

async function updatePost(postId, newContent) {
  if (DRY_RUN) {
    console.log(`(dry-run) nu actualizez post #${postId}`);
    return true;
  }
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/posts/${postId}`, {
    method: "PUT",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ content: newContent }),
  });
  if (!r.ok) {
    console.error(`❌ update ${postId}:`, r.status, await r.text());
    return false;
  }
  console.log(`✅ Actualizat post #${postId}`);
  return true;
}

// ---------- Parsing helpers ----------
function stripDiacritics(s = "") {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseMarketLabel(text) {
  const t = stripDiacritics(String(text || "").toUpperCase()).trim();
  if (/^(1)(\s|$)/.test(t) || /\bGAZDE\b/.test(t)) return "1";
  if (/^(X)(\s|$)/.test(t) || /\bEGAL\b/.test(t)) return "X";
  if (/^(2)(\s|$)/.test(t) || /\bOASP/.test(t) || /\bOASPETI\b/.test(t)) return "2";
  // Extend later: 1X, X2, 12, O/U etc.
  return null;
}

function decideOutcomeFromScore(home, away) {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

function extractMatchIdFromUrl(url = "") {
  const m = /\/match\/([A-Za-z0-9]+)\//i.exec(url);
  return m ? m[1] : null;
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "ro,en;q=0.9",
    },
  });
  if (!r.ok) return null;
  return await r.text();
}

// Primary: parse match page
async function parseMatchPage(url) {
  const html = await fetchText(url);
  if (!html) return { status: "pending" };

  const $ = cheerio.load(html);
  const bodyTxt = $("body").text();

  // Detect finished
  const finished = /(Finished|FT\b|Final)/i.test(bodyTxt);
  if (!finished) return { status: "pending" };

  // Try to pick the first score a:b that is not minute/time
  // Prefer patterns near odds / summary blocks
  const tryAreas = ["#tab-mcontent", "p.odds-detail", "#main", "body"];
  for (const sel of tryAreas) {
    const t = $(sel).first().text();
    const m = t.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    if (m) {
      const home = parseInt(m[1], 10);
      const away = parseInt(m[2], 10);
      return {
        status: "finished",
        outcome: decideOutcomeFromScore(home, away),
        score: `${home}:${away}`,
      };
    }
  }

  // Fallback: still finished but no parseable score
  return { status: "finished", outcome: null, score: null };
}

// Fallback: scan list pages for this match ID (-3..+3 days)
async function parseFromListPages(matchId) {
  if (!matchId) return { status: "pending" };
  for (let d = -3; d <= 3; d++) {
    const url = `https://www.flashscore.mobi/?d=${d}&s=1`;
    const html = await fetchText(url);
    if (!html) continue;

    const $ = cheerio.load(html);
    const a = $(`a[href*="/match/${matchId}/"]`).first();
    if (!a.length) continue;

    const cls = (a.attr("class") || "").toLowerCase(); // live | sched | fin
    const text = a.text().trim();
    if (cls.includes("fin") || /(\d{1,2})\s*:\s*(\d{1,2})/.test(text)) {
      const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
      if (m) {
        const home = parseInt(m[1], 10);
        const away = parseInt(m[2], 10);
        return {
          status: "finished",
          outcome: decideOutcomeFromScore(home, away),
          score: `${home}:${away}`,
        };
      }
      return { status: "finished", outcome: null, score: null };
    }
    return { status: "pending" };
  }
  return { status: "pending" };
}

async function fetchMatchOutcome(url) {
  try {
    const primary = await parseMatchPage(url);
    if (primary.status === "finished") return primary;
    const id = extractMatchIdFromUrl(url);
    const fb = await parseFromListPages(id);
    return fb;
  } catch {
    return { status: "pending" };
  }
}

// ---------- Ticket status helpers ----------
function computeTicketStatus($, table) {
  const rows = table.find("tbody > tr").not(".total").toArray();

  let wins = 0,
    losses = 0,
    pend = 0,
    considered = 0;

  for (const tr of rows) {
    const st = (($(tr).attr("data-status")) || "pending").toLowerCase();
    if (st === "win") {
      wins++;
      considered++;
    } else if (st === "loss") {
      losses++;
      considered++;
    } else {
      pend++;
      considered++;
    }
  }

  if (losses > 0) return { status: "loss", wins, losses, pend, considered };
  if (considered > 0 && pend === 0) return { status: "win", wins, losses, pend, considered };
  return { status: "pending", wins, losses, pend, considered };
}

function applyTicketBadge($, status, table) {
  // Map UI text + bootstrap class
  const map = {
    pending: { text: "Rezultat în așteptare", cls: "btn-warning" },
    win: { text: "Bilet câștigător", cls: "btn-success" },
    loss: { text: "Bilet pierdut", cls: "btn-danger" },
  };
  const cfg = map[status] || map.pending;

  // Update any visible "Rezultat ..." button/badge
  let $btn =
    $('a.btn:contains("Rezultat"), button.btn:contains("Rezultat"), .ticket-result').first();
  if ($btn.length) {
    // reset known state classes then add the right one
    $btn.removeClass("btn-warning btn-success btn-danger");
    $btn.addClass(cfg.cls);
    $btn.text(cfg.text);
  }

  // Mark table + total row, so future runs can read this quickly
  if (table && table.length) {
    table.attr("data-ticket-status", status);
    table.find("tr.total").attr("data-status", status);
  }
}

// Walks the table, updates data-status on rows and returns updated HTML
async function verifyHtmlAndReturn(html) {
  const $ = cheerio.load(html);
  const table = $("table.bilet-pariu").first();
  if (!table.length) return { html, changed: false };

  const rows = table.find("tbody > tr").toArray();
  let changed = false;

  for (const tr of rows) {
    const $row = $(tr);
    if ($row.hasClass("total")) continue;

    // ensure data-status exists
    if (!$row.attr("data-status")) $row.attr("data-status", "pending");

    const tds = $row.find("td");
    if (tds.length < 4) continue;

    const anchor = tds.eq(0).find("a").first();
    const url = anchor.attr("href");

    const pickText = tds.eq(3).text().trim();
    const pick = parseMarketLabel(pickText);

    const current = ($row.attr("data-status") || "pending").toLowerCase();

    if (!url || !pick) continue;

    // If we already have a final state, skip rechecking to save requests
    if (current === "win" || current === "loss") {
      console.log(
        `[VERIFY] Event: ${tds.eq(0).text().trim()}\n         URL:   ${url}\n         Pick:  ${pickText} -> ${pick}\n         Cur:   ${current}\n         Skip: already decided.\n`
      );
      continue;
    }

    // Ask Flashscore
    const res = await fetchMatchOutcome(url);

    if (res.status === "finished" && res.outcome) {
      const win = res.outcome === pick;
      $row.attr("data-status", win ? "win" : "loss");
      changed = true;
      console.log(
        `[VERIFY] Event: ${tds.eq(0).text().trim()}\n         URL:   ${url}\n         Pick:  ${pickText} -> ${pick}\n         Cur:   ${current}\n         Score: ${res.score} | outcome=${res.outcome} | OK (${win ? "win" : "loss"})\n`
      );
    } else if (res.status === "finished" && !res.outcome) {
      // Finished but no reliable score → keep pending (safer)
      console.log(
        `[VERIFY] Event: ${tds.eq(0).text().trim()}\n         URL:   ${url}\n         Pick:  ${pickText} -> ${pick}\n         Cur:   ${current}\n         Finished, but score not confidently parsed -> leaving as is.\n`
      );
    } else {
      console.log(
        `[VERIFY] Event: ${tds.eq(0).text().trim()}\n         URL:   ${url}\n         Pick:  ${pickText} -> ${pick}\n         Cur:   ${current}\n         Not finished yet -> leaving as is.\n`
      );
    }
  }

  // Compute & apply the overall ticket status badge
  const summary = computeTicketStatus($, table);
  applyTicketBadge($, summary.status, table);

  return { html: $.html(), changed };
}

// ---------- Modes ----------
async function runLocal() {
  if (!TEST_HTML_PATH) {
    console.error("Setează TEST_HTML_PATH pentru test local (ex: cota2.html)");
    process.exit(1);
  }
  const html = await fs.readFile(TEST_HTML_PATH, "utf8");
  const { html: out, changed } = await verifyHtmlAndReturn(html);
  await fs.writeFile(OUTPUT_HTML_PATH, out, "utf8");
  console.log(
    `Local test -> ${OUTPUT_HTML_PATH} (${changed ? "cu modificări" : "fără modificări"})`
  );
}

async function runWP() {
  if (!AUTH) {
    console.error("Lipsesc WP_URL / WP_USER / WP_APP_PASS pentru mod WP.");
    process.exit(1);
  }

  if (ONLY_POST_ID) {
    const p = await readPost(ONLY_POST_ID);
    if (!p) {
      console.error("Post inexistent");
      return;
    }
    const content = p.content?.rendered || "";
    const { html: newHtml, changed } = await verifyHtmlAndReturn(content);
    if (changed) await updatePost(p.id, newHtml);
    else console.log("Nicio schimbare.");
    return;
  }

  const catSlugs = ["cota-2", "biletul-zilei"];
  for (const slug of catSlugs) {
    const id = await getCategoryId(slug);
    if (!id) {
      console.error(`Categorie lipsă: ${slug}`);
      continue;
    }
    const posts = await listPostsByCategory(id, MAX_POSTS_PER_CAT);
    for (const p of posts) {
      const content = p.content?.rendered || "";
      const { html: newHtml, changed } = await verifyHtmlAndReturn(content);
      if (changed) await updatePost(p.id, newHtml);
      else console.log(`Post #${p.id}: fără schimbări`);
    }
  }
}

// ---------- Entry ----------
(async () => {
  if (TEST_HTML_PATH) await runLocal();
  else await runWP();
})();
