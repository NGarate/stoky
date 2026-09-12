ALTER TABLE "StockEntry" ADD COLUMN "batchId" TEXT;
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "StockEntry_batchId_idx" ON "StockEntry"("batchId");
