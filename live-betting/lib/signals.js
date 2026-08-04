import { LIVE_CONFIG } from '../config/live.config.js';
import { calculatePressure } from './pressure.js';
import { clamp, nowIso, stableSignalId } from './utils.js';

const TEXT = {
  ro: {
    over05: ['Peste 0.5 goluri până la final', 'Ritm ofensiv ridicat și suficiente ocazii pentru încă un gol.'],
    over15: ['Peste 1.5 goluri în meci', 'Volumul ofensiv susține cel puțin două goluri în total.'],
    homeNext: ['Gazdele marchează următorul gol', 'Gazdele controlează clar presiunea ofensivă.'],
    awayNext: ['Oaspeții marchează următorul gol', 'Oaspeții controlează clar presiunea ofensivă.'],
    corners: ['Peste cornere live', 'Ritmul și numărul actual de cornere indică valoare pe linia următoare.'],
  },
  en: {
    over05: ['Over 0.5 goals until full time', 'High attacking intensity and enough chances for another goal.'],
    over15: ['Over 1.5 match goals', 'The attacking volume supports at least two total goals.'],
    homeNext: ['Home team to score next', 'The home side clearly controls the attacking pressure.'],
    awayNext: ['Away team to score next', 'The away side clearly controls the attacking pressure.'],
    corners: ['Live corners over', 'The tempo and current corner count support the next line.'],
  },
};

function localized(key) {
  return {
    title: { ro: TEXT.ro[key][0], en: TEXT.en[key][0] },
    reason: { ro: TEXT.ro[key][1], en: TEXT.en[key][1] },
  };
}

function signal(match, type, key, confidence, extra = {}) {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + LIVE_CONFIG.signalTtlMinutes * 60000).toISOString();
  return {
    id: stableSignalId(match.id, type, match.minute),
    matchId: match.id,
    type,
    minute: match.minute,
    scoreAtSignal: match.score,
    confidence: Math.round(clamp(confidence, 0, 99)),
    ...localized(key),
    ...extra,
    createdAt,
    expiresAt,
    status: 'active',
  };
}

export function generateSignals(match, previous = null) {
  const minute = Number(match.minute);
  if (!match.statsAvailable || !Number.isFinite(minute) || minute < LIVE_CONFIG.minMinute || minute > LIVE_CONFIG.maxMinute) return [];
  const p = calculatePressure(match, previous);
  const goals = Number(match.score?.home || 0) + Number(match.score?.away || 0);
  const redCards = Number(match.stats.home.redCards || 0) + Number(match.stats.away.redCards || 0);
  const output = [];

  if (minute >= 52 && minute <= 82 && p.totals.shots >= 12 && p.totals.shotsOnTarget >= 4 && p.intensity >= 58) {
    const confidence = 48 + p.totals.shots * 1.1 + p.totals.shotsOnTarget * 2.4 + p.totals.corners * 0.8 + p.totals.xg * 5 + p.momentum * 0.25 - redCards * 3;
    output.push(signal(match, 'goal_over_0_5_ft', 'over05', confidence, { recommendedMinimumOdd: 1.45, pressure: p }));
  }

  if (minute >= 25 && minute <= 68 && goals <= 1 && p.totals.shots >= 10 && p.totals.shotsOnTarget >= 3 && p.intensity >= 52) {
    const confidence = 45 + p.totals.shots * 1.15 + p.totals.shotsOnTarget * 2.2 + p.totals.xg * 6 + p.totals.corners * 0.7;
    output.push(signal(match, 'goal_over_1_5_match', 'over15', confidence, { recommendedMinimumOdd: 1.55, pressure: p }));
  }

  if (minute >= 35 && minute <= 80 && Math.max(p.homeShare, p.awayShare) >= 68 && p.totals.shotsOnTarget >= 3) {
    const isHome = p.homeShare > p.awayShare;
    const confidence = 42 + Math.max(p.homeShare, p.awayShare) * 0.42 + p.totals.shotsOnTarget * 2 + p.momentum * 0.3;
    output.push(signal(match, isHome ? 'home_next_goal' : 'away_next_goal', isHome ? 'homeNext' : 'awayNext', confidence, { recommendedMinimumOdd: 1.75, pressure: p }));
  }

  if (minute >= 48 && minute <= 78 && p.totals.corners >= 5 && p.totals.shots >= 12) {
    const projected = Math.max(p.totals.corners + 1.5, (p.totals.corners / minute) * 92);
    const line = Math.floor(projected - 0.5) + 0.5;
    if (line > p.totals.corners) {
      const confidence = 48 + p.totals.corners * 2.3 + p.totals.shots * 0.8 + p.momentum * 0.25;
      output.push(signal(match, 'corners_over', 'corners', confidence, { line, recommendedMinimumOdd: 1.55, pressure: p }));
    }
  }

  return output
    .filter((item) => item.confidence >= LIVE_CONFIG.minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, LIVE_CONFIG.maxSignalsPerMatch);
}
