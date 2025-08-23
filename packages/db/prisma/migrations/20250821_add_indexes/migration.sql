-- Migration: add_indexes (P3.1)

-- usage_events(captured_at)
CREATE INDEX IF NOT EXISTS idx_usage_events_captured_at ON usage_events (captured_at);

-- usage_events(model, captured_at) — model column not present yet in schema.
-- Attempt to create and ignore if column is missing, to be added in a later phase.
DO $$ BEGIN
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_usage_events_model_captured_at ON usage_events (model, captured_at)';
EXCEPTION
  WHEN undefined_column THEN
    RAISE NOTICE 'usage_events.model not found, skipping composite index for now';
END $$;

-- snapshots(captured_at)
CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at ON snapshots (captured_at);

-- snapshots unique on (billing_period_start, billing_period_end, table_hash)
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_cycle_hash_unique
  ON snapshots (billing_period_start, billing_period_end, table_hash);

-- alerts(triggered_at)
CREATE INDEX IF NOT EXISTS idx_alerts_triggered_at ON alerts (triggered_at);

-- metric_hourly(metric_key, ts_hour)
CREATE INDEX IF NOT EXISTS idx_metric_hourly_key_hour ON metric_hourly (metric_key, ts_hour);

-- metric_daily(metric_key, date)
CREATE INDEX IF NOT EXISTS idx_metric_daily_key_date ON metric_daily (metric_key, date);


