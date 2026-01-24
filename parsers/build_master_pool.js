// parsers/build_master_pool.js
// Creează master_pool.json din Claudiu + TalkFootball odds

import fs from "fs/promises";

const CLAUDIU = "claudiu_pool.json";
const OUTPUT = "master_pool.json";

async function run() {
  const claudiuRaw = await fs.readFile(CLAUDIU, "utf8");
  const claudiu = JSON.parse(claudiuRaw);

  // Dacă TalkFootball a injectat odds, ele sunt deja în claudiu_pool.json?
  // NU → deci master_pool începe ca o copie
  const master = {
    date: claudiu.date,
    selections: claudiu.selections || [],
    source: "master_pool"
  };

  await fs.writeFile(OUTPUT, JSON.stringify(master, null, 2));
  console.log(`✅ master_pool.json created (${master.selections.length} selections)`);
}

run().catch(e => {
  console.error("❌ build_master_pool failed", e);
  process.exit(1);
});
