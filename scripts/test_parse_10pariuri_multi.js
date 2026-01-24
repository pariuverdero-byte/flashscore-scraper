import https from "https";
import { SOURCES_10PARIURI } from "../parsers/10pariuri_sources.js";
import { parse10PariuriGeneric } from "../parsers/parse10pariuri_generic.js";

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      }
    ).on("error", reject);
  });
}

async function run() {
  for (const src of SOURCES_10PARIURI) {
    const html = await fetchHtml(src.url);
    const parsed = parse10PariuriGeneric(html, src.url, src);

    console.log("\n====", src.key.toUpperCase(), "====");
    console.log(JSON.stringify(parsed, null, 2));
  }
}

run().catch(console.error);
