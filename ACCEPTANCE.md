# Cursor Usage Tracker — Acceptance Criteria (2025 Stack)

The project is considered complete when all the following pass.

---

## Data Acquisition (HTTP CSV, Node)
- [x] Authentication verified by HTTP request to `usage-summary` using stored cookies; key fields present.
- [x] Hourly scraping downloads **CSV export** via authenticated HTTP and persists raw blob.
- [x] CSV → normalized rows mapping implemented and produces **normalized output**.
- [x] **Change detection** works: re-ingests do not create duplicate `usage_event` rows (row hash unchanged).
- [ ] CSV ingestion failures **log an error**, enqueue an **alert**, and a notifier email is sent.

## Scheduling & Workers
- [ ] An **hourly** schedule exists (BullMQ repeatable job or Vercel Cron) that triggers `scrape` safely (single leader, no duplicate runs).
- [ ] `aggregate` job runs after `scrape` and upserts materialized metrics, then **warms Redis cache** for dashboard queries.
- [ ] `housekeeping` job rotates logs and trims raw blob retention to the last 20 captures.

## Data Storage (PostgreSQL via Prisma)
- [x] Prisma schema includes all tables in §3 of SPEC.md (including enums and UUID PKs).
- [x] All numeric values are normalized (commas stripped, currency → **cents**, missing → `0`).
- [x] Historical data is retained indefinitely.
- [x] `usage_event.row_hash` stays stable for identical logical rows (verified by fixtures).
- [x] Appropriate indexes exist (see §3.2).

## Projections
- [ ] Linear projection returns the correct projected spend for provided fixtures.
- [ ] EWMA projection matches test fixture values for a given half‑life (default 7 days).
- [ ] Status label updates correctly (**On track / At risk / Over**).

## Alerts
- [ ] Threshold alerts **fire once per threshold per cycle**.
- [ ] Projection overrun alert **fires once per cycle**, and **clears when under budget for 48h**.
- [ ] Scrape error alert triggers when both methods fail.
- [ ] No‑data‑24h alert triggers appropriately.
- [ ] Emails are sent successfully via configured SMTP (Gmail App Password or other).

## Web App API (Next.js Route Handlers)
- [ ] All endpoints in §7.2 return expected JSON shapes with appropriate HTTP status codes.
- [ ] `/api/models` includes **cost per 1K tokens** for each model.
- [ ] `/api/cycle` and `/api/summary` reflect the **latest cycle** data.
- [ ] Endpoints leverage Redis caching where specified and respect cache revalidation settings.

## Dashboard UI (Next.js + React)
- [ ] Sidebar allows enabling/disabling any tile and the choice **persists** (local storage or user profile).
- [ ] All **7 initial tiles** render correctly with sample data.
- [ ] Budget update is possible via UI, is **role‑gated** (admin), and **persists**.
- [ ] Projection panel **toggles** between Linear and EWMA and updates the chart accordingly.
- [ ] Auth works (Auth.js); non‑authenticated users cannot access the dashboard.

## Deployment & Ops
- [ ] Web app deploys successfully to **Vercel** (or container) with environment variables configured.
- [ ] Worker container builds and runs with Playwright + Chromium; volumes for `/profile` and `/data` persist between restarts.
- [ ] Redis and Postgres are reachable from both web and workers (network/credentials validated).
- [ ] `/api/healthz` responds OK when app is running; worker heartbeat visible in logs/metrics.

## Testing & Resilience
- [ ] Unit tests pass for CSV normalization and change detection (projection tests pending) (vitest).
- [ ] Sample CSV fixtures parse correctly.
- [ ] E2E tests cover login/authorization flow, dashboard load, tile toggling, and budget update.
- [ ] Logs are structured (JSON) and write to `/data/logs/` with rotation if self‑hosted.
- [ ] Sentry is configured (DSN via env) and reports a forced test error in both web and worker.

## Security
- [ ] Auth secrets and SMTP credentials are not committed; environment configuration verified.
- [ ] DB uses least‑privilege role for the application; Prisma migrations applied via CI.
- [ ] HTTP security headers present; CSRF protection where applicable.

