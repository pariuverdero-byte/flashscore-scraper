import type { ExecutionIntent } from "./types";

export type CatalogueMarket = { marketId: string; marketName: string; event?: { name: string }; runners?: Array<{ selectionId: number; runnerName: string; handicap?: number }> };

export function normal(value: string): string {
  return value.toLocaleLowerCase("ro").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
}

function translated(value: string): string {
  return normal(value)
    .replace(/\bpeste\b/g, "over").replace(/\bsub\b/g, "under")
    .replace(/\bgoluri\b/g, "goals").replace(/\bcornere\b/g, "corners")
    .replace(/\bambele echipe marcheaza\b|\bambele marcheaza\b|\bbtts\b|\bgg\b/g, "both teams to score")
    .replace(/\bsansa dubla\b/g, "double chance").replace(/\begal\b/g, "draw")
    .replace(/\bvictorie\b/g, "win");
}

function tokens(value: string): string[] { return translated(value).split(" ").filter((token) => token.length > 1 || /^[12x]$/.test(token)); }
function overlap(needle: string[], haystack: string): number { const hay = new Set(tokens(haystack)); return needle.length ? needle.filter((token) => hay.has(token)).length / needle.length : 0; }

function textScore(expected: string, actual: string): number {
  if (translated(expected) === translated(actual)) return 1;
  return overlap(tokens(expected), actual);
}

export function chooseMarket(intent: ExecutionIntent, markets: CatalogueMarket[]): { market: CatalogueMarket; runner: NonNullable<CatalogueMarket["runners"]>[number]; confidence: number } | null {
  let best: { market: CatalogueMarket; runner: NonNullable<CatalogueMarket["runners"]>[number]; confidence: number } | null = null;
  for (const market of markets) {
    const eventScore = textScore(intent.eventName, market.event?.name ?? "");
    const marketScore = textScore(intent.marketText, market.marketName);
    if (eventScore < 0.7 || marketScore < 0.65) continue;
    for (const runner of market.runners ?? []) {
      // Score the runner independently. Including the market name here makes
      // both sides of an Over/Under market appear to contain "over" and can
      // silently invert the simulated selection.
      const selectionScore = textScore(intent.selectionText, runner.runnerName);
      if (selectionScore < 0.8) continue;
      const confidence = eventScore * 0.4 + marketScore * 0.3 + selectionScore * 0.3;
      if (!best || confidence > best.confidence) best = { market, runner, confidence };
    }
  }
  return best && best.confidence >= 0.72 ? best : null;
}
