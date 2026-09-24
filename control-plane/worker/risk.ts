import type { BettingConfig } from "../lib/config";
import type { BetCandidate } from "./types";

export type DailyLedger = { date: string; pnl: number; bets: number; signalIds: Set<string> };

export function assess(candidate: BetCandidate, config: BettingConfig, ledger: DailyLedger, now = new Date()): { allowed: boolean; reason: string } {
  if (!config.enabled) return { allowed: false, reason: "automation paused" };
  if (ledger.pnl <= -config.maxDailyLoss) return { allowed: false, reason: "daily loss limit reached" };
  if (ledger.pnl >= config.dailyTakeProfit) return { allowed: false, reason: "daily take-profit reached" };
  const minimumOdds = Math.max(candidate.kind === "live" ? config.minLiveOdds : 1.01, candidate.recommendedMinimumOdds ?? 1.01);
  if (candidate.availableOdds < minimumOdds) return { allowed: false, reason: "odds below minimum" };
  if (ledger.signalIds.has(candidate.id)) return { allowed: false, reason: "duplicate signal" };
  const ageSeconds = (now.getTime() - new Date(candidate.createdAt).getTime()) / 1000;
  if (candidate.kind === "live" && ageSeconds > config.maxSignalAgeSeconds) return { allowed: false, reason: "stale signal" };
  if (candidate.kind === "live" && Number(candidate.confidence ?? 0) < config.minLiveConfidence) return { allowed: false, reason: "confidence below minimum" };
  if (candidate.kind === "live" && Number(candidate.minute ?? 0) < config.liveMinMinute) return { allowed: false, reason: "before configured live window" };
  if (candidate.kind === "live" && Number(candidate.minute ?? 0) > config.liveMaxMinute) return { allowed: false, reason: "after configured live window" };
  return { allowed: true, reason: "within controls" };
}

export function liveInterlockEnabled(): boolean {
  return process.env.LIVE_BETTING_ENABLED === "true" && process.env.LIVE_BETTING_ACK === "I_ACCEPT_LIVE_BETTING_RISK";
}
