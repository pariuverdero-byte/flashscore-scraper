import { LIVE_CONFIG } from '../config/live.config.js';
import { calculatePressure } from './pressure.js';
import { clamp, nowIso, stableSignalId } from './utils.js';

const TEXT = {
  ro: {
    over05: [
      'Peste 0.5 goluri până la final',
      'Ritmul ofensiv și numărul ocaziilor susțin apariția unui nou gol.',
    ],
    over15: [
      'Peste 1.5 goluri în meci',
      'Volumul ofensiv susține cel puțin două goluri până la final.',
    ],
    homeNext: [
      'Gazdele marchează următorul gol',
      'Gazdele controlează clar presiunea ofensivă.',
    ],
    awayNext: [
      'Oaspeții marchează următorul gol',
      'Oaspeții controlează clar presiunea ofensivă.',
    ],
    corners: [
      'Peste cornere live',
      'Ritmul meciului și numărul actual de cornere susțin depășirea liniei indicate.',
    ],
  },

  en: {
    over05: [
      'Over 0.5 goals until full time',
      'The attacking tempo and chance volume support another goal.',
    ],
    over15: [
      'Over 1.5 match goals',
      'The attacking volume supports at least two total goals.',
    ],
    homeNext: [
      'Home team to score next',
      'The home side clearly controls the attacking pressure.',
    ],
    awayNext: [
      'Away team to score next',
      'The away side clearly controls the attacking pressure.',
    ],
    corners: [
      'Live corners over',
      'The match tempo and current corner count support the indicated line.',
    ],
  },
};

function localized(key) {
  return {
    title: {
      ro: TEXT.ro[key][0],
      en: TEXT.en[key][0],
    },
    reason: {
      ro: TEXT.ro[key][1],
      en: TEXT.en[key][1],
    },
  };
}

