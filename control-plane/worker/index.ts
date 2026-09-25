import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { BetfairClient } from "./betfair";
import { nativeIntentsFromData, readNativeIntents } from "./native-inputs";
import { assess, liveInterlockEnabled, type DailyLedger } from "./risk";
import type { BettingConfig } from "../lib/config";
import type { WorkerCheck } from "../lib/store";

const controlUrl = process.env.CONTROL_PLANE_URL ?? "http://localhost:3000";
const token = required("CONTROL_API_TOKEN");
const repositoryRoot = path.resolve(process.env.REPOSITORY_ROOT ?? "..");
const stateFile = path.join(process.cwd(), "worker-state.json");
const live = liveInterlockEnabled();
const ledger: DailyLedger = { date: today(), pnl: 0, bets: 0, signalIds: new Set<string>() };
const dryRunSeen = new Set<string>();
const recentChecks = new Map<string, WorkerCheck>();
let client: BetfairClient | null = null;

type RemoteInputs = {
  live: { payload?: { liveMatches?: Parameters<typeof nativeIntentsFromData>[0]; liveSignals?: Parameters<typeof nativeIntentsFromData>[1] } } | null;
  tickets: { payload?: { tickets?: Parameters<typeof nativeIntentsFromData>[2] } } | null;
};
type SimulatedTransaction = { intent_id: string; betfair_market_id: string; betfair_selection_id: number; available_odds: number; stake: number };
type PnlResponse = { simulated?: { today?: number } };

