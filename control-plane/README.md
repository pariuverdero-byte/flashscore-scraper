# LiveEdge Control

Personal Betfair live-betting automation with a Vercel control plane and a separate long-running worker. It begins in **dry-run mode** and will not submit an order unless both server interlocks are explicitly enabled.

## Architecture

- Next.js dashboard: stake, minimum in-play odds, maximum daily loss, take-profit, signal age, pause/resume.
- Shared KV: persists controls and short-lived worker status across Vercel and the worker.
- Native inputs: reads the existing `../live-betting/data/signals.json`, `../live-betting/data/live_matches.json`, and `../tickets.json` artifacts without changing either algorithm.
- Worker: resolves native live signals and every generated ticket selection to Betfair, applies risk checks, and optionally calls `placeOrders`. Ticket selections are Exchange singles, not an accumulator.
- Betfair credentials and client certificates stay only on the worker.

Vercel Functions are not suitable for permanent in-play polling. Run `pnpm worker` on a persistent process (a private server/container) and deploy only the Next.js control plane to Vercel.

## Setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` for the dashboard. Set `CONTROL_API_TOKEN` and KV REST credentials.
3. Configure the same control token/KV via Vercel environment variables.
4. Give the worker its own environment containing the Betfair app key, username/password, certificate/key paths, control-plane URL, and token.
5. Run `pnpm dev`, connect with the control token, and save limits.
6. Run `pnpm worker` with `LIVE_BETTING_ENABLED=false` and review dry-run messages first.

The worker must run from `control-plane` in the same checkout as the existing engines. `REPOSITORY_ROOT=..` is the default. Native live signal IDs and deterministic ticket-selection fingerprints provide restart-safe deduplication.

Live execution additionally requires:

```dotenv
LIVE_BETTING_ENABLED=true
LIVE_BETTING_ACK=I_ACCEPT_LIVE_BETTING_RISK
```

Keep the dashboard's `Enabled` switch off until dry-run market matching has been manually validated. Betfair availability, licensing, and API access depend on account and jurisdiction.

## Verification

```bash
pnpm test
pnpm lint
pnpm build
```

## Known next production steps

- Replace fuzzy event/runner matching with a reviewed alias table and confidence threshold.
- Pull settled orders (`listClearedOrders`) into the daily ledger so loss/take-profit limits use authoritative realized P&L.
- Persist order/audit records and add idempotency across worker restarts.
- Expand the reviewed Romanian/English market alias tests as new native `market_raw` values appear.
- Add dashboard user authentication before exposing it beyond a private deployment.
