-- CreateEnum
CREATE TYPE "data_source" AS ENUM ('network_json', 'dom_table');

-- CreateEnum
CREATE TYPE "blob_kind" AS ENUM ('network_json', 'html');

-- CreateEnum
CREATE TYPE "alert_kind" AS ENUM ('threshold_hit', 'projection_overrun', 'scrape_error', 'no_data_24h');

-- CreateTable
CREATE TABLE "usage_events" (
    "id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL,
    "model" TEXT NOT NULL,
    "row_hash" TEXT,
    "source_row" JSONB,
    "input_with_cache_write_tokens" INTEGER NOT NULL,
    "input_without_cache_write_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "api_cost_cents" INTEGER NOT NULL,
    "api_cost_raw" TEXT,
    "kind" TEXT,
    "max_mode" TEXT,
    "billing_period_start" DATE,
    "billing_period_end" DATE,
    "source" "data_source" NOT NULL,
    "raw_blob_id" UUID,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL,
    "billing_period_start" DATE,
    "billing_period_end" DATE,
    "table_hash" TEXT NOT NULL,
    "rows_count" INTEGER NOT NULL,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_blobs" (
    "id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL,
    "kind" "blob_kind" NOT NULL,
    "url" TEXT,
    "payload" BYTEA NOT NULL,
    "content_hash" TEXT,
    "content_type" TEXT,
    "schema_version" TEXT,
    "metadata" JSONB,

    CONSTRAINT "raw_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "effective_budget_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "kind" "alert_kind" NOT NULL,
    "details" TEXT NOT NULL,
    "triggered_at" TIMESTAMPTZ NOT NULL,
    "cleared_at" TIMESTAMPTZ,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_hourly" (
    "id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "ts_hour" TIMESTAMPTZ NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "metric_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_daily" (
    "id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "metric_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_row_hash_key" ON "usage_events"("row_hash");

-- CreateIndex
CREATE INDEX "usage_events_captured_at_idx" ON "usage_events"("captured_at");

-- Create unique composite index for deduplication by captured_at + total_tokens
CREATE UNIQUE INDEX "usage_events_captured_at_total_tokens_key" ON "usage_events"("captured_at","total_tokens");

-- CreateIndex
CREATE INDEX "snapshots_captured_at_idx" ON "snapshots"("captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_billing_period_start_billing_period_end_table_has_key" ON "snapshots"("billing_period_start", "billing_period_end", "table_hash");

-- CreateIndex
CREATE INDEX "alerts_triggered_at_idx" ON "alerts"("triggered_at");

-- CreateIndex
CREATE INDEX "metric_hourly_metric_key_ts_hour_idx" ON "metric_hourly"("metric_key", "ts_hour");

-- CreateIndex
CREATE INDEX "metric_daily_metric_key_date_idx" ON "metric_daily"("metric_key", "date");

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_raw_blob_id_fkey" FOREIGN KEY ("raw_blob_id") REFERENCES "raw_blobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
