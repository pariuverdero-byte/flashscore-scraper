import { describe, expect, it } from "vitest";
import { defaultConfig } from "../lib/config";
import { assess, type DailyLedger } from "../worker/risk";

const candidate = { id: "one", kind: "live" as const, eventName: "A v B", marketText: "Over/Under 0.5 Goals", selectionText: "Over 0.5 Goals", createdAt: "2026-08-26T10:00:00.000Z", confidence: 80, minute: 60, marketId: "1.1", selectionId: 1, availableOdds: 2, betDelaySeconds: 5 };
const ledger = (): DailyLedger => ({ date: "2026-08-26", pnl: 0, bets: 0, signalIds: new Set() });

describe("risk assessment", () => {
  it("accepts a fresh candidate within limits", () => expect(assess(candidate, { ...defaultConfig, enabled: true }, ledger(), new Date("2026-08-26T10:00:20Z")).allowed).toBe(true));
  it("blocks after maximum daily loss", () => { const state = ledger(); state.pnl = -50; expect(assess(candidate, { ...defaultConfig, enabled: true }, state, new Date("2026-08-26T10:00:20Z")).reason).toMatch(/loss/); });
  it("blocks real-money execution after daily take-profit", () => { const state = ledger(); state.pnl = 100; expect(assess(candidate, { ...defaultConfig, enabled: true }, state, new Date("2026-08-26T10:00:20Z"), true).reason).toMatch(/take-profit/); });
  it("keeps dry-run calibration running after simulated take-profit", () => { const state = ledger(); state.pnl = 100; expect(assess(candidate, { ...defaultConfig, enabled: true }, state, new Date("2026-08-26T10:00:20Z"), false)).toEqual({ allowed: true, reason: "within controls" }); });
  it("keeps dry-run calibration running after simulated daily loss", () => { const state = ledger(); state.pnl = -100; expect(assess(candidate, { ...defaultConfig, enabled: true }, state, new Date("2026-08-26T10:00:20Z"), false)).toEqual({ allowed: true, reason: "within controls" }); });
  it("blocks duplicate tickets", () => { const state = ledger(); state.signalIds.add("one"); expect(assess(candidate, { ...defaultConfig, enabled: true }, state, new Date("2026-08-26T10:00:20Z")).reason).toMatch(/duplicate/); });
});
