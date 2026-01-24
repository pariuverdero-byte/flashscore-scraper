// scrapers/beturi_ro.js
// TEST MODE — output only

import fs from "fs/promises";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const URL = "https://beturi.ro/";

(async () => {
  console.log("[beturi_ro] Fetching:", URL);

  const res = await fetch(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  console.log("[beturi_ro] Page length:", html.length);

  // ⛔ momentan NU mapăm nimic, doar vedem structura
  // Dump parțial pentru inspecție
  const sample = $("article, .post, .entry, .tip").first().text().slice(0, 500);

  console.log("---- SAMPLE TEXT ----");
  console.log(sample);
  console.log("---------------------");

  await fs.writeFile(
    "beturi_ro_raw.html",
    html
  );

  console.log("[beturi_ro] Raw HTML saved → beturi_ro_raw.html");
})();
