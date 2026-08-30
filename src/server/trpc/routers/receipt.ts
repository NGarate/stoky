import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, householdProcedure, writeProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import type { PrismaClient, Prisma } from "@prisma/client";
import { ReceiptStatus, MatchStatus, StockOperation } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { processReceiptOcr } from "@/server/services/ocr";
import { parseReceiptText, saveParsedItems } from "@/server/services/receiptParser";
import { matchReceiptItems, getItemCandidates } from "@/server/services/productMatcher";
import { uploadRateLimit } from "@/lib/rate-limit";
import { enforceRateLimit } from "../throttle";
import { reencodeAsJpeg } from "@/server/services/image";
import {
  MAX_RECEIPT_BASE64_LENGTH,
  MAX_RECEIPT_BYTES,
  RECEIPT_IMAGE_TYPES,
  receiptItemMatchSchema,
} from "@/lib/validations/receipt";

const VALID_MIME_TYPES: readonly string[] = RECEIPT_IMAGE_TYPES;

/**
 * Receipt scanning: a photograph in, stock and prices out.
 *
 * **A state machine, and the order is enforced rather than assumed.**
 * `ReceiptStatus` runs UPLOADING → PROCESSING → PARSED → NEEDS_REVIEW →
 * CONFIRMED → APPLIED, with FAILED reachable from the middle. Each procedure
 * below acts on one edge and refuses if the receipt is not on it, which is what
 * stops a half-parsed receipt being applied to the inventory.
 *
 * **A person sits in the middle on purpose.** OCR misreads receipts and fuzzy
 * matching picks the wrong tin; between PARSED and CONFIRMED a human looks at
 * every line. Nothing here writes stock until they have.
 *
 * The pipeline's expensive half — OCR, parsing, matching — is
 * `src/server/services/`; this router is the guards, the transitions and the
 * one write that matters (`applyReceipt`).
 *
 * This is the largest router in the project and was for a long time the least
 * covered: 28.6% of its functions against 90% for the tier as a whole. Its
 * services were well tested and the browser suite walked the screens, so what
 * was missing was exactly this layer.
 */
/**
 * Refuse a store that is not this household's.
 *
 * `receipt.upload` takes an optional `storeId` and writes it onto the Receipt.
 * `price.recordPrice` verifies the identical field two files away — SEC-1 is
 * the entry that put the check there — and this one did not, so a receipt could
 * be filed against another household's shop. Everything the receipt later
 * produces (its price records, the store comparison) inherits that reference.
 */
async function assertOwnStore(
  db: PrismaClient | Prisma.TransactionClient,
  storeId: string | undefined,
  householdId: string,
): Promise<void> {
  if (!storeId) return;

  const store = await db.store.findFirst({
    where: { id: storeId, householdId },
    select: { id: true },
  });

  if (!store) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  }
}

/**
 * Refuse a product that is not this household's.
 *
 * Both confirm procedures take a `productId` straight from the caller and write
 * it into `ReceiptItem.matchedProductId`. Nobody was asking whose product it
 * was, so a caller could point their own receipt line at another household's
 * catalogue — and applying the receipt afterwards books stock and a price
 * against it. This is `ISSUES.md` SEC-1's shape a second time; that entry rated
 * it HIGH and closed it for `inventory.addStock`.
 *
 * NOT_FOUND rather than FORBIDDEN, deliberately and for the same reason
 * `product.getById` does it: telling an outsider that an id exists but is not
 * theirs confirms the id exists.
 *
 * **`productId` is required and there is no if-absent-return.** There was one,
 * and it was the injection's accomplice: the callers passed
 * `input.productId` from a shape where it was optional, so an absent id meant
 * "checked" rather than "refused". The union upstream now guarantees a MATCH
 * carries one, and this signature is what makes a caller that forgets a
 * compile error rather than a silent pass.
 */
async function assertOwnProduct(
  db: PrismaClient | Prisma.TransactionClient,
  productId: string,
  householdId: string,
): Promise<void> {
  const product = await db.product.findFirst({
    where: { id: productId, householdId },
    select: { id: true },
  });

  if (!product) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
  }
}

