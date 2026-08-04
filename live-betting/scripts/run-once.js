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
 * Afișăm numai meciurile pentru care avem statistici
 * vizibile și suficient de complete.
 *
 * Cerem minimum două dintre următoarele trei categorii:
 * - șuturi;
 * - cornere;
 * - posesie validă, aproximativ 100% cumulat.
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

  const totalCorners =
    Number(home.corners || 0) +
    Number(away.corners || 0);

  const totalPossession =
    Number(home.possession || 0) +
    Number(away.possession || 0);

  const hasShots =
    totalShots > 0 &&
    shotsOnTarget >= 0;

  const hasCorners =
    totalCorners > 0;

  const hasValidPossession =
    totalPossession >= 95 &&
    totalPossession <= 105;

  const validCategories = [
    hasShots,
    hasCorners,
    hasValidPossession,
  ].filter(Boolean).length;

  return validCategories >= 2;
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
 * Elimină din feed semnalele similare din aceeași familie.
 *
 * Exemplu:
 * - Over 0.5 până la final
 * - Over 1.5 în meci
 *
 * Dacă ambele reprezintă practic aceeași situație,
 * rămâne semnalul cu încrederea mai mare.
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

/**
 * Închide semnalele active atunci când:
 * - meciul nu mai este live;
 * - minutul a trecut de limita maximă;
 * - statisticile au devenit indisponibile.
 */
function expireInvalidSignals(
  signals,
  selectedForProcessing,
) {
  const currentMatchesById = new Map(
    selectedForProcessing.map(
      (match) => [match.id, match],
    ),
  );

  return signals.map((signal) => {
    if (signal.status !== 'active') {
      return signal;
    }

    const match = currentMatchesById.get(
      signal.matchId,
    );

    if (!match) {
      return {
        ...signal,
        status: 'expired',
        closedAt: nowIso(),
        closeReason: 'match_not_live',
      };
    }

    const minute = Number(
      match.minute || 0,
    );

    if (
      minute > LIVE_CONFIG.maxMinute
    ) {
      return {
        ...signal,
        status: 'expired',
        closedAt: nowIso(),
        closeReason: 'minute_limit',
      };
    }

    if (!hasUsableStatistics(match)) {
      return {
        ...signal,
        status: 'expired',
        closedAt: nowIso(),
        closeReason:
          'statistics_unavailable',
      };
    }

    return signal;
  });
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
 * 3. Selectăm maximum 15 meciuri pentru procesare.
 *
 * Această listă include și meciurile fără statistici complete,
 * deoarece trebuie să putem închide eventualele semnale vechi.
 */
const selectedForProcessing = selectMatches(
  enriched,
  LIVE_CONFIG.maxMatches,
);

/*
 * 4. Pentru feed păstrăm numai meciurile cu statistici utile.
 */
const selectedForFeed =
  selectedForProcessing.filter(
    hasUsableStatistics,
  );

/*
 * 5. Citim istoricul semnalelor și actualizăm rezultatele.
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
 * 6. Închidem semnalele care nu mai trebuie afișate.
 */
signals = expireInvalidSignals(
  signals,
  selectedForProcessing,
);

/*
 * 7. Generăm semnale numai pentru meciurile
 * care au statistici suficiente.
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
 * 8. Selectăm semnalele active și eliminăm dublurile.
 */
const rawActiveSignals = signals.filter(
  (signal) =>
    signal.status === 'active',
);

const activeSignals =
  deduplicateActiveSignals(
    rawActiveSignals,
  );

/*
 * 9. Construim feed-ul public.
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

/*
 * 10. Salvăm starea internă completă.
 */
await writeJsonAtomic(
  matchesFile,
  {
    generatedAt,
    matches: selectedForProcessing,
  },
);

/*
 * 11. Salvăm istoricul semnalelor.
 */
await writeJsonAtomic(
  signalsFile,
  signals,
);

/*
 * 12. Salvăm feed-ul public pentru WordPress.
 */
await writeJsonAtomic(
  feedFile,
  {
    version: 3,

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
