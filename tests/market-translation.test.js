import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { englishMarketLabel } from "../scripts/market-translation.js";
import { repairMarketText } from "../scripts/repair-market-translation-wp.js";

test("the mixed Romanian market is repaired across generated tickets", () => {
  const raw = "gol marcat în ambele reprize";
  assert.equal(englishMarketLabel("goal marcat în ambele reprize", raw), "Goal scored in both halves");
  assert.equal(englishMarketLabel("", raw), "Goal scored in both halves");
  assert.equal(englishMarketLabel("Over 1.5 goals", "peste 1.5 goluri"), "Over 1.5 goals");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gbt-market-test-"));
  try {
    const selection = { teams: "Crystal Palace - Lech Poznan", market_raw: raw,
      ai: { label_en: "goal marcat în ambele reprize" }, odd: 1.52 };
    fs.writeFileSync(path.join(dir, "tickets.json"), JSON.stringify({ date: "2026-09-17",
      bilet_cota2: { product: 1.52, selections: [selection] } }));
    const generator = fileURLToPath(new URL("../generate_wp.js", import.meta.url));
    const run = spawnSync(process.execPath, [generator], { cwd: dir,
      env: { ...process.env, LANG: "en" }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const html = fs.readFileSync(path.join(dir, "cota2.html"), "utf8");
    assert.match(html, /Goal scored in both halves/);
    assert.doesNotMatch(html, /marcat|reprize/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown Romanian market labels stop before publication", () => {
  assert.throws(() => englishMarketLabel("", "rezultat meci"), /Untranslated English market label/);
});

test("the post repair changes only the affected market phrase", () => {
  const post = "Crystal Palace: goal marcat în ambele reprize @ 1.52; Over 1.5 goals";
  assert.equal(repairMarketText(post), "Crystal Palace: Goal scored in both halves @ 1.52; Over 1.5 goals");
  assert.equal(repairMarketText(repairMarketText(post)), repairMarketText(post));
});
