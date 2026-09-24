import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __test, nativeIntentsFromData, readNativeIntents } from "../worker/native-inputs";

describe("native live signal mapping", () => {
  const match = { id: "abc", teams: "Team A – Team B", home: "Team A", away: "Team B" };
  it("maps another-goal signal to the score-dependent Betfair line", () => {
    expect(__test.liveMarket({ id: "s", matchId: "abc", type: "goal_over_0_5_ft", status: "active", createdAt: "2026-01-01T00:00:00Z", scoreAtSignal: { home: 1, away: 0 } }, match)).toEqual({ marketText: "Over/Under 1.5 Goals", selectionText: "Over 1.5 Goals" });
  });
  it("maps next-goal runner to the native home team", () => {
    expect(__test.liveMarket({ id: "s", matchId: "abc", type: "home_next_goal", status: "active", createdAt: "2026-01-01T00:00:00Z" }, match)?.selectionText).toBe("Team A");
  });

  it("uses the same mapping for remotely published native payloads", () => {
    const now = new Date();
    const intents = nativeIntentsFromData(
      { matches: [match] },
      [{ id: "remote-signal", matchId: "abc", type: "goal_over_1_5_match", status: "active", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), confidence: 81, minute: 55 }],
      {},
    );
    expect(intents).toMatchObject([{ id: "live:remote-signal", kind: "live", eventName: "Team A – Team B", selectionText: "Over 1.5 Goals" }]);
  });
});

describe("native daily ticket mapping", () => {
  it("reads both Cota 2 and Biletul zilei from the generated tickets file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "liveedge-tickets-"));
    try {
      await writeFile(path.join(root, "tickets.json"), JSON.stringify({
        date: "2026-09-24",
        status: "ok",
        bilet_cota2: { selections: [{ match_id: "m1", teams: "Home A - Away A", market_raw: "Peste 1.5 goluri", odd: 1.42 }] },
        biletul_zilei: { selections: [{ match_id: "m2", teams: "Home B - Away B", market_raw: "Ambele echipe marcheaza", odd: 1.75 }] },
      }));

      const intents = await readNativeIntents(root);
      expect(intents).toHaveLength(2);
      expect(intents.map((intent) => [intent.kind, intent.eventName, intent.marketText])).toEqual([
        ["ticket", "Home A - Away A", "Peste 1.5 goluri"],
        ["ticket", "Home B - Away B", "Ambele echipe marcheaza"],
      ]);
      expect(intents.every((intent) => intent.id.startsWith("ticket:"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
