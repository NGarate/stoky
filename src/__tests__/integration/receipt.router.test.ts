import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { MatchStatus, ReceiptStatus } from "@prisma/client";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createTestUser,
  createTestHousehold,
  createTestProduct,
  createMockSession,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * The receipt router, procedure by procedure.
 *
 * It is the largest router in the project — ten procedures over 686 lines —
 * and it was the least covered: 28.6% of its functions and 19.5% of its lines,
 * against 90% for the integration tier as a whole. The pipeline's *services*
 * were well tested and the browser suite walked the screens, so what was
 * missing was the layer in between: the procedures' own guards, state
 * transitions and side effects.
 *
 * Every procedure here is exercised for three things, because each is a
 * different failure and the third is the one no interface reveals:
 *
 * - the row is missing → NOT_FOUND
 * - the row belongs to another household → FORBIDDEN, and nothing read
 * - the happy path leaves the database in the state the next screen assumes
 *
 * **What this deliberately does not cover.** `upload`'s success path calls
 * `processReceiptAsync`, which starts Tesseract; on a fresh container that
 * fetches language data from a CDN (ISSUES.md OCR-1) and would put an
 * unbounded network wait inside a suite held to ten minutes. `parseReceipt`
 * and `matchItems` have the same problem past their guards. So their refusal
 * branches are covered — which is where the file-upload security lives — and
 * their success paths belong to the browser suite until OCR-1 is closed.
 */

const HOUSEHOLD = "Receipt Router Household";
const OTHER_HOUSEHOLD = "Receipt Router Other Household";

type Caller = ReturnType<typeof appRouter.createCaller>;

let householdId: string;
let otherHouseholdId: string;
let ownerId: string;
let storeId: string;
let productId: string;
let caller: Caller;
let outsider: Caller;
let kitchen: Caller;

async function callerFor(
  household: string,
  role: "OWNER" | "KITCHEN",
): Promise<{ caller: Caller; userId: string }> {
  const user = await createTestUser({
    email: generateTestEmail(`receipt-${role.toLowerCase()}`),
    name: `Receipt Router ${role}`,
    householdId: household,
    role,
  });
  const ctx = await createTRPCContext({ session: createMockSession(user) });
  return { caller: appRouter.createCaller(ctx), userId: user.id };
}

/** A receipt with two parsed lines, at whatever status the test needs. */
async function seedReceipt(options: {
  status?: ReceiptStatus;
  household?: string;
  withStore?: boolean;
  matchStatus?: MatchStatus;
  matched?: boolean;
}) {
  const receipt = await prisma.receipt.create({
    data: {
      imagePath: `uploads/receipts/${options.household ?? householdId}/test.jpg`,
      householdId: options.household ?? householdId,
      uploadedBy: ownerId,
      status: options.status ?? ReceiptStatus.NEEDS_REVIEW,
      storeId: options.withStore === false ? null : storeId,
      purchaseDate: new Date("2026-08-01T10:00:00.000Z"),
      totalAmount: 7.5,
    },
  });

  const first = await prisma.receiptItem.create({
    data: {
      receiptId: receipt.id,
      rawText: "LECHE ENTERA 1L 2,50",
      parsedName: "Leche entera",
      parsedPrice: 2.5,
      parsedQuantity: 2,
      matchedProductId: options.matched === false ? null : productId,
      matchStatus: options.matchStatus ?? MatchStatus.AUTO_MATCHED,
      matchConfidence: 0.9,
    },
  });

  const second = await prisma.receiptItem.create({
    data: {
      receiptId: receipt.id,
      rawText: "PAN RUSTICO 1,20",
      parsedName: "Pan rustico",
      parsedPrice: 1.2,
      parsedQuantity: 1,
      matchStatus: MatchStatus.PENDING,
    },
  });

  return { receipt, first, second };
}

/** Asserts a call was refused with a particular code. */
async function expectCode(call: () => Promise<unknown>, code: TRPC_ERROR_CODE_KEY) {
  let thrown: unknown;
  try {
    await call();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TRPCError);
  expect((thrown as TRPCError).code).toBe(code);
}

