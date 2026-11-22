import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { fetchText } from '../lib/flashscore.js';
import { writeJsonAtomic } from '../lib/utils.js';

const SITES = { 'pariuverde.ro': 'ro', 'greenbettips.com': 'en' };
const MINUTE = 60_000;
const markets = [
  [/^(?:Peste 0[.,]5 goluri până la final|Over 0[.,]5 goals until full time)$/i, 'goal_after_signal'],
  [/^(?:Peste 1[.,]5 goluri în meci|Over 1[.,]5 match goals)$/i, 'match_goals_over', 1.5],
  [/^(?:Gazdele marchează următorul gol|Home team to score next)$/i, 'home_next_goal'],
  [/^(?:Oaspeții marchează următorul gol|Away team to score next)$/i, 'away_next_goal'],
  [/^(?:Peste cornere live|Live corners over)\s+(\d+[.,]\d+)$/i, 'match_corners_over'],
];

const clean = text => text.replace(/\s+/g, ' ').trim();
const score = text => {
  const match = /^(\d+)\s*[-–:]\s*(\d+)$/.exec(clean(text));
  return match ? [Number(match[1]), Number(match[2])] : null;
};
const total = values => values[0] + values[1];

export function parseFeed(html) {
  const $ = cheerio.load(html);
  if (!$('.pv-live-grid, .pv-live-empty').length) throw new Error('Live feed markup missing');
  const signals = [];
  $('.pv-live-card').each((_, card) => {
    const item = $(card);
    const matchId = item.attr('data-match-id');
    const visible = item.find('.pv-live-signal');
    if (!visible.length) return;
    const teams = item.find('.pv-live-score > span').map((_, team) => clean($(team).text())).get();
    const scoreAtSignal = score(item.find('.pv-live-score > b').text());
    const minute = /\b(\d+(?:\+\d+)?)\s*'/.exec(item.find('.pv-live-meta strong').text())?.[1] ?? null;
    if (!/^[A-Za-z0-9]{8}$/.test(matchId || '') || teams.length !== 2 || !scoreAtSignal) {
      throw new Error('Published signal lacks a valid match ID, teams or score');
    }
    const stats = item.find('.pv-live-stats > div').map((_, block) => {
      const stat = $(block);
      return [[clean(stat.find('small').text()), clean(stat.find('b').text())]];
    }).get();
    visible.each((_, node) => {
      const signal = $(node);
      const title = clean(signal.find('h3').text());
      if (!title) throw new Error('Published signal lacks a title');
      const market = markets.find(([pattern]) => pattern.test(title));
      const line = market?.[2] ?? market?.[0].exec(title)?.[1]?.replace(',', '.') ?? null;
      const confidence = /(\d+)\s*\/\s*100/.exec(signal.find('b').text())?.[1];
      const minimumOdd = /(\d+[.,]\d+)/.exec(signal.find('em').text())?.[1];
      signals.push({
        matchId, teams, minute, scoreAtSignal, title,
        competition: clean(item.find('.pv-live-meta > span').text()),
        market: market?.[1] ?? 'unclassified',
        line: line === null ? null : Number(line),
        confidence: confidence === undefined ? null : Number(confidence),
        minimumOdd: minimumOdd === undefined ? null : Number(minimumOdd.replace(',', '.')),
        reason: clean(signal.find('p').first().text()),
        stats: Object.fromEntries(stats),
      });
    });
  });
  return signals;
}

export function observe(state, site, generatedAt, signals) {
  const previous = state.lastFeed[site];
  if (previous && generatedAt <= previous) return;
  state.lastFeed[site] = generatedAt;
  const key = item => JSON.stringify([item.matchId, item.market, item.line, item.title]);
  const active = new Map(state.records
    .filter(item => item.site === site && !item.firstAbsentAt)
    .map(item => [key(item), item]));
  const visible = new Set();
  for (const signal of signals) {
    const id = key(signal);
    if (visible.has(id)) continue;
    visible.add(id);
    const current = active.get(id);
    if (current) {
      current.lastSeenAt = generatedAt;
      current.lastSeenMinute = signal.minute;
      current.observations += 1;
    } else {
      state.records.push({
        ...signal, site, firstSeenAt: generatedAt, lastSeenAt: generatedAt,
        lastSeenMinute: signal.minute, observations: 1, firstAbsentAt: null,
        outcome: 'pending',
      });
    }
  }
  for (const [id, item] of active) {
    if (!visible.has(id)) item.firstAbsentAt = generatedAt;
  }
}

export function parseFinal(html) {
  const $ = cheerio.load(html);
  const header = $('#detail-tab-content').prevAll('h3').first();
  const details = header.nextUntil('p, #detail-tab-content', '.detail');
  const status = clean(details.eq(1).text());
  const finalScore = score(details.eq(0).find('b').first().text());
  if (!finalScore || !/^Finished\b/i.test(status)) return null;

  // The short codes are in home/away order in the match title and also
  // identify the side on each normal goal in the incident timeline.
  const codes = /^(.+?)\s+\d+\s*-\s*\d+\s+([^|]+?)\s*\|/.exec(clean($('title').text()));
  const goalOrder = $('#detail-tab-content .incident').filter((_, node) => $(node).find('.icon.ball').length > 0)
    .map((_, node) => {
      const code = /\[([^\]]+)\]\s*$/.exec(clean($(node).text()))?.[1];
      return code && codes && code === codes[1] ? 0 : code && codes && code === codes[2] ? 1 : -1;
    }).get();
  const supported = goalOrder.filter(side => side === 0).length === finalScore[0] &&
    goalOrder.filter(side => side === 1).length === finalScore[1] && !goalOrder.includes(-1);
  return { finalScore, finalStatus: status, goalOrder: supported ? goalOrder : null };
}

