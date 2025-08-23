-- Migration: init_base_models
-- Minimal Prisma models for Phase P2.2 with required fields

-- Create enum types
CREATE TYPE data_source AS ENUM ('network_json', 'dom_table');
CREATE TYPE blob_kind AS ENUM ('network_json', 'html');

-- RawBlob table
CREATE TABLE IF NOT EXISTS raw_blobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at TIMESTAMPTZ NOT NULL,
  kind        blob_kind NOT NULL,
  url         TEXT,
  payload     BYTEA NOT NULL
);

-- UsageEvent table
CREATE TABLE IF NOT EXISTS usage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at TIMESTAMPTZ NOT NULL,
  source      data_source NOT NULL,
  raw_blob_id UUID,
  CONSTRAINT fk_usage_events_raw_blob FOREIGN KEY (raw_blob_id) REFERENCES raw_blobs(id)
);

-- Snapshot table
CREATE TABLE IF NOT EXISTS snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at           TIMESTAMPTZ NOT NULL,
  billing_period_start  DATE,
  billing_period_end    DATE,
  table_hash            TEXT NOT NULL,
  rows_count            INTEGER NOT NULL
);

