import { readFile } from "node:fs/promises";
import { Agent } from "node:https";
import type { BetCandidate, ExecutionIntent } from "./types";
import { chooseMarket, type CatalogueMarket } from "./market-matcher";

type RpcResponse<T> = { result?: T; error?: { message: string; data?: unknown } };

export class BetfairClient {
  private sessionToken: string | null = null;
  constructor(private readonly appKey: string) {}

  async login(): Promise<void> {
    const username = requireEnv("BETFAIR_USERNAME");
    const password = requireEnv("BETFAIR_PASSWORD");
    const cert = await readFile(requireEnv("BETFAIR_CERT_PATH"));
    const key = await readFile(requireEnv("BETFAIR_KEY_PATH"));
    const agent = new Agent({ cert, key });
    // Node fetch does not accept an https.Agent. Use the native request helper so
    // the client certificate remains worker-only and never enters the web app.
    this.sessionToken = await certificateLogin(agent, this.appKey, username, password, identityEndpoint());
  }

  isAuthenticated(): boolean { return this.sessionToken !== null; }

  async testConnection(): Promise<{ eventTypeCount: number }> {
    const eventTypes = await this.rpc<Array<{ eventType?: { id?: string; name?: string } }>>("listEventTypes", {
      filter: {},
    });
    return { eventTypeCount: eventTypes.length };
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    if (!this.sessionToken) throw new Error("Betfair client is not authenticated");
    const response = await fetch("https://api.betfair.com/exchange/betting/json-rpc/v1", {
      method: "POST",
      headers: { "X-Application": this.appKey, "X-Authentication": this.sessionToken, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: `SportsAPING/v1.0/${method}`, params, id: 1 }),
    });
    const body = (await response.json()) as RpcResponse<T>;
    if (!response.ok || body.error || body.result === undefined) throw new Error(`Betfair ${method}: ${body.error?.message ?? response.status}`);
    return body.result;
  }

  async resolveIntent(intent: ExecutionIntent): Promise<BetCandidate | null> {
    const markets = await this.rpc<CatalogueMarket[]>("listMarketCatalogue", {
      filter: { ...(intent.kind === "live" ? { inPlayOnly: true } : {}), textQuery: intent.eventName },
      marketProjection: ["EVENT", "RUNNER_DESCRIPTION", "MARKET_DESCRIPTION"], sort: "FIRST_TO_START", maxResults: "100",
    });
    const selected = chooseMarket(intent, markets);
    if (!selected) return null;
    const books = await this.rpc<Array<{ inplay: boolean; betDelay: number; runners: Array<{ selectionId: number; ex?: { availableToBack?: Array<{ price: number }> } }> }>>("listMarketBook", { marketIds: [selected.market.marketId], priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true } });
    const bookRunner = books[0]?.runners.find((item) => item.selectionId === selected.runner.selectionId);
    const odds = bookRunner?.ex?.availableToBack?.[0]?.price;
    if ((intent.kind === "live" && !books[0]?.inplay) || !odds) return null;
    return { ...intent, marketId: selected.market.marketId, selectionId: selected.runner.selectionId, availableOdds: odds, betDelaySeconds: books[0].betDelay };
  }

  async placeBack(candidate: BetCandidate, stake: number): Promise<{ betId?: string; raw: unknown }> {
    const raw = await this.rpc<{ instructionReports?: Array<{ betId?: string }> }>("placeOrders", { marketId: candidate.marketId, customerRef: candidate.id.slice(0, 32), instructions: [{ selectionId: candidate.selectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: stake, price: candidate.availableOdds, persistenceType: "LAPSE" } }] });
    return { betId: raw.instructionReports?.[0]?.betId, raw };
  }

  async getSettledPnlToday(): Promise<number> {
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    const report = await this.rpc<{ clearedOrders?: Array<{ profit?: number }> }>("listClearedOrders", {
      betStatus: "SETTLED",
      settledDateRange: { from: from.toISOString(), to: new Date().toISOString() },
      groupBy: "BET",
      fromRecord: 0,
      recordCount: 1000,
    });
    return Math.round((report.clearedOrders ?? []).reduce((total, order) => total + Number(order.profit ?? 0), 0) * 100) / 100;
  }

  async getSettlementsToday(): Promise<Array<{ betId: string; profit: number; settledAt?: string }>> {
    const from = new Date(); from.setUTCHours(0, 0, 0, 0);
    const report = await this.rpc<{ clearedOrders?: Array<{ betId?: string; profit?: number; settledDate?: string }> }>("listClearedOrders", { betStatus: "SETTLED", settledDateRange: { from: from.toISOString(), to: new Date().toISOString() }, groupBy: "BET", fromRecord: 0, recordCount: 1000 });
    return (report.clearedOrders ?? []).filter((order): order is { betId: string; profit?: number; settledDate?: string } => Boolean(order.betId)).map((order) => ({ betId: order.betId, profit: Number(order.profit ?? 0), settledAt: order.settledDate }));
  }
}
function requireEnv(name: string): string { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }

function identityEndpoint(): string {
  const jurisdiction = (process.env.BETFAIR_JURISDICTION ?? "COM").toUpperCase();
  const endpoints: Record<string, string> = {
    COM: "https://identitysso-cert.betfair.com/api/certlogin",
    RO: "https://identitysso-cert.betfair.ro/api/certlogin",
    ES: "https://identitysso-cert.betfair.es/api/certlogin",
    IT: "https://identitysso-cert.betfair.it/api/certlogin",
    AU: "https://identitysso-cert.betfair.com.au/api/certlogin",
  };
  const endpoint = endpoints[jurisdiction];
  if (!endpoint) throw new Error(`Unsupported BETFAIR_JURISDICTION: ${jurisdiction}`);
  return endpoint;
}

async function certificateLogin(agent: Agent, appKey: string, username: string, password: string, endpoint: string): Promise<string> {
  const { request } = await import("node:https");
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams({ username, password }).toString();
    const req = request(endpoint, { method: "POST", agent, headers: { "X-Application": appKey, "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
      let body = ""; res.on("data", (chunk) => body += chunk); res.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { loginStatus: string; sessionToken?: string };
          if (parsed.loginStatus === "SUCCESS" && parsed.sessionToken) resolve(parsed.sessionToken);
          else reject(new Error(`Betfair login: ${parsed.loginStatus}`));
        } catch (error) { reject(error); }
      });
    });
    req.on("error", reject); req.end(payload);
  });
}
