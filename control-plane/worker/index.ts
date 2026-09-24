import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { BetfairClient } from "./betfair";
import { readNativeIntents } from "./native-inputs";
import { assess, liveInterlockEnabled, type DailyLedger } from "./risk";
import type { BettingConfig } from "../lib/config";

const controlUrl = process.env.CONTROL_PLANE_URL ?? "http://localhost:3000";
const token = required("CONTROL_API_TOKEN");
const repositoryRoot = path.resolve(process.env.REPOSITORY_ROOT ?? "..");
const stateFile = path.join(process.cwd(), "worker-state.json");
const live = liveInterlockEnabled();
const ledger: DailyLedger = { date: today(), pnl: 0, bets: 0, signalIds: new Set<string>() };
const dryRunSeen = new Set<string>();
let client: BetfairClient | null = null;

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
    ledger.pnl = await client.getSettledPnlToday();
    await control("/api/transactions", { method: "PATCH", body: JSON.stringify({ settlements: await client.getSettlementsToday() }) });
    for (const intent of await readNativeIntents(repositoryRoot)) {
      if (ledger.signalIds.has(intent.id)) continue;
      if (!live && dryRunSeen.has(intent.id)) continue;
      const candidate = await client.resolveIntent(intent);
      if (!candidate) { message = `${intent.eventName}: Betfair mapping rejected as missing or ambiguous`; continue; }
      const decision = assess(candidate, config, ledger);
      if (!decision.allowed) { message = `${intent.eventName}: ${decision.reason}`; continue; }
      if (live) {
        const placed = await client.placeBack(candidate, config.stakePerBet);
        await control("/api/transactions", { method: "POST", body: JSON.stringify({ intentId: intent.id, kind: intent.kind, eventName: intent.eventName, marketText: intent.marketText, selectionText: intent.selectionText, confidence: intent.confidence, requestedOdds: intent.recommendedMinimumOdds, availableOdds: candidate.availableOdds, stake: config.stakePerBet, marketId: candidate.marketId, selectionId: candidate.selectionId, betId: placed.betId, raw: placed.raw }) });
        ledger.bets += 1; message = `Submitted ${intent.kind} single: ${intent.eventName} @ ${candidate.availableOdds}`;
      }
      else {
        message = `DRY RUN ${intent.kind}: ${intent.eventName} @ ${candidate.availableOdds}`;
        dryRunSeen.add(intent.id);
      }
      if (live) {
        ledger.signalIds.add(intent.id);
        await persistProcessed();
      }
    }
  }
  await control("/api/status", { method: "POST", body: JSON.stringify({ lastHeartbeat: new Date().toISOString(), mode: live ? "live" : "dry-run", pnlToday: ledger.pnl, betsToday: ledger.bets, lastMessage: message }) });
}

async function main() {
  ledger.signalIds = new Set(await readProcessed());
  const interval = Math.max(5000, Number(process.env.POLL_INTERVAL_MS ?? 15000));
  for (;;) { try { await cycle(); } catch (error) { console.error(new Date().toISOString(), error); } await new Promise((resolve) => setTimeout(resolve, interval)); }
}
function today() { return new Date().toISOString().slice(0, 10); }
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
void main();
