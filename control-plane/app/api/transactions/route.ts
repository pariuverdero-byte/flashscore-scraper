import { isAuthorized } from "@/lib/auth";
import { ensureSchema, getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "1970-01-01";
  const to = params.get("to") || "2999-12-31";
  const kind = params.get("kind") || "all";
  const status = params.get("status");
  const sql = getSql();
  const rows = status
    ? await sql`SELECT * FROM bet_transactions WHERE status = ${status} ORDER BY submitted_at DESC LIMIT 500`
    : kind === "all"
    ? await sql`SELECT * FROM bet_transactions WHERE submitted_at >= (${from}::date::timestamp AT TIME ZONE 'Europe/Bucharest') AND submitted_at < ((${to}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Bucharest') ORDER BY submitted_at DESC LIMIT 500`
    : await sql`SELECT * FROM bet_transactions WHERE kind = ${kind} AND submitted_at >= (${from}::date::timestamp AT TIME ZONE 'Europe/Bucharest') AND submitted_at < ((${to}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Bucharest') ORDER BY submitted_at DESC LIMIT 500`;
  return Response.json(rows);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const body = await request.json();
  const sql = getSql();
  await sql`INSERT INTO bet_transactions (intent_id, kind, event_name, market_text, selection_text, confidence, requested_odds, available_odds, stake, betfair_market_id, betfair_selection_id, betfair_bet_id, status, raw)
    VALUES (${body.intentId}, ${body.kind}, ${body.eventName}, ${body.marketText}, ${body.selectionText}, ${body.confidence ?? null}, ${body.requestedOdds ?? null}, ${body.availableOdds}, ${body.stake}, ${body.marketId}, ${body.selectionId}, ${body.betId ?? null}, ${body.status ?? "submitted"}, ${JSON.stringify(body.raw ?? {})}::jsonb)
    ON CONFLICT (intent_id) DO NOTHING`;
  return Response.json({ stored: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const body = await request.json() as {
    settlements?: Array<{ betId: string; profit: number; settledAt?: string }>;
    simulatedSettlements?: Array<{ intentId: string; status: "simulated_won" | "simulated_lost" | "simulated_void"; profit: number; settledAt?: string }>;
    auditCorrections?: Array<{ intentId: string; status: "simulated_won" | "simulated_lost" | "simulated_void"; profit: number; reason: string }>;
  };
  const sql = getSql();
  for (const item of body.settlements ?? []) {
    await sql`UPDATE bet_transactions SET status = 'settled', profit = ${item.profit}, settled_at = ${item.settledAt ?? new Date().toISOString()} WHERE betfair_bet_id = ${item.betId}`;
  }
  for (const item of body.simulatedSettlements ?? []) {
    await sql`UPDATE bet_transactions SET status = ${item.status}, profit = ${item.profit}, settled_at = ${item.settledAt ?? new Date().toISOString()} WHERE intent_id = ${item.intentId} AND status = 'simulated_open'`;
  }
  for (const item of body.auditCorrections ?? []) {
    await sql`UPDATE bet_transactions
      SET status = ${item.status}, profit = ${item.profit},
          raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('auditCorrection', jsonb_build_object('reason', ${item.reason}::text, 'correctedAt', ${new Date().toISOString()}::text))
      WHERE intent_id = ${item.intentId} AND status LIKE 'simulated_%'`;
  }
  return Response.json({ updated: (body.settlements?.length ?? 0) + (body.simulatedSettlements?.length ?? 0) + (body.auditCorrections?.length ?? 0) });
}

