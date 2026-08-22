-- The CONTRACT half: `customName` goes, and `productId` becomes required.
--
-- **Deploy this after the previous two have been running, not with them.**
-- The window between expand and contract is the only interval in which this
-- decision can be taken back, and it is a *deployment* practice rather than
-- something the repository can enforce: these are three separate migrations,
-- and `migrate deploy` will happily apply all three in one go. If you are
-- cutting a release that includes the backfill, hold this one for the next.
--
-- After it, the original free-text spellings survive only as `Product.name`
-- on the products the backfill minted (`id LIKE 'mig\_%'`), which is enough to
-- reconstruct what a list said but not to restore the column.

-- The assertion, deliberately before the drop: if the backfill missed a row,
-- this fails loudly rather than dropping the only record of what that row was.
ALTER TABLE "ShoppingItem" ALTER COLUMN "productId" SET NOT NULL;

ALTER TABLE "ShoppingItem" DROP COLUMN "customName";
