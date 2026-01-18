// publish_wp.js
// FIXED VERSION — robust publish even if category is missing

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

// ---------------- CATEGORY (OPTIONAL) ----------------
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

// ---------------- PUBLISH ----------------
async function publish({ title, html, categorySlug }) {
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

// ---------------- MAIN ----------------
(async () => {
  const today = new Date().toLocaleDateString("ro-RO");

  const cota2 = await read("cota2.html");
  const zi = await read("biletul-zilei.html");

  if (cota2) {
    await publish({
      title: `Bilet Cota 2 (${today})`,
      html: cota2,
      categorySlug: "cota-2" // dacă există, bine; dacă nu, nu blochează
    });
  } else {
    console.log("ℹ cota2.html lipsă — nu public");
  }

  if (zi) {
    await publish({
      title: `Biletul Zilei (${today})`,
      html: zi,
      categorySlug: "biletul-zilei"
    });
  } else {
    console.log("ℹ biletul-zilei.html lipsă — nu public");
  }
})();
