// verify_and_update_wp.js — rows re-eval + overall ticket status + robust score parse

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

const TEST_HTML_PATH = process.env.TEST_HTML_PATH || ""; // for local tests
const OUTPUT_HTML_PATH = process.env.OUTPUT_HTML_PATH || "updated.html";
const ONLY_POST_ID = process.env.POST_ID ? String(process.env.POST_ID) : "";

// ---------- WP helpers ----------
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

function getFinalScoreFromHtml(html) {
  if (!html) return null;
  const text = html.replace(/\s+/g, " ").trim();
  const finishedIdx = text.search(/(Finished|FT\b|Final|After extra time|AET)/i);
  if (finishedIdx === -1) return null;

  const allScores = [...text.matchAll(/(\d{1,2})\s*:\s*(\d{1,2})/g)];
  if (!allScores.length) return null;

  const filtered = allScores.filter((m) => {
    const start = Math.max(0, m.index - 1);
    const end = m.index + m[0].length + 1;
    const slice = text.slice(start, end);
    return !slice.includes("("); // ignore halftime like (1:0)
  });
  if (!filtered.length) return null;

  let chosen = null;
  for (const m of filtered) if (m.index < finishedIdx) chosen = m;
  const fm = chosen || filtered[filtered.length - 1];

  const home = parseInt(fm[1], 10);
  const away = parseInt(fm[2], 10);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

async function parseMatchPage(url) {
  const html = await fetchText(url);
  if (!html) return { status: "pending" };

  const finished = /(Finished|FT\b|Final|After extra time|AET)/i.test(html);
  if (!finished) return { status: "pending" };

  const fs = getFinalScoreFromHtml(html);
  if (fs) {
    const outcome = decideOutcomeFromScore(fs.home, fs.away);
    return { status: "finished", outcome, score: `${fs.home}:${fs.away}` };
  }
  return { status: "finished", outcome: null, score: null };
}

async function parseFromListPages(matchId) {
  if (!matchId) return { status: "pending" };
  for (let d = -3; d <= 3; d++) {
    const url = `https://www.flashscore.mobi/?d=${d}&s=1`;
    const html = await fetchText(url);
    if (!html) continue;

    const $ = cheerio.load(html);
    const a = $(`a[href*="/match/${matchId}/"]`).first();
    if (!a.length) continue;

    const cls = (a.attr("class") || "").toLowerCase();
    const text = a.text().trim();
    if (cls.includes("fin") || /(\d{1,2})\s*:\s*(\d{1,2})/.test(text)) {
      const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
      if (m) {
        const home = parseInt(m[1], 10);
        const away = parseInt(m[2], 10);
        return { status: "finished", outcome: decideOutcomeFromScore(home, away), score: `${home}:${away}` };
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
    return await parseFromListPages(id);
  } catch {
    return { status: "pending" };
  }
}

// ---------- Ticket-level status ----------
function computeTicketStatus($, table) {
  const rows = table.find("tbody > tr").not(".total").toArray();
  let wins = 0, losses = 0, pend = 0, considered = 0;

  for (const tr of rows) {
    const $row = $(tr);
    const s = ($row.attr("data-status") || "pending").toLowerCase();
    if (["win", "loss", "pending"].includes(s)) {
      considered++;
      if (s === "win") wins++;
      else if (s === "loss") losses++;
      else pend++;
    }
  }

  if (losses > 0) return { status: "loss", wins, losses, pend, considered };
  if (considered > 0 && pend === 0) return { status: "win", wins, losses, pend, considered };
  return { status: "pending", wins, losses, pend, considered };
}

function setTicketStatusVisual($, table, status) {
  const labels = {
    win: "Rezultat: Câștigat ✅",
    loss: "Rezultat: Pierdut ❌",
    pending: "Rezultat în așteptare ⏳",
  };

  // Try common WP button markup near the table
  let btn =
    table.nextAll('div.wp-block-button').first().find('a.wp-block-button__link:contains("Rezultat")').first();
  if (!btn.length) btn = $('a.wp-block-button__link:contains("Rezultat")').first();
  if (!btn.length) btn = $('a:contains("Rezultat")').first();
  if (!btn.length) btn = $('button:contains("Rezultat")').first();

  if (btn.length) {
    btn.text(labels[status]);
    btn.attr("data-status", status);
  } else {
    // Fallback: inject a small paragraph after the table.
    table.after(`<p class="ticket-result" data-status="${status}">${labels[status]}</p>`);
  }
}

// ---------- Core: verify + update ----------
async function verifyHtmlAndReturn(html) {
  const $ = cheerio.load(html);
  const table = $("table.bilet-pariu").first();
  if (!table.length) return { html, changed: false };

  const rows = table.find("tbody > tr").toArray();
  let changed = false;

  for (const tr of rows) {
    const $row = $(tr);
    if ($row.hasClass("total")) continue;

    if (!$row.attr("data-status")) $row.attr("data-status", "pending");

    const tds = $row.find("td");
    if (tds.length < 4) continue;

    const eventText = tds.eq(0).text().trim();
    const anchor = tds.eq(0).find("a").first();
    const url = anchor.attr("href") || "";

    const pickText = tds.eq(3).text().trim();
    const pick = parseMarketLabel(pickText);
    const current = ($row.attr("data-status") || "pending").toLowerCase();

    console.log(`\n[VERIFY] Event: ${eventText}`);
    console.log(`         URL:   ${url || "(no url)"}`);
    console.log(`         Pick:  ${pickText} -> ${pick || "?"}`);
    console.log(`         Cur:   ${current}`);

    if (!url || !pick) {
      console.log("         Skip: missing URL or unsupported market.");
      continue;
    }

    // ALWAYS re-evaluate
    const res = await fetchMatchOutcome(url);

    if (res.status === "finished" && res.outcome) {
      const newWin = res.outcome === pick;
      const newStatus = newWin ? "win" : "loss";

      if (current !== newStatus) {
        $row.attr("data-status", newStatus);
        changed = true;
        console.log(`         Score: ${res.score} | outcome=${res.outcome} | FIX -> ${newStatus.toUpperCase()}`);
      } else {
        console.log(`         Score: ${res.score} | outcome=${res.outcome} | OK (${current})`);
      }
    } else if (res.status === "finished" && !res.outcome) {
      console.log("         Finished, but score not confidently parsed -> leaving as is.");
    } else {
      console.log("         Not finished yet -> leaving as is.");
    }
  }

  // Ticket-level compute & visual
  const agg = computeTicketStatus($, table);
  setTicketStatusVisual($, table, agg.status);
  // also store on table for future runs
  table.attr("data-ticket-status", agg.status);

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
  console.log(`Local test -> ${OUTPUT_HTML_PATH} (${changed ? "cu modificări" : "fără modificări"})`);
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
