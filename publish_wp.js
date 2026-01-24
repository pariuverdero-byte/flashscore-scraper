// publish_wp.js — FINAL FIX (pariuverde + greenbettips compatible)

import fs from "fs/promises";
import fetch from "node-fetch";

const { WP_URL, WP_USER, WP_APP_PASS } = process.env;

if (!WP_URL || !WP_USER || !WP_APP_PASS) {
  console.error("❌ Missing WP_URL / WP_USER / WP_APP_PASS");
  process.exit(1);
}

// =====================================================
// 🔧 NORMALIZE REST API BASE (AUTO-DETECT index.php)
// =====================================================
function normalizeApiBase(url) {
  let u = url.replace(/\/$/, "");

  // dacă deja conține wp-json → îl folosim ca atare
  if (u.includes("/wp-json/wp/v2")) return u;

  // fallback sigur (merge pe orice hosting)
  return `${u}/index.php/wp-json/wp/v2`;
}

const API_BASE = normalizeApiBase(WP_URL);
const POSTS_ENDPOINT = `${API_BASE}/posts`;
const CATEGORIES_ENDPOINT = `${API_BASE}/categories`;

const auth =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const read = async (p) =>
  fs.readFile(p, "utf8").catch(() => null);

// =====================================================
// CATEGORY
// =====================================================
async function getCategoryId(slug) {
  try {
    const r = await fetch(`${CATEGORIES_ENDPOINT}?slug=${slug}`, {
      headers: { Authorization: auth },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.[0]?.id || null;
  } catch {
    return null;
  }
}

// =====================================================
// EXCERPT
// =====================================================
function buildExcerptText(title, ticket) {
  if (!ticket || !ticket.selections?.length) {
    return `${title} – football betting tips.`;
  }
  return `${title} with ${ticket.selections.length} selections • Total odds ${ticket.product}`;
}

// =====================================================
// PUBLISH
// =====================================================
async function publish({ title, html, excerptText, categorySlug }) {
  if (!html || !html.trim()) {
    console.log(`ℹ Empty content → skip "${title}"`);
    return;
  }

  let categories = [];
  if (categorySlug) {
    const catId = await getCategoryId(categorySlug);
    if (catId) categories = [catId];
    else console.log(`⚠ Category missing: ${categorySlug}`);
  }

  const content = `
<p><strong>${excerptText}</strong></p>
<!--more-->
${html}
`.trim();

  const r = await fetch(POSTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      status: "publish",
      content,
      categories,
    }),
  });

  if (!r.ok) {
    console.error(
      `❌ Publish failed "${title}"`,
      r.status,
      await r.text()
    );
    return;
  }

  const data = await r.json();
  console.log(`✅ Published: ${data.link}`);
}

// =====================================================
// MAIN
// =====================================================
(async () => {
  const today = new Date().toLocaleDateString("en-GB");

  const ticketsRaw = await read("tickets.json");
  const tickets = ticketsRaw ? JSON.parse(ticketsRaw) : {};

  const cota2Html = await read("cota2.html");
  const ziHtml = await read("biletul-zilei.html");

  if (cota2Html && tickets.bilet_cota2) {
    await publish({
      title: `Odds 2 Ticket (${today})`,
      html: cota2Html,
      excerptText: buildExcerptText("Odds 2 Ticket", tickets.bilet_cota2),
      categorySlug: "cota-2",
    });
  }

  if (ziHtml && tickets.biletul_zilei) {
    await publish({
      title: `Bet of the Day (${today})`,
      html: ziHtml,
      excerptText: buildExcerptText("Bet of the Day", tickets.biletul_zilei),
      categorySlug: "biletul-zilei",
    });
  }
})();
