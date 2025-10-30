// verify_and_update_wp.js — robust updater with FT-adjacent score & list-page fallback

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

const TEST_HTML_PATH = process.env.TEST_HTML_PATH || ""; // test local pe fișier
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
const stripDiacritics = (s = "") =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const tidy = (s = "") => stripDiacritics(String(s)).replace(/\s+/g, " ").trim();

function parseMarketLabel(text) {
  const t = tidy(text).toUpperCase();
  if (/^1(\s|$)|\bGAZDE\b/.test(t)) return "1";
  if (/^X(\s|$)|\bEGAL\b/.test(t)) return "X";
  if (/^2(\s|$)|\bOASP/.test(t)) return "2"; // OASP(OASPETI)
  // Extensii viitoare: 1X / X2 / 12 / O-U etc.
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
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome",
      "Accept-Language": "ro,en;q=0.9",
    },
  });
  if (!r.ok) return null;
  return await r.text();
}

// Preferă scorul final din zona „header/scoreboard” (primele 6KB) și, dacă se poate,
// scorul aflat în proximitatea markerilor finali: FT/Finished/Final/AET/AP/Penalties.
function getFinalScoreFromHtml(html) {
  if (!html) return null;

  // Simplu detector de finalizare
  if (!/(Finished|Final|FT\b|After extra time|AET|Penalties|AP)/i.test(html)) {
    return null;
  }

  const header = html.slice(0, 6144); // zona cu scoreboard la mobi

  // 1) Caută „blocul final” și un scor în vecinătate
  const ftBlock =
    header.match(
      /(Finished|Final|FT\b|After extra time|AET|Penalties|AP)[^]{0,400}/i
    )?.[0] || "";

  let m;
  const nearby = [...ftBlock.matchAll(/(\d{1,2})\s*:\s*(\d{1,2})/g)];
  if (nearby.length) m = nearby[nearby.length - 1];

  // 2) Fallback: ultimul scor din header (finalul se afișează după HT)
  if (!m) {
    const all = [...header.matchAll(/(\d{1,2})\s*:\s*(\d{1,2})/g)];
    if (all.length) m = all[all.length - 1];
  }

  if (!m) return null;
  return { home: parseInt(m[1], 10), away: parseInt(m[2], 10) };
}

// Primary: parse match page (FT-adjacent logic)
async function parseMatchPage(url) {
  const html = await fetchText(url);
  if (!html) return { status: "pending" };

  const final = getFinalScoreFromHtml(html);
  if (!final) return { status: "pending" };

  const outcome = decideOutcomeFromScore(final.home, final.away);
  return { status: "finished", outcome, score: `${final.home}:${final.away}` };
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

    const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    if (cls.includes("fin") || m) {
      if (m) {
        const home = parseInt(m[1], 10);
        const away = parseInt(m[2], 10);
        return {
          status: "finished",
          outcome: decideOutcomeFromScore(home, away),
          score: `${home}:${away}`,
        };
      }
      // finished but couldn't read score safely
      return { status: "finished", outcome: null, score: null };
    }
    // sched / live
    return { status: "pending" };
  }
  return { status: "pending" };
}

async function fetchMatchOutcome(url) {
  try {
    // 1) try the match page (better)
    const primary = await parseMatchPage(url);
    if (primary.status === "finished") return primary;

    // 2) fallback via list pages
    const id = extractMatchIdFromUrl(url);
    const fb = await parseFromListPages(id);
    return fb;
  } catch (e) {
    console.warn("fetchMatchOutcome err:", e?.message || e);
    return { status: "pending" };
  }
}

// Walk the table, update data-status and return updated HTML
async function verifyHtmlAndReturn(html) {
  const $ = cheerio.load(html);
  const table = $("table.bilet-pariu").first();
  if (!table.length) return { html, changed: false };

  const rows = table.find("tbody > tr").toArray();
  let changed = false;

  for (const tr of rows) {
    const $row = $(tr);
    if ($row.hasClass("total")) continue;

    // ensure data-status exists (so the first row isn’t skipped)
    if (!$row.attr("data-status")) $row.attr("data-status", "pending");

    const tds = $row.find("td");
    if (tds.length < 4) continue;

    // event link
    const anchor = tds.eq(0).find("a").first();
    const url = anchor.attr("href") || "";

    // pick
    const pickText = tidy(tds.eq(3).text());
    const pick = parseMarketLabel(pickText);

    const current = String($row.attr("data-status") || "pending").toLowerCase();

    if (!url || !pick) {
      if (DRY_RUN) console.log(`skip row: url=${!!url} pick=${pickText}`);
      continue;
    }
    if (current === "win" || current === "loss") continue;

    const res = await fetchMatchOutcome(url);
    if (res.status === "finished" && res.outcome) {
      const win = res.outcome === pick;
      if (DRY_RUN) {
        console.log(
          `DEBUG | ${tds.eq(0).text().trim()} | pick=${pick} | score=${res.score} | outcome=${res.outcome} | -> ${win ? "win" : "loss"}`
        );
      }
      $row.attr("data-status", win ? "win" : "loss");
      changed = true;
    }
  }

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
