import https from "https";

import { SOURCES_10PARIURI } from "../parsers/10pariuri_sources.js";
import { parse10PariuriGeneric } from "../parsers/parse10pariuri_generic.js";
import { extractMatch } from "../parsers/extract_match.js";
import { flashscoreMapMatch } from "../engine/flashscore_mapper.js";

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { "User-Agent": "Mozilla/5.0" } },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve(data));
        }
      )
      .on("error", reject);
  });
}

async function run() {
  for (const src of SOURCES_10PARIURI) {
    const html = await fetchHtml(src.url);
    const parsed = parse10PariuriGeneric(html, src.url, src);

    let match = extractMatch({
      sport: parsed.sport,
      title: parsed.title,
      rawText: parsed.rawText,
    });

    if (!match) {
      match = await flashscoreMapMatch({
        sport: parsed.sport,
        rawText: parsed.rawText,
      });
    }

    console.log(`\n==== ${src.key.toUpperCase()} ====`);
    console.log(
      JSON.stringify(
        {
          ...parsed,
          match,
        },
        null,
        2
      )
    );
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