export function settle(record, result) {
  const start = record.scoreAtSignal;
  const final = result.finalScore;
  if (final.some((goals, side) => goals < start[side])) return 'unverified';
  switch (record.market) {
    case 'goal_after_signal':
      return total(final) > total(start) ? 'won' : 'lost';
    case 'match_goals_over':
      if (total(start) > record.line) return 'unverified';
      return total(final) > record.line ? 'won' : 'lost';
    case 'match_corners_over': {
      const initialCorners = score(record.stats?.Cornere ?? record.stats?.Corners ?? '');
      if (!Number.isFinite(result.corners) || (initialCorners && total(initialCorners) > record.line)) {
        return 'unverified';
      }
      return result.corners > record.line ? 'won' : 'lost';
    }
    case 'home_next_goal':
    case 'away_next_goal': {
      const home = final[0] - start[0];
      const away = final[1] - start[1];
      if (home + away === 0) return 'no_more_goals';
      const prefix = result.goalOrder?.slice(0, total(start));
      const orderMatches = prefix && prefix.filter(side => side === 0).length === start[0];
      const next = home === 0 ? 1 : away === 0 ? 0 : orderMatches ? result.goalOrder[total(start)] : null;
      if (next === null || next === undefined) return 'unverified';
      return next === (record.market === 'home_next_goal' ? 0 : 1) ? 'won' : 'lost';
    }
    default:
      return 'unverified';
  }
}

async function getFeed(site, lang) {
  const url = new URL(`https://${site}/wp-admin/admin-ajax.php`);
  url.search = new URLSearchParams({ action: 'pv_live_refresh', lang, _: String(Date.now()) });
  const response = await fetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
  const { success, data } = await response.json();
  const timestamp = Date.parse(data?.generatedAt);
  if (!success || typeof data?.html !== 'string' || !Number.isFinite(timestamp) ||
      Date.now() - timestamp > 15 * MINUTE || timestamp - Date.now() > 2 * MINUTE) {
    throw new Error('Feed is stale or invalid');
  }
  return { generatedAt: new Date(timestamp).toISOString(), signals: parseFeed(data.html) };
}

async function reconcile(state, now) {
  const due = new Map();
  for (const record of state.records) {
    if (record.outcome !== 'pending') continue;
    if (now - Date.parse(record.firstSeenAt) >= 48 * 60 * MINUTE) {
      record.outcome = 'unverified';
      record.outcomeReason = 'no_confirmed_regulation_result';
    } else if (now - Date.parse(record.firstSeenAt) >= 30 * MINUTE &&
        (!record.lastResultCheckAt || now - Date.parse(record.lastResultCheckAt) >= 15 * MINUTE)) {
      if (!due.has(record.matchId)) due.set(record.matchId, []);
      due.get(record.matchId).push(record);
    }
  }
  for (const [key, records] of [...due].slice(0, 12)) {
    const resultUrl = `https://www.flashscore.mobi/match/${encodeURIComponent(key)}/`;
    for (const record of records) record.lastResultCheckAt = new Date(now).toISOString();
    try {
      const result = parseFinal(await fetchText(resultUrl, { timeoutMs: 7000 }));
      if (!result) continue;
      result.corners = null;
      if (records.some(record => record.market === 'match_corners_over')) {
        try {
          const $ = cheerio.load(await fetchText(`${resultUrl}?t=stats`, { timeoutMs: 7000 }));
          const stat = /SG÷(?:Corner kicks|Corners)¬SH÷(\d+)¬SI÷(\d+)/i.exec($.html());
          if (stat) result.corners = Number(stat[1]) + Number(stat[2]);
        } catch (error) {
          console.warn(`[${key}] Final corners unavailable: ${error.message}`);
        }
      }
      for (const record of records) {
        record.finalScore = result.finalScore;
        record.finalCorners = result.corners;
        record.resultUrl = resultUrl;
        record.finalObservedAt = new Date().toISOString();
        if (record.market === 'match_corners_over' && result.corners === null) continue;
        record.outcome = settle(record, result);
        if (record.outcome === 'unverified') record.outcomeReason = 'market_or_evidence_incomplete';
      }
    } catch (error) {
      console.warn(`[${key}] Final result unavailable: ${error.message}`);
    }
  }
}

async function main() {
  const file = process.env.LIVE_SIGNAL_LOG_FILE;
  if (!file || !path.isAbsolute(file)) throw new Error('Set LIVE_SIGNAL_LOG_FILE to an absolute path outside the web root.');
  const sites = process.argv.slice(2);
  if (!sites.length) sites.push(...Object.keys(SITES));
  if (sites.some(site => !Object.hasOwn(SITES, site))) throw new Error('Pass only pariuverde.ro or greenbettips.com.');
  let state;
  try {
    state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.records) || !state.lastFeed) throw new Error('Invalid history format');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { version: 1, lastFeed: {}, records: [] };
  }
  const updates = await Promise.allSettled(sites.map(site => getFeed(site, SITES[site])));
  updates.forEach((update, index) => {
    const site = sites[index];
    if (update.status === 'fulfilled') {
      observe(state, site, update.value.generatedAt, update.value.signals);
      console.log(`[${site}] ${update.value.signals.length} published signals in snapshot ${update.value.generatedAt}`);
    } else {
      console.warn(`[${site}] ${update.reason.message}`);
      process.exitCode = 1;
    }
  });
  // Preserve observations before potentially slow result lookups.
  await writeJsonAtomic(file, state);
  await reconcile(state, Date.now());
  await writeJsonAtomic(file, state);
  console.log(`[history] ${state.records.length} visibility intervals stored`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
