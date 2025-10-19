# Cursor Usage Tracker — Specification (2025 Stack)

## 1. Overview
This application tracks usage data from the Cursor Pro “Usage” page for users without Admin API access. It collects hourly snapshots (only when usage changes), stores all history, and provides a web dashboard with charts, breakdowns, and projections. It also sends email alerts for thresholds, over‑budget projections, and scraping failures.

**Primary stack (2025):**
- **TypeScript** throughout.
- **Scraper & Workers:** Node.js + **BullMQ** (Redis). (Acquisition uses HTTP CSV export; Playwright is optional.)
- **Web App / API:** **Next.js (App Router)** on Node (Server Components + Route Handlers + Server Actions).
- **Database:** **PostgreSQL** (managed preferred: Neon/Supabase/RDS).
- **ORM:** **Prisma** (migrations + typed client).
- **Cache / Queue:** **Redis** (Upstash/ElastiCache).
- **Auth:** **Auth.js (NextAuth)** with email/OAuth.
- **UI:** React + **Recharts** (or ECharts) + **TanStack Query** for client data fetching.
- **Observability:** OpenTelemetry traces + **Sentry** for errors.
- **CI/CD:** GitHub Actions; deploy web on Vercel or container; workers containerized.

---

## 2. Data Acquisition

### 2.1 Primary: HTTP (Node) + CSV Export
- **Authentication:**
  - Persist minimal cookie state in `cursor.state.json`.
  - Verify authentication by calling `https://cursor.com/api/usage-summary` and checking required fields: `billingCycleStart`, `billingCycleEnd`, `membershipType`.
- **Scheduled scraping (`scrape` job):**
  - Build `Cookie` header from stored cookies.
  - Download `https://cursor.com/api/dashboard/export-usage-events-csv`.
  - Persist raw CSV as compressed blob.
  - Parse CSV to **normalized records** (see §3).

### 2.2 Notes
- DOM scraping via Playwright is no longer required for normal operation.
- A future optional UI‑driven onboarding flow may reintroduce a manual login redirect, but scraping will remain HTTP‑based.

### 2.3 Reliability & Retention
- On CSV download or parsing failure, **log error and enqueue an alert** event for the notifier worker.
- Retain last **20 raw captures** (CSV) for debugging in `raw_blobs` (compressed).

### 2.4 Scheduling
- Preferred: **BullMQ repeatable jobs** scheduled hourly (single leader worker).
- Alternative: **Vercel Cron** hitting a protected API route that enqueues work.
- Jobs:
  - `scrape` (hourly) → download CSV & store raw rows; currently the scraper performs inline snapshot creation.
  - `aggregate` (on‑demand after scrape) → compute materialized metrics & warm caches. (Planned; snapshot creation is inline today.)
  - `housekeeping` (daily) → rotate logs and trim raw blob retention.

---

## 3. Data Model (PostgreSQL via Prisma)

### 3.1 Tables
- **usage_events**  
  - `id` (pk, uuid)  
  - `captured_at` (timestamptz, UTC)  
  - `model` (text)  
  - `input_with_cache_write_tokens` (integer)  
  - `input_without_cache_write_tokens` (integer)  
  - `cache_read_tokens` (integer)  
  - `output_tokens` (integer)  
  - `total_tokens` (integer)  
  - `api_cost_cents` (integer)  
  - `cost_to_you_cents` (integer)  
  - `billing_period_start` (date)  
  - `billing_period_end` (date)  
  - `source` (enum: `network_json` | `dom_table`)  
  - `raw_blob_id` (uuid, fk → `raw_blobs.id`, nullable)

- **snapshots**  
  - `id` (pk, uuid)  
  - `captured_at` (timestamptz, UTC)  
  - `billing_period_start` (date)  
  - `billing_period_end` (date)  
  - `table_hash` (text, sha256)  
  - `rows_count` (integer)

- **raw_blobs**  
  - `id` (pk, uuid)  
  - `captured_at` (timestamptz, UTC)  
  - `kind` (enum: `network_json` | `html`)  
  - `url` (text, nullable)  
  - `payload` (bytea, gzip)  

- **budgets**  
  - `id` (pk, uuid)  
  - `effective_budget_cents` (integer)  
  - `created_at` (timestamptz, UTC)

- **alerts**  
  - `id` (pk, uuid)  
  - `kind` (enum: `threshold_hit` | `projection_overrun` | `scrape_error` | `no_data_24h`)  
  - `details` (text)  
  - `triggered_at` (timestamptz, UTC)  
  - `cleared_at` (timestamptz, UTC, nullable)

- **users** (for Auth.js adapter, minimal RBAC)  
  - `id` (pk) and fields required by chosen adapter (e.g., Prisma Auth.js schema).  
  - `role` (enum: `viewer` | `admin`, default `viewer`).

- **metrics (materialized)**  
  - `metric_hourly` (`id`, `metric_key`, `ts_hour`, `value`)  
  - `metric_daily` (`id`, `metric_key`, `date`, `value`)  
  (As tables or Postgres **materialized views** refreshed by the aggregator job.)

### 3.2 Indexes
- `usage_events(captured_at)`; `usage_events(model, captured_at)`  
- `snapshots(captured_at)`; unique on `(billing_period_start, billing_period_end, table_hash)`  
- `alerts(triggered_at)`  
- `metric_hourly(metric_key, ts_hour)`; `metric_daily(metric_key, date)`

