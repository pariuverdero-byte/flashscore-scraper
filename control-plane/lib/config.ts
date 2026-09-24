import { z } from "zod";

export const bettingConfigSchema = z.object({
  stakePerBet: z.number().min(2).max(10_000),
  minLiveOdds: z.number().min(1.01).max(1000),
  maxDailyLoss: z.number().min(2).max(100_000),
  dailyTakeProfit: z.number().min(2).max(100_000),
  maxSignalAgeSeconds: z.number().int().min(5).max(600),
  minLiveConfidence: z.number().min(0).max(99),
  liveMinMinute: z.number().int().min(1).max(89),
  liveMaxMinute: z.number().int().min(2).max(120),
  algorithmAutopilot: z.boolean(),
  approvalWindowDays: z.number().int().min(1).max(5),
  enabled: z.boolean(),
});

export type BettingConfig = z.infer<typeof bettingConfigSchema>;

export const defaultConfig: BettingConfig = {
  stakePerBet: 5,
  minLiveOdds: 1.5,
  maxDailyLoss: 50,
  dailyTakeProfit: 100,
  maxSignalAgeSeconds: 45,
  minLiveConfidence: 72,
  liveMinMinute: 12,
  liveMaxMinute: 88,
  algorithmAutopilot: false,
  approvalWindowDays: 5,
  enabled: false,
};
