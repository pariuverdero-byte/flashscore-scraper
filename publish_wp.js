// publish_wp.js
// FINAL VERSION — publish with custom excerpt for category listing

import fs from "fs/promises";
import fetch from "node-fetch";

const { WP_URL, WP_USER, WP_APP_PASS } = process.env;

if (!WP_URL || !WP_USER || !WP_APP_PASS) {
  console.error("❌ Lipsesc WP_URL / WP_USER / WP_APP_PASS");
  process.exit(1);
}

const auth =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const read = async (p) =>
  fs.readFile(p, "utf8").catch(() => null);

// ---------- CATEGORY (OPTIONAL) ----------
async function getCategoryId(slug) {
  try {
    const r = await fetch(
      `${WP_URL}/wp-json/wp/v2/categories?slug=${slug}`,
      { headers: { Authorization: auth } }
    );
    const j = await r.json();
    return j?.[0]?.id || null;
  } catch {
    return null;
  }
}

// ---------- EXCERPT BUILDER ----------
function buildExcerpt({ title, ticket }) {
  if (!ticket || !ticket.selections?.length) {
    return `${title} – analiză și pronosticuri fotbal.`;
  }

  const n = ticket.selections.length;
  const totalOdd = ticket.product;
  const sports = new Set();

  for (const s of ticket.selections) {
    if (s.country) sports.add(s.country);
  }

  const region =
    sports.size === 1 ? [...sports][0] : "Fotbal Internațional";

  return `${title} cu ${n} selecții • Cotă totală ${totalOdd} • ${region}`;
}

// ---------- PUBLISH ----------
async function publish({ title, html, excerpt, categorySlug }) {
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

  const body = {
    title,
    status: "publish",
    content: html,
    excerpt,
    categories
  };

  const r = await fetch(`${WP_URL}/wp-json/wp/v2/posts`, {
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
  const today = new Date().toLocaleDateString("ro-RO");

  const ticketsRaw = await read("tickets.json");
  const tickets = ticketsRaw ? JSON.parse(ticketsRaw) : {};

  const cota2Html = await read("cota2.html");
  const ziHtml = await read("biletul-zilei.html");

  if (cota2Html && tickets.bilet_cota2) {
    const title = `Bilet Cota 2 (${today})`;
    await publish({
      title,
      html: cota2Html,
      excerpt: buildExcerpt({
        title: "Bilet Cota 2",
        ticket: tickets.bilet_cota2
      }),
      categorySlug: "cota-2"
    });
  } else {
    console.log("ℹ cota2.html lipsă — nu public");
  }

  if (ziHtml && tickets.biletul_zilei) {
    const title = `Biletul Zilei (${today})`;
    await publish({
      title,
      html: ziHtml,
      excerpt: buildExcerpt({
        title: "Biletul Zilei",
        ticket: tickets.biletul_zilei
      }),
      categorySlug: "biletul-zilei"
    });
  } else {
    console.log("ℹ biletul-zilei.html lipsă — nu public");
  }
})();
