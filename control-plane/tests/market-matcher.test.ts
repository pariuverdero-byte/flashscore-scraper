import { describe, expect, it } from "vitest";
import { chooseMarket } from "../worker/market-matcher";
import type { ExecutionIntent } from "../worker/types";

const base: ExecutionIntent = {
  id: "live:test",
  kind: "live",
  eventName: "Ivory Coast – Ghana",
  marketText: "Over/Under 2.5 Goals",
  selectionText: "Over 2.5 Goals",
  createdAt: "2026-09-24T20:38:20.935Z",
};

describe("Betfair market matcher", () => {
  it("does not invert an Over selection when Under is the first runner", () => {
    const result = chooseMarket(base, [{
      marketId: "1.2",
      marketName: "Over/Under 2.5 Goals",
      event: { name: "Ivory Coast v Ghana" },
      runners: [
        { selectionId: 10, runnerName: "Under 2.5 Goals" },
        { selectionId: 20, runnerName: "Over 2.5 Goals" },
      ],
    }]);

    expect(result?.runner).toMatchObject({ selectionId: 20, runnerName: "Over 2.5 Goals" });
  });

  it("matches a next-goal team independently from the market name", () => {
    const result = chooseMarket({ ...base, marketText: "Next Goal", selectionText: "Ivory Coast" }, [{
      marketId: "1.3",
      marketName: "Next Goal",
      event: { name: "Ivory Coast v Ghana" },
      runners: [
        { selectionId: 30, runnerName: "Ghana" },
        { selectionId: 40, runnerName: "Ivory Coast" },
        { selectionId: 50, runnerName: "No Goal" },
      ],
    }]);

    expect(result?.runner).toMatchObject({ selectionId: 40, runnerName: "Ivory Coast" });
  });

  it("rejects a market when the displayed runner is unavailable", () => {
    const result = chooseMarket(base, [{
      marketId: "1.4",
      marketName: "Over/Under 2.5 Goals",
      event: { name: "Ivory Coast v Ghana" },
      runners: [{ selectionId: 10, runnerName: "Under 2.5 Goals" }],
    }]);

    expect(result).toBeNull();
  });
});