### 3.3 Normalization Rules
- Missing numeric → `0`  
- Strip commas; currency → **cents** (integer)  
- `total_tokens` computed if missing  
- Always store **UTC** timestamps

---

## 4. Change Detection
- Build **stable JSON** of sorted, normalized rows + billing period.
- Compute **sha256** → compare with last snapshot’s `table_hash`.
- Only insert new snapshot & events when hash differs.

---

## 5. Projections

### 5.1 Inputs
- Current cycle spend
- Daily spend history
- Cycle start/end dates
- Budget from `budgets`

### 5.2 Linear
`avg = spend_to_date / days_elapsed`  
`projected = avg * total_days`

### 5.3 EWMA
Default half‑life: **7 days**.  
`alpha = 1 - exp(-ln(2) / half_life_days)`  
`ewma_t = alpha * spend_t + (1 - alpha) * ewma_{t-1}`

### 5.4 Status
- **On track:** `projected <= budget * 0.95`
- **At risk:** `budget * 0.95 < projected <= budget`
- **Over:** `projected > budget`

---

## 6. Alerts (Email via SMTP)
- **Threshold alerts:** fire when spend crosses configured thresholds (default $5, $10, $15, $18).  
- **Projection overrun:** once per cycle if `projected > budget`.  
- **Scrape error:** when both acquisition methods fail.  
- **No data 24h:** when last success > 24h ago.  
- Transport: Gmail SMTP with App Password or any SMTP creds; config in env.  
- Emitted as queue events → handled by **notifier worker**.

---

## 7. Web App & API

### 7.1 Tech
- **Next.js (App Router)** with **Route Handlers** for API endpoints.  
- **Server Components** for static/ISR pages; **Client Components** where interactivity/charts are needed.  
- **Auth.js** for authentication; **RBAC** via `role`.  
- **Caching:**  
  - **Redis** object cache for expensive reads.  
  - **ISR / route segment caching** with `revalidate` for dashboards.  
  - HTTP caching at CDN edge where safe.

### 7.2 API Routes (under `/api`)
- `GET /api/cycle` — cycle metadata  
- `GET /api/summary` — spend to date, projection, status  
- `GET /api/daily` — daily spend & tokens  
- `GET /api/models` — per‑model breakdown (includes **cost per 1K tokens**)  
- `GET /api/tiles` — available tile IDs + names  
- `POST /api/budget` — update budget (admin only)  
- `GET /api/healthz` — health check for container/uptime

### 7.3 UI
- **Dashboard** built with React + Recharts (or ECharts).  
- **Sidebar** toggles tiles on/off (persist to local storage or user profile).  
- **Initial tiles:**
  1. Cumulative spend vs time
  2. Daily spend
  3. Tokens by type (stacked area)
  4. Spend by model
  5. Cost per 1K tokens by model
  6. Cache efficiency
  7. Projection panel (toggle Linear/EWMA)

---

## 8. Services & Processes

- **Web (Next.js)**: can run on Vercel (recommended) or containerized Node.  
- **Worker**:
  - **Scraper worker**: Playwright jobs + enqueue `aggregate`.  
  - **Aggregator worker**: computes/upserts `metric_*` tables & warms Redis.  
  - **Notifier worker**: consumes alert events and sends emails.  
- All workers share a **Redis** and **Postgres**.  
- Use **BullMQ** queues: `scrape`, `aggregate`, `alerts`, with DLQs and backoff.

---

## 9. Config & Security
- Env vars (examples):  
  - `DATABASE_URL` (Postgres)  
  - `REDIS_URL`  
  - `PLAYWRIGHT_USER_DATA_DIR` (mounted volume path)  
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`  
  - `AUTH_SECRET`, `AUTH_URL` (Auth.js)  
  - `DASH_DEFAULT_THRESHOLDS` (comma‑sep dollars)  
  - `PROJECTION_HALF_LIFE_DAYS`  
- Principle of least privilege DB roles.  
- Secrets in managed store (Vercel/1Password/AWS SM).  
- Helmet‑style secure headers; CSRF for form posts as applicable.

---

## 10. Docker & Deployment
- **Workers**: Node 20 base + Playwright dependencies & Chromium.  
  - Volumes:  
    - `/data` — logs, temporary artifacts  
    - `/profile` — Chromium profile (persisted)  
  - Healthcheck: liveness via Redis ping & a self‑reported heartbeat.
- **Web**: Deploy on **Vercel** (preferred) with `vercel.json` cron to call enqueue route, or containerize (Node 20 + Next build).
- **Redis/Postgres**: managed services (Upstash/Neon/etc.).
- **Restart policy**: `unless-stopped` (if self‑hosted).

---

## 11. Observability & Logging
- **OpenTelemetry** SDK in web and workers; propagate trace IDs through BullMQ.  
- **Sentry** in browser and server with release tagging.  
- Structured logs (JSON) with request IDs; rotate if self‑hosted.

---

## 12. Testing
- **Unit**: vitest for normalization, projections, hashing.  
- **API**: supertest (route handlers) or Next’s request test utils.  
- **E2E**: Playwright for dashboard flows + login.  
- **Fixtures**: sample HTML/JSON captures for parsers.  
- **Load**: k6/Artillery on hot endpoints.

---

## 13. Future Enhancements
- Model price override & historical price tables.  
- Workspace/account breakdown.  
- Export CSV/Parquet.  
- Push/mobile notifications.  
- Multi‑user tenancy (Org → Users → Roles).
