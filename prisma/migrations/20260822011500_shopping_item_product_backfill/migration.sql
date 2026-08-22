-- Every free-text shopping item gets a real product.
--
-- `ShoppingItem` could name a thing two ways: a `productId`, or a
-- `customName` typed into a box, with Zod enforcing exactly one. So every
-- screen, every query and every future feature had to handle both — and a
-- free-text item is one you cannot price, cannot count against stock, cannot
-- put on a receipt and cannot suppress when it is already covered.
--
-- This is the EXPAND half. It writes `productId` and leaves `customName`
-- exactly where it is, so the database after this still serves the
-- application before it. The column is dropped in a later migration,
-- deliberately not on the same day: that gap is the only window in which this
-- decision can be taken back.
--
-- **Reversal.** Un-point the items and delete what was minted:
--   UPDATE "ShoppingItem" SET "productId" = NULL WHERE "productId" LIKE 'mig\_%';
--   DELETE FROM "Product" WHERE id LIKE 'mig\_%';
-- The original spelling is not lost in between, because the minted product
-- carries it as its name — which is why this needs no scratch table.

-- Normalisation: case, surrounding space and runs of inner space are not
-- differences anybody meant. "Leche" and "leche  entera " are one product and
-- two products respectively.
--
-- Reuse before minting. A household with "Leche" in its catalogue and "leche"
-- on a list has one product, not two — and reusing is most of why this
-- migration is worth more than deleting the rows would be.
UPDATE "ShoppingItem" item
SET "productId" = (
  SELECT MIN(product.id)
  FROM "Product" product
  JOIN "ShoppingList" list ON list.id = item."shoppingListId"
  WHERE product."householdId" = list."householdId"
    AND lower(btrim(regexp_replace(product.name, '\s+', ' ', 'g')))
        = lower(btrim(regexp_replace(item."customName", '\s+', ' ', 'g')))
)
WHERE item."productId" IS NULL
  AND item."customName" IS NOT NULL
  AND btrim(item."customName") <> ''
  AND EXISTS (
    SELECT 1
    FROM "Product" product
    JOIN "ShoppingList" list ON list.id = item."shoppingListId"
    WHERE product."householdId" = list."householdId"
      AND lower(btrim(regexp_replace(product.name, '\s+', ' ', 'g')))
          = lower(btrim(regexp_replace(item."customName", '\s+', ' ', 'g')))
  );

-- Whatever is left has nothing to reuse, so one product is minted per
-- distinct name per household.
--
-- The displayed name is the most frequent original spelling, tie-broken by
-- the lowest item id so the result does not depend on scan order.
--
-- `minStock` stays null on purpose: a product invented from a shopping note
-- has no household minimum, and inventing one would put it on the restock
-- list from the moment it existed.
--
-- Ids are `mig_` + a uuid rather than cuids, which is visible and is the
-- point — they are also what makes the reversal above a one-liner. The
-- alternative was a TypeScript backfill script, which would stop
-- `prisma migrate deploy` being self-contained.
WITH normalised AS (
  SELECT
    item.id AS item_id,
    list."householdId" AS household_id,
    item."customName" AS original_name,
    lower(btrim(regexp_replace(item."customName", '\s+', ' ', 'g'))) AS key,
    item.unit AS unit
  FROM "ShoppingItem" item
  JOIN "ShoppingList" list ON list.id = item."shoppingListId"
  WHERE item."productId" IS NULL
    AND item."customName" IS NOT NULL
    AND btrim(item."customName") <> ''
),
chosen AS (
  SELECT DISTINCT ON (household_id, key)
    household_id,
    key,
    original_name AS display_name,
    -- One unit only when every row sharing the name agrees; otherwise the
    -- schema default, because a disagreement is not evidence.
    (SELECT CASE WHEN COUNT(DISTINCT inner_rows.unit) = 1
                 THEN MIN(inner_rows.unit) ELSE 'unit' END
       FROM normalised inner_rows
      WHERE inner_rows.household_id = outer_rows.household_id
        AND inner_rows.key = outer_rows.key
        AND inner_rows.unit IS NOT NULL) AS unit
  FROM normalised outer_rows
  ORDER BY household_id, key,
           (SELECT COUNT(*) FROM normalised counted
             WHERE counted.household_id = outer_rows.household_id
               AND counted.key = outer_rows.key
               AND counted.original_name = outer_rows.original_name) DESC,
           item_id ASC
)
INSERT INTO "Product" (id, "householdId", name, "defaultUnit", "createdAt", "updatedAt")
SELECT
  'mig_' || replace(gen_random_uuid()::text, '-', ''),
  chosen.household_id,
  chosen.display_name,
  COALESCE(chosen.unit, 'unit'),
  NOW(),
  NOW()
FROM chosen;

UPDATE "ShoppingItem" item
SET "productId" = (
  SELECT product.id
  FROM "Product" product
  JOIN "ShoppingList" list ON list.id = item."shoppingListId"
  WHERE product."householdId" = list."householdId"
    AND product.id LIKE 'mig\_%'
    AND lower(btrim(regexp_replace(product.name, '\s+', ' ', 'g')))
        = lower(btrim(regexp_replace(item."customName", '\s+', ' ', 'g')))
  LIMIT 1
)
WHERE item."productId" IS NULL
  AND item."customName" IS NOT NULL
  AND btrim(item."customName") <> '';

-- Rows that named nothing at all.
--
-- Both `productId` and `customName` absent is a row that renders as an empty
-- tickable line: it carries no information, and the current validation
-- already refuses to create one (SHOP-1). They are reported into the deploy
-- log before they go, so the deletion is on the record rather than silent —
-- the dev database held none when this was written, and a production one is
-- not visible from here.
DO $$
DECLARE orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM "ShoppingItem" WHERE "productId" IS NULL;
  IF orphans > 0 THEN
    RAISE NOTICE 'Deleting % shopping item(s) that named nothing at all (no product, no name).', orphans;
  END IF;
END $$;

DELETE FROM "ShoppingItem" WHERE "productId" IS NULL;
