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

export function chooseMarket(intent: ExecutionIntent, markets: CatalogueMarket[]): { market: CatalogueMarket; runner: NonNullable<CatalogueMarket["runners"]>[number]; confidence: number } | null {
  const desired = tokens(`${intent.marketText} ${intent.selectionText}`);
  let best: { market: CatalogueMarket; runner: NonNullable<CatalogueMarket["runners"]>[number]; confidence: number } | null = null;
  for (const market of markets) {
    for (const runner of market.runners ?? []) {
      const eventScore = overlap(tokens(intent.eventName), market.event?.name ?? "");
      const selectionScore = overlap(desired, `${market.marketName} ${runner.runnerName}`);
      const confidence = eventScore * 0.45 + selectionScore * 0.55;
      if (!best || confidence > best.confidence) best = { market, runner, confidence };
    }
  }
  return best && best.confidence >= 0.72 ? best : null;
}
