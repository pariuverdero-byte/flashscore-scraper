import { isAuthorized } from "@/lib/auth";
import { ensureSchema, getSql } from "@/lib/db";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const rows = await getSql()`SELECT * FROM algorithm_reviews ORDER BY period_end DESC LIMIT 12`;
  return Response.json(rows);
}
