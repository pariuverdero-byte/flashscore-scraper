import { neon } from "@neondatabase/serverless";

let initialized = false;

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

export async function ensureSchema() {
  if (initialized) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS bet_transactions (
      id BIGSERIAL PRIMARY KEY,
      intent_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('live', 'ticket')),
      event_name TEXT NOT NULL,
      market_text TEXT NOT NULL,
      selection_text TEXT NOT NULL,
      confidence NUMERIC(5,2),
      requested_odds NUMERIC(10,3),
      available_odds NUMERIC(10,3) NOT NULL,
      stake NUMERIC(12,2) NOT NULL,
      betfair_market_id TEXT NOT NULL,
      betfair_selection_id BIGINT NOT NULL,
      betfair_bet_id TEXT,
      status TEXT NOT NULL DEFAULT 'submitted',
      profit NUMERIC(12,2),
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      settled_at TIMESTAMPTZ,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb
    )`;
  await sql`CREATE INDEX IF NOT EXISTS bet_transactions_submitted_idx ON bet_transactions (submitted_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS bet_transactions_kind_confidence_idx ON bet_transactions (kind, confidence)`;
  await sql`
    CREATE TABLE IF NOT EXISTS algorithm_reviews (
      id BIGSERIAL PRIMARY KEY,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      sample_size INTEGER NOT NULL,
      metrics JSONB NOT NULL,
      recommendations JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(period_start, period_end)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS algorithm_proposals (
      id BIGSERIAL PRIMARY KEY,
      review_id BIGINT REFERENCES algorithm_reviews(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'auto_approved')),
      proposed_config JSONB NOT NULL,
      rationale TEXT NOT NULL,
      auto_apply_at TIMESTAMPTZ NOT NULL,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      state_key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  initialized = true;
}
