// parsers/parse_predictz_as_odds.js
//
// FINAL — PredictZ injection + sequential external augmentation
// + sequential Flashscore odds fallback.
//
// IMPORTANT:
//
// The external augmenter and Flashscore fallback are executed as
// separate Node processes, synchronously.
//
// This guarantees:
//
// 1. PredictZ is injected into master_pool
// 2. external sources augment the existing master_pool
// 3. Flashscore fallback sees the FINAL external pool
// 4. fallback only completes what is missing
//
// Do NOT replace these sequential subprocess calls with parallel
// dynamic imports. Both downstream scripts write master_pool.json
// and parallel execution can cause one stage to overwrite another.

import fs from "fs/promises";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

/* ============================================================
 * PATHS
 * ============================================================ */

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

const MATCHED_FILE =
  path.join(
    ROOT,
    "predictz_matched.json"
  );

const MASTER_POOL_FILE =
  path.join(
    ROOT,
    "master_pool.json"
  );

const AUGMENT_SCRIPT =
  path.join(
    ROOT,
    "parsers",
    "augment_pool_sources_and_fallback.js"
  );

const FALLBACK_SCRIPT =
  path.join(
    ROOT,
    "parsers",
    "flashscore_odds_list_fallback.js"
  );

/* ============================================================
 * HELPERS
 * ============================================================ */

function safe(value) {
  return (value ?? "")
    .toString()
    .trim();
}

async function readJsonSafe(
  file,
  fallback
) {
  try {
    return JSON.parse(
      await fs.readFile(
        file,
        "utf8"
      )
    );
  } catch {
    return fallback;
  }
}

function betText(p) {
  if (
    p.market === "BTTS"
  ) {
    return "Ambele echipe marchează";
  }

  if (
    p.market === "OVER_2_5"
  ) {
    return "Peste 2.5 goluri";
  }

  if (
    p.market === "1X2"
  ) {
    if (
      p.prediction === "1"
    ) {
      return "Victorie gazde";
    }

    if (
      p.prediction === "2"
    ) {
      return "Victorie oaspeți";
    }

    if (
      p.prediction === "X"
    ) {
      return "Egal";
    }
  }

  return "Pariu special";
}

function detectType(p) {
  if (
    p.market === "BTTS"
  ) {
    return "btts";
  }

  if (
    p.market === "OVER_2_5"
  ) {
    return "goals_ou";
  }

  return "1x2";
}

function detectParams(p) {
  if (
    p.market === "BTTS"
  ) {
    return {
      side: "yes"
    };
  }

  if (
    p.market === "OVER_2_5"
  ) {
    return {
      side: "over",
      line: 2.5
    };
  }

  if (
    p.market === "1X2"
  ) {
    return {
      pick:
        safe(
          p.prediction
        )
    };
  }

  return {};
}

function predictedOdd(p) {
  if (
    p.market === "BTTS"
  ) {
    return 1.70;
  }

  if (
    p.market === "OVER_2_5"
  ) {
    return 1.50;
  }

  return 1.45;
}

function selectionKey(
  selection
) {
  return [
    safe(
      selection.match_id ||
      selection.id
    ),

    safe(
      selection.market_raw
    ).toLowerCase(),

    Number(
      selection.odd || 0
    ).toFixed(3),

    safe(
      selection.source
    ).toLowerCase()
  ].join("|");
}

function dedupeSelections(
  items
) {
  const seen =
    new Set();

  const out = [];

  for (
    const item
    of items
  ) {
    if (!item) {
      continue;
    }

    const key =
      selectionKey(
        item
      );

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    out.push(item);
  }

  return out;
}

/* ============================================================
 * SEQUENTIAL SCRIPT RUNNER
 * ============================================================ */

function runNodeStage(
  label,
  scriptPath
) {
  console.log("");
  console.log(
    `[PIPELINE] ${label}`
  );

  const result =
    spawnSync(
      process.execPath,
      [scriptPath],
      {
        cwd: ROOT,

        stdio:
          "inherit",

        env: {
          ...process.env
        }
      }
    );

  if (
    result.error
  ) {
    throw result.error;
  }

  if (
    result.status !== 0
  ) {
    throw new Error(
      `${label} failed with exit code ${result.status}`
    );
  }

  console.log(
    `[PIPELINE] ${label} complete`
  );
}

/* ============================================================
 * MAIN
 * ============================================================ */

