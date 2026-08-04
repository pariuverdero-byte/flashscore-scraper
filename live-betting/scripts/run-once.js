import path from 'path';
import { LIVE_CONFIG } from '../config/live.config.js';
import { fetchLiveMatches, fetchMatchState } from '../lib/flashscore.js';
import { selectMatches } from '../lib/selector.js';
import { generateSignals } from '../lib/signals.js';
import { mergeSignals, settleSignals } from '../lib/state.js';
import { nowIso, readJson, writeJsonAtomic } from '../lib/utils.js';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'live-betting', 'data');
const matchesFile = path.join(DATA, 'live_matches.json');
const signalsFile = path.join(DATA, 'signals.json');
const feedFile = path.join(DATA, 'live_feed.json');

async function mapLimited(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = await fn(items[index], index); }
      catch (error) { output[index] = { ...items[index], fetchError: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

const previousPayload = await readJson(matchesFile, { matches: [] });
const previousById = new Map((previousPayload.matches || []).map((match) => [match.id, match]));
const liveList = await fetchLiveMatches();
const enriched = await mapLimited(liveList, 4, fetchMatchState);
const selected = selectMatches(enriched, LIVE_CONFIG.maxMatches);

let signals = await readJson(signalsFile, []);
signals = settleSignals(signals, selected);
for (const match of selected) {
  signals = mergeSignals(signals, generateSignals(match, previousById.get(match.id)));
}

const activeSignals = signals.filter((signal) => signal.status === 'active');
const matches = selected.map((match) => ({
  ...match,
  signals: activeSignals.filter((signal) => signal.matchId === match.id),
}));
const generatedAt = nowIso();

await writeJsonAtomic(matchesFile, { generatedAt, matches });
await writeJsonAtomic(signalsFile, signals);
await writeJsonAtomic(feedFile, {
  version: 1,
  generatedAt,
  refreshSeconds: LIVE_CONFIG.pollSeconds,
  disclaimer: {
    ro: 'Semnalele sunt informative și nu garantează câștiguri. Joacă responsabil.',
    en: 'Signals are informational and do not guarantee winnings. Gamble responsibly.',
  },
  matches,
});

console.log(`[live] ${matches.length} matches, ${activeSignals.length} active signals`);
