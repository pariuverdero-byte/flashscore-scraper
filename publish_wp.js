// publish_wp.js
// FINAL — CLEAN HTML + DATE + ROBUST

import fs from "fs/promises";
import fetch from "node-fetch";

const { WP_URL, WP_USER, WP_APP_PASS } = process.env;
const LANG = (process.env.LANG || "ro").toLowerCase();

if (!WP_URL || !WP_USER || !WP_APP_PASS) {
  console.error("❌ Missing WP_URL / WP_USER / WP_APP_PASS");
  process.exit(1);
}

/* =====================================================
 * 🔧 NORMALIZE REST API BASE
 * ===================================================== */
function normalizeApiBase(url) {
  let u = url.replace(/\/$/, "");
  if (u.includes("/wp-json/wp/v2")) return u;
  return `${u}/index.php/wp-json/wp/v2`;
}

const API_BASE = normalizeApiBase(WP_URL);
const POSTS_ENDPOINT = `${API_BASE}/posts`;
const CATEGORIES_ENDPOINT = `${API_BASE}/categories`;

const auth =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const read = async (p) =>
  fs.readFile(p, "utf8").catch(() => null);

/* =====================================================
 * 🧹 HTML SANITIZER (CRITICAL FIX)
 * ===================================================== */
function sanitizeHtmlFragment(html = "") {
  return html
    .replace(/<html[^>]*>/gi, "")
    .replace(/<\/html>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<body[^>]*>/gi, "")
    .replace(/<\/body>/gi, "")
    .trim();
}

/* =====================================================
 * 📅 DATE FORMAT
 * ===================================================== */
function formatTicketDate(dateStr) {
  if (!dateStr) return "";

  const d = new Date(dateStr);

  if (LANG === "en") {
    return d.toLocaleDateString("en-GB");
  }

  return d.toLocaleDateString("ro-RO");
}

/* =====================================================
 * 🌍 TRANSLATIONS
 * ===================================================== */
const I18N = {
  ro: {
    cota2_title: "Bilet Cota 2",
    zi_title: "Biletul Zilei",
    cota2_excerpt: (t) =>
      `Bilet Cota 2 cu ${t.selections.length} selecții • Cotă totală ${t.product}`,
    zi_excerpt: (t) =>
      `Biletul Zilei cu ${t.selections.length} selecții • Cotă totală ${t.product}`,
    ticket_date_label: "Data biletului"
  },
  en: {
    cota2_title: "Odds 2 Ticket",
    zi_title: "Bet of the Day",
    cota2_excerpt: (t) =>
      `Odds 2 Ticket with ${t.selections.length} selections • Total odds ${t.product}`,
    zi_excerpt: (t) =>
      `Bet of the Day with ${t.selections.length} selections • Total odds ${t.product}`,
    ticket_date_label: "Ticket date"
  },
};

const T = I18N[LANG] || I18N.ro;

/* =====================================================
 * CATEGORY
 * ===================================================== */
async function getCategoryId(slug) {
  try {
    const r = await fetch(`${CATEGORIES_ENDPOINT}?slug=${slug}`, {
      headers: { Authorization: auth },
    });

    const text = await r.text();

    try {
      const j = JSON.parse(text);
      return j?.[0]?.id || null;
    } catch {
      console.log(`⚠ Category lookup returned non-JSON for ${slug}`);
      return null;
    }

  } catch {
    return null;
  }
}

/* =====================================================
 * PUBLISH
 * ===================================================== */
async function publish({ title, html, excerpt, categorySlug, ticketDate }) {
  if (!html || !html.trim()) {
    console.log(`ℹ Empty content → skip "${title}"`);
    return;
  }

  const cleanHtml = sanitizeHtmlFragment(html);

  let categories = [];
  if (categorySlug) {
    const catId = await getCategoryId(categorySlug);
    if (catId) categories = [catId];
    else console.log(`⚠ Category missing: ${categorySlug}`);
  }

  const content = `
<p><strong>${excerpt}</strong></p>
<p><em>${T.ticket_date_label}: ${formatTicketDate(ticketDate)}</em></p>
<!--more-->
${cleanHtml}
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

  const text = await r.text();

  if (!r.ok) {
    console.error(`❌ Publish failed "${title}"`, r.status, text);
    return;
  }

  try {
    const data = JSON.parse(text);
    console.log(`✅ Published: ${data.link}`);
  } catch {
    console.error(`❌ Publish parse failed "${title}"`, text);
  }
}

/* =====================================================
 * MAIN
 * ===================================================== */
(async () => {
  const ticketsRaw = await read("tickets.json");
  const tickets = ticketsRaw ? JSON.parse(ticketsRaw) : {};

  const ticketDate = tickets.date;

  const today =
    LANG === "ro"
      ? new Date().toLocaleDateString("ro-RO")
      : new Date().toLocaleDateString("en-GB");

  const cota2Html = await read("cota2.html");
  const ziHtml = await read("biletul-zilei.html");

  // ---- COTA 2 ----
  if (cota2Html && tickets.bilet_cota2) {
    await publish({
      title: `${T.cota2_title} (${today})`,
      html: cota2Html,
      excerpt: T.cota2_excerpt(tickets.bilet_cota2),
      categorySlug: "cota-2",
      ticketDate
    });
  }

  // ---- BILETUL ZILEI ----
  if (ziHtml && tickets.biletul_zilei) {
    await publish({
      title: `${T.zi_title} (${today})`,
      html: ziHtml,
      excerpt: T.zi_excerpt(tickets.biletul_zilei),
      categorySlug: "biletul-zilei",
      ticketDate
    });
  }

})();
