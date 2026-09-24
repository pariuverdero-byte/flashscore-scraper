import { defaultConfig, type BettingConfig } from "@/lib/config";
import { ensureSchema, getSql } from "@/lib/db";

const CONFIG_KEY = "live-betting:config";
const STATUS_KEY = "live-betting:status";

export type WorkerStatus = {
  lastHeartbeat: string | null;
  mode: "dry-run" | "live";
  pnlToday: number;
  betsToday: number;
  lastMessage: string;
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