/**
 * Refuse a receipt that is not open to being reviewed.
 *
 * A line may be settled while its receipt is under review, and re-settled while
 * it is CONFIRMED but not yet applied — going back and changing your mind is
 * part of reviewing. **APPLIED is the point of no return**, and it was not
 * guarded at all: `confirmAll` ends by writing CONFIRMED whatever it found, so
 * an applied receipt could be dragged back and applied a second time, booking
 * every line's stock and price twice. The states before NEEDS_REVIEW have no
 * lines worth settling and FAILED has nothing to settle them for.
 *
 * A function rather than two copies of the condition, because the two
 * procedures being allowed to drift on which states are open is the defect one
 * level up from the one this closes.
 */
function assertOpenForReview(status: ReceiptStatus): void {
  if (
    status !== ReceiptStatus.NEEDS_REVIEW &&
    status !== ReceiptStatus.CONFIRMED
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Receipt is not open for review",
    });
  }
}

export const receiptRouter = createTRPCRouter({
  /**
   * Takes the photograph. The only procedure here that accepts arbitrary bytes.
   *
   * Every check `CLAUDE.md` requires is on this path and in this order: MIME
   * type, size, magic bytes, then a re-encode through `Bun.Image`
   * (`src/server/services/image.ts`) that strips EXIF and normalises the
   * format — so what lands on disk is an image this server produced rather
   * than a file a caller supplied. The name is a UUID, in a per-household
   * directory, served only through an authenticated query.
   *
   * Metered at 30 per account per hour, counted *before* the base64 is decoded
   * (ASVS V11.1.4): one call is up to 10 MB decoded, a `Bun.Image` re-encode,
   * a file, and then Tesseract. A refused upload still spends budget, or
   * sending rubbish would be the cheap way in.
   *
   * Returns as soon as the file is written; OCR runs after the response.
   */
  upload: writeProcedure
    .input(
      z.object({
        // Bounded here as well as after decoding, so an oversized body is
        // refused by validation rather than by allocating a second copy of it
        // as a Buffer first. The check below still stands: this bounds the
        // encoded length, that bounds what the bytes actually came to.
        fileBase64: z.string().max(MAX_RECEIPT_BASE64_LENGTH),
        mimeType: z.string(),
        storeId: z.string().optional(),
        purchaseDate: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;
      const householdId = ctx.householdId;

      // Counted before anything is decoded, for the same reason sign-in counts
      // before Argon2id: a limit that only counts the work it has already done
      // is a way to ask for that work. ASVS V11.1.4.
      await enforceRateLimit(
        uploadRateLimit(),
        user.id,
        "Too many receipts uploaded. Try again in a little while.",
      );

      // Before the bytes are decoded, like the rate limit above it: a receipt
      // filed against somebody else's shop should be refused without doing the
      // work of accepting it first.
      await assertOwnStore(ctx.db, input.storeId, householdId);

      // Validate MIME type
      if (!VALID_MIME_TYPES.includes(input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid file type. Only JPEG, PNG, and WebP are allowed.",
        });
      }

      // Decode base64
      const buffer = Buffer.from(input.fileBase64, "base64");

      // Validate file size
      if (buffer.length > MAX_RECEIPT_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "File size exceeds 10MB limit",
        });
      }

      // Validate magic bytes
      const isValidImage = await validateImageMagicBytes(buffer, input.mimeType);
      if (!isValidImage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid image file",
        });
      }

      // Normalised to a JPEG this server produced: the format stops being
      // whatever was sent, the EXIF goes, and the orientation is applied to
      // the pixels. Bounded in pixels as well as bytes — see the module,
      // which the OCR path reads the same bound from.
      let processedBuffer: Buffer;
      try {
        processedBuffer = await reencodeAsJpeg(buffer);
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to process image",
        });
      }

      // Generate unique filename
      const fileName = `${randomUUID()}.jpg`;
      const uploadDir = `uploads/receipts/${householdId}`;
      const filePath = `${uploadDir}/${fileName}`;

      // Ensure directory exists
      const fs = await import("node:fs");
      await fs.promises.mkdir(uploadDir, { recursive: true });

      // Save file
      await fs.promises.writeFile(filePath, processedBuffer);

      // Create receipt record
      const receipt = await ctx.db.receipt.create({
        data: {
          imagePath: filePath,
          householdId,
          uploadedBy: user.id,
          storeId: input.storeId,
          purchaseDate: input.purchaseDate,
          status: ReceiptStatus.UPLOADING,
        },
      });

      // Trigger async processing
      processReceiptAsync(receipt.id).catch(console.error);

      return receipt;
    }),

  /**
   * Where a receipt has got to. What the upload screen polls.
   *
   * The status is the whole answer: OCR happens after the upload responds, so
   * this is how the interface learns that PROCESSING became PARSED — or FAILED.
   */
  getStatus: householdProcedure
    .input(z.object({ receiptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const receipt = await ctx.db.receipt.findFirst({
        where: { id: input.receiptId, householdId: ctx.householdId },
        include: {
          items: {
            select: {
              id: true,
              matchStatus: true,
            },
          },
        },
      });

      if (!receipt) {
        // NOT_FOUND for "not yours" as well as "not there", like every other
        // router: confirming an id exists is information (see assertOwnProduct
        // above).
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      const totalItems = receipt.items.length;
      const processedItems = receipt.items.filter(
        (i) =>
          i.matchStatus === MatchStatus.AUTO_MATCHED ||
          i.matchStatus === MatchStatus.USER_CONFIRMED ||
          i.matchStatus === MatchStatus.SKIPPED,
      ).length;

      return {
        ...receipt,
        progress: {
          total: totalItems,
          processed: processedItems,
        },
      };
    }),

  /**
   * A receipt with its lines and each line's candidates — the review screen.
   *
   * The one read here that assembles rather than fetches: candidates come from
   * a similarity query per unmatched line.
   */
  getReceiptWithItems: householdProcedure
    .input(z.object({ receiptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const receipt = await ctx.db.receipt.findFirst({
        where: { id: input.receiptId, householdId: ctx.householdId },
        include: {
          items: {
            include: {
              matchedProduct: true,
            },
          },
          store: true,
        },
      });

      if (!receipt) {
        // NOT_FOUND for "not yours" as well as "not there", like every other
        // router: confirming an id exists is information (see assertOwnProduct
        // above).
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      // Get candidates for items that need review
      const itemsWithCandidates = await Promise.all(
        receipt.items.map(async (item) => {
          if (
            item.matchStatus === MatchStatus.PENDING ||
            item.matchStatus === MatchStatus.AUTO_MATCHED
          ) {
            const candidates = await getItemCandidates(item.id);
            return { ...item, candidates };
          }
          return { ...item, candidates: [] };
        }),
      );

      return {
        ...receipt,
        items: itemsWithCandidates,
      };
    }),

  /**
   * Settles one line, and refetches the page that shows it.
   *
   * It used to write and change nothing on screen — no invalidation, so the
   * card kept its button and the pending count kept its number. The reasonable
   * response to a button that does nothing is to press it again, so the defect
   * cost a second write every time (ISSUES.md A11Y-2, UI-7).
   *
   * The input is now the shared review-decision schema from
   * `src/lib/validations/receipt.ts`, which this router had been carrying a
   * looser inlined copy of instead of importing. What that copy cost is in the
   * schema's own docstring.
   *
   * (Named by file rather than by identifier, for the same reason `applyReceipt`
   * names its claim helper indirectly. `tenant-scoped-ids.test.ts` slices a
   * procedure's source from its own name to the *next* one, so this comment
   * counts as `getReceiptWithItems`'s body — and the identifier here would
   * credit that read with an input field it does not take, which the scan then
   * reports as an unchecked id.)
   */
  confirmItem: writeProcedure
    .input(receiptItemMatchSchema)
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.receiptItem.findFirst({
        where: {
          id: input.receiptItemId,
          receipt: { householdId: ctx.householdId },
        },
        include: {
          receipt: true,
        },
      });

      if (!item) {
        // NOT_FOUND for "not yours" as well as "not there", like every other
        // router: confirming an id exists is information (see assertOwnProduct
        // above).
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt item not found",
        });
      }

      assertOpenForReview(item.receipt.status);

      // Narrowed by the discriminated union, so each branch reads only the
      // fields its action has — and SKIP falls through to a null product,
      // which detaches whatever the matcher had put there.
      let productId: string | null = null;
      if (input.action === "MATCH") {
        await assertOwnProduct(ctx.db, input.productId, ctx.householdId);
        productId = input.productId;
      }
      if (input.action === "CREATE") {
        const newProduct = await ctx.db.product.create({
          data: {
            name: input.customName,
            householdId: ctx.householdId,
            defaultUnit: "unit",
          },
        });
        productId = newProduct.id;
      }

      await ctx.db.receiptItem.update({
        where: { id: input.receiptItemId },
        data: {
          matchedProductId: productId,
          matchStatus:
            input.action === "SKIP"
              ? MatchStatus.SKIPPED
              : input.action === "CREATE"
                ? MatchStatus.USER_CREATED
                : MatchStatus.USER_CONFIRMED,
          matchConfidence: input.action === "MATCH" ? 1.0 : null,
        },
      });

      return { success: true };
    }),

  /**
   * Settles the remaining lines at once — the NEEDS_REVIEW → CONFIRMED edge.
   *
   * Despite the name it does not confirm blindly: it takes a decision per line
   * — MATCH an existing product, CREATE a new one, or SKIP — so it is the
   * *submission* of a review rather than a way to avoid one. The button that
   * calls it is named "Terminar revisión" for that reason, having once been
   * called "Confirmar todos" (I18N-6), and is disabled until every line has
   * been looked at.
   */
  confirmAll: writeProcedure
    .input(
      z.object({
        receiptId: z.string(),
        items: z.array(receiptItemMatchSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const receipt = await ctx.db.receipt.findFirst({
        where: { id: input.receiptId, householdId: ctx.householdId },
      });

      if (!receipt) {
        // NOT_FOUND for "not yours" as well as "not there", like every other
        // router: confirming an id exists is information (see assertOwnProduct
        // above).
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      assertOpenForReview(receipt.status);

      // Every line named must belong to *this* receipt.
      //
      // The household check above authorises the receipt, which is a different
      // claim from authorising the lines: passing a receipt you own alongside
      // `receiptItemId`s you do not was enough to rewrite rows in another
      // household. Resolved in one query rather than per item, so a fifty-line
      // receipt costs one round trip and the refusal happens before anything is
      // written.
      const named = input.items.map((item) => item.receiptItemId);
      const own = await ctx.db.receiptItem.findMany({
        where: { id: { in: named }, receiptId: receipt.id },
        select: { id: true },
      });
      const owned = new Set(own.map((item) => item.id));

      for (const id of named) {
        if (!owned.has(id)) {
          // NOT_FOUND rather than FORBIDDEN: an outsider learning that a line
          // id exists but belongs to somebody else has learned something.
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Receipt item not found",
          });
        }
      }

      for (const itemInput of input.items) {
        if (itemInput.action === "MATCH") {
          await assertOwnProduct(ctx.db, itemInput.productId, ctx.householdId);
        }
      }

      // One transaction for the line updates and the status claim, so a
      // crash or refusal mid-loop settles nothing rather than some: every
      // decision lands together with the CONFIRMED write, or none does.
      // Before this, a failure between two updates left the first line
      // settled with the status unmoved — half a review, silently.
      await ctx.db.$transaction(async (tx) => {
        for (const itemInput of input.items) {
          // The same action-narrowed logic as `confirmItem`, and it has to
          // stay the same: a decision means the same thing whichever button
          // submitted it. Same product/action narrowing only, though: unlike
          // `confirmItem`, this path never touches `matchConfidence`, so the
          // bulk update below leaves whatever figure the matcher already
          // wrote in place.
          let productId: string | null = null;

          if (itemInput.action === "MATCH") {
            productId = itemInput.productId;
          }

          if (itemInput.action === "CREATE") {
            const newProduct = await tx.product.create({
              data: {
                name: itemInput.customName,
                householdId: ctx.householdId,
                defaultUnit: "unit",
              },
            });
            productId = newProduct.id;
          }

          await tx.receiptItem.update({
            where: { id: itemInput.receiptItemId },
            data: {
              matchedProductId: productId,
              matchStatus:
                itemInput.action === "SKIP"
                  ? MatchStatus.SKIPPED
                  : itemInput.action === "CREATE"
                    ? MatchStatus.USER_CREATED
                    : MatchStatus.USER_CONFIRMED,
            },
          });
        }

        // The same claim shape `applyReceipt` uses, and here for the same
        // reason: the guard at the top only *read* the status, so an apply
        // committing between that read and this write was dragged back to
        // CONFIRMED and applied a second time. Filtered on the review
        // states, this write refuses a receipt that left them, under any
        // interleaving — and since the loop above is in this transaction, a
        // refusal here rolls the settlements back too, so an apply landing
        // mid-loop no longer keeps lines settled underneath it.
        // householdId for the same belt-and-braces reason as applyReceipt's
        // claim: the id was resolved household-scoped above, and the write
        // being self-scoping means that stays true wherever the id came
        // from.
        const claimed = await tx.receipt.updateMany({
          where: {
            id: input.receiptId,
            householdId: ctx.householdId,
            status: {
              in: [ReceiptStatus.NEEDS_REVIEW, ReceiptStatus.CONFIRMED],
            },
          },
          data: { status: ReceiptStatus.CONFIRMED },
        });

        if (claimed.count === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Receipt is not open for review",
          });
        }
      });

      return { success: true };
    }),

  /**
   * The one that touches the inventory — the CONFIRMED → APPLIED edge.
   *
   * Everything above this is bookkeeping about a photograph. This writes a
   * `StockEntry` per confirmed line and a `PriceRecord` where there is a store,
   * in one transaction — which this docstring claimed for months before it was
   * true; the 2026-08-29 review is what made it true — and moves the receipt to
   * APPLIED so it cannot be applied twice.
   *
   * **No store means no prices**, silently as far as the data is concerned —
   * a `PriceRecord` with nowhere attached says nothing — so the applied summary
   * tells the person that in words rather than leaving them to notice.
   */
  applyReceipt: writeProcedure
    .input(z.object({ receiptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;

      const receipt = await ctx.db.receipt.findFirst({
        where: { id: input.receiptId, householdId: ctx.householdId },
        select: { id: true, storeId: true, status: true },
      });

      if (!receipt) {
        // NOT_FOUND for "not yours" as well as "not there", like every other
        // router: confirming an id exists is information (see assertOwnProduct
        // above).
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      if (receipt.status !== ReceiptStatus.CONFIRMED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Receipt must be confirmed before applying",
        });
      }

      const applied = await ctx.db.$transaction(async (tx) => {
        // The claim is the guard. An UPDATE filtered on CONFIRMED flips the
        // status and takes the row lock in one statement, so of two concurrent
        // applies exactly one matches; the loser sees count 0 and refuses. The
        // check above is a courtesy for a fast error message — this is the one
        // that holds. Same shape as the replay claim in `replay.ts`, where the
        // claim row is the lock. (Named indirectly on purpose — for reading
        // flow, not because it has to be: the meta-test in `replayable.test.ts`
        // matches call syntax rather than the bare name, so a comment that
        // spelled the helper out would no longer read as a use of it.)
        // householdId is belt-and-braces — the id came from a
        // household-scoped findFirst above — but it makes the write
        // self-scoping like the rest of the router, so the guarantee no
        // longer depends on where the id was resolved.
        const claimed = await tx.receipt.updateMany({
          where: {
            id: receipt.id,
            householdId: ctx.householdId,
            status: ReceiptStatus.CONFIRMED,
          },
          data: { status: ReceiptStatus.APPLIED },
        });

        if (claimed.count === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Receipt must be confirmed before applying",
          });
        }

        // Read the lines inside the transaction, after the claim, so two
        // applies serialise and the lines the loop walks are one consistent
        // snapshot of each other. That is all it buys: nothing locks the item
        // rows, so a confirmItem racing an individual line can still commit
        // between this read and the writes below, and the entry would record
        // the pre-edit line. The review chose to document that window rather
        // than lock it away — closing it needs confirmItem to re-check the
        // receipt status inside its own transaction, which is a decision, not
        // a wording fix.
        const items = await tx.receiptItem.findMany({
          where: { receiptId: receipt.id },
          include: { matchedProduct: true },
        });

        let stockEntriesCreated = 0;
        let priceRecordsCreated = 0;

        for (const item of items) {
          if (!item.matchedProductId || item.matchStatus === MatchStatus.SKIPPED) {
            continue;
          }

          await tx.stockEntry.create({
            data: {
              productId: item.matchedProductId,
              quantity: item.parsedQuantity ?? 1,
              unit: item.matchedProduct?.defaultUnit || "unit",
              operationType: StockOperation.PURCHASE,
              receiptItemId: item.id,
              createdBy: user.id,
              locationId: null,
            },
          });
          stockEntriesCreated += 1;

          if (item.parsedPrice && receipt.storeId) {
            await tx.priceRecord.create({
              data: {
                productId: item.matchedProductId,
                storeId: receipt.storeId,
                price: item.parsedPrice,
                currency: "EUR",
                unit: item.matchedProduct?.defaultUnit || "unit",
                quantity: item.parsedQuantity ?? 1,
                receiptId: receipt.id,
              },
            });
            priceRecordsCreated += 1;
          }
        }

        return { stockEntriesCreated, priceRecordsCreated };
      });

      return { success: true, ...applied };
    }),

  /**
   * What a receipt changed, after the fact.
   *
   * Reads the entries `applyReceipt` wrote rather than recomputing from the
   * lines, so it says what *happened* — including lines that were skipped and
   * prices that were not recorded, which is the half a person is most likely to
   * want to check.
   */
  getAppliedSummary: householdProcedure
    .input(z.object({ receiptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const receipt = await ctx.db.receipt.findFirst({
        where: { id: input.receiptId, householdId: ctx.householdId },
        include: {
          // The confirmation page names the shop the stock came from, and the
          // store is the only field on the receipt it cannot derive.
          store: true,
          items: {
            // The same condition `applyReceipt` applies stock under, rather than
            // a list of match statuses. It used to filter on
            // `USER_CONFIRMED | USER_CREATED`, which is narrower than what is
            // actually applied: `confirmAll` accepts a subset of the lines, so a
            // partly-reviewed receipt can reach CONFIRMED with lines still
            // AUTO_MATCHED, and `applyReceipt` creates stock for those too. The
            // summary would then under-report what it had just done — which is
            // the one thing a confirmation screen must not do.
            where: {
              matchedProductId: { not: null },
              matchStatus: { not: MatchStatus.SKIPPED },
            },
            include: {
              matchedProduct: true,
            },
          },
          // Every parsed line, applied or not, so the page can say how many were
          // left out instead of implying the receipt held only what it shows.
          _count: { select: { items: true } },
        },
      });

      if (!receipt) {
        // NOT_FOUND for "not yours" as well as "not there", like every other
        // router: confirming an id exists is information (see assertOwnProduct
        // above).
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      const stockEntries = await ctx.db.stockEntry.findMany({
        where: { receiptItemId: { in: receipt.items.map((i) => i.id) } },
        include: { product: true },
      });

      const priceRecords = await ctx.db.priceRecord.findMany({
        where: { receiptId: receipt.id },
        include: { product: true, store: true },
      });

      return {
        receipt,
        itemsAdded: stockEntries.length,
        pricesRecorded: priceRecords.length,
        // Lines the parser found that produced no stock: skipped by the reviewer,
        // or never matched to a product.
        linesNotApplied: receipt._count.items - receipt.items.length,
        totalAmount: receipt.totalAmount,
        items: receipt.items.map((item) => ({
          ...item,
          stockEntry: stockEntries.find((se) => se.receiptItemId === item.id),
          priceRecord: priceRecords.find(
            (pr) => pr.productId === item.matchedProductId,
          ),
        })),
      };
    }),

  // List receipts for household
  /** The household's receipts, newest first. */
  list: householdProcedure
    .input(
      z.object({
        status: z.enum([
          "UPLOADING",
          "PROCESSING",
          "PARSED",
          "NEEDS_REVIEW",
          "CONFIRMED",
          "APPLIED",
          "FAILED",
        ]).optional(),
        limit: z.number().default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const receipts = await ctx.db.receipt.findMany({
        where: {
          householdId: ctx.householdId,
          ...(input.status && { status: input.status }),
        },
        take: input.limit + 1,
        ...(input.cursor && {
          cursor: { id: input.cursor },
          skip: 1,
        }),
        orderBy: { createdAt: "desc" },
        include: {
          store: true,
          _count: {
            select: { items: true },
          },
        },
      });

      const hasMore = receipts.length > input.limit;
      const items = hasMore ? receipts.slice(0, -1) : receipts;

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id : null,
      };
    }),
});

async function validateImageMagicBytes(
  buffer: Buffer,
  mimeType: string,
): Promise<boolean> {
  const magicBytes = {
    "image/jpeg": [[0xff, 0xd8, 0xff]],
    "image/png": [[0x89, 0x50, 0x4e, 0x47]],
    "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  };

  const patterns = magicBytes[mimeType as keyof typeof magicBytes];
  if (!patterns) return false;

  return patterns.some((pattern) =>
    pattern.every((byte, i) => buffer[i] === byte),
  );
}

// The one deliberate use of the module import in this file: this runs after
// the upload's response, with no request context to carry a db. Everything
// inside a procedure takes ctx.db (trpc.ts:24-38 explains why).
async function processReceiptAsync(receiptId: string): Promise<void> {
  try {
    // Run OCR
    await processReceiptOcr(receiptId);

    // Parse receipt
    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId },
    });

    if (receipt?.rawOcrText) {
      const parsed = parseReceiptText(receipt.rawOcrText);
      await saveParsedItems(receiptId, parsed);

      // Match items
      await matchReceiptItems(receiptId);
    }
  } catch (error) {
    console.error("Failed to process receipt:", error);
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { status: ReceiptStatus.FAILED },
    });
  }
}
