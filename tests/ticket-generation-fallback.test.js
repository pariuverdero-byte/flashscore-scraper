import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// Run the generator's selection logic without its scraper and network imports.
const generator = fs.readFileSync(fileURLToPath(new URL("../generate_tickets_from_pool.js", import.meta.url)), "utf8");
const selectionLogic = generator.split("function splitCanonicalTeams")[0].replace(/^import .*;\r?\n/gm, "");
const context = { process: { env: {} }, console: { log() {} } };
vm.runInNewContext(`${selectionLogic}\nglobalThis.buildBundles = buildBundles; globalThis.selectAnalysisBundles = selectAnalysisBundles;`, context);

function selection(index, odd) {
  return { match_id: `match-${index}`, market_raw: "Peste 1.5 goluri", odd, source: "test" };
}

test("a three-selection pool below 3.50 still generates both ticket types", () => {
  const bundles = context.buildBundles([selection(1, 1.52), selection(2, 1.35), selection(3, 1.60)]);
  assert.ok(bundles.some(bundle => bundle.cota2 && bundle.day));
  assert.equal(Number(bundles[0].day.product.toFixed(3)), 3.283);
});

test("the original 3.50 day-ticket minimum remains preferred when available", () => {
  const bundles = context.buildBundles([
    selection(1, 1.52), selection(2, 1.35), selection(3, 1.60), selection(4, 1.30)
  ]);
  assert.ok(bundles.some(bundle => bundle.cota2 && bundle.day));
  assert.ok(bundles.every(bundle => !bundle.day || bundle.day.product >= 3.5));
});

test("a valid Cota 2 is retained when only the day ticket has analysis evidence", () => {
  const day = [1, 2, 3, 4].map(index => ({
    ...selection(index, 1.35),
    __analysisEvidence: { usable: true }
  }));
  const cota2 = selection(5, 2.02);
  const { evidenceBundles, selectedBundles } = context.selectAnalysisBundles([...day, cota2]);
  assert.equal(evidenceBundles[0].cota2, null);
  assert.ok(evidenceBundles[0].day);
  assert.ok(selectedBundles[0].cota2);
  assert.ok(selectedBundles[0].day);

  cota2.__analysisEvidence = { usable: false, blocked_by_contradiction: true };
  const contradicted = context.selectAnalysisBundles([...day, cota2]);
  assert.equal(contradicted.selectedBundles[0].cota2, null);
});
