/*
  Warnings:

  - Made the column `model` on table `usage_events` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "usage_events" DROP CONSTRAINT "fk_usage_events_raw_blob";

-- AlterTable
ALTER TABLE "alerts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "budgets" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "metric_daily" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "metric_hourly" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "raw_blobs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "snapshots" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "usage_events" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "model" SET NOT NULL,
ALTER COLUMN "input_with_cache_write_tokens" DROP DEFAULT,
ALTER COLUMN "input_without_cache_write_tokens" DROP DEFAULT,
ALTER COLUMN "cache_read_tokens" DROP DEFAULT,
ALTER COLUMN "output_tokens" DROP DEFAULT,
ALTER COLUMN "total_tokens" DROP DEFAULT,
ALTER COLUMN "api_cost_cents" DROP DEFAULT,
ALTER COLUMN "cost_to_you_cents" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_raw_blob_id_fkey" FOREIGN KEY ("raw_blob_id") REFERENCES "raw_blobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_alerts_triggered_at" RENAME TO "alerts_triggered_at_idx";

-- RenameIndex
ALTER INDEX "idx_metric_daily_key_date" RENAME TO "metric_daily_metric_key_date_idx";

-- RenameIndex
ALTER INDEX "idx_metric_hourly_key_hour" RENAME TO "metric_hourly_metric_key_ts_hour_idx";

-- RenameIndex
ALTER INDEX "idx_snapshots_captured_at" RENAME TO "snapshots_captured_at_idx";

-- RenameIndex
ALTER INDEX "idx_usage_events_captured_at" RENAME TO "usage_events_captured_at_idx";
