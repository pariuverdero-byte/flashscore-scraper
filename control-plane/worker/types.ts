export type ExecutionIntent = {
  id: string;
  kind: "live" | "ticket";
  eventName: string;
  marketText: string;
  selectionText: string;
  createdAt: string;
  recommendedMinimumOdds?: number;
  confidence?: number;
  minute?: number;
};

export type BetCandidate = ExecutionIntent & {
  marketId: string;
  selectionId: number;
  availableOdds: number;
  betDelaySeconds: number;
};
