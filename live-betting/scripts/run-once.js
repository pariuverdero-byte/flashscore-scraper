import path from 'path';
import { LIVE_CONFIG } from '../config/live.config.js';
import {
  fetchLiveMatches,
  fetchMatchState,
} from '../lib/flashscore.js';
import { selectMatches } from '../lib/selector.js';
import { generateSignals } from '../lib/signals.js';
import {
  mergeSignals,
  settleSignals,
} from '../lib/state.js';
import {
  nowIso,
  readJson,
  writeJsonAtomic,
} from '../lib/utils.js';

const ROOT = process.cwd();

const DATA = path.join(
  ROOT,
  'live-betting',
  'data',
);

const matchesFile = path.join(
  DATA,
  'live_matches.json',
);

const signalsFile = path.join(
  DATA,
  'signals.json',
);

const feedFile = path.join(
  DATA,
  'live_feed.json',
);

async function mapLimited(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;

      try {
        output[index] = await fn(
          items[index],
          index,
        );
      } catch (error) {
        output[index] = {
          ...items[index],
          fetchError:
            error instanceof Error
              ? error.message
              : String(error),
        };
      }
    }
  }

  const workers = Array.from(
    {
      length: Math.min(
        limit,
        Math.max(items.length, 1),
      ),
    },
    () => worker(),
  );

  await Promise.all(workers);

  return output;
}

/**
 * Nu afișăm meciurile pentru care Flashscore nu oferă statistici reale.
 */
function hasUsableStatistics(match) {
  if (!match?.statsAvailable) {
    return false;
  }

  const home = match.stats?.home || {};
  const away = match.stats?.away || {};

  const totalShots =
    Number(home.shots || 0) +
    Number(away.shots || 0);

  const shotsOnTarget =
    Number(home.shotsOnTarget || 0) +
    Number(away.shotsOnTarget || 0);

  const corners =
    Number(home.corners || 0) +
    Number(away.corners || 0);

  const possession =
    Number(home.possession || 0) +
    Number(away.possession || 0);

  const xg =
    Number(home.xg || 0) +
    Number(away.xg || 0);

  /*
   * Acceptăm meciul dacă există cel puțin o categorie relevantă.
   * Nu este necesar ca Flashscore să ofere toate statisticile.
   */
  return (
    totalShots > 0 ||
    shotsOnTarget > 0 ||
    corners > 0 ||
    possession > 0 ||
    xg > 0
  );
}

function signalFamily(signal) {
  if (signal.family) {
    return signal.family;
  }

  if (
    signal.type === 'goal_over_0_5_ft' ||
    signal.type === 'goal_over_1_5_match'
  ) {
    return 'total_goals';
  }

  if (
    signal.type === 'home_next_goal' ||
    signal.type === 'away_next_goal'
  ) {
    return 'next_goal';
  }

  if (signal.type === 'corners_over') {
    return 'corners';
  }

  return signal.type;
}

/**
 * Elimină din feed eventualele semnale similare rămase
 * din ciclurile anterioare.
 */
function deduplicateActiveSignals(signals) {
  const selected = new Map();

  for (const signal of signals) {
    const key = [
      signal.matchId,
      signalFamily(signal),
    ].join(':');

    const current = selected.get(key);

    if (
      !current ||
      Number(signal.confidence || 0) >
        Number(current.confidence || 0)
    ) {
      selected.set(key, signal);
    }
  }

  return [...selected.values()];
}

const previousPayload = await readJson(
  matchesFile,
  {
    matches: [],
  },
);

const previousById = new Map(
  (previousPayload.matches || []).map(
    (match) => [match.id, match],
  ),
);

/*
 * 1. Detectăm toate meciurile live.
 */
const liveList = await fetchLiveMatches();

/*
 * 2. Preluăm scorul, minutul și statisticile.
 */
const enriched = await mapLimited(
  liveList,
  4,
  fetchMatchState,
);

/*
 * 3. Selectăm maximum 15 meciuri.
 *
 * Păstrăm această listă pentru procesarea și închiderea
 * eventualelor semnale existente.
 */
const selectedForProcessing = selectMatches(
  enriched,
  LIVE_CONFIG.maxMatches,
);

/*
 * 4. Pentru afișare păstrăm numai meciurile cu statistici utile.
 */
const selectedForFeed =
  selectedForProcessing.filter(
    hasUsableStatistics,
  );

/*
 * 5. Citim și actualizăm istoricul semnalelor.
 */
let signals = await readJson(
  signalsFile,
  [],
);

signals = settleSignals(
  signals,
  selectedForProcessing,
);

/*
 * 6. Generăm semnale numai pentru meciurile
 * care vor fi afișate.
 */
for (const match of selectedForFeed) {
  const generatedSignals = generateSignals(
    match,
    previousById.get(match.id),
  );

  signals = mergeSignals(
    signals,
    generatedSignals,
  );
}

/*
 * 7. Selectăm semnalele active și eliminăm
 * eventualele dubluri din aceeași familie.
 */
const rawActiveSignals = signals.filter(
  (signal) => signal.status === 'active',
);

const activeSignals =
  deduplicateActiveSignals(
    rawActiveSignals,
  );

/*
 * 8. Construim feed-ul public.
 */
const matches = selectedForFeed.map(
  (match) => ({
    ...match,
    signals: activeSignals
      .filter(
        (signal) =>
          signal.matchId === match.id,
      )
      .sort(
        (a, b) =>
          Number(b.confidence || 0) -
          Number(a.confidence || 0),
      )
      .slice(
        0,
        LIVE_CONFIG.maxSignalsPerMatch,
      ),
  }),
);

const generatedAt = nowIso();

await writeJsonAtomic(
  matchesFile,
  {
    generatedAt,
    matches: selectedForProcessing,
  },
);

await writeJsonAtomic(
  signalsFile,
  signals,
);

await writeJsonAtomic(
  feedFile,
  {
    version: 2,
    generatedAt,
    refreshSeconds:
      LIVE_CONFIG.pollSeconds,

    disclaimer: {
      ro:
        'Semnalele sunt informative și nu garantează câștiguri. Joacă responsabil.',
      en:
        'Signals are informational and do not guarantee winnings. Gamble responsibly.',
    },

    matches,
  },
);

console.log(
  `[live] ${matches.length} matches with statistics, ` +
    `${activeSignals.length} active signals`,
);