async function main() {
  /* ----------------------------------------------------------
   * 1. READ PREDICTZ MATCHES
   * ---------------------------------------------------------- */

  const matched =
    await readJsonSafe(
      MATCHED_FILE,
      {
        selections: []
      }
    );

  /* ----------------------------------------------------------
   * 2. READ EXISTING MASTER POOL
   *
   * At this point it normally already contains:
   * - ClaudiuHood
   * - TalkFootball
   * ---------------------------------------------------------- */

  const pool =
    await readJsonSafe(
      MASTER_POOL_FILE,
      {
        date: null,

        source:
          "master_pool",

        source_mode:
          "empty",

        sources_used:
          [],

        selections:
          []
      }
    );

  const selections =
    Array.isArray(
      pool.selections
    )
      ? [
          ...pool.selections
        ]
      : [];

  let added = 0;

  /* ----------------------------------------------------------
   * 3. INJECT PREDICTZ
   * ---------------------------------------------------------- */

  const predictzSelections =
    Array.isArray(
      matched?.selections
    )
      ? matched.selections
      : [];

  for (
    const p
    of predictzSelections
  ) {
    const flashscoreId =
      safe(
        p?.flashscore_id ||
        p?.match_id ||
        p?.id
      );

    if (
      !flashscoreId
    ) {
      continue;
    }

    const odd =
      predictedOdd(p);

    const url =
      safe(
        p.flashscore_url
      ) ||
      `https://www.flashscore.mobi/match/${flashscoreId}/`;

    selections.push({
      match_id:
        flashscoreId,

      id:
        flashscoreId,

      flashscore_url:
        url,

      url,

      teams:
        safe(
          p.teams
        ),

      time:
        safe(
          p.flashscore_kickoff ||
          p.kickoff ||
          p.time
        ),

      country:
        safe(
          p.country
        ),

      competition:
        safe(
          p.competition ||
          p.league
        ),

      bet_type:
        detectType(p),

      market_raw:
        betText(p),

      odd:
        Number(
          odd.toFixed(3)
        ),

      source:
        "predictz",

      meta: {
        ...(p.meta || {}),

        bet_text:
          betText(p),

        source:
          "predictz",

        source_market:
          safe(
            p.market
          ),

        match_method:
          safe(
            p.match_method
          ),

        match_confidence:
          p.match_confidence ??
          p.match_score ??
          null
      },

      params:
        detectParams(p)
    });

    added++;
  }

  const deduped =
    dedupeSelections(
      selections
    );

  const existingSources =
    Array.isArray(
      pool.sources_used
    )
      ? [
          ...pool.sources_used
        ]
      : [];

  if (
    added > 0 &&
    !existingSources.includes(
      "predictz"
    )
  ) {
    existingSources.push(
      "predictz"
    );
  }

  await fs.writeFile(
    MASTER_POOL_FILE,

    JSON.stringify(
      {
        ...pool,

        source:
          "master_pool",

        sources_used:
          existingSources,

        selections:
          deduped
      },
      null,
      2
    ),

    "utf8"
  );

  console.log(
    `✅ predictz added: ${added}`
  );

  console.log(
    `[PIPELINE] pool after PredictZ: ${deduped.length}`
  );

  /* ----------------------------------------------------------
   * 4. EXTERNAL SOURCES
   *
   * MUST finish completely before fallback starts.
   * ---------------------------------------------------------- */

  try {
    runNodeStage(
      "External source augmentation",
      AUGMENT_SCRIPT
    );
  } catch (error) {
    console.warn(
      `[POOL+] skipped after error: ${
        error?.message ||
        error
      }`
    );
  }

  /* ----------------------------------------------------------
   * 5. FLASHSCORE FALLBACK
   *
   * LAST RESORT ONLY.
   *
   * It reads master_pool AFTER all external sources have
   * completely finished.
   * ---------------------------------------------------------- */

  try {
    runNodeStage(
      "Flashscore odds fallback",
      FALLBACK_SCRIPT
    );
  } catch (error) {
    console.warn(
      `[FS-ODDS] skipped after error: ${
        error?.message ||
        error
      }`
    );
  }

  /* ----------------------------------------------------------
   * 6. FINAL AUDIT
   * ---------------------------------------------------------- */

  const finalPool =
    await readJsonSafe(
      MASTER_POOL_FILE,
      {
        selections: []
      }
    );

  const finalSelections =
    Array.isArray(
      finalPool.selections
    )
      ? finalPool.selections
      : [];

  const sourceCounts =
    {};

  for (
    const selection
    of finalSelections
  ) {
    const source =
      safe(
        selection.source ||
        selection.meta?.source ||
        "unknown"
      );

    sourceCounts[source] =
      (
        sourceCounts[source] ||
        0
      ) + 1;
  }

  console.log("");
  console.log(
    `[PIPELINE] FINAL pool=${finalSelections.length}`
  );

  console.log(
    `[PIPELINE] FINAL sources=${JSON.stringify(sourceCounts)}`
  );
}

main().catch(
  (error) => {
    console.error(
      "❌ parse_predictz_as_odds failed:",
      error
    );

    process.exit(1);
  }
);
