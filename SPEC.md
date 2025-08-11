# Cursor Usage Tracker — Specification

## 1. Overview
This application tracks usage data from the Cursor Pro “Usage” page for users without Admin API access. It collects hourly snapshots (only when usage changes), stores all history, and provides a local browser-accessible dashboard with charts, breakdowns, and projections. It also sends email alerts for thresholds, over-budget projections, and scraping failures.

---

## 2. Data Acquisition

### 2.1 Primary: Playwright + Network Capture
- On first run (`onboard` command), launch Chromium non-headless with a persistent user-data-dir so the user can log in manually.
- On subsequent runs (`scrape` command), use headless Chromium with the stored profile.
- Navigate to the Cursor Usage page.
- Listen for network responses while the page loads.
- Capture JSON payloads containing usage data (URLs containing `usage`, `spend`, `billing`).
- Parse JSON into normalized records (see §3).

### 2.2 Fallback: DOM Table Parsing
- Locate the usage table with headings:
  `MODEL`, `INPUT (W/ CACHE WRITE)`, `INPUT (W/O CACHE WRITE)`, `CACHE READ`, `OUTPUT`, `TOTAL TOKENS`, `API COST`, `COST TO YOU`.
- Read current billing period text.
- Parse rows into normalized records (see §3).
- Generate a stable hash of normalized rows for change detection.

### 2.3 Reliability
- If both methods fail, log error and send email alert.
- Retain last 20 raw captures (JSON or HTML) for debugging.

### 2.4 Scheduling
- Run scraping job hourly via APScheduler or systemd timer.
- Skip insert if normalized table hash matches last snapshot.

---

## 3. Data Model

### 3.1 Tables (SQLite)
- **usage_events**  
  - id (pk)  
  - captured_at (UTC datetime)  
  - model (text)  
  - input_with_cache_write_tokens (int)  
  - input_without_cache_write_tokens (int)  
  - cache_read_tokens (int)  
  - output_tokens (int)  
  - total_tokens (int)  
  - api_cost_cents (int)  
  - cost_to_you_cents (int)  
  - billing_period_start (date)  
  - billing_period_end (date)  
  - source (enum: `network_json` | `dom_table`)  
  - raw_blob_id (fk → raw_blobs.id)

- **snapshots**  
  - id (pk)  
  - captured_at (UTC)  
  - billing_period_start (date)  
  - billing_period_end (date)  
  - table_hash (text, sha256)  
  - rows_count (int)

- **raw_blobs**  
  - id (pk)  
  - captured_at (UTC)  
  - kind (enum: `network_json` | `html`)  
  - url (text, nullable)  
  - payload (blob, compressed)

- **budgets**  
  - id (pk)  
  - effective_budget_cents (int)  
  - created_at (UTC)

- **alerts**  
  - id (pk)  
  - kind (enum: `threshold_hit` | `projection_overrun` | `scrape_error` | `no_data_24h`)  
  - details (text)  
  - triggered_at (UTC)  
  - cleared_at (UTC, nullable)

### 3.2 Indexes
- usage_events: (captured_at), (model, captured_at)
- snapshots: (captured_at)
- alerts: (triggered_at)

### 3.3 Normalization Rules
- Missing numeric → 0
- Remove commas, convert currency to cents
- total_tokens computed if missing
- Always store UTC

---

## 4. Change Detection
- Stable JSON of sorted, normalized rows + billing period
- sha256 hash compared to last snapshot
- Only insert when different

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
Half-life default: 7 days  
`alpha = 1 - exp(-ln(2) / half_life_days)`  
`ewma_t = alpha * spend_t + (1 - alpha) * ewma_{t-1}`

### 5.4 Status
- On track: projected <= budget * 0.95
- At risk: budget * 0.95 < projected <= budget
- Over: projected > budget

---

## 6. Alerts (Gmail SMTP)
- Threshold alerts: fire when spend crosses configured thresholds (default $5, $10, $15, $18)
- Projection overrun: once per cycle if projected > budget
- Scrape error: when both methods fail
- No data 24h: when last success > 24h ago
- Use Gmail App Password, SMTP over TLS, config in `.env`

---

## 7. Dashboard

### 7.1 Tech
- FastAPI backend, Chart.js or ECharts frontend
- Bind to 0.0.0.0 for LAN access
- Basic auth for write ops

### 7.2 REST Endpoints
- `GET /api/cycle` — cycle metadata
- `GET /api/summary` — spend to date, projection, status
- `GET /api/daily` — daily spend & tokens
- `GET /api/models` — per-model breakdown
- `GET /api/tiles` — available tile IDs + names
- `POST /api/budget` — update budget
- `GET /healthz` — for container healthcheck

### 7.3 Initial Tiles
1. Cumulative spend vs time
2. Daily spend
3. Tokens by type (stacked area)
4. Spend by model
5. Cost per 1K tokens by model
6. Cache efficiency
7. Projection panel

---

## 8. Config & Security
- Env vars: `BIND`, `DATA_DIR`, `USER_DATA_DIR`, `DASH_USER`, `DASH_PASS`, SMTP vars, thresholds, half-life
- Store Chromium profile in `USER_DATA_DIR` volume
- API key/passwords in env or system keyring (if non-Docker)

---

## 9. Docker
- Base: playwright/python
- Volumes:  
  - `./data:/app/data` — DB & raw blobs  
  - `./profile:/app/profile` — Chromium profile  
  - `./.env:/app/.env:ro` — config
- Healthcheck: `/healthz`
- Restart policy: unless-stopped
- Onboarding: run once non-headless to log in, then headless for scheduled jobs

---

## 10. Resilience & Testing
- Unit tests for normalization, hash detection, projections
- Fixtures for HTML & JSON captures
- Logs with levels, rotated in `data/logs/`
- Optional `/metrics` endpoint

---

## 11. Future Enhancements
- Model price override
- Per-workspace breakdown
- Export CSV/Parquet
- Push notifications
- Multi-user support
