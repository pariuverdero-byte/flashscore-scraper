import { isAuthorized } from "@/lib/auth";
import { ensureSchema, getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE execution_intents SET status = 'expired' WHERE status = 'pending' AND expires_at <= NOW()`;
  return Response.json(await sql`SELECT * FROM execution_intents WHERE created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 200`);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const body = await request.json();
  const sql = getSql();
  await sql`INSERT INTO execution_intents (intent_id, kind, event_name, market_text, selection_text, confidence, available_odds, stake, betfair_market_id, betfair_selection_id, expires_at, raw)
    VALUES (${body.intentId}, ${body.kind}, ${body.eventName}, ${body.marketText}, ${body.selectionText}, ${body.confidence ?? null}, ${body.availableOdds}, ${body.stake}, ${body.marketId}, ${body.selectionId}, ${body.expiresAt}, ${JSON.stringify(body.raw ?? {})}::jsonb)
    ON CONFLICT (intent_id) DO NOTHING`;
  return Response.json({ stored: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const body = await request.json() as { id?: number; action?: "approve" | "reject" };
  if (!body.id || !["approve", "reject"].includes(body.action ?? "")) return Response.json({ error: "Invalid decision" }, { status: 400 });
  const status = body.action === "approve" ? "approved" : "rejected";
  const rows = await getSql()`UPDATE execution_intents SET status = ${status}, decided_at = NOW()
    WHERE id = ${body.id} AND status = 'pending' AND expires_at > NOW() RETURNING *`;
  if (!rows[0]) return Response.json({ error: "Intent is no longer pending or has expired" }, { status: 409 });
  return Response.json(rows[0]);
}
