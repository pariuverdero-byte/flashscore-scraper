"use client";

import { useState } from "react";
import { defaultConfig, type BettingConfig } from "@/lib/config";
import type { WorkerStatus } from "@/lib/store";

const emptyStatus: WorkerStatus = { lastHeartbeat: null, mode: "dry-run", pnlToday: 0, betsToday: 0, lastMessage: "Not connected" };
const emptyPnl = { today: 0, month: 0, year: 0, forever: 0 };

export default function Dashboard() {
  const [token, setToken] = useState(() => typeof window === "undefined" ? "" : sessionStorage.getItem("control-token") ?? "");
  const [config, setConfig] = useState<BettingConfig>(defaultConfig);
  const [status, setStatus] = useState<WorkerStatus>(emptyStatus);
  const [message, setMessage] = useState("Enter the control token to load settings.");
  const [transactions, setTransactions] = useState<Array<Record<string, unknown>>>([]);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState("all");
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>([]);
  const [proposals, setProposals] = useState<Array<Record<string, unknown>>>([]);
  const [pnl, setPnl] = useState(emptyPnl);

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
  }

  async function load() {
    try {
      sessionStorage.setItem("control-token", token);
      const [nextConfig, nextStatus, nextReviews, nextProposals, nextPnl] = await Promise.all([request("/api/config"), request("/api/status"), request("/api/reviews").catch(() => []), request("/api/proposals").catch(() => []), request("/api/pnl").catch(() => emptyPnl)]);
      setConfig(nextConfig); setStatus(nextStatus); setReviews(nextReviews); setProposals(nextProposals); setPnl(nextPnl); setMessage("Controls loaded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load"); }
  }

  async function save() {
    try {
      const saved = await request("/api/config", { method: "PUT", body: JSON.stringify(config) });
      setConfig(saved); setMessage(config.enabled ? "Saved. Worker enabled subject to server safety interlock." : "Saved. Worker paused.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save"); }
  }

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
      <article><span>P&amp;L today</span><strong className={pnl.today < 0 ? "negative" : ""}>€{pnl.today.toFixed(2)}</strong></article>
      <article><span>P&amp;L this month</span><strong className={pnl.month < 0 ? "negative" : ""}>€{pnl.month.toFixed(2)}</strong></article>
      <article><span>P&amp;L this year</span><strong className={pnl.year < 0 ? "negative" : ""}>€{pnl.year.toFixed(2)}</strong></article>
      <article><span>P&amp;L forever</span><strong className={pnl.forever < 0 ? "negative" : ""}>€{pnl.forever.toFixed(2)}</strong></article>
      <article><span>Bets today</span><strong>{status.betsToday}</strong></article>
      <article><span>Worker</span><strong>{status.lastHeartbeat ? "Online" : "Offline"}</strong></article>
    </section>
    <section className="panel"><div className="panelTitle"><div><h2>Algorithm controls</h2><p>Execution-window changes apply without rewriting the signal generator.</p></div><label className="switch"><input type="checkbox" checked={config.algorithmAutopilot} onChange={(event) => setConfig({ ...config, algorithmAutopilot: event.target.checked })} /><span>Autopilot {config.algorithmAutopilot ? "on" : "off"}</span></label></div>
      <div className="grid">{numberField("liveMinMinute", "Earliest live minute", 1)}{numberField("liveMaxMinute", "Latest live minute", 1)}{numberField("approvalWindowDays", "Auto-approval delay (1–5 days)", 1)}</div><button className="primary" onClick={save}>Save algorithm controls</button>
    </section>
    <section className="panel auth"><h2>Connection</h2><label><span>Control token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="••••••••••••" /></label><button onClick={load}>Connect</button></section>
    <section className="panel"><div className="panelTitle"><div><h2>Risk limits</h2><p>Applied before every order, including imported tickets.</p></div><label className="switch"><input type="checkbox" checked={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} /><span>{config.enabled ? "Enabled" : "Paused"}</span></label></div>
      <div className="grid">{numberField("stakePerBet", "Stake per selection (€)", .01)}{numberField("minLiveOdds", "Minimum live odds", .01)}{numberField("minLiveConfidence", "Minimum live confidence (%)", 1)}{numberField("maxDailyLoss", "Maximum daily loss (€)", 1)}{numberField("dailyTakeProfit", "Daily take-profit (€)", 1)}{numberField("maxSignalAgeSeconds", "Maximum signal age (seconds)", 1)}</div>
      <button className="primary" onClick={save}>Save controls</button>
    </section>
    <section className="panel"><div className="panelTitle"><div><h2>Transactions</h2><p>Submitted and settled Betfair singles.</p></div></div>
      <div className="filters"><label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label><span>Type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All</option><option value="live">Live</option><option value="ticket">Tickets</option></select></label><button onClick={loadTransactions}>Apply filter</button></div>
      <div className="tableWrap"><table><thead><tr><th>Date</th><th>Type</th><th>Event</th><th>Selection</th><th>Confidence</th><th>Odds</th><th>Stake</th><th>Status</th><th>P&amp;L</th></tr></thead><tbody>{transactions.map((row) => <tr key={String(row.id)}><td>{String(row.submitted_at ?? "").slice(0, 16).replace("T", " ")}</td><td>{String(row.kind ?? "")}</td><td>{String(row.event_name ?? "")}</td><td>{String(row.selection_text ?? "")}</td><td>{row.confidence == null ? "—" : `${row.confidence}%`}</td><td>{String(row.available_odds ?? "")}</td><td>€{String(row.stake ?? "")}</td><td>{String(row.status ?? "")}</td><td>{row.profit == null ? "—" : `€${row.profit}`}</td></tr>)}</tbody></table></div>
    </section>
    <section className="panel"><h2>Monthly algorithm review</h2><p>{reviews.length ? `${String(reviews[0].period_start)} — ${String(reviews[0].period_end)} · ${String(reviews[0].sample_size)} settled live bets` : "The first report will be generated on the first day of next month."}</p><div className="proposals">{proposals.filter((item) => item.status === "pending").map((item) => <article key={String(item.id)}><div><strong>Proposed change</strong><p>{String(item.rationale ?? "")}</p><small>{JSON.stringify(item.proposed_config)} · auto-apply: {String(item.auto_apply_at).slice(0, 16).replace("T", " ")}</small></div><div><button onClick={() => decide(item.id, "approve")}>Approve</button><button className="secondary" onClick={() => decide(item.id, "reject")}>Reject</button></div></article>)}</div></section>
    <section className="notice"><span>STATUS</span><p>{message}</p><small>{status.lastMessage}</small></section>
  </main>;
}
