-- CreateEnum
CREATE TYPE "data_source" AS ENUM ('network_json', 'dom_table');

-- CreateEnum
CREATE TYPE "blob_kind" AS ENUM ('network_json', 'html');

-- CreateEnum
CREATE TYPE "alert_kind" AS ENUM ('threshold_hit', 'projection_overrun', 'scrape_error', 'no_data_24h');

-- CreateTable
CREATE TABLE "usage_event" (
    "row_hash" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL,
    "kind" TEXT,
    "model" TEXT NOT NULL,
    "max_mode" TEXT,
    "input_with_cache_write_tokens" INTEGER NOT NULL,
    "input_without_cache_write_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "api_cost_cents" INTEGER NOT NULL,
    "api_cost_raw" TEXT,
    "cost_to_you_cents" INTEGER NOT NULL,
    "cost_to_you_raw" TEXT,
    "billing_period_start" DATE,
    "billing_period_end" DATE,
    "source" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "logic_version" INTEGER,

    CONSTRAINT "usage_event_pkey" PRIMARY KEY ("row_hash")
);

-- CreateTable
CREATE TABLE "raw_blobs" (
    "id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL,
    "kind" "blob_kind" NOT NULL,
    "url" TEXT,
    "payload" BYTEA NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content_type" TEXT,
    "schema_version" TEXT,
    "metadata" JSONB,

    CONSTRAINT "raw_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "ingested_at" TIMESTAMPTZ NOT NULL,
    "content_hash" TEXT,
    "headers" JSONB,
    "metadata" JSONB,
    "status" TEXT NOT NULL,
    "raw_blob_id" UUID,

    CONSTRAINT "ingestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_ingestion" (
    "row_hash" TEXT NOT NULL,
    "ingestion_id" UUID NOT NULL,

    CONSTRAINT "event_ingestion_pkey" PRIMARY KEY ("row_hash","ingestion_id")
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
CREATE INDEX "usage_event_billing_period_start_billing_period_end_idx" ON "usage_event"("billing_period_start", "billing_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "raw_blobs_content_hash_key" ON "raw_blobs"("content_hash");

-- CreateIndex
CREATE INDEX "ingestion_ingested_at_idx" ON "ingestion"("ingested_at");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_content_hash_key" ON "ingestion"("content_hash");

-- CreateIndex
CREATE INDEX "event_ingestion_ingestion_id_idx" ON "event_ingestion"("ingestion_id");

-- CreateIndex
CREATE INDEX "alerts_triggered_at_idx" ON "alerts"("triggered_at");

-- CreateIndex
CREATE INDEX "metric_hourly_metric_key_ts_hour_idx" ON "metric_hourly"("metric_key", "ts_hour");

-- CreateIndex
CREATE INDEX "metric_daily_metric_key_date_idx" ON "metric_daily"("metric_key", "date");

-- AddForeignKey
ALTER TABLE "ingestion" ADD CONSTRAINT "ingestion_raw_blob_id_fkey" FOREIGN KEY ("raw_blob_id") REFERENCES "raw_blobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ingestion" ADD CONSTRAINT "event_ingestion_row_hash_fkey" FOREIGN KEY ("row_hash") REFERENCES "usage_event"("row_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ingestion" ADD CONSTRAINT "event_ingestion_ingestion_id_fkey" FOREIGN KEY ("ingestion_id") REFERENCES "ingestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
