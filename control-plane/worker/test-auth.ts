import { BetfairClient } from "./betfair";

async function main() {
  const appKey = process.env.BETFAIR_APP_KEY;
  if (!appKey) throw new Error("Missing BETFAIR_APP_KEY");

  const client = new BetfairClient(appKey);
  await client.login();
  const result = await client.testConnection();
  console.log(`Betfair authentication successful. Read-only API returned ${result.eventTypeCount} event types.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Betfair authentication failed: ${message}`);
  process.exitCode = 1;
});
