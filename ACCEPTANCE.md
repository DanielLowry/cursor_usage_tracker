# Cursor Usage Tracker — Acceptance Criteria

The project is considered complete when all the following pass.

---

## Data Acquisition
- [ ] First-run onboarding launches Chromium, user can log in to Cursor, and profile persists.
- [ ] Hourly headless scraping succeeds with network JSON capture.
- [ ] If network capture fails, DOM table parser runs and produces equivalent normalized output.
- [ ] Change detection works: no duplicate snapshots for identical data.
- [ ] Failing both methods logs error and sends email alert.

## Data Storage
- [ ] SQLite schema matches §3 in SPEC.md.
- [ ] All numeric values normalized (commas stripped, currency → cents, missing → 0).
- [ ] Historical data retained indefinitely.
- [ ] `snapshots.table_hash` changes only when data changes.

## Projections
- [ ] Linear projection returns correct projected spend.
- [ ] EWMA projection matches test fixture values for given half-life.
- [ ] Status label updates correctly (On track / At risk / Over).

## Alerts
- [ ] Threshold alerts fire once per threshold per cycle.
- [ ] Projection overrun alert fires once per cycle, clears when under budget for 48h.
- [ ] Scrape error alert triggers when both methods fail.
- [ ] No data 24h alert triggers appropriately.
- [ ] Alerts send successfully via Gmail SMTP with App Password.

## Dashboard API
- [ ] All endpoints in §7.2 return expected JSON shapes.
- [ ] `/api/models` includes cost per 1K tokens for each model.
- [ ] `/api/cycle` and `/api/summary` reflect latest cycle data.

## Dashboard UI
- [ ] Sidebar allows enabling/disabling any tile.
- [ ] All 7 initial tiles render correctly with sample data.
- [ ] Budget update is possible via UI and persists.
- [ ] Projection panel toggle between Linear and EWMA works.

## Docker
- [ ] Container builds successfully with Dockerfile.
- [ ] Volumes `data` and `profile` persist between restarts.
- [ ] `.env` config read correctly inside container.
- [ ] `/healthz` responds OK when app running.

## Testing & Resilience
- [ ] Unit tests pass for normalization, projections, change detection.
- [ ] Sample HTML/JSON fixtures parse correctly.
- [ ] Logs write to `data/logs/` and rotate.
