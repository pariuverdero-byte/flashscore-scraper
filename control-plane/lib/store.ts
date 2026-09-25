import { defaultConfig, type BettingConfig } from "@/lib/config";
import { ensureSchema, getSql } from "@/lib/db";

const CONFIG_KEY = "live-betting:config";
const STATUS_KEY = "live-betting:status";
const NATIVE_LIVE_KEY = "native-input:live";
const NATIVE_TICKETS_KEY = "native-input:tickets";

export type WorkerStatus = {
  lastHeartbeat: string | null;
  mode: "dry-run" | "live";
  pnlToday: number;
  betsToday: number;
  lastMessage: string;
  recentChecks?: WorkerCheck[];
};

export type WorkerCheck = {
  id: string;
  kind: "live" | "ticket";
  eventName: string;
  selectionText: string;
  result: "matched" | "rejected" | "missing_or_ambiguous" | "submitted" | "error";
  reason: string;
  availableOdds: number | null;
  checkedAt: string;
  minute?: number;
  confidence?: number;
  marketId?: string;
  selectionId?: number;
};

export type NativeInputSnapshot = {
  receivedAt: string;
  payload: unknown;
};

const defaultStatus: WorkerStatus = {
  lastHeartbeat: null,
  mode: "dry-run",
  pnlToday: 0,
  betsToday: 0,
  lastMessage: "Worker has not connected yet.",
};

async function readState<T>(key: string): Promise<T | null> {
  await ensureSchema();
  const rows = await getSql()`SELECT value FROM app_state WHERE state_key = ${key}`;
  return rows[0]?.value ? (rows[0].value as T) : null;
}

async function writeState(key: string, value: unknown): Promise<void> {
  await ensureSchema();
  await getSql()`
    INSERT INTO app_state (state_key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (state_key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
}

export async function getConfig(): Promise<BettingConfig> {
  const stored = await readState<Partial<BettingConfig>>(CONFIG_KEY);
  return stored ? { ...defaultConfig, ...stored } : defaultConfig;
}

export async function saveConfig(config: BettingConfig): Promise<void> {
  await writeState(CONFIG_KEY, config);
}

export async function getStatus(): Promise<WorkerStatus> {
  return (await readState<WorkerStatus>(STATUS_KEY)) ?? defaultStatus;
}

export async function saveStatus(status: WorkerStatus): Promise<void> {
  await writeState(STATUS_KEY, status);
}

export async function getNativeInputs(): Promise<{ live: NativeInputSnapshot | null; tickets: NativeInputSnapshot | null }> {
  const [live, tickets] = await Promise.all([
    readState<NativeInputSnapshot>(NATIVE_LIVE_KEY),
    readState<NativeInputSnapshot>(NATIVE_TICKETS_KEY),
  ]);
  return { live, tickets };
}

export async function saveNativeInput(source: "live" | "tickets", payload: unknown): Promise<NativeInputSnapshot> {
  const snapshot = { receivedAt: new Date().toISOString(), payload };
  await writeState(source === "live" ? NATIVE_LIVE_KEY : NATIVE_TICKETS_KEY, snapshot);
  return snapshot;
}

