import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import { ReceiptStatus, MatchStatus, StockOperation } from "@prisma/client";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { processReceiptOcr } from "@/server/services/ocr";
import { parseReceiptText, saveParsedItems } from "@/server/services/receiptParser";
import { matchReceiptItems, getItemCandidates } from "@/server/services/productMatcher";

const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const receiptRouter = createTRPCRouter({
  // F8: Upload receipt image
  upload: protectedProcedure
    .input(
      z.object({
        fileBase64: z.string(),
        mimeType: z.string(),
        storeId: z.string().optional(),
        purchaseDate: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;
      const householdId = user.householdId;

      if (!householdId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to a household to upload receipts",
        });
      }

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
      if (buffer.length > MAX_FILE_SIZE) {
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

      // Re-encode with Sharp (strips EXIF, normalizes format)
      let processedBuffer: Buffer;
      try {
        processedBuffer = await sharp(buffer)
          .jpeg({ quality: 90, progressive: true })
          .rotate() // Auto-orient based on EXIF
          .toBuffer();
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
      const receipt = await prisma.receipt.create({
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

  // F8: Get receipt processing status
  getStatus: protectedProcedure
    .input(z.object({ receiptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user;
      
      const receipt = await prisma.receipt.findUnique({
        where: { id: input.receiptId },
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
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      if (receipt.householdId !== user.householdId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
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

  // F9: Parse receipt (internal, triggered after OCR)
  parseReceipt: protectedProcedure
    .input(z.object({ receiptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;
      
      const receipt = await prisma.receipt.findUnique({
        where: { id: input.receiptId },
      });

      if (!receipt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      if (receipt.householdId !== user.householdId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

      if (!receipt.rawOcrText) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Receipt has not been processed yet",
        });
      }

      const parsed = parseReceiptText(receipt.rawOcrText);
      await saveParsedItems(receipt.id, parsed);

      return { success: true, itemsFound: parsed.items.length };
    }),

  // F10: Match items to products
  matchItems: protectedProcedure
    .input(z.object({ receiptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;
      
      const receipt = await prisma.receipt.findUnique({
        where: { id: input.receiptId },
      });

      if (!receipt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      if (receipt.householdId !== user.householdId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

      const results = await matchReceiptItems(receipt.id);

      return {
        success: true,
        autoMatched: results.filter((r) => r.autoMatch).length,
        needsReview: results.filter((r) => !r.autoMatch).length,
        results,
      };
    }),

  // F11: Get receipt with items and candidates
  getReceiptWithItems: protectedProcedure
    .input(z.object({ receiptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user;
      
      const receipt = await prisma.receipt.findUnique({
        where: { id: input.receiptId },
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
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      if (receipt.householdId !== user.householdId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
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

  // F11: Confirm match for single item
  confirmItem: protectedProcedure
    .input(
      z.object({
        receiptItemId: z.string(),
        action: z.enum(["MATCH", "CREATE", "SKIP"]),
        productId: z.string().optional(),
        customName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;
      
      const item = await prisma.receiptItem.findUnique({
        where: { id: input.receiptItemId },
        include: {
          receipt: true,
        },
      });

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt item not found",
        });
      }

      if (item.receipt.householdId !== user.householdId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

      let productId = input.productId;

      if (input.action === "CREATE" && input.customName) {
        // Create new product
        const newProduct = await prisma.product.create({
          data: {
            name: input.customName,
            householdId: item.receipt.householdId,
            defaultUnit: "unit",
          },
        });
        productId = newProduct.id;
      }

      await prisma.receiptItem.update({
        where: { id: input.receiptItemId },
        data: {
          matchedProductId: input.action === "SKIP" ? null : productId,
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

  // F11: Confirm all items at once
  confirmAll: protectedProcedure
    .input(
      z.object({
        receiptId: z.string(),
        items: z.array(
          z.object({
            receiptItemId: z.string(),
            action: z.enum(["MATCH", "CREATE", "SKIP"]),
            productId: z.string().optional(),
            customName: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;
      
      const receipt = await prisma.receipt.findUnique({
        where: { id: input.receiptId },
      });

      if (!receipt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      if (receipt.householdId !== user.householdId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

      // Confirm all items
      for (const itemInput of input.items) {
        let productId = itemInput.productId;

        if (itemInput.action === "CREATE" && itemInput.customName) {
          const newProduct = await prisma.product.create({
            data: {
              name: itemInput.customName,
              householdId: receipt.householdId,
              defaultUnit: "unit",
            },
          });
          productId = newProduct.id;
        }

        await prisma.receiptItem.update({
          where: { id: itemInput.receiptItemId },
          data: {
            matchedProductId: itemInput.action === "SKIP" ? null : productId,
            matchStatus:
              itemInput.action === "SKIP"
                ? MatchStatus.SKIPPED
                : itemInput.action === "CREATE"
                  ? MatchStatus.USER_CREATED
                  : MatchStatus.USER_CONFIRMED,
          },
        });
      }

      // Update receipt status to CONFIRMED
      await prisma.receipt.update({
        where: { id: input.receiptId },
        data: { status: ReceiptStatus.CONFIRMED },
      });

      return { success: true };
    }),

  // F12: Apply receipt to inventory
  applyReceipt: protectedProcedure
    .input(z.object({ receiptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;
      
      const receipt = await prisma.receipt.findUnique({
        where: { id: input.receiptId },
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
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      if (receipt.householdId !== user.householdId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

      if (receipt.status !== ReceiptStatus.CONFIRMED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Receipt must be confirmed before applying",
        });
      }

      const createdStockEntries = [];
      const createdPriceRecords = [];

      for (const item of receipt.items) {
        if (
          !item.matchedProductId ||
          item.matchStatus === MatchStatus.SKIPPED
        ) {
          continue;
        }

        // Create stock entry
        const stockEntry = await prisma.stockEntry.create({
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
        createdStockEntries.push(stockEntry);

        // Create price record
        if (item.parsedPrice && receipt.storeId) {
          const priceRecord = await prisma.priceRecord.create({
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
          createdPriceRecords.push(priceRecord);
        }
      }

      // Update receipt status to APPLIED
      await prisma.receipt.update({
        where: { id: input.receiptId },
        data: { status: ReceiptStatus.APPLIED },
      });

      return {
        success: true,
        stockEntriesCreated: createdStockEntries.length,
        priceRecordsCreated: createdPriceRecords.length,
      };
    }),

  // F12: Get applied summary
  getAppliedSummary: protectedProcedure
    .input(z.object({ receiptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user;

      const receipt = await prisma.receipt.findUnique({
        where: { id: input.receiptId },
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
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found",
        });
      }

      if (receipt.householdId !== user.householdId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

      const stockEntries = await prisma.stockEntry.findMany({
        where: { receiptItemId: { in: receipt.items.map((i) => i.id) } },
        include: { product: true },
      });

      const priceRecords = await prisma.priceRecord.findMany({
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
  list: protectedProcedure
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
      const user = ctx.session.user;
      
      if (!user.householdId) {
        return { items: [], nextCursor: null };
      }

      const receipts = await prisma.receipt.findMany({
        where: {
          householdId: user.householdId,
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
