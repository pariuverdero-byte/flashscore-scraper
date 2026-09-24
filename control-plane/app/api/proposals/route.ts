import { isAuthorized } from "@/lib/auth";
import { ensureSchema, getSql } from "@/lib/db";
import { decideProposal } from "@/lib/review";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  return Response.json(await getSql()`SELECT * FROM algorithm_proposals ORDER BY created_at DESC LIMIT 24`);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { id?: number; action?: "approve" | "reject" };
  if (!Number.isInteger(body.id) || !body.action || !["approve", "reject"].includes(body.action)) return Response.json({ error: "Invalid decision" }, { status: 400 });
  const changed = await decideProposal(Number(body.id), body.action);
  return Response.json({ changed });
}
