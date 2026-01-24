// scripts/build_master_pool.js
import fs from "fs/promises";
import { scrapeBeturi } from "../scrapers/beturi_ro.js";

async function run() {
  const dayOffset = Number(process.env.DAY_OFFSET || 0);

  // Load Claudiu pool that you already generate (must contain match_id / data-id in your pipeline)
  const claudiuRaw = await fs.readFile("claudiu_pool.json", "utf8").catch(() => null);
  const claudiu = claudiuRaw ? JSON.parse(claudiuRaw) : null;

  const claudiuSelections =
    Array.isArray(claudiu) ? claudiu :
    Array.isArray(claudiu?.selections) ? claudiu.selections :
    [];

  const beturiSelections = await scrapeBeturi({ dayOffset, maxPosts: 50 });

  // strict filter: must have match_id
  const all = [...claudiuSelections, ...beturiSelections].filter(x => x.match_id);

  // dedupe by match_id (no repeated events)
  const map = new Map();
  for (const s of all) {
    if (!map.has(s.match_id)) map.set(s.match_id, s);
  }

  const master = [...map.values()];
  await fs.writeFile(
    "master_pool.json",
    JSON.stringify({ generated_at: new Date().toISOString(), selections: master }, null, 2),
    "utf8"
  );

  console.log(`✅ master_pool.json: ${master.length} unique matches (claudiu=${claudiuSelections.length}, beturi=${beturiSelections.length})`);
}

run();
