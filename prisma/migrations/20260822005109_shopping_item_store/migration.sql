-- Where a shopping item is meant to be bought.
--
-- Nullable and unread for now: this is the additive half, so the database
-- after it still serves the application before it. Nothing writes the column
-- until the row gains a control for it.
--
-- `ON DELETE SET NULL` rather than a refusal, and that is the right way round
-- here: deleting a shop is a thing households do, and it should not be blocked
-- by a note somebody left on a list. The item survives without its shop, which
-- is exactly what it was before anyone chose one.

-- AlterTable
ALTER TABLE "ShoppingItem" ADD COLUMN     "storeId" TEXT;

-- CreateIndex
CREATE INDEX "ShoppingItem_storeId_idx" ON "ShoppingItem"("storeId");

-- AddForeignKey
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
