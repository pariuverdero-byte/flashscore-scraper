import { isAuthorized } from "@/lib/auth";
import { getNativeInputs, saveNativeInput } from "@/lib/store";
import { z } from "zod";

export const runtime = "nodejs";

const liveInputSchema = z.object({
  source: z.literal("live"),
  liveMatches: z.object({ matches: z.array(z.unknown()).max(500) }).passthrough(),
  liveSignals: z.array(z.unknown()).max(2_000),
});

const ticketInputSchema = z.object({
  source: z.literal("tickets"),
  tickets: z.object({}).passthrough(),
});

const inputSchema = z.discriminatedUnion("source", [liveInputSchema, ticketInputSchema]);

export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await getNativeInputs());
}

export async function PUT(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000_000) return Response.json({ error: "Payload too large" }, { status: 413 });

  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const payload = parsed.data.source === "live"
    ? { liveMatches: parsed.data.liveMatches, liveSignals: parsed.data.liveSignals }
    : { tickets: parsed.data.tickets };
  const snapshot = await saveNativeInput(parsed.data.source, payload);
  return Response.json({ ok: true, source: parsed.data.source, receivedAt: snapshot.receivedAt });
}
