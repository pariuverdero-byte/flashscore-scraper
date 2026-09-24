import { isAuthorized } from "@/lib/auth";
import { bettingConfigSchema } from "@/lib/config";
import { getConfig, saveConfig } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await getConfig());
}

export async function PUT(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bettingConfigSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    await saveConfig(parsed.data);
    return Response.json(parsed.data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: 503 });
  }
}
