-- CreateIndex
CREATE INDEX "PriceRecord_productId_recordedAt_idx" ON "PriceRecord"("productId", "recordedAt");

-- CreateIndex
CREATE INDEX "PriceRecord_storeId_idx" ON "PriceRecord"("storeId");

-- CreateIndex
CREATE INDEX "Product_householdId_idx" ON "Product"("householdId");

-- CreateIndex
CREATE INDEX "Receipt_householdId_createdAt_idx" ON "Receipt"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "Receipt_storeId_idx" ON "Receipt"("storeId");

-- CreateIndex
CREATE INDEX "ReceiptItem_receiptId_idx" ON "ReceiptItem"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptItem_matchedProductId_idx" ON "ReceiptItem"("matchedProductId");

-- CreateIndex
CREATE INDEX "ShoppingItem_shoppingListId_idx" ON "ShoppingItem"("shoppingListId");

-- CreateIndex
CREATE INDEX "ShoppingItem_productId_idx" ON "ShoppingItem"("productId");

-- CreateIndex
CREATE INDEX "ShoppingList_householdId_idx" ON "ShoppingList"("householdId");

-- CreateIndex
CREATE INDEX "StockEntry_productId_idx" ON "StockEntry"("productId");

-- CreateIndex
CREATE INDEX "StockEntry_locationId_idx" ON "StockEntry"("locationId");

-- CreateIndex
CREATE INDEX "StorageLocation_householdId_idx" ON "StorageLocation"("householdId");

-- CreateIndex
CREATE INDEX "StorageLocation_parentId_idx" ON "StorageLocation"("parentId");

-- CreateIndex
CREATE INDEX "Store_householdId_idx" ON "Store"("householdId");

-- CreateIndex
CREATE INDEX "User_householdId_idx" ON "User"("householdId");
