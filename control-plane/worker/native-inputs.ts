import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExecutionIntent } from "./types";

type LiveMatch = { id: string; teams?: string; home?: string; away?: string };
type LiveSignal = { id: string; matchId: string; type: string; status: string; createdAt: string; expiresAt?: string; minute?: number; line?: number; scoreAtSignal?: { home?: number; away?: number }; recommendedMinimumOdd?: number; confidence?: number };
type TicketSelection = { match_id?: string; id?: string; teams?: string; market_raw?: string; bet_text_ro?: string; odd?: number };
type TicketsFile = { date?: string; status?: string; bilet_cota2?: { selections?: TicketSelection[] }; biletul_zilei?: { selections?: TicketSelection[] } };

async function json<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return fallback; }
}

function liveMarket(signal: LiveSignal, match: LiveMatch): Pick<ExecutionIntent, "marketText" | "selectionText"> | null {
  const totalGoals = Number(signal.scoreAtSignal?.home ?? 0) + Number(signal.scoreAtSignal?.away ?? 0);
  if (signal.type === "goal_over_0_5_ft") return { marketText: `Over/Under ${totalGoals + 0.5} Goals`, selectionText: `Over ${totalGoals + 0.5} Goals` };
  if (signal.type === "goal_over_1_5_match") return { marketText: "Over/Under 1.5 Goals", selectionText: "Over 1.5 Goals" };
  if (signal.type === "home_next_goal") return { marketText: "Next Goal", selectionText: match.home ?? match.teams?.split(/\s+[–—-]\s+/)[0] ?? "" };
  if (signal.type === "away_next_goal") return { marketText: "Next Goal", selectionText: match.away ?? match.teams?.split(/\s+[–—-]\s+/)[1] ?? "" };
  if (signal.type === "corners_over" && Number.isFinite(signal.line)) return { marketText: `Over/Under ${signal.line} Corners`, selectionText: `Over ${signal.line} Corners` };
  return null;
}

export async function readNativeIntents(repositoryRoot: string): Promise<ExecutionIntent[]> {
  const dataDir = path.join(repositoryRoot, "live-betting", "data");
  const liveMatches = await json<{ matches?: LiveMatch[] }>(path.join(dataDir, "live_matches.json"), {});
  const liveSignals = await json<LiveSignal[]>(path.join(dataDir, "signals.json"), []);
  const tickets = await json<TicketsFile>(path.join(repositoryRoot, "tickets.json"), {});
  return nativeIntentsFromData(liveMatches, liveSignals, tickets);
}

export function nativeIntentsFromData(liveMatches: { matches?: LiveMatch[] } = {}, liveSignals: LiveSignal[] = [], tickets: TicketsFile = {}): ExecutionIntent[] {
  const matches = new Map((liveMatches.matches ?? []).map((match) => [match.id, match]));
  const now = Date.now();
  const intents: ExecutionIntent[] = [];

  for (const signal of liveSignals) {
    const match = matches.get(signal.matchId);
    const mapping = match ? liveMarket(signal, match) : null;
    if (signal.status !== "active" || !match || !mapping || (signal.expiresAt && new Date(signal.expiresAt).getTime() <= now)) continue;
    intents.push({ id: `live:${signal.id}`, kind: "live", eventName: match.teams ?? `${match.home} v ${match.away}`, ...mapping, createdAt: signal.createdAt, recommendedMinimumOdds: signal.recommendedMinimumOdd, confidence: signal.confidence, minute: Number(signal.minute) || undefined });
  }

  if (tickets.status === "ok") {
    for (const [ticketType, ticket] of [["bilet_cota2", tickets.bilet_cota2], ["biletul_zilei", tickets.biletul_zilei]] as const) {
      for (const selection of ticket?.selections ?? []) {
        const marketText = selection.market_raw ?? selection.bet_text_ro ?? "";
        const rawId = `${tickets.date}|${ticketType}|${selection.match_id ?? selection.id}|${marketText}`;
        const id = `ticket:${createHash("sha256").update(rawId).digest("hex").slice(0, 24)}`;
        if (selection.teams && marketText) intents.push({ id, kind: "ticket", eventName: selection.teams, marketText, selectionText: marketText, createdAt: `${tickets.date ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`, recommendedMinimumOdds: selection.odd });
      }
    }
  }
  return intents;
}

export const __test = { liveMarket };
