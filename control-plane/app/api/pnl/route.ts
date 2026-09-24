import { isAuthorized } from "@/lib/auth";
import { ensureSchema, getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const rows = await getSql()`
    SELECT
      COALESCE(SUM(profit) FILTER (WHERE settled_at >= (date_trunc('day', NOW() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::float AS today,
      COALESCE(SUM(profit) FILTER (WHERE settled_at >= (date_trunc('month', NOW() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::float AS month,
      COALESCE(SUM(profit) FILTER (WHERE settled_at >= (date_trunc('year', NOW() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::float AS year,
      COALESCE(SUM(profit), 0)::float AS forever
    FROM bet_transactions
    WHERE status = 'settled'`;
  return Response.json(rows[0] ?? { today: 0, month: 0, year: 0, forever: 0 });
}
