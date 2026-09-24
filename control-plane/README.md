# LiveEdge Control

Personal Betfair live-betting automation with a Vercel control plane and a separate long-running worker. It begins in **dry-run mode** and will not submit an order unless both server interlocks are explicitly enabled.

## Architecture

- Next.js dashboard: stake, minimum in-play odds, maximum daily loss, take-profit, signal age, pause/resume.
- Neon Postgres: persists controls, worker status, transactions, P&L, monthly reviews, and algorithm proposals.
- Native inputs: reads the existing `../live-betting/data/signals.json`, `../live-betting/data/live_matches.json`, and `../tickets.json` artifacts without changing either algorithm.
- Worker: resolves native live signals and every generated ticket selection to Betfair, applies risk checks, and optionally calls `placeOrders`. Ticket selections are Exchange singles, not an accumulator.
- Betfair credentials and client certificates stay only on the worker.
- Existing GitHub Actions workflows can invoke the same worker once, directly after they generate `signals.json` or `tickets.json`; no scraper or second ticket pipeline is involved.

Vercel Functions are not suitable for permanent in-play polling. Run `pnpm worker` on a persistent process (a private server/container) and deploy only the Next.js control plane to Vercel.

## Setup

1. Install dependencies with `pnpm install`.
2. Provision Neon through the Vercel Marketplace so `DATABASE_URL` is injected into the project.
3. Configure `CONTROL_API_TOKEN` and `CRON_SECRET` as sensitive Vercel environment variables.
4. Give the worker its own environment containing the Betfair app key, username/password, certificate/key paths, control-plane URL, and token.
5. Run `pnpm dev`, connect with the control token, and save limits.
6. On this Windows workstation, run `scripts/run-worker-local.ps1`; it loads DPAPI-encrypted credentials and forces `LIVE_BETTING_ENABLED=false`.

To connect the browser dashboard without displaying its token, run `scripts/copy-control-token.ps1`, paste the clipboard value into the Connection field, click Connect, return to PowerShell, and press Enter to clear the clipboard.

The worker must run from `control-plane` in the same checkout as the existing engines. `REPOSITORY_ROOT=..` is the default. Native live signal IDs and deterministic ticket-selection fingerprints provide restart-safe deduplication.

Live execution additionally requires:

```dotenv
LIVE_BETTING_ENABLED=true
LIVE_BETTING_ACK=I_ACCEPT_LIVE_BETTING_RISK
```

Keep the dashboard's `Enabled` switch off until dry-run market matching has been manually validated. Betfair availability, licensing, and API access depend on account and jurisdiction.

## Existing GitHub Actions integration

Both existing generation workflows contain an optional Betfair dry-run step. It is skipped unless the repository secret `BETFAIR_AUTOMATION_CONFIGURED` is exactly `true`. The step reuses the generated files already present on the runner and invokes `worker/index.ts --once`.

Required GitHub repository secrets are `BETFAIR_APP_KEY`, `BETFAIR_USERNAME`, `BETFAIR_PASSWORD`, `BETFAIR_CERT_B64`, `BETFAIR_KEY_B64`, and `CONTROL_API_TOKEN`. Store the certificate and private key as base64 values. The runner decodes them into a temporary directory and removes that directory on exit.

The committed workflow forces `LIVE_BETTING_ENABLED=false`; therefore it cannot place an order even when the dashboard is enabled. The five-minute GitHub schedule is suitable for integration dry-runs, but not for latency-sensitive production in-play execution. Keep the persistent worker architecture for eventual live operation.

## Verification

```bash
pnpm test
pnpm lint
pnpm build
```

## Known next production steps

- Run the worker on a persistent private host after validating local dry-run market matching over a representative sample.
- Activate the Betfair Live App Key only after delayed-key testing and Betfair approval.
- Expand the reviewed Romanian/English market aliases as new native `market_raw` values appear.
- Replace the shared control token with user authentication before sharing the dashboard with other people.
