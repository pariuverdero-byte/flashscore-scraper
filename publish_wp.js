// publish_wp.js
// FINAL — LANG-aware (RO / EN), safe publish, no-picks safe, HTML-response safe

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
  const u = url.replace(/\/$/, "");
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
    no_picks: "Nu există bilete valide astăzi. Publicarea a fost omisă.",
    ticket_date_label: "Data biletului",
  },
  en: {
    cota2_title: "Odds 2 Ticket",
    zi_title: "Bet of the Day",
    cota2_excerpt: (t) =>
      `Odds 2 Ticket with ${t.selections.length} selections • Total odds ${t.product}`,
    zi_excerpt: (t) =>
      `Bet of the Day with ${t.selections.length} selections • Total odds ${t.product}`,
    no_picks: "No valid tickets today. Publish skipped.",
    ticket_date_label: "Ticket date",
  },
};

const T = I18N[LANG] || I18N.ro;

/* =====================================================
 * 📅 DATE
 * ===================================================== */
function formatTicketDate(isoDate) {
  if (!isoDate) {
    return LANG === "ro"
      ? new Date().toLocaleDateString("ro-RO")
      : new Date().toLocaleDateString("en-GB");
  }

  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;

  return LANG === "ro" ? `${d}.${m}.${y}` : `${d}/${m}/${y}`;
}

/* =====================================================
 * 🌐 SAFE JSON / TEXT
 * ===================================================== */
async function safeJsonResponse(response, label) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    console.error(`❌ ${label} returned non-JSON response`);
    console.error(text.slice(0, 800));
    throw new Error(`${label} returned HTML/non-JSON instead of JSON`);
  }
}

/* =====================================================
 * CATEGORY
 * ===================================================== */
async function getCategoryId(slug) {
  try {
    const r = await fetch(`${CATEGORIES_ENDPOINT}?slug=${encodeURIComponent(slug)}`, {
      headers: {
        Authorization: auth,
        Accept: "application/json",
      },
    });

    if (!r.ok) {
      console.log(`⚠ Category lookup failed: ${slug} (${r.status})`);
      return null;
    }

    const j = await safeJsonResponse(r, `Category lookup for slug "${slug}"`);
    return j?.[0]?.id || null;
  } catch (err) {
    console.log(`⚠ Category missing or blocked: ${slug} (${err.message})`);
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

  let categories = [];
  if (categorySlug) {
    const catId = await getCategoryId(categorySlug);
    if (catId) {
      categories = [catId];
    } else {
      console.log(`⚠ Category missing: ${categorySlug}`);
    }
  }

  const content = `
<p><strong>${excerpt}</strong></p>
<p><em>${T.ticket_date_label}: ${formatTicketDate(ticketDate)}</em></p>
<!--more-->
${html}
`.trim();

  const r = await fetch(POSTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      title,
      status: "publish",
      content,
      categories,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    console.error(`❌ Publish failed "${title}" (${r.status})`);
    console.error(text.slice(0, 800));
    return;
  }

  try {
    const data = await safeJsonResponse(r, `Publish "${title}"`);
    console.log(`✅ Published: ${data.link}`);
  } catch (err) {
    console.error(`❌ Publish parse failed "${title}": ${err.message}`);
  }
}

/* =====================================================
 * MAIN
 * ===================================================== */
(async () => {
  try {
    const ticketsRaw = await read("tickets.json");
    if (!ticketsRaw) {
      console.log("ℹ tickets.json missing → skip publish");
      process.exit(0);
    }

    const tickets = JSON.parse(ticketsRaw);

    if (tickets.status === "no_picks") {
      console.log(`ℹ ${T.no_picks}`);
      process.exit(0);
    }

    const ticketDateLabel = formatTicketDate(tickets.date);

    const cota2Html = await read("cota2.html");
    const ziHtml = await read("biletul-zilei.html");

    // ---- COTA 2 ----
    if (cota2Html && tickets.bilet_cota2) {
      await publish({
        title: `${T.cota2_title} (${ticketDateLabel})`,
        html: cota2Html,
        excerpt: T.cota2_excerpt(tickets.bilet_cota2),
        categorySlug: "cota-2",
        ticketDate: tickets.date,
      });
    } else {
      console.log("ℹ No Cota 2 content to publish");
    }

    // ---- BILETUL ZILEI ----
    if (ziHtml && tickets.biletul_zilei) {
      await publish({
        title: `${T.zi_title} (${ticketDateLabel})`,
        html: ziHtml,
        excerpt: T.zi_excerpt(tickets.biletul_zilei),
        categorySlug: "biletul-zilei",
        ticketDate: tickets.date,
      });
    } else {
      console.log("ℹ No Bet of the Day content to publish");
    }

    process.exit(0);
  } catch (err) {
    console.error(`❌ publish_wp fatal: ${err.message}`);
    process.exit(1);
  }
})();
