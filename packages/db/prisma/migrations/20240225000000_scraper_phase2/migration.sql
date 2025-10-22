-- Ensure raw blob dedupe via content hash
CREATE UNIQUE INDEX IF NOT EXISTS "raw_blobs_content_hash_key" ON "raw_blobs"("content_hash");

-- Align snapshot uniqueness with billing period + table hash
DROP INDEX IF EXISTS "snapshots_table_hash_rows_count_key";

-- Add created_at column for snapshots and index for latest lookup
ALTER TABLE "snapshots" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "snapshots_created_at_idx" ON "snapshots"("created_at");