/** A one-pixel PNG, as real bytes: valid header, valid image. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(async () => {
  const household = await createTestHousehold({ name: HOUSEHOLD });
  householdId = household.id;
  const other = await createTestHousehold({ name: OTHER_HOUSEHOLD });
  otherHouseholdId = other.id;

  const owner = await callerFor(householdId, "OWNER");
  caller = owner.caller;
  ownerId = owner.userId;

  outsider = (await callerFor(otherHouseholdId, "OWNER")).caller;
  kitchen = (await callerFor(householdId, "KITCHEN")).caller;

  const store = await prisma.store.create({
    data: { name: "Receipt Router Store", householdId },
  });
  storeId = store.id;

  const product = await createTestProduct({
    name: "Receipt Router Milk",
    householdId,
    defaultUnit: "L",
  });
  productId = product.id;
});

beforeEach(async () => {
  // Each test seeds the receipts it needs, so the previous test's rows must be
  // gone or `list`'s counts would depend on execution order.
  const ids = [householdId, otherHouseholdId];
  await prisma.stockEntry.deleteMany({ where: { product: { householdId: { in: ids } } } });
  await prisma.priceRecord.deleteMany({ where: { product: { householdId: { in: ids } } } });
  await prisma.receiptItem.deleteMany({ where: { receipt: { householdId: { in: ids } } } });
  await prisma.receipt.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.product.deleteMany({
    where: { householdId: { in: ids }, id: { not: productId } },
  });
});

afterAll(async () => {
  const ids = [householdId, otherHouseholdId];
  await prisma.stockEntry.deleteMany({ where: { product: { householdId: { in: ids } } } });
  await prisma.priceRecord.deleteMany({ where: { product: { householdId: { in: ids } } } });
  await prisma.receiptItem.deleteMany({ where: { receipt: { householdId: { in: ids } } } });
  await prisma.receipt.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.product.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.store.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: "Receipt Router " } } });
  await prisma.household.deleteMany({ where: { name: { in: [HOUSEHOLD, OTHER_HOUSEHOLD] } } });
});

describe("receipt.upload — what it refuses", () => {
  // CLAUDE.md, Security Constraints: "validate MIME type + magic bytes,
  // re-encode with Sharp". These are the checks that stand between an upload
  // form and arbitrary bytes on disk, so they are asserted one at a time
  // rather than through one representative bad file.

  it("refuses a MIME type that is not an image", async () => {
    await expectCode(
      () =>
        caller.receipt.upload({
          fileBase64: ONE_PIXEL_PNG.toString("base64"),
          mimeType: "application/pdf",
        }),
      "BAD_REQUEST",
    );
  });

  it("refuses bytes whose magic number does not match the declared type", async () => {
    // The whole point of the magic-byte check: the MIME type is the caller's
    // claim, and a caller who wants to write a script to disk will claim
    // whatever passes.
    await expectCode(
      () =>
        caller.receipt.upload({
          fileBase64: Buffer.from("#!/bin/sh\necho not an image\n").toString("base64"),
          mimeType: "image/png",
        }),
      "BAD_REQUEST",
    );
  });

  it("refuses a PNG header on a JPEG declaration", async () => {
    await expectCode(
      () =>
        caller.receipt.upload({
          fileBase64: ONE_PIXEL_PNG.toString("base64"),
          mimeType: "image/jpeg",
        }),
      "BAD_REQUEST",
    );
  });

  it("refuses a file over the 10MB limit", async () => {
    // Built as a valid PNG header followed by padding, so it is the size check
    // that refuses it and not the magic-byte check standing in for it.
    const oversize = Buffer.concat([
      ONE_PIXEL_PNG,
      Buffer.alloc(10 * 1024 * 1024 + 1, 0),
    ]);

    await expectCode(
      () =>
        caller.receipt.upload({
          fileBase64: oversize.toString("base64"),
          mimeType: "image/png",
        }),
      "BAD_REQUEST",
    );
  });

  it("writes no receipt row for any refused upload", async () => {
    await expectCode(
      () =>
        caller.receipt.upload({
          fileBase64: Buffer.from("not an image").toString("base64"),
          mimeType: "image/png",
        }),
      "BAD_REQUEST",
    );

    expect(await prisma.receipt.count({ where: { householdId } })).toBe(0);
  });

  it("refuses a kitchen account before it validates anything", async () => {
    await expectCode(
      () =>
        kitchen.receipt.upload({
          fileBase64: ONE_PIXEL_PNG.toString("base64"),
          mimeType: "image/png",
        }),
      "FORBIDDEN",
    );
  });
});

describe("receipt.getStatus", () => {
  it("reports progress over the lines that have been decided", async () => {
    const { receipt } = await seedReceipt({});

    const status = await caller.receipt.getStatus({ receiptId: receipt.id });

    expect(status.id).toBe(receipt.id);
    // One AUTO_MATCHED, one PENDING: pending is not progress.
    expect(status.progress).toEqual({ total: 2, processed: 1 });
  });

  it("is NOT_FOUND for a receipt that does not exist", async () => {
    await expectCode(
      () => caller.receipt.getStatus({ receiptId: "does-not-exist" }),
      "NOT_FOUND",
    );
  });

  it("is FORBIDDEN for another household's receipt", async () => {
    const { receipt } = await seedReceipt({});

    await expectCode(
      () => outsider.receipt.getStatus({ receiptId: receipt.id }),
      "FORBIDDEN",
    );
  });
});

describe("receipt.getReceiptWithItems", () => {
  it("returns the receipt with its parsed lines", async () => {
    const { receipt } = await seedReceipt({});

    const result = await caller.receipt.getReceiptWithItems({ receiptId: receipt.id });

    expect(result.id).toBe(receipt.id);
    expect(result.items).toHaveLength(2);
  });

  it("is NOT_FOUND, then FORBIDDEN, for the two ways it can be unreachable", async () => {
    await expectCode(
      () => caller.receipt.getReceiptWithItems({ receiptId: "does-not-exist" }),
      "NOT_FOUND",
    );

    const { receipt } = await seedReceipt({});
    await expectCode(
      () => outsider.receipt.getReceiptWithItems({ receiptId: receipt.id }),
      "FORBIDDEN",
    );
  });
});

describe("receipt.confirmItem", () => {
  it("records a MATCH as user-confirmed, at full confidence", async () => {
    const { second } = await seedReceipt({});

    await caller.receipt.confirmItem({
      receiptItemId: second.id,
      action: "MATCH",
      productId,
    });

    const item = await prisma.receiptItem.findUnique({ where: { id: second.id } });
    expect(item?.matchStatus).toBe(MatchStatus.USER_CONFIRMED);
    expect(item?.matchedProductId).toBe(productId);
    // A person said so, so there is nothing probabilistic left to record.
    expect(item?.matchConfidence).toBe(1);
  });

  it("creates the product a CREATE names, in the receipt's household", async () => {
    const { second } = await seedReceipt({});

    await caller.receipt.confirmItem({
      receiptItemId: second.id,
      action: "CREATE",
      customName: "Pan rústico de pueblo",
    });

    const created = await prisma.product.findFirst({
      where: { name: "Pan rústico de pueblo" },
    });
    expect(created?.householdId).toBe(householdId);

    const item = await prisma.receiptItem.findUnique({ where: { id: second.id } });
    expect(item?.matchStatus).toBe(MatchStatus.USER_CREATED);
    expect(item?.matchedProductId).toBe(created?.id);
  });

  it("clears the product a SKIP had, so applying cannot resurrect it", async () => {
    // The line arrives AUTO_MATCHED to a product. Skipping it has to detach
    // that product, not merely relabel the row — `applyReceipt` skips on
    // status *or* a null product, and a row that kept both would be one
    // condition away from creating stock nobody asked for.
    const { first } = await seedReceipt({});

    await caller.receipt.confirmItem({ receiptItemId: first.id, action: "SKIP" });

    const item = await prisma.receiptItem.findUnique({ where: { id: first.id } });
    expect(item?.matchStatus).toBe(MatchStatus.SKIPPED);
    expect(item?.matchedProductId).toBeNull();
  });

  it("is NOT_FOUND for an item that does not exist", async () => {
    await expectCode(
      () => caller.receipt.confirmItem({ receiptItemId: "does-not-exist", action: "SKIP" }),
      "NOT_FOUND",
    );
  });

  it("is FORBIDDEN for another household's line, and changes nothing", async () => {
    const { first } = await seedReceipt({});

    await expectCode(
      () => outsider.receipt.confirmItem({ receiptItemId: first.id, action: "SKIP" }),
      "FORBIDDEN",
    );

    const item = await prisma.receiptItem.findUnique({ where: { id: first.id } });
    expect(item?.matchStatus).toBe(MatchStatus.AUTO_MATCHED);
  });
});

describe("receipt.confirmAll", () => {
  it("applies each decision and moves the receipt to CONFIRMED", async () => {
    const { receipt, first, second } = await seedReceipt({});

    await caller.receipt.confirmAll({
      receiptId: receipt.id,
      items: [
        { receiptItemId: first.id, action: "MATCH", productId },
        { receiptItemId: second.id, action: "SKIP" },
      ],
    });

    const [one, two, updated] = await Promise.all([
      prisma.receiptItem.findUnique({ where: { id: first.id } }),
      prisma.receiptItem.findUnique({ where: { id: second.id } }),
      prisma.receipt.findUnique({ where: { id: receipt.id } }),
    ]);

    expect(one?.matchStatus).toBe(MatchStatus.USER_CONFIRMED);
    expect(two?.matchStatus).toBe(MatchStatus.SKIPPED);
    expect(updated?.status).toBe(ReceiptStatus.CONFIRMED);
  });

  it("confirms with a subset, leaving the rest as the matcher left them", async () => {
    // The case D18 is about: `confirmAll` accepts a subset, so a receipt can
    // reach CONFIRMED with lines still AUTO_MATCHED — and `applyReceipt`
    // creates stock for those too.
    const { receipt, second } = await seedReceipt({});

    await caller.receipt.confirmAll({
      receiptId: receipt.id,
      items: [{ receiptItemId: second.id, action: "SKIP" }],
    });

    const untouched = await prisma.receiptItem.findFirst({
      where: { receiptId: receipt.id, matchStatus: MatchStatus.AUTO_MATCHED },
    });
    expect(untouched).not.toBeNull();

    const updated = await prisma.receipt.findUnique({ where: { id: receipt.id } });
    expect(updated?.status).toBe(ReceiptStatus.CONFIRMED);
  });

  it("is FORBIDDEN for another household, and does not move its status", async () => {
    const { receipt, first } = await seedReceipt({});

    await expectCode(
      () =>
        outsider.receipt.confirmAll({
          receiptId: receipt.id,
          items: [{ receiptItemId: first.id, action: "SKIP" }],
        }),
      "FORBIDDEN",
    );

    const updated = await prisma.receipt.findUnique({ where: { id: receipt.id } });
    expect(updated?.status).toBe(ReceiptStatus.NEEDS_REVIEW);
  });
});

describe("receipt.applyReceipt", () => {
  it("refuses a receipt that has not been confirmed, and writes nothing", async () => {
    // The state machine's one real rule. Without it, a receipt could be
    // applied twice: once here and once after review.
    const { receipt } = await seedReceipt({ status: ReceiptStatus.NEEDS_REVIEW });

    await expectCode(
      () => caller.receipt.applyReceipt({ receiptId: receipt.id }),
      "BAD_REQUEST",
    );

    expect(await prisma.stockEntry.count({ where: { productId } })).toBe(0);
  });

  it("creates stock and a price record for every applied line", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });

    const result = await caller.receipt.applyReceipt({ receiptId: receipt.id });

    expect(result.stockEntriesCreated).toBe(1);
    expect(result.priceRecordsCreated).toBe(1);

    const entry = await prisma.stockEntry.findFirst({ where: { productId } });
    // The parsed quantity, and the product's own unit rather than the line's.
    expect(entry?.quantity).toBe(2);
    expect(entry?.unit).toBe("L");
    expect(entry?.operationType).toBe("PURCHASE");

    const price = await prisma.priceRecord.findFirst({ where: { productId } });
    expect(price?.price).toBe(2.5);
    expect(price?.storeId).toBe(storeId);
    expect(price?.receiptId).toBe(receipt.id);
  });

  it("moves the receipt to APPLIED", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });

    await caller.receipt.applyReceipt({ receiptId: receipt.id });

    const updated = await prisma.receipt.findUnique({ where: { id: receipt.id } });
    expect(updated?.status).toBe(ReceiptStatus.APPLIED);
  });

  it("skips a SKIPPED line and a line that matched nothing", async () => {
    const { receipt, first } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });
    await prisma.receiptItem.update({
      where: { id: first.id },
      data: { matchStatus: MatchStatus.SKIPPED, matchedProductId: null },
    });

    const result = await caller.receipt.applyReceipt({ receiptId: receipt.id });

    // Both lines are now unusable: one skipped, one never matched.
    expect(result.stockEntriesCreated).toBe(0);
    expect(await prisma.stockEntry.count({ where: { productId } })).toBe(0);
  });

  it("skips a SKIPPED line even when it still carries a product", async () => {
    // Two independent reasons to skip a line — the status and a null product —
    // and they have to be independent, or the guard is one schema change from
    // creating stock nobody asked for. `confirmItem` and `confirmAll` both
    // clear the product on a skip, so this state only arises from a direct
    // write; a defensive check is exactly what that is for.
    //
    // Written this way after breaking the status branch on its own and finding
    // that the previous version of this test stayed green: it cleared the
    // product too, so it was asserting the null check twice.
    const { receipt, first } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });
    await prisma.receiptItem.update({
      where: { id: first.id },
      data: { matchStatus: MatchStatus.SKIPPED },
    });

    const result = await caller.receipt.applyReceipt({ receiptId: receipt.id });

    expect(result.stockEntriesCreated).toBe(0);
    expect(await prisma.stockEntry.count({ where: { productId } })).toBe(0);
  });

  it("records no price when the receipt has no store", async () => {
    // A price without a shop is not a price anyone can compare.
    const { receipt } = await seedReceipt({
      status: ReceiptStatus.CONFIRMED,
      withStore: false,
    });

    const result = await caller.receipt.applyReceipt({ receiptId: receipt.id });

    expect(result.stockEntriesCreated).toBe(1);
    expect(result.priceRecordsCreated).toBe(0);
  });

  it("is FORBIDDEN for another household, and writes no stock", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });

    await expectCode(
      () => outsider.receipt.applyReceipt({ receiptId: receipt.id }),
      "FORBIDDEN",
    );

    expect(await prisma.stockEntry.count({ where: { productId } })).toBe(0);
  });

  it("is refused for a kitchen account", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });

    await expectCode(
      () => kitchen.receipt.applyReceipt({ receiptId: receipt.id }),
      "FORBIDDEN",
    );
  });
});

describe("receipt.getAppliedSummary", () => {
  it("counts what applyReceipt applied, not the lines that were parsed", async () => {
    // D18. The filter here has to mirror `applyReceipt`'s own condition, or a
    // confirmation screen under-reports what it has just done.
    const { receipt } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });
    await caller.receipt.applyReceipt({ receiptId: receipt.id });

    const summary = await caller.receipt.getAppliedSummary({ receiptId: receipt.id });

    // One line applied, of two parsed. Both figures are needed: the page says
    // how many were left out rather than implying the receipt held one line.
    expect(summary.items).toHaveLength(1);
    expect(summary.linesNotApplied).toBe(1);
    expect(summary.itemsAdded).toBe(1);
    expect(summary.pricesRecorded).toBe(1);
    expect(summary.receipt.store?.id).toBe(storeId);
  });

  it("still counts a line the matcher matched and nobody reviewed", async () => {
    // The regression D18 records: filtering on USER_CONFIRMED | USER_CREATED
    // is narrower than what is applied, so an AUTO_MATCHED line got stock and
    // no mention.
    const { receipt } = await seedReceipt({
      status: ReceiptStatus.CONFIRMED,
      matchStatus: MatchStatus.AUTO_MATCHED,
    });

    const summary = await caller.receipt.getAppliedSummary({ receiptId: receipt.id });

    expect(summary.items).toHaveLength(1);
  });

  it("is FORBIDDEN for another household", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.APPLIED });

    await expectCode(
      () => outsider.receipt.getAppliedSummary({ receiptId: receipt.id }),
      "FORBIDDEN",
    );
  });
});

describe("receipt.list", () => {
  it("returns only this household's receipts", async () => {
    await seedReceipt({});
    await seedReceipt({ household: otherHouseholdId });

    const mine = await caller.receipt.list({ limit: 20 });

    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]?.householdId).toBe(householdId);
  });

  it("filters by status", async () => {
    await seedReceipt({ status: ReceiptStatus.NEEDS_REVIEW });
    await seedReceipt({ status: ReceiptStatus.APPLIED });

    const applied = await caller.receipt.list({ limit: 20, status: "APPLIED" });

    expect(applied.items).toHaveLength(1);
    expect(applied.items[0]?.status).toBe(ReceiptStatus.APPLIED);
  });

  it("counts each receipt's lines without loading them", async () => {
    await seedReceipt({});

    const result = await caller.receipt.list({ limit: 20 });

    expect(result.items[0]?._count.items).toBe(2);
  });

  it("pages, and hands back a cursor only when there is more", async () => {
    await seedReceipt({});
    await seedReceipt({});
    await seedReceipt({});

    const firstPage = await caller.receipt.list({ limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await caller.receipt.list({
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    // And the pages do not overlap, which a cursor off by one would break.
    const ids = new Set([...firstPage.items, ...secondPage.items].map((r) => r.id));
    expect(ids.size).toBe(3);
  });
});

describe("receipt.parseReceipt and matchItems — their guards", () => {
  it("parseReceipt is NOT_FOUND for a receipt that does not exist", async () => {
    await expectCode(
      () => caller.receipt.parseReceipt({ receiptId: "does-not-exist" }),
      "NOT_FOUND",
    );
  });

  it("parseReceipt is FORBIDDEN for another household", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.PROCESSING });

    await expectCode(
      () => outsider.receipt.parseReceipt({ receiptId: receipt.id }),
      "FORBIDDEN",
    );
  });

  it("parseReceipt refuses a receipt whose OCR has not run", async () => {
    // The phase order the ReceiptStatus state machine exists to enforce:
    // there is nothing to parse until OCR has produced text.
    const { receipt } = await seedReceipt({ status: ReceiptStatus.UPLOADING });

    await expectCode(
      () => caller.receipt.parseReceipt({ receiptId: receipt.id }),
      "BAD_REQUEST",
    );
  });

  it("matchItems is NOT_FOUND, and FORBIDDEN for another household", async () => {
    await expectCode(
      () => caller.receipt.matchItems({ receiptId: "does-not-exist" }),
      "NOT_FOUND",
    );

    const { receipt } = await seedReceipt({ status: ReceiptStatus.PARSED });
    await expectCode(
      () => outsider.receipt.matchItems({ receiptId: receipt.id }),
      "FORBIDDEN",
    );
  });

  it("refuses a kitchen account on both", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.PARSED });

    await expectCode(
      () => kitchen.receipt.parseReceipt({ receiptId: receipt.id }),
      "FORBIDDEN",
    );
    await expectCode(
      () => kitchen.receipt.matchItems({ receiptId: receipt.id }),
      "FORBIDDEN",
    );
  });
});
