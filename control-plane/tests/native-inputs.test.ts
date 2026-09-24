import { describe, expect, it } from "vitest";
import { __test } from "../worker/native-inputs";

describe("native live signal mapping", () => {
  const match = { id: "abc", teams: "Team A – Team B", home: "Team A", away: "Team B" };
  it("maps another-goal signal to the score-dependent Betfair line", () => {
    expect(__test.liveMarket({ id: "s", matchId: "abc", type: "goal_over_0_5_ft", status: "active", createdAt: "2026-01-01T00:00:00Z", scoreAtSignal: { home: 1, away: 0 } }, match)).toEqual({ marketText: "Over/Under 1.5 Goals", selectionText: "Over 1.5 Goals" });
  });
  it("maps next-goal runner to the native home team", () => {
    expect(__test.liveMarket({ id: "s", matchId: "abc", type: "home_next_goal", status: "active", createdAt: "2026-01-01T00:00:00Z" }, match)?.selectionText).toBe("Team A");
  });
});
