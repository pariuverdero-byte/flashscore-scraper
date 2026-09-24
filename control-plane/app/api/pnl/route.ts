import { isAuthorized } from "@/lib/auth";
import { ensureSchema, getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const rows = await getSql()`
    SELECT
      COALESCE(SUM(profit) FILTER (WHERE status = 'settled' AND settled_at >= (date_trunc('day', NOW() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::float AS today,
      COALESCE(SUM(profit) FILTER (WHERE status = 'settled' AND settled_at >= (date_trunc('month', NOW() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::float AS month,
      COALESCE(SUM(profit) FILTER (WHERE status = 'settled' AND settled_at >= (date_trunc('year', NOW() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::float AS year,
      COALESCE(SUM(profit) FILTER (WHERE status = 'settled'), 0)::float AS forever,
      COALESCE(SUM(profit) FILTER (WHERE status IN ('simulated_won', 'simulated_lost', 'simulated_void') AND settled_at >= (date_trunc('day', NOW() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::float AS simulated_today,
      COALESCE(SUM(profit) FILTER (WHERE status IN ('simulated_won', 'simulated_lost', 'simulated_void') AND settled_at >= (date_trunc('month', NOW() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::float AS simulated_month,
      COALESCE(SUM(profit) FILTER (WHERE status IN ('simulated_won', 'simulated_lost', 'simulated_void') AND settled_at >= (date_trunc('year', NOW() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::float AS simulated_year,
      COALESCE(SUM(profit) FILTER (WHERE status IN ('simulated_won', 'simulated_lost', 'simulated_void')), 0)::float AS simulated_forever,
      COUNT(*) FILTER (WHERE status = 'simulated_open')::int AS simulated_open,
      COUNT(*) FILTER (WHERE status IN ('simulated_won', 'simulated_lost', 'simulated_void'))::int AS simulated_settled,
      COUNT(*) FILTER (WHERE status = 'simulated_won')::int AS simulated_wins,
      COALESCE(SUM(stake) FILTER (WHERE status IN ('simulated_won', 'simulated_lost', 'simulated_void')), 0)::float AS simulated_stake
    FROM bet_transactions`;
  const row = rows[0];
  if (!row) return Response.json({ today: 0, month: 0, year: 0, forever: 0, simulated: { today: 0, month: 0, year: 0, forever: 0, open: 0, settled: 0, wins: 0, winRate: 0, stake: 0, roi: 0 } });
  const settled = Number(row.simulated_settled);
  const stake = Number(row.simulated_stake);
  const simulatedForever = Number(row.simulated_forever);
  return Response.json({
    today: Number(row.today), month: Number(row.month), year: Number(row.year), forever: Number(row.forever),
    simulated: {
      today: Number(row.simulated_today), month: Number(row.simulated_month), year: Number(row.simulated_year), forever: simulatedForever,
      open: Number(row.simulated_open), settled, wins: Number(row.simulated_wins), winRate: settled ? Number(row.simulated_wins) / settled : 0,
      stake, roi: stake ? simulatedForever / stake : 0,
    },
  });
}

