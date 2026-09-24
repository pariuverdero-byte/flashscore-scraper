import { BetfairClient } from "./betfair";
import { nativeIntentsFromData } from "./native-inputs";

type RemoteInputs = {
  tickets?: { payload?: { tickets?: Parameters<typeof nativeIntentsFromData>[2] } } | null;
};

async function main() {
  const controlUrl = process.env.CONTROL_PLANE_URL ?? "https://liveedge-control.vercel.app";
  const controlToken = required("CONTROL_API_TOKEN");
  const response = await fetch(`${controlUrl}/api/inputs`, {
    headers: { Authorization: `Bearer ${controlToken}` },
  });
  if (!response.ok) throw new Error(`Control plane inputs: ${response.status}`);

  const remote = await response.json() as RemoteInputs;
  const intents = nativeIntentsFromData(undefined, undefined, remote.tickets?.payload?.tickets)
    .filter((intent) => intent.kind === "ticket");
  const client = new BetfairClient(required("BETFAIR_APP_KEY"));
  await client.login();

  const results = [];
  for (const intent of intents) {
    try {
      const candidate = await client.resolveIntent(intent);
      results.push({
        id: intent.id,
        event: intent.eventName,
        selection: intent.selectionText,
        result: candidate ? "matched" : "missing_or_ambiguous",
        availableOdds: candidate?.availableOdds ?? null,
        marketId: candidate?.marketId ?? null,
      });
    } catch (error) {
      results.push({
        id: intent.id,
        event: intent.eventName,
        selection: intent.selectionText,
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

