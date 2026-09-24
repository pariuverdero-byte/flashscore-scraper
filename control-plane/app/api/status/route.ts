import { isAuthorized } from "@/lib/auth";
import { getStatus, saveStatus, type WorkerStatus } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await getStatus());
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as WorkerStatus;
  await saveStatus(body);
  return Response.json({ ok: true });
}
