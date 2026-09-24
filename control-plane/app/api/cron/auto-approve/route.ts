import { applyDueProposals } from "@/lib/review";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await applyDueProposals());
}
