-- Migration: add UsageEvent detail fields

DO $$ BEGIN
  ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS model TEXT,
    ADD COLUMN IF NOT EXISTS input_with_cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS input_without_cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS api_cost_cents INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cost_to_you_cents INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS billing_period_start DATE,
    ADD COLUMN IF NOT EXISTS billing_period_end DATE;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'usage_events table not found, skipping';
END $$;


