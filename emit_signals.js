import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

const STATE_DIR = "./state";
const SIGNALS_FILE = "./signals.json";

await fs.mkdir(STATE_DIR, { recursive: true });

function sum(home, away, key) {
  return (home[key] || 0) + (away[key] || 0);
}

function loadState(matchId) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(STATE_DIR, `${matchId}.json`), "utf8")
    );
  } catch {
    return { matchId, snapshots: [] };
  }
}

async function saveState(state) {
  const file = path.join(STATE_DIR, `${state.matchId}.json`);
  await fs.writeFile(file, JSON.stringify(state, null, 2));
}

function delta10(snaps, key) {
  if (snaps.length < 2) return 0;
  return snaps[snaps.length - 1][key] - snaps[0][key];
}

function evaluateSignals(ctx) {
  const {
    minute,
    xG_sum,
    SOT_sum,
    shots_in_box_sum,
    big_chances_sum,
    delta_xG,
  } = ctx;

  const signals = [];

  // OVER 0.5 FH
  if (
    minute >= 18 &&
    minute <= 40 &&
    [
      xG_sum >= 0.6,
      big_chances_sum >= 1,
      SOT_sum >= 3,
      shots_in_box_sum >= 4,
      delta_xG >= 0.25,
    ].filter(Boolean).length >= 2
  ) {
    signals.push({
      market: "OVER_0_5_FH",
      confidence: "medium",
    });
  }

  // UNDER 0.5 FH
  if (
    minute >= 25 &&
    minute <= 45 &&
    xG_sum <= 0.3 &&
    SOT_sum <= 1 &&
    shots_in_box_sum <= 2 &&
    delta_xG <= 0.1
  ) {
    signals.push({
      market: "UNDER_0_5_FH",
      confidence: "medium",
    });
  }

  return signals;
}

async function processMatch(matchId) {
  const { stdout } = await exec("node", [
    "scrape_mobi_stats.js",
    matchId,
  ]);

  const stats = JSON.parse(stdout);

  if (!stats.minute || stats.minute < 12) return [];

  const xG_sum = sum(stats.home, stats.away, "xg");
  const SOT_sum = sum(stats.home, stats.away, "shots_on_target");
  const shots_in_box_sum = sum(stats.home, stats.away, "shots_in_box");
  const big_chances_sum = sum(stats.home, stats.away, "big_chances");

  const state = loadState(matchId);

  state.snapshots.push({
    minute: stats.minute,
    xG_sum,
    SOT_sum,
    box_sum: shots_in_box_sum,
  });

  // keep only last 3
  state.snapshots = state.snapshots.slice(-3);

  await saveState(state);

  const delta_xG = delta10(state.snapshots, "xG_sum");

  const ctx = {
    minute: stats.minute,
    xG_sum,
    SOT_sum,
    shots_in_box_sum,
    big_chances_sum,
    delta_xG,
  };

  const signals = evaluateSignals(ctx);

  return signals.map((s) => ({
    matchId,
    minute: stats.minute,
    ...s,
    metrics: ctx,
  }));
}

(async () => {
  const matches = JSON.parse(await fs.readFile("matches.json", "utf8")).matches;

  const allSignals = [];

  for (const m of matches) {
    if (m.status !== "live") continue;

    try {
      const sigs = await processMatch(m.id);
      sigs.forEach((s) => {
        console.log(
          `[SIGNAL] ${m.teams} @ ${s.minute}' → ${s.market}`
        );
      });
      allSignals.push(...sigs);
    } catch (e) {
      console.error(`[ERR] ${m.id}`, e.message);
    }
  }

  await fs.writeFile(SIGNALS_FILE, JSON.stringify(allSignals, null, 2));
})();