function signal(match, type, key, confidence, extra = {}) {
  const createdAt = nowIso();

  const expiresAt = new Date(
    Date.now() + LIVE_CONFIG.signalTtlMinutes * 60_000,
  ).toISOString();

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

/**
 * Over 0.5 până la final și Over 1.5 în meci pot reprezenta
 * exact același eveniment atunci când scorul este deja 1-0 sau 0-1.
 *
 * Păstrăm un singur semnal principal din familia "total goals".
 */
function chooseBestGoalSignal(goalSignals, goals, minute) {
  if (!goalSignals.length) {
    return null;
  }

  if (goalSignals.length === 1) {
    return goalSignals[0];
  }

  const over05 = goalSignals.find(
    (item) => item.type === 'goal_over_0_5_ft',
  );

  const over15 = goalSignals.find(
    (item) => item.type === 'goal_over_1_5_match',
  );

  /*
   * La minimum un gol marcat, cele două selecții au același rezultat:
   * este necesar încă un gol.
   */
  if (goals >= 1 && over05) {
    return over05;
  }

  /*
   * La 0-0, Over 1.5 necesită două goluri.
   * Îl păstrăm doar dacă este devreme și are o încredere clară.
   */
  if (
    goals === 0 &&
    minute <= 55 &&
    over15 &&
    over15.confidence >= 80 &&
    over15.confidence >= Number(over05?.confidence || 0) - 3
  ) {
    return over15;
  }

  return [...goalSignals].sort(
    (a, b) => b.confidence - a.confidence,
  )[0];
}

export function generateSignals(match, previous = null) {
  const minute = Number(match.minute);

  if (
    !match.statsAvailable ||
    !Number.isFinite(minute) ||
    minute < LIVE_CONFIG.minMinute ||
    minute > LIVE_CONFIG.maxMinute
  ) {
    return [];
  }

  const pressure = calculatePressure(match, previous);

  const goals =
    Number(match.score?.home || 0) +
    Number(match.score?.away || 0);

  const redCards =
    Number(match.stats?.home?.redCards || 0) +
    Number(match.stats?.away?.redCards || 0);

  const goalSignals = [];
  const otherSignals = [];

  /*
   * Un gol până la final.
   */
  if (
    minute >= 52 &&
    minute <= 82 &&
    pressure.totals.shots >= 12 &&
    pressure.totals.shotsOnTarget >= 4 &&
    pressure.intensity >= 58
  ) {
    const confidence =
      48 +
      pressure.totals.shots * 1.1 +
      pressure.totals.shotsOnTarget * 2.4 +
      pressure.totals.corners * 0.8 +
      pressure.totals.xg * 5 +
      pressure.momentum * 0.25 -
      redCards * 3;

    goalSignals.push(
      signal(
        match,
        'goal_over_0_5_ft',
        'over05',
        confidence,
        {
          family: 'total_goals',
          recommendedMinimumOdd: 1.45,
          pressure,
        },
      ),
    );
  }

  /*
   * Minimum două goluri în meci.
   */
  if (
    minute >= 25 &&
    minute <= 68 &&
    goals <= 1 &&
    pressure.totals.shots >= 10 &&
    pressure.totals.shotsOnTarget >= 3 &&
    pressure.intensity >= 52
  ) {
    const confidence =
      45 +
      pressure.totals.shots * 1.15 +
      pressure.totals.shotsOnTarget * 2.2 +
      pressure.totals.xg * 6 +
      pressure.totals.corners * 0.7;

    goalSignals.push(
      signal(
        match,
        'goal_over_1_5_match',
        'over15',
        confidence,
        {
          family: 'total_goals',
          recommendedMinimumOdd: 1.55,
          pressure,
        },
      ),
    );
  }

  /*
   * Echipa care marchează următorul gol.
   */
  if (
    minute >= 35 &&
    minute <= 80 &&
    Math.max(pressure.homeShare, pressure.awayShare) >= 68 &&
    pressure.totals.shotsOnTarget >= 3
  ) {
    const isHome =
      pressure.homeShare > pressure.awayShare;

    const confidence =
      42 +
      Math.max(pressure.homeShare, pressure.awayShare) * 0.42 +
      pressure.totals.shotsOnTarget * 2 +
      pressure.momentum * 0.3;

    otherSignals.push(
      signal(
        match,
        isHome ? 'home_next_goal' : 'away_next_goal',
        isHome ? 'homeNext' : 'awayNext',
        confidence,
        {
          family: 'next_goal',
          recommendedMinimumOdd: 1.75,
          pressure,
        },
      ),
    );
  }

  /*
   * Linie de cornere.
   */
  if (
    minute >= 48 &&
    minute <= 78 &&
    pressure.totals.corners >= 5 &&
    pressure.totals.shots >= 12
  ) {
    const projectedCorners = Math.max(
      pressure.totals.corners + 1.5,
      (pressure.totals.corners / minute) * 92,
    );

    const line =
      Math.floor(projectedCorners - 0.5) + 0.5;

    if (line > pressure.totals.corners) {
      const confidence =
        48 +
        pressure.totals.corners * 2.3 +
        pressure.totals.shots * 0.8 +
        pressure.momentum * 0.25;

      otherSignals.push(
        signal(
          match,
          'corners_over',
          'corners',
          confidence,
          {
            family: 'corners',
            line,
            recommendedMinimumOdd: 1.55,
            pressure,
          },
        ),
      );
    }
  }

  const bestGoalSignal = chooseBestGoalSignal(
    goalSignals.filter(
      (item) =>
        item.confidence >= LIVE_CONFIG.minConfidence,
    ),
    goals,
    minute,
  );

  const accepted = [
    ...(bestGoalSignal ? [bestGoalSignal] : []),
    ...otherSignals.filter(
      (item) =>
        item.confidence >= LIVE_CONFIG.minConfidence,
    ),
  ];

  return accepted
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, LIVE_CONFIG.maxSignalsPerMatch);
}