async function readProcessed(): Promise<string[]> {
  try { const body = JSON.parse(await readFile(stateFile, "utf8")) as { date?: string; ids?: string[] }; return body.date === today() ? body.ids ?? [] : []; }
  catch { return []; }
}
async function persistProcessed() { await writeFile(stateFile, JSON.stringify({ date: ledger.date, ids: [...ledger.signalIds] }, null, 2)); }
async function control<T>(route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${controlUrl}${route}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error(`Control plane ${route}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function cycle() {
  if (ledger.date !== today()) { ledger.date = today(); ledger.pnl = 0; ledger.bets = 0; ledger.signalIds.clear(); await persistProcessed(); }
  const config = await control<BettingConfig>("/api/config");
  let message = config.enabled ? "No actionable native output." : "Paused from dashboard.";
  if (config.enabled) {
    client ??= new BetfairClient(required("BETFAIR_APP_KEY"));
    if (!client.isAuthenticated()) await client.login();
    if (live) {
      ledger.pnl = await client.getSettledPnlToday();
      await control("/api/transactions", { method: "PATCH", body: JSON.stringify({ settlements: await client.getSettlementsToday() }) });
    }
    else {
      await settleSimulations(client);
      ledger.pnl = Number((await control<PnlResponse>("/api/pnl")).simulated?.today ?? 0);
    }
    const [localIntents, remote] = await Promise.all([
      readNativeIntents(repositoryRoot),
      control<RemoteInputs>("/api/inputs"),
    ]);
    const remoteIntents = nativeIntentsFromData(
      remote.live?.payload?.liveMatches,
      remote.live?.payload?.liveSignals,
      remote.tickets?.payload?.tickets,
    );
    const intents = [...new Map([...localIntents, ...remoteIntents].map((intent) => [intent.id, intent])).values()];
    for (const intent of intents) {
      if (ledger.signalIds.has(intent.id)) continue;
      if (!live && dryRunSeen.has(intent.id)) continue;
      try {
        const candidate = await client.resolveIntent(intent);
        if (!candidate) {
          message = `${intent.eventName}: Betfair mapping rejected as missing or ambiguous`;
          recordCheck(intent, "missing_or_ambiguous", "Betfair market missing or ambiguous", null);
          continue;
        }
        const decision = assess(candidate, config, ledger);
        if (!decision.allowed) {
          message = `${intent.eventName}: ${decision.reason}`;
          recordCheck(intent, "rejected", decision.reason, candidate.availableOdds, candidate);
          continue;
        }
        if (live) {
          const placed = await client.placeBack(candidate, config.stakePerBet);
          await control("/api/transactions", { method: "POST", body: JSON.stringify({ intentId: intent.id, kind: intent.kind, eventName: intent.eventName, marketText: intent.marketText, selectionText: intent.selectionText, confidence: intent.confidence, requestedOdds: intent.recommendedMinimumOdds, availableOdds: candidate.availableOdds, stake: config.stakePerBet, marketId: candidate.marketId, selectionId: candidate.selectionId, betId: placed.betId, raw: placed.raw }) });
          ledger.bets += 1;
          message = `Submitted ${intent.kind} single: ${intent.eventName} @ ${candidate.availableOdds}`;
          recordCheck(intent, "submitted", "order submitted", candidate.availableOdds, candidate);
        }
        else {
          message = `DRY RUN ${intent.kind}: ${intent.eventName} @ ${candidate.availableOdds}`;
          dryRunSeen.add(intent.id);
          await control("/api/transactions", { method: "POST", body: JSON.stringify({ intentId: intent.id, kind: intent.kind, eventName: intent.eventName, marketText: intent.marketText, selectionText: intent.selectionText, confidence: intent.confidence, requestedOdds: intent.recommendedMinimumOdds, availableOdds: candidate.availableOdds, stake: config.stakePerBet, marketId: candidate.marketId, selectionId: candidate.selectionId, status: "simulated_open", raw: { simulation: true, betDelaySeconds: candidate.betDelaySeconds } }) });
          ledger.bets += 1;
          recordCheck(intent, "matched", "eligible in dry-run", candidate.availableOdds, candidate);
        }
        if (live) {
          ledger.signalIds.add(intent.id);
          await persistProcessed();
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        message = `${intent.eventName}: ${reason}`;
        recordCheck(intent, "error", reason, null);
      }
    }
  }
  await control("/api/status", { method: "POST", body: JSON.stringify({ lastHeartbeat: new Date().toISOString(), mode: live ? "live" : "dry-run", pnlToday: ledger.pnl, betsToday: ledger.bets, lastMessage: message, recentChecks: [...recentChecks.values()].slice(-100) }) });
}

async function settleSimulations(betfair: BetfairClient) {
  const open = await control<SimulatedTransaction[]>("/api/transactions?status=simulated_open");
  if (!open.length) return;
  const outcomes = await betfair.getMarketOutcomes([...new Set(open.map((item) => item.betfair_market_id))]);
  const byMarket = new Map(outcomes.map((market) => [market.marketId, market]));
  const simulatedSettlements = open.flatMap((item) => {
    const market = byMarket.get(item.betfair_market_id);
    if (market?.status !== "CLOSED") return [];
    const runner = market.runners.find((entry) => Number(entry.selectionId) === Number(item.betfair_selection_id));
    const status = runner?.status === "WINNER" ? "simulated_won" : runner?.status === "LOSER" ? "simulated_lost" : "simulated_void";
    const profit = status === "simulated_won" ? Number(item.stake) * (Number(item.available_odds) - 1) : status === "simulated_lost" ? -Number(item.stake) : 0;
    return [{ intentId: item.intent_id, status, profit: Math.round(profit * 100) / 100, settledAt: new Date().toISOString() }];
  });
  if (simulatedSettlements.length) await control("/api/transactions", { method: "PATCH", body: JSON.stringify({ simulatedSettlements }) });
}

function recordCheck(intent: { id: string; kind: "live" | "ticket"; eventName: string; selectionText: string }, result: WorkerCheck["result"], reason: string, availableOdds: number | null, candidate?: { marketId: string; selectionId: number }) {
  recentChecks.set(intent.id, { ...intent, result, reason, availableOdds, marketId: candidate?.marketId, selectionId: candidate?.selectionId, checkedAt: new Date().toISOString() });
}

async function main() {
  ledger.signalIds = new Set(await readProcessed());
  if (process.argv.includes("--once")) {
    await cycle();
    return;
  }
  const interval = Math.max(5000, Number(process.env.POLL_INTERVAL_MS ?? 15000));
  for (;;) { try { await cycle(); } catch (error) { console.error(new Date().toISOString(), error); } await new Promise((resolve) => setTimeout(resolve, interval)); }
}
function today() { return new Date().toISOString().slice(0, 10); }
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
void main();

