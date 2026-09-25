"use client";

import { useCallback, useEffect, useState } from "react";
import { bettingConfigSchema, defaultConfig, type BettingConfig } from "@/lib/config";
import type { WorkerStatus } from "@/lib/store";

const emptyStatus: WorkerStatus = { lastHeartbeat: null, mode: "dry-run", pnlToday: 0, betsToday: 0, lastMessage: "Not connected" };
const emptyPnl = { today: 0, month: 0, year: 0, forever: 0, simulated: { today: 0, month: 0, year: 0, forever: 0, open: 0, settled: 0, wins: 0, winRate: 0, stake: 0, roi: 0 } };
type SaveSection = "algorithm" | "risk";
type SaveFeedback = { section: SaveSection; kind: "pending" | "success" | "error"; text: string } | null;
type TicketStatus = { date: string; receivedAt: string; cota2: number; ticketOfDay: number } | null;
type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

function bucharestDate(value: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

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
  const [token, setToken] = useState("");
  const [activeToken, setActiveToken] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [config, setConfig] = useState<BettingConfig>(defaultConfig);
  const [status, setStatus] = useState<WorkerStatus>(emptyStatus);
  const [message, setMessage] = useState("Enter the control token to load settings.");
  const [transactions, setTransactions] = useState<Array<Record<string, unknown>>>([]);
  const [today] = useState(() => bucharestDate());
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
  const [selectedChecks, setSelectedChecks] = useState<string[]>([]);
  const [preparedBatch, setPreparedBatch] = useState<string[]>([]);
  const [statusNow, setStatusNow] = useState(0);

  const request = useCallback(async (path: string, init?: RequestInit, authToken = activeToken) => {
    const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, ...init?.headers } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return body;
  }, [activeToken]);

  const refreshDashboard = useCallback(async (authToken: string, announce: boolean) => {
    try {
      const [nextConfig, nextStatus, nextReviews, nextProposals, nextPnl, nextInputs, nextTransactions] = await Promise.all([
        request("/api/config", undefined, authToken),
        request("/api/status", undefined, authToken),
        request("/api/reviews", undefined, authToken).catch(() => []),
        request("/api/proposals", undefined, authToken).catch(() => []),
        request("/api/pnl", undefined, authToken).catch(() => emptyPnl),
        request("/api/inputs", undefined, authToken).catch(() => null),
        request(`/api/transactions?from=${from}&to=${to}&kind=${kind}`, undefined, authToken).catch(() => []),
      ]);
      setConfig(nextConfig);
      setStatus(nextStatus);
      setStatusNow(Date.now());
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
      setTransactions(nextTransactions);
      setConnectionState("connected");
      if (announce) setMessage("Controls loaded. Status refreshes automatically.");
    } catch (error) {
      setConnectionState("error");
      setWorkerOnline(false);
      if (announce) setMessage(error instanceof Error ? error.message : "Unable to load");
    }
  }, [request, from, to, kind]);

  useEffect(() => {
    const savedToken = localStorage.getItem("control-token") ?? sessionStorage.getItem("control-token") ?? "";
    if (!savedToken) return;
    const restoreConnection = window.setTimeout(() => {
      localStorage.setItem("control-token", savedToken);
      setToken(savedToken);
      setConnectionState("connecting");
      setActiveToken(savedToken);
    }, 0);
    return () => window.clearTimeout(restoreConnection);
  }, []);

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
    const nextToken = token.trim();
    if (!nextToken) {
      setConnectionState("error");
      setMessage("Enter the control token first.");
      return;
    }
    localStorage.setItem("control-token", nextToken);
    sessionStorage.setItem("control-token", nextToken);
    setConnectionState("connecting");
    setActiveToken(nextToken);
    await refreshDashboard(nextToken, true);
  }

  function disconnect() {
    localStorage.removeItem("control-token");
    sessionStorage.removeItem("control-token");
    setToken("");
    setActiveToken("");
    setConnectionState("disconnected");
    setWorkerOnline(false);
    setStatus(emptyStatus);
    setMessage("Disconnected. Enter the control token to load settings.");
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

  const workerLabel = connectionState === "connected" ? (workerOnline ? "Online" : "Offline") : "Not connected";
  const workerClass = connectionState === "connected" ? (workerOnline ? "online" : "negative") : "dryRunText";
  const liveChecksToday = (status.recentChecks ?? [])
    .filter((item) => item.kind === "live" && bucharestDate(item.checkedAt) === today)
    .sort((left, right) => new Date(right.checkedAt).getTime() - new Date(left.checkedAt).getTime());
  const isCheckEligible = (item: NonNullable<WorkerStatus["recentChecks"]>[number]) => item.result === "matched" && Boolean(item.marketId) && statusNow - new Date(item.checkedAt).getTime() <= config.maxSignalAgeSeconds * 1000;
  const preparedItems = liveChecksToday.filter((item) => preparedBatch.includes(item.id) && isCheckEligible(item));

  return <main>
    <header><div><p className="eyebrow">BETFAIR AUTOMATION</p><h1>LiveEdge Control</h1><p className="muted">One disciplined control surface for live execution.</p></div><div className={`mode ${status.mode}`}>{status.mode}</div></header>
    <section className="panel auth"><div><h2>Connection</h2><p className="muted">{connectionState === "connected" ? "Connected. Live status refreshes every 15 seconds." : connectionState === "connecting" ? "Connecting…" : "Connect once; this browser will reconnect automatically after refresh."}</p></div><label><span>Control token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="••••••••••••" /></label><button onClick={load} disabled={connectionState === "connecting"}>{connectionState === "connecting" ? "Connecting…" : "Connect"}</button>{connectionState === "connected" ? <button className="secondary" onClick={disconnect}>Disconnect</button> : null}</section>
    <section className="metrics">
      <article><span>P&amp;L today</span><strong className={pnl.today < 0 ? "negative" : ""}>{pnl.today.toFixed(2)} RON</strong></article>
      <article><span>P&amp;L this month</span><strong className={pnl.month < 0 ? "negative" : ""}>{pnl.month.toFixed(2)} RON</strong></article>
      <article><span>P&amp;L this year</span><strong className={pnl.year < 0 ? "negative" : ""}>{pnl.year.toFixed(2)} RON</strong></article>
      <article><span>P&amp;L forever</span><strong className={pnl.forever < 0 ? "negative" : ""}>{pnl.forever.toFixed(2)} RON</strong></article>
      <article><span>Bets today</span><strong>{status.betsToday}</strong></article>
      <article><span>Worker</span><strong className={workerClass}>{workerLabel}</strong></article>
    </section>
    <section className="panel systemStatus">
      <div className="panelTitle"><div><h2>System status</h2><p>Updated automatically every 15 seconds.</p></div></div>
      <div className="statusGrid">
        <article><span>Automation</span><strong className={config.enabled ? "online" : "negative"}>{config.enabled ? "Enabled" : "Paused"}</strong></article>
        <article><span>Worker</span><strong className={workerClass}>{workerLabel}</strong><small>{connectionState === "connected" ? `Heartbeat: ${heartbeatLabel}` : "Connect the dashboard to read heartbeat data"}</small></article>
        <article><span>Execution mode</span><strong className={status.mode === "live" ? "negative" : "dryRunText"}>{status.mode === "live" ? "LIVE" : "DRY-RUN"}</strong><small>{status.mode === "live" ? "Real orders may be submitted" : "No real bets can be placed"}</small></article>
        <article><span>Today&apos;s tickets</span><strong>{ticketStatus?.date === today ? "Received" : "Not received"}</strong><small>{ticketStatus ? `Cota 2: ${ticketStatus.cota2} selections · Ticket of day: ${ticketStatus.ticketOfDay} selections · ${ticketStatus.receivedAt}` : "Waiting for ticket input"}</small></article>
      </div>
      <div className="workerMessage"><span>Latest worker result</span><p>{status.lastMessage}</p></div>
      {liveChecksToday.length ? <div className="checkResults"><h3>Today&apos;s live checks</h3><p className="muted">Newest first. A selection expires after {config.maxSignalAgeSeconds} seconds and must be revalidated before use.</p><div className="tableWrap"><table><thead><tr><th>Batch</th><th>Checked</th><th>Event</th><th>Selection</th><th>Minute</th><th>Confidence</th><th>Betfair odds</th><th>Result</th><th>Reason</th></tr></thead><tbody>{liveChecksToday.map((item) => { const eligible = isCheckEligible(item); const displayResult = item.result === "matched" && !eligible ? "expired" : item.result.replaceAll("_", " "); const displayReason = item.result === "matched" && !eligible ? "Quote expired — wait for a fresh check" : item.reason; return <tr key={item.id}><td><input aria-label={`Select ${item.eventName}`} type="checkbox" disabled={!eligible} checked={eligible && selectedChecks.includes(item.id)} onChange={(event) => setSelectedChecks(event.target.checked ? [...selectedChecks, item.id] : selectedChecks.filter((id) => id !== item.id))} /></td><td>{new Date(item.checkedAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}</td><td>{item.eventName}</td><td>{item.selectionText}</td><td>{item.minute ?? "—"}</td><td>{item.confidence == null ? "—" : `${item.confidence}%`}</td><td>{item.availableOdds ?? "—"}</td><td><span className={`resultBadge ${eligible ? item.result : "rejected"}`}>{displayResult}</span></td><td>{displayReason}</td></tr>; })}</tbody></table></div><div className="saveRow"><button className="primary" disabled={!selectedChecks.some((id) => liveChecksToday.some((item) => item.id === id && isCheckEligible(item)))} onClick={() => setPreparedBatch(selectedChecks.filter((id) => liveChecksToday.some((item) => item.id === id && isCheckEligible(item))))}>Prepare selected batch</button><span>{selectedChecks.filter((id) => liveChecksToday.some((item) => item.id === id && isCheckEligible(item))).length} current selection(s) selected</span></div>{preparedItems.length ? <div className="workerMessage"><span>Prepared batch</span><p>{preparedItems.length} current selection(s). Open each verified Betfair market and complete the final placement manually.</p><div className="saveRow">{preparedItems.map((item) => <a className="button secondary" key={item.id} href={`https://www.betfair.ro/exchange/plus/market/${item.marketId}`} target="_blank" rel="noreferrer">{item.eventName} — {item.selectionText}</a>)}</div></div> : null}</div> : <div className="workerMessage"><span>Today&apos;s live checks</span><p>No live signals have been evaluated yet.</p></div>}
      {status.recentChecks?.some((item) => item.kind === "ticket") ? <div className="checkResults"><h3>Today&apos;s ticket checks</h3><div className="tableWrap"><table><thead><tr><th>Event</th><th>Selection</th><th>Betfair odds</th><th>Result</th><th>Reason</th></tr></thead><tbody>{status.recentChecks.filter((item) => item.kind === "ticket").map((item) => <tr key={item.id}><td>{item.eventName}</td><td>{item.selectionText}</td><td>{item.availableOdds ?? "—"}</td><td><span className={`resultBadge ${item.result}`}>{item.result.replaceAll("_", " ")}</span></td><td>{item.reason}</td></tr>)}</tbody></table></div></div> : null}
    </section>
    <section className="panel"><div className="panelTitle"><div><h2>Dry-run performance</h2><p>Hypothetical bets settled against actual Betfair market outcomes.</p></div></div>
      <div className="statusGrid simulationGrid">
        <article><span>Simulated P&amp;L today</span><strong className={pnl.simulated.today < 0 ? "negative" : "online"}>{pnl.simulated.today.toFixed(2)} RON</strong></article>
        <article><span>Simulated P&amp;L forever</span><strong className={pnl.simulated.forever < 0 ? "negative" : "online"}>{pnl.simulated.forever.toFixed(2)} RON</strong></article>
        <article><span>Open simulations</span><strong>{pnl.simulated.open}</strong></article>
        <article><span>Settled simulations</span><strong>{pnl.simulated.settled}</strong><small>{pnl.simulated.settled ? `${(pnl.simulated.winRate * 100).toFixed(1)}% win rate · ${(pnl.simulated.roi * 100).toFixed(1)}% ROI` : "Waiting for completed markets"}</small></article>
      </div>
    </section>
    <section className="panel"><div className="panelTitle"><div><h2>Algorithm controls</h2><p>Execution-window changes apply without rewriting the signal generator.</p></div><label className="switch"><input type="checkbox" checked={config.algorithmAutopilot} onChange={(event) => setConfig({ ...config, algorithmAutopilot: event.target.checked })} /><span>Autopilot {config.algorithmAutopilot ? "on" : "off"}</span></label></div>
      <div className="grid">{numberField("liveMinMinute", "Earliest live minute", 1)}{numberField("liveMaxMinute", "Latest live minute", 1)}{numberField("approvalWindowDays", "Auto-approval delay (1–5 days)", 1)}</div><div className="saveRow"><button className="primary" onClick={() => save("algorithm")} disabled={savingSection !== null}>{savingSection === "algorithm" ? "Saving…" : "Save algorithm controls"}</button>{saveStatus("algorithm")}</div>
    </section>
    <section className="panel"><div className="panelTitle"><div><h2>Risk limits</h2><p>Applied before every order, including imported tickets.</p></div><label className="switch"><input type="checkbox" checked={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} /><span>{config.enabled ? "Enabled" : "Paused"}</span></label></div>
      <div className="grid">{numberField("stakePerBet", "Stake per selection (RON)", .01)}{numberField("minLiveOdds", "Minimum live odds", .01)}{numberField("minLiveConfidence", "Minimum live confidence (%)", 1)}{numberField("maxDailyLoss", "Maximum daily loss (RON)", 1)}{numberField("dailyTakeProfit", "Daily take-profit (RON)", 1)}{numberField("maxSignalAgeSeconds", "Maximum signal age (seconds)", 1)}</div>
      <div className="saveRow"><button className="primary" onClick={() => save("risk")} disabled={savingSection !== null}>{savingSection === "risk" ? "Saving…" : "Save risk limits"}</button>{saveStatus("risk")}</div>
    </section>
    <section className="panel"><div className="panelTitle"><div><h2>Transactions</h2><p>Real and simulated Betfair singles.</p></div></div>
      <div className="filters"><label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label><span>Type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All</option><option value="live">Live</option><option value="ticket">Tickets</option></select></label><button onClick={loadTransactions}>Apply filter</button></div>
      <div className="tableWrap"><table><thead><tr><th>Date</th><th>Type</th><th>Event</th><th>Selection</th><th>Confidence</th><th>Odds</th><th>Stake</th><th>Status</th><th>P&amp;L</th></tr></thead><tbody>{transactions.map((row) => <tr key={String(row.id)}><td>{String(row.submitted_at ?? "").slice(0, 16).replace("T", " ")}</td><td>{String(row.kind ?? "")}</td><td>{String(row.event_name ?? "")}</td><td>{String(row.selection_text ?? "")}</td><td>{row.confidence == null ? "—" : `${row.confidence}%`}</td><td>{String(row.available_odds ?? "")}</td><td>{String(row.stake ?? "")} RON</td><td>{String(row.status ?? "")}</td><td>{row.profit == null ? "—" : `${row.profit} RON`}</td></tr>)}</tbody></table></div>
    </section>
    <section className="panel"><h2>Monthly algorithm review</h2><p>{reviews.length ? `${String(reviews[0].period_start)} — ${String(reviews[0].period_end)} · ${String(reviews[0].sample_size)} settled live bets` : "The first report will be generated on the first day of next month."}</p><div className="proposals">{proposals.filter((item) => item.status === "pending").map((item) => <article key={String(item.id)}><div><strong>Proposed change</strong><p>{String(item.rationale ?? "")}</p><small>{JSON.stringify(item.proposed_config)} · auto-apply: {String(item.auto_apply_at).slice(0, 16).replace("T", " ")}</small></div><div><button onClick={() => decide(item.id, "approve")}>Approve</button><button className="secondary" onClick={() => decide(item.id, "reject")}>Reject</button></div></article>)}</div></section>
    <section className="notice"><span>STATUS</span><p>{message}</p><small>{status.lastMessage}</small></section>
  </main>;
}

