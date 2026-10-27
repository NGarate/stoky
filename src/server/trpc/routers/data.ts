import { createTRPCRouter, adminProcedure } from "../trpc";

/**
 * Taking your data out.
 *
 * The premise of this application is that a household's inventory, receipts and
 * prices live on hardware the household controls. That promise is only worth
 * something if the data can leave — otherwise "self-hosted" means the lock-in is
 * just closer to home. `REDESIGN_PLAN.md` §10 listed this as absent rather than
 * deferred, which is the right description of a gap in the product's own
 * premise.
 *
 * **JSON, not CSV.** A spreadsheet flattens a household into one table and loses
 * the shape — which stock entry belongs to which product, which line to which
 * receipt. JSON keeps the relationships, and anything that wants a spreadsheet
 * can make one from it. The point of an export is to be complete, not to be
 * convenient for one destination.
 *
 * **`adminProcedure`**, because this is the whole household in one file,
 * including the other members' names and addresses. The capability matrix
 * already puts "see account data and emails" behind admin (§5.2), and an export
 * is that, in bulk.
 */

/**
 * Everything a household owns, in one object.
 *
 * The `select` clauses are deliberate rather than incidental. `include` would
 * hand over whatever the schema grows next — and the first thing it would have
 * handed over is the password hash, once a `User` column and now its
 * credential `Account` row, which is exactly what an export must never
 * contain. Naming the columns means a new one has to be added here on purpose.
 */
export const dataRouter = createTRPCRouter({
  /**
   * The household's data, as a plain object the client turns into a file.
   *
   * A query rather than a mutation: it changes nothing. It is not paginated —
   * a household's whole history is a few thousand rows, and an export delivered
   * in pages is not an export.
   *
   * **Receipt images are referenced, not embedded.** They are the only thing
   * here that is not text, and base64ing a year of photographs would turn a
   * small file into a hundred-megabyte one that most editors will not open. The
   * paths are included so somebody copying the uploads volume can match them
   * up, and the export says as much in its own `notes` field rather than
   * leaving the omission to be discovered.
   */
  exportHousehold: adminProcedure.query(async ({ ctx }) => {
    const householdId = ctx.householdId;

    const [household, members, products, locations, stores, receipts, lists] =
      await Promise.all([
        ctx.db.household.findUnique({
          where: { id: householdId },
          select: { id: true, name: true, createdAt: true },
        }),

        // No `accounts` (the password hash is there), and no `include` that
        // could quietly acquire them.
        ctx.db.user.findMany({
          where: { householdId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            locale: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        }),

        ctx.db.product.findMany({
          where: { householdId },
          select: {
            id: true,
            name: true,
            barcode: true,
            brand: true,
            category: true,
            defaultUnit: true,
            minStock: true,
            createdAt: true,
            stockEntries: {
              select: {
                id: true,
                quantity: true,
                unit: true,
                expirationDate: true,
                locationId: true,
                // Which purchase a consumption or a move drew from: without
                // it the ledger's sum survives, but not what each batch has
                // left, so no expiry can be read back from the file.
                batchId: true,
                operationType: true,
                note: true,
                createdAt: true,
              },
              orderBy: { createdAt: "asc" },
            },
            priceRecords: {
              select: {
                id: true,
                storeId: true,
                price: true,
                currency: true,
                unit: true,
                quantity: true,
                recordedAt: true,
              },
              orderBy: { recordedAt: "asc" },
            },
          },
          orderBy: { name: "asc" },
        }),

        ctx.db.storageLocation.findMany({
          where: { householdId },
          select: { id: true, name: true, parentId: true },
          orderBy: { name: "asc" },
        }),

        ctx.db.store.findMany({
          where: { householdId },
          select: { id: true, name: true, address: true },
          orderBy: { name: "asc" },
        }),

        ctx.db.receipt.findMany({
          where: { householdId },
          select: {
            id: true,
            imagePath: true,
            status: true,
            storeId: true,
            purchaseDate: true,
            totalAmount: true,
            createdAt: true,
            processedAt: true,
            items: {
              select: {
                id: true,
                rawText: true,
                parsedName: true,
                parsedPrice: true,
                parsedQuantity: true,
                matchedProductId: true,
                matchStatus: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),

        ctx.db.shoppingList.findMany({
          where: { householdId },
          select: {
            id: true,
            name: true,
            isAutoGenerated: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                productId: true,
                quantity: true,
                unit: true,
                isChecked: true,
                checkedAt: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
      ]);

    return {
      /**
       * Versioned from the first export, not from the first time it breaks.
       * Anything reading these files later needs to know which shape it has,
       * and adding the field afterwards means the earliest exports are the ones
       * that cannot say.
       */
      formatVersion: 1,
      exportedAt: new Date(),
      notes: {
        rawOcrText:
          "A receipt's whole-image OCR dump is omitted — it is regenerable from the photograph and is the largest text in the database. Each line's own `rawText` is kept, because it is why that line was read the way it was.",
        images:
          "Receipt images are referenced by path, not embedded. Copy the uploads volume alongside this file to keep them.",
        passwords:
          "Password hashes are never exported, by anybody, for any reason.",
      },
      household,
      members,
      locations,
      stores,
      products,
      receipts,
      shoppingLists: lists,
    };
  }),
});
