-- Migration: add_budgets_alerts_metrics (P2.3)

-- Note: metrics are implemented as regular tables for now (simpler). They may
-- be replaced with materialized views in a later phase without changing the
-- Prisma client API by creating views with the same names.

-- Enums
DO $$ BEGIN
  CREATE TYPE alert_kind AS ENUM ('threshold_hit', 'projection_overrun', 'scrape_error', 'no_data_24h');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_budget_cents  INTEGER NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          alert_kind NOT NULL,
  details       TEXT NOT NULL,
  triggered_at  TIMESTAMPTZ NOT NULL,
  cleared_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered_at ON alerts (triggered_at);

-- Metric hourly
CREATE TABLE IF NOT EXISTS metric_hourly (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key  TEXT NOT NULL,
  ts_hour     TIMESTAMPTZ NOT NULL,
  value       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_hourly_key_hour ON metric_hourly (metric_key, ts_hour);

-- Metric daily
CREATE TABLE IF NOT EXISTS metric_daily (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key  TEXT NOT NULL,
  date        DATE NOT NULL,
  value       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_daily_key_date ON metric_daily (metric_key, date);


