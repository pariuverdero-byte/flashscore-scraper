"use client";

import { useCallback, useEffect, useState } from "react";
import { bettingConfigSchema, defaultConfig, type BettingConfig } from "@/lib/config";
import type { WorkerStatus } from "@/lib/store";

const emptyStatus: WorkerStatus = { lastHeartbeat: null, mode: "dry-run", pnlToday: 0, betsToday: 0, lastMessage: "Not connected" };
const emptyPnl = { today: 0, month: 0, year: 0, forever: 0 };
type SaveSection = "algorithm" | "risk";
type SaveFeedback = { section: SaveSection; kind: "pending" | "success" | "error"; text: string } | null;
type TicketStatus = { date: string; receivedAt: string; cota2: number; ticketOfDay: number } | null;

function errorMessage(body: unknown, status: number) {
  if (!body || typeof body !== "object") return `Request failed (${status})`;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const fieldErrors = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    const firstFieldError = fieldErrors && Object.values(fieldErrors).flat().find(Boolean);
    if (firstFieldError) return firstFieldError;
    const formErrors = (error as { formErrors?: string[] }).formErrors;
    if (formErrors?.[0]) return formErrors[0];
  }
  return `Request failed (${status})`;
}

export default function Dashboard() {
  const [token, setToken] = useState(() => typeof window === "undefined" ? "" : sessionStorage.getItem("control-token") ?? "");
  const [activeToken, setActiveToken] = useState(() => typeof window === "undefined" ? "" : sessionStorage.getItem("control-token") ?? "");
  const [config, setConfig] = useState<BettingConfig>(defaultConfig);
  const [status, setStatus] = useState<WorkerStatus>(emptyStatus);
  const [message, setMessage] = useState("Enter the control token to load settings.");
  const [transactions, setTransactions] = useState<Array<Record<string, unknown>>>([]);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState("all");
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>([]);
  const [proposals, setProposals] = useState<Array<Record<string, unknown>>>([]);
  const [pnl, setPnl] = useState(emptyPnl);
  const [workerOnline, setWorkerOnline] = useState(false);
  const [heartbeatLabel, setHeartbeatLabel] = useState("No heartbeat received");
  const [ticketStatus, setTicketStatus] = useState<TicketStatus>(null);
  const [savingSection, setSavingSection] = useState<SaveSection | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback>(null);

  const request = useCallback(async (path: string, init?: RequestInit, authToken = activeToken) => {
    const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, ...init?.headers } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return body;
  }, [activeToken]);

  const refreshDashboard = useCallback(async (authToken: string, announce: boolean) => {
    try {
      const [nextConfig, nextStatus, nextReviews, nextProposals, nextPnl, nextInputs] = await Promise.all([
        request("/api/config", undefined, authToken),
        request("/api/status", undefined, authToken),
        request("/api/reviews", undefined, authToken).catch(() => []),
        request("/api/proposals", undefined, authToken).catch(() => []),
        request("/api/pnl", undefined, authToken).catch(() => emptyPnl),
        request("/api/inputs", undefined, authToken).catch(() => null),
      ]);
      setConfig(nextConfig);
      setStatus(nextStatus);
      setWorkerOnline(Boolean(nextStatus.lastHeartbeat) && Date.now() - new Date(nextStatus.lastHeartbeat).getTime() < 60_000);
      setHeartbeatLabel(nextStatus.lastHeartbeat
        ? new Date(nextStatus.lastHeartbeat).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "medium" })
        : "No heartbeat received");
      const tickets = nextInputs?.tickets?.payload?.tickets;
      setTicketStatus(tickets ? {
        date: String(tickets.date ?? ""),
        receivedAt: nextInputs.tickets.receivedAt
          ? new Date(nextInputs.tickets.receivedAt).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" })
          : "—",
        cota2: tickets.bilet_cota2?.selections?.length ?? 0,
        ticketOfDay: tickets.biletul_zilei?.selections?.length ?? 0,
      } : null);
      setReviews(nextReviews);
      setProposals(nextProposals);
      setPnl(nextPnl);
      if (announce) setMessage("Controls loaded. Status refreshes automatically.");
    } catch (error) {
      if (announce) setMessage(error instanceof Error ? error.message : "Unable to load");
    }
  }, [request]);

  useEffect(() => {
    if (!activeToken) return;
    const initialRefresh = window.setTimeout(() => void refreshDashboard(activeToken, true), 0);
    const timer = window.setInterval(() => void refreshDashboard(activeToken, false), 15_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [activeToken, refreshDashboard]);

  async function load() {
    sessionStorage.setItem("control-token", token);
    setActiveToken(token);
    await refreshDashboard(token, true);
  }

  async function save(section: SaveSection) {
    const parsed = bettingConfigSchema.safeParse(config);
    if (!parsed.success) {
      const text = parsed.error.issues[0]?.message ?? "Please check the entered values.";
      setSaveFeedback({ section, kind: "error", text });
      setMessage(text);
      return;
    }

    setSavingSection(section);
    setSaveFeedback({ section, kind: "pending", text: "Saving…" });
    try {
      const saved = await request("/api/config", { method: "PUT", body: JSON.stringify(parsed.data) });
      const savedAt = new Date().toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setConfig(saved);
      setSaveFeedback({ section, kind: "success", text: `Saved successfully at ${savedAt}.` });
      setMessage(saved.enabled ? "Saved. Worker enabled subject to server safety interlock." : "Saved. Worker paused.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unable to save";
      setSaveFeedback({ section, kind: "error", text });
      setMessage(text);
    } finally {
      setSavingSection(null);
    }
  }

  const saveStatus = (section: SaveSection) => saveFeedback?.section === section ? (
    <span className={`saveFeedback ${saveFeedback.kind}`} role="status" aria-live="polite">{saveFeedback.text}</span>
  ) : null;

  async function loadTransactions() {
    try { setTransactions(await request(`/api/transactions?from=${from}&to=${to}&kind=${kind}`)); setMessage("Transactions loaded."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load transactions"); }
  }

  async function decide(id: unknown, action: "approve" | "reject") {
    try { await request("/api/proposals", { method: "POST", body: JSON.stringify({ id: Number(id), action }) }); setProposals(await request("/api/proposals")); setConfig(await request("/api/config")); setMessage(`Proposal ${action}d.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to decide proposal"); }
  }

  const numberField = (key: keyof BettingConfig, label: string, step: number) => (
    <label><span>{label}</span><input type="number" step={step} value={String(config[key])} onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })} /></label>
  );

  return <main>
    <header><div><p className="eyebrow">BETFAIR AUTOMATION</p><h1>LiveEdge Control</h1><p className="muted">One disciplined control surface for live execution.</p></div><div className={`mode ${status.mode}`}>{status.mode}</div></header>
    <section className="metrics">
      <article><span>P&amp;L today</span><strong className={pnl.today < 0 ? "negative" : ""}>{pnl.today.toFixed(2)} RON</strong></article>
      <article><span>P&amp;L this month</span><strong className={pnl.month < 0 ? "negative" : ""}>{pnl.month.toFixed(2)} RON</strong></article>
      <article><span>P&amp;L this year</span><strong className={pnl.year < 0 ? "negative" : ""}>{pnl.year.toFixed(2)} RON</strong></article>
      <article><span>P&amp;L forever</span><strong className={pnl.forever < 0 ? "negative" : ""}>{pnl.forever.toFixed(2)} RON</strong></article>
      <article><span>Bets today</span><strong>{status.betsToday}</strong></article>
      <article><span>Worker</span><strong className={workerOnline ? "online" : "negative"}>{workerOnline ? "Online" : "Offline"}</strong></article>
    </section>
    <section className="panel systemStatus">
      <div className="panelTitle"><div><h2>System status</h2><p>Updated automatically every 15 seconds.</p></div></div>
      <div className="statusGrid">
        <article><span>Automation</span><strong className={config.enabled ? "online" : "negative"}>{config.enabled ? "Enabled" : "Paused"}</strong></article>
        <article><span>Worker</span><strong className={workerOnline ? "online" : "negative"}>{workerOnline ? "Online" : "Offline"}</strong><small>Heartbeat: {heartbeatLabel}</small></article>
        <article><span>Execution mode</span><strong className={status.mode === "live" ? "negative" : "dryRunText"}>{status.mode === "live" ? "LIVE" : "DRY-RUN"}</strong><small>{status.mode === "live" ? "Real orders may be submitted" : "No real bets can be placed"}</small></article>
        <article><span>Today&apos;s tickets</span><strong>{ticketStatus?.date === today ? "Received" : "Not received"}</strong><small>{ticketStatus ? `Cota 2: ${ticketStatus.cota2} selections · Ticket of day: ${ticketStatus.ticketOfDay} selections · ${ticketStatus.receivedAt}` : "Waiting for ticket input"}</small></article>
      </div>
      <div className="workerMessage"><span>Latest worker result</span><p>{status.lastMessage}</p></div>
    </section>
    <section className="panel"><div className="panelTitle"><div><h2>Algorithm controls</h2><p>Execution-window changes apply without rewriting the signal generator.</p></div><label className="switch"><input type="checkbox" checked={config.algorithmAutopilot} onChange={(event) => setConfig({ ...config, algorithmAutopilot: event.target.checked })} /><span>Autopilot {config.algorithmAutopilot ? "on" : "off"}</span></label></div>
      <div className="grid">{numberField("liveMinMinute", "Earliest live minute", 1)}{numberField("liveMaxMinute", "Latest live minute", 1)}{numberField("approvalWindowDays", "Auto-approval delay (1–5 days)", 1)}</div><div className="saveRow"><button className="primary" onClick={() => save("algorithm")} disabled={savingSection !== null}>{savingSection === "algorithm" ? "Saving…" : "Save algorithm controls"}</button>{saveStatus("algorithm")}</div>
    </section>
    <section className="panel auth"><h2>Connection</h2><label><span>Control token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="••••••••••••" /></label><button onClick={load}>Connect</button></section>
    <section className="panel"><div className="panelTitle"><div><h2>Risk limits</h2><p>Applied before every order, including imported tickets.</p></div><label className="switch"><input type="checkbox" checked={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} /><span>{config.enabled ? "Enabled" : "Paused"}</span></label></div>
      <div className="grid">{numberField("stakePerBet", "Stake per selection (RON)", .01)}{numberField("minLiveOdds", "Minimum live odds", .01)}{numberField("minLiveConfidence", "Minimum live confidence (%)", 1)}{numberField("maxDailyLoss", "Maximum daily loss (RON)", 1)}{numberField("dailyTakeProfit", "Daily take-profit (RON)", 1)}{numberField("maxSignalAgeSeconds", "Maximum signal age (seconds)", 1)}</div>
      <div className="saveRow"><button className="primary" onClick={() => save("risk")} disabled={savingSection !== null}>{savingSection === "risk" ? "Saving…" : "Save risk limits"}</button>{saveStatus("risk")}</div>
    </section>
    <section className="panel"><div className="panelTitle"><div><h2>Transactions</h2><p>Submitted and settled Betfair singles.</p></div></div>
      <div className="filters"><label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label><span>Type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All</option><option value="live">Live</option><option value="ticket">Tickets</option></select></label><button onClick={loadTransactions}>Apply filter</button></div>
      <div className="tableWrap"><table><thead><tr><th>Date</th><th>Type</th><th>Event</th><th>Selection</th><th>Confidence</th><th>Odds</th><th>Stake</th><th>Status</th><th>P&amp;L</th></tr></thead><tbody>{transactions.map((row) => <tr key={String(row.id)}><td>{String(row.submitted_at ?? "").slice(0, 16).replace("T", " ")}</td><td>{String(row.kind ?? "")}</td><td>{String(row.event_name ?? "")}</td><td>{String(row.selection_text ?? "")}</td><td>{row.confidence == null ? "—" : `${row.confidence}%`}</td><td>{String(row.available_odds ?? "")}</td><td>{String(row.stake ?? "")} RON</td><td>{String(row.status ?? "")}</td><td>{row.profit == null ? "—" : `${row.profit} RON`}</td></tr>)}</tbody></table></div>
    </section>
    <section className="panel"><h2>Monthly algorithm review</h2><p>{reviews.length ? `${String(reviews[0].period_start)} — ${String(reviews[0].period_end)} · ${String(reviews[0].sample_size)} settled live bets` : "The first report will be generated on the first day of next month."}</p><div className="proposals">{proposals.filter((item) => item.status === "pending").map((item) => <article key={String(item.id)}><div><strong>Proposed change</strong><p>{String(item.rationale ?? "")}</p><small>{JSON.stringify(item.proposed_config)} · auto-apply: {String(item.auto_apply_at).slice(0, 16).replace("T", " ")}</small></div><div><button onClick={() => decide(item.id, "approve")}>Approve</button><button className="secondary" onClick={() => decide(item.id, "reject")}>Reject</button></div></article>)}</div></section>
    <section className="notice"><span>STATUS</span><p>{message}</p><small>{status.lastMessage}</small></section>
  </main>;
}

