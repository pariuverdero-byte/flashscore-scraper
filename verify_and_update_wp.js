// verify_and_update_wp.js — versiune FIX (fără paranteza în plus) + parsing robust

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

const TEST_HTML_PATH = process.env.TEST_HTML_PATH || "";        // test local pe fișier
const OUTPUT_HTML_PATH = process.env.OUTPUT_HTML_PATH || "updated.html";
const ONLY_POST_ID = process.env.POST_ID ? String(process.env.POST_ID) : "";

// === Helpers WP ===
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

// === Helpers rezultat / parsing ===
function stripDiacritics(s = "") {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Robust: acceptă forme cu/ fără text explicativ
function parseMarketLabel(text) {
  const t = stripDiacritics(String(text || "").toUpperCase()).trim();

  if (/^(1)(\s|$)/.test(t) || /GAZDE/.test(t)) return "1";
  if (/^(X)(\s|$)/.test(t) || /EGAL/.test(t)) return "X";
  if (/^(2)(\s|$)/.test(t) || /OASP/.test(t)) return "2";

  // TODO: extensii viitoare pentru 1X / X2 / 12 / O-U etc.
  return null;
}

function decideOutcomeFromScore(home, away) {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

async function fetchMatchOutcome(url) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "ro,en;q=0.9",
      },
    });
    if (!r.ok) return { status: "pending" };
    const html = await r.text();
    const $ = cheerio.load(html);
    const txt = $("body").text();

    if (!/(Finished|FT\b|Final)/i.test(txt)) return { status: "pending" };

    const m = txt.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    if (!m) return { status: "pending" };

    const home = parseInt(m[1], 10);
    const away = parseInt(m[2], 10);
    const outcome = decideOutcomeFromScore(home, away);
    return { status: "finished", outcome, score: `${home}:${away}` };
  } catch {
    return { status: "pending" };
  }
}

async function verifyHtmlAndReturn(html) {
  const $ = cheerio.load(html);
  const table = $("table.bilet-pariu").first();
  if (!table.length) return { html, changed: false };

  const rows = table.find("tbody > tr").toArray();
  let changed = false;

  for (const tr of rows) {
    const $tr = cheerio.load($.html(tr))("tr"); // izolează rândul
    if ($tr.hasClass("total")) continue;

    const tds = $tr.find("td");
    if (tds.length < 4) continue;

    const eventCell = tds.eq(0);
    const anchor = eventCell.find("a").first();
    const url = anchor.attr("href");

    const pickText = tds.eq(3).text().trim();
    const pick = parseMarketLabel(pickText);

    const current = ($tr.attr("data-status") || "pending").toLowerCase();

    if (!url || !pick) continue;
    if (current === "win" || current === "loss") continue;

    const res = await fetchMatchOutcome(url);
    if (res.status === "finished") {
      const win = res.outcome === pick;
      // aplică pe elementul real din DOM-ul paginii
      $(tr).attr("data-status", win ? "win" : "loss");
      changed = true;
      console.log(
        ` - ${eventCell.text().trim()} => ${win ? "win" : "loss"} (${res.score}), pick=${pick}`
      );
    }
  }

  return { html: $.html(), changed };
}

// === Mode: local file ===
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

// === Mode: WordPress ===
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

// === Entry ===
(async () => {
  if (TEST_HTML_PATH) await runLocal();
  else await runWP();
})();
