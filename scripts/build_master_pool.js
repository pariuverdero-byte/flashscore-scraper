import fs from "fs/promises";
import { scrapeClaudiuPool } from "../scrapers/claudiuhood.js";

async function run() {
  const pools = [];

  console.log("▶ Scraping Claudiu Hood...");
  const claudiu = await scrapeClaudiuPool();
  pools.push(...claudiu);

  // DEDUPE STRICT pe match_id
  const map = new Map();
  for (const sel of pools) {
    if (!map.has(sel.match_id)) {
      map.set(sel.match_id, sel);
    }
  }

  const master = [...map.values()];

  await fs.writeFile(
    "master_pool.json",
    JSON.stringify(master, null, 2),
    "utf8"
  );

  console.log(`✅ Master pool ready: ${master.length} selections`);
}

run();
