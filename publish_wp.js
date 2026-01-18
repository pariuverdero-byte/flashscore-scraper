// publish_wp.js
// FINAL & GUARANTEED — works with or without index.php

import fs from "fs/promises";
import fetch from "node-fetch";

const { WP_URL, WP_USER, WP_APP_PASS } = process.env;

if (!WP_URL || !WP_USER || !WP_APP_PASS) {
  console.error("❌ Lipsesc WP_URL / WP_USER / WP_APP_PASS");
  process.exit(1);
}

// ---------------------------------
// NORMALIZE WP_URL (NO DOUBLE PATHS)
// ---------------------------------
const BASE_API = WP_URL.replace(/\/$/, ""); // remove trailing slash

const POSTS_ENDPOINT = BASE_API.endsWith("/posts")
  ? BASE_API
  : `${BASE_API}/posts`;

const CATEGORIES_ENDPOINT = BASE_API.replace(/\/posts$/, "") + "/categories";

const auth =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const read = async (p) =>
  fs.readFile(p, "utf8").catch(() => null);

// ---------- CATEGORY ----------
async function getCategoryId(slug) {
  try {
    const r = await fetch(
      `${CATEGORIES_ENDPOINT}?slug=${slug}`,
      { headers: { Authorization: auth } }
    );
    const j = await r.json();
    return j?.[0]?.id || null;
  } catch {
    return null;
  }
}

// ---------- EXCERPT TEXT ----------
function buildExcerptText(title, ticket) {
  if (!ticket || !ticket.selections?.length) {
    return `${title} – football analysis and betting tips.`;
  }

  const n = ticket.selections.length;
  const odd = ticket.product;

  return `${title} with ${n} selections • Total odds ${odd}`;
}

// ---------- PUBLISH ----------
async function publish({ title, html, excerptText, categorySlug }) {
  if (!html || !html.trim()) {
    console.log(`ℹ Conținut gol → skip "${title}"`);
    return;
  }

  let categories = [];
  if (categorySlug) {
    const catId = await getCategoryId(categorySlug);
    if (catId) {
      categories = [catId];
      console.log(`ℹ Categoria setată: ${categorySlug}`);
    } else {
      console.log(`⚠ Categoria lipsă (${categorySlug}) → public fără categorie`);
    }
  }

  const content = `
<p><strong>${excerptText}</strong></p>
<!--more-->
${html}
  `.trim();

  const body = {
    title,
    status: "publish",
    content,
    categories
  };

  const r = await fetch(POSTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    console.error(`❌ Eroare publicare "${title}"`, r.status, await r.text());
    return;
  }

  const data = await r.json();
  console.log(`✅ Publicat: ${data.link}`);
}

// ---------- MAIN ----------
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
      categorySlug: "cota-2"
    });
  } else {
    console.log("ℹ cota2.html lipsă — nu public");
  }

  if (ziHtml && tickets.biletul_zilei) {
    await publish({
      title: `Bet of the Day (${today})`,
      html: ziHtml,
      excerptText: buildExcerptText("Bet of the Day", tickets.biletul_zilei),
      categorySlug: "biletul-zilei"
    });
  } else {
    console.log("ℹ biletul-zilei.html lipsă — nu public");
  }
})();
