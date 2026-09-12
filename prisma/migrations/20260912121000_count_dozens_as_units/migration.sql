-- Exact conversion only: neither a package size nor a physical recount is inferred.
UPDATE "StockEntry" SET quantity = quantity * 12, unit = 'unidad'
WHERE lower(trim(unit)) IN ('docena', 'docenas', 'dozen', 'dozens');
UPDATE "PriceRecord" SET quantity = quantity * 12, unit = 'unidad'
WHERE lower(trim(unit)) IN ('docena', 'docenas', 'dozen', 'dozens');
UPDATE "ShoppingItem" SET quantity = quantity * 12, unit = 'unidad'
WHERE lower(trim(unit)) IN ('docena', 'docenas', 'dozen', 'dozens');
UPDATE "Product" SET "minStock" = "minStock" * 12, "defaultUnit" = 'unidad'
WHERE lower(trim("defaultUnit")) IN ('docena', 'docenas', 'dozen', 'dozens');
