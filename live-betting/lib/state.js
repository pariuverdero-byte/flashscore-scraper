import { LIVE_CONFIG } from '../config/live.config.js';
import { minutesBetween } from './utils.js';

export function mergeSignals(existing = [], generated = [], now = new Date()) {
  const updatedExisting = existing.map((signal) => {
    if (signal.status === 'active' && new Date(signal.expiresAt) <= now) return { ...signal, status: 'expired' };
    return signal;
  });

  const active = updatedExisting.filter((signal) => signal.status === 'active');
  const accepted = [];
  for (const candidate of generated) {
    if (active.some((signal) => signal.id === candidate.id)) continue;
    const sameType = [...active, ...accepted].find((signal) => signal.matchId === candidate.matchId && signal.type === candidate.type);
    if (sameType && minutesBetween(sameType.createdAt, candidate.createdAt) < LIVE_CONFIG.cooldownMinutes) continue;
    const perMatch = [...active, ...accepted].filter((signal) => signal.matchId === candidate.matchId).length;
    if (perMatch >= LIVE_CONFIG.maxSignalsPerMatch) continue;
    accepted.push(candidate);
  }
  return [...updatedExisting, ...accepted];
}

export function settleSignals(signals = [], matches = []) {
  const byId = new Map(matches.map((match) => [match.id, match]));
  return signals.map((signal) => {
    if (signal.status !== 'active') return signal;
    const match = byId.get(signal.matchId);
    if (!match) return signal;
    const currentGoals = Number(match.score?.home || 0) + Number(match.score?.away || 0);
    const initialGoals = Number(signal.scoreAtSignal?.home || 0) + Number(signal.scoreAtSignal?.away || 0);
    if (signal.type === 'goal_over_0_5_ft' && currentGoals > initialGoals) return { ...signal, status: 'won', settledAt: new Date().toISOString() };
    if (signal.type === 'goal_over_1_5_match' && currentGoals >= 2) return { ...signal, status: 'won', settledAt: new Date().toISOString() };
    if (signal.type === 'home_next_goal' && Number(match.score.home) > Number(signal.scoreAtSignal.home)) return { ...signal, status: 'won', settledAt: new Date().toISOString() };
    if (signal.type === 'away_next_goal' && Number(match.score.away) > Number(signal.scoreAtSignal.away)) return { ...signal, status: 'won', settledAt: new Date().toISOString() };
    if (signal.type === 'corners_over') {
      const corners = Number(match.stats.home.corners || 0) + Number(match.stats.away.corners || 0);
      if (corners > Number(signal.line)) return { ...signal, status: 'won', settledAt: new Date().toISOString() };
    }
    if (match.status === 'finished') return { ...signal, status: 'lost', settledAt: new Date().toISOString() };
    return signal;
  });
}
