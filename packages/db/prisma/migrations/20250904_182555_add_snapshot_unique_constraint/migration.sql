-- CreateIndex
CREATE UNIQUE INDEX "snapshots_billing_period_start_billing_period_end_table_hash_key" ON "snapshots"("billing_period_start", "billing_period_end", "table_hash");
