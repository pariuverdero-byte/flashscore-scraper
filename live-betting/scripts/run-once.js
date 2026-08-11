import path from 'path';
import { LIVE_CONFIG } from '../config/live.config.js';
import { fetchLiveMatches, fetchMatchState } from '../lib/flashscore.js';
import { enrichWithPrematch } from '../lib/prematch.js';
import { selectMatches } from '../lib/selector.js';
import { generateSignals } from '../lib/signals.js';
import { mergeSignals, settleSignals } from '../lib/state.js';
import { nowIso, readJson, writeJsonAtomic } from '../lib/utils.js';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'live-betting', 'data');
const matchesFile = path.join(DATA, 'live_matches.json');
const signalsFile = path.join(DATA, 'signals.json');
const feedFile = path.join(DATA, 'live_feed.json');
const prematchCacheFile = path.join(DATA, 'pre_match_cache.json');

async function mapLimited(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = await fn(items[index], index);
      } catch (error) {
        output[index] = {
          ...items[index],
          fetchError: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, Math.max(items.length, 1)) },
      () => worker(),
    ),
  );
  return output;
}

function hasUsableStatistics(match) {
  if (!match?.statsAvailable) return false;

  const home = match.stats?.home || {};
  const away = match.stats?.away || {};
  const totalShots = Number(home.shots || 0) + Number(away.shots || 0);
  const totalCorners = Number(home.corners || 0) + Number(away.corners || 0);
  const totalPossession = Number(home.possession || 0) + Number(away.possession || 0);

  const categories = [
    totalShots > 0,
    totalCorners > 0,
    totalPossession >= 95 && totalPossession <= 105,
  ].filter(Boolean).length;

  return categories >= 2;
}

function signalFamily(signal) {
  if (signal.family) return signal.family;
  if (['goal_over_0_5_ft', 'goal_over_1_5_match'].includes(signal.type)) return 'total_goals';
  if (['home_next_goal', 'away_next_goal'].includes(signal.type)) return 'next_goal';
  if (signal.type === 'corners_over') return 'corners';
  return signal.type;
}

function deduplicateActiveSignals(signals) {
  const selected = new Map();
  for (const signal of signals) {
    const key = `${signal.matchId}:${signalFamily(signal)}`;
    const current = selected.get(key);
    if (!current || Number(signal.confidence || 0) > Number(current.confidence || 0)) {
      selected.set(key, signal);
    }
  }
  return [...selected.values()];
}

function expireInvalidSignals(signals, currentMatches) {
  const byId = new Map(currentMatches.map((match) => [match.id, match]));
  return signals.map((signal) => {
    if (signal.status !== 'active') return signal;
    const match = byId.get(signal.matchId);
    if (!match) {
      return { ...signal, status: 'expired', closedAt: nowIso(), closeReason: 'match_not_live' };
    }
    if (Number(match.minute || 0) > LIVE_CONFIG.maxMinute) {
      return { ...signal, status: 'expired', closedAt: nowIso(), closeReason: 'minute_limit' };
    }
    if (!hasUsableStatistics(match)) {
      return { ...signal, status: 'expired', closedAt: nowIso(), closeReason: 'statistics_unavailable' };
    }
    return signal;
  });
}

const previousPayload = await readJson(matchesFile, { matches: [] });
const previousById = new Map((previousPayload.matches || []).map((match) => [match.id, match]));

const liveList = await fetchLiveMatches();

console.log(
  `[live-debug] fetched=${liveList.length}`
);

const liveStates =
  await mapLimited(
    liveList,
    4,
    fetchMatchState
  );

const selectedForProcessing =
  selectMatches(
    liveStates,
    LIVE_CONFIG.maxMatches
  );

const selectedWithStats =
  selectedForProcessing.filter(
    hasUsableStatistics
  );

console.log(
  `[live-debug] states=${liveStates.length}, ` +
  `selected=${selectedForProcessing.length}, ` +
  `withStats=${selectedWithStats.length}, ` +
  `max=${LIVE_CONFIG.maxMatches}`
);

const prematchCache = await readJson(prematchCacheFile, {});
const prematchResult = await enrichWithPrematch(selectedWithStats, prematchCache, {
  ttlMs: Number(process.env.PREMATCH_CACHE_HOURS || 12) * 60 * 60 * 1000,
  maxFetches: Number(process.env.PREMATCH_MAX_FETCHES_PER_CYCLE || 3),
});
const selectedForFeed = prematchResult.matches;

console.log(
  `[live-debug] feed=${selectedForFeed.length}`
);

let signals = await readJson(signalsFile, []);
signals = settleSignals(signals, selectedForProcessing);
signals = expireInvalidSignals(signals, selectedForProcessing);

for (const match of selectedForFeed) {
  signals = mergeSignals(signals, generateSignals(match, previousById.get(match.id)));
}

const activeSignals = deduplicateActiveSignals(
  signals.filter((signal) => signal.status === 'active'),
);

const matches = selectedForFeed.map((match) => ({
  ...match,
  signals: activeSignals
    .filter((signal) => signal.matchId === match.id)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, LIVE_CONFIG.maxSignalsPerMatch),
}));

const generatedAt = nowIso();

await writeJsonAtomic(matchesFile, { generatedAt, matches: selectedForProcessing });
await writeJsonAtomic(signalsFile, signals);
await writeJsonAtomic(prematchCacheFile, prematchResult.cache);
await writeJsonAtomic(feedFile, {
  version: 4,
  generatedAt,
  refreshSeconds: LIVE_CONFIG.pollSeconds,
  disclaimer: {
    ro: 'Semnalele sunt informative și nu garantează câștiguri. Joacă responsabil.',
    en: 'Signals are informational and do not guarantee winnings. Gamble responsibly.',
  },
  matches,
});

console.log(
  `[live] ${matches.length} matches with statistics, ${activeSignals.length} active signals, ` +
  `${prematchResult.fetched} prematch profiles fetched`,
);
