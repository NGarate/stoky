import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { TRPCError } from "@trpc/server";
import { pngClaiming, pngOf } from "../utils/png";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { MatchStatus, ReceiptStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { appRouter } from "@/server/trpc/router";
import { ThrottledError } from "@/server/trpc/throttle";
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
 * - the row belongs to another household → NOT_FOUND, and nothing read
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
  db?: PrismaClient,
): Promise<{ caller: Caller; userId: string }> {
  const user = await createTestUser({
    email: generateTestEmail(`receipt-${role.toLowerCase()}`),
    name: `Receipt Router ${role}`,
    householdId: household,
    role,
  });
  // `db` is how the rollback test hands the router a client whose second write
  // throws; production passes nothing and gets the singleton.
  const ctx = await createTRPCContext({ session: createMockSession(user), db });
  return { caller: appRouter.createCaller(ctx), userId: user.id };
}

/**
 * A client that fails exactly where the price record is written.
 *
 * The same injection `inventory.purchase-atomicity.test.ts` uses, and for the
 * same reason: `PriceRecord` has no constraint an input could violate, so there
 * is no receipt that makes the second write fail on its own. An extension is
 * carried by the transaction client too, which is the point — the failure
 * lands *inside* the transaction, where a rollback either happens or does not.
 */
function clientThatCannotWritePrices(): PrismaClient {
  return prisma.$extends({
    query: {
      priceRecord: {
        create() {
          throw new Error("price write failed");
        },
      },
    },
    // An extended client is a superset of `PrismaClient`; the context types the
    // field as the plain one because that is what production passes.
  }) as unknown as PrismaClient;
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

  it("refuses a store that belongs to another household", async () => {
    // SEC-1's shape a third time. `price.recordPrice` verifies this identical
    // field two files away; upload wrote it onto the Receipt unchecked, and
    // everything the receipt later produces inherits the reference.
    const strangersStore = await prisma.store.create({
      data: { name: "Tienda ajena", householdId: otherHouseholdId },
    });

    await expectCode(
      () =>
        caller.receipt.upload({
          fileBase64: ONE_PIXEL_PNG.toString("base64"),
          mimeType: "image/png",
          storeId: strangersStore.id,
        }),
      "NOT_FOUND",
    );

    // Refused before the bytes were written anywhere.
    const filed = await prisma.receipt.count({
      where: { storeId: strangersStore.id },
    });
    expect(filed).toBe(0);
  });

  it("still accepts the household's own store", async () => {
    const receipt = await caller.receipt.upload({
      fileBase64: ONE_PIXEL_PNG.toString("base64"),
      mimeType: "image/png",
      storeId,
    });

    expect(receipt).toBeDefined();
  });

  it("refuses an image that is small in bytes and enormous in pixels", async () => {
    // `SECURITY_REVIEW.md` finding 14. The size cap counts bytes; the decoding
    // cost is in pixels, and the two are unrelated for a compressible image.
    // This one declares 81 megapixels in 68 bytes — it passes the 10 MB cap and
    // the magic-byte check, and decoding it would ask for gigabytes.
    //
    // Assembled here rather than committed as a fixture, because a checked-in
    // decompression bomb is a thing somebody opens by accident. Hand-built
    // rather than made with sharp, because `Bun.Image` has no `create` and this
    // file is the last thing in the suite that needed the library at all.
    const bomb = pngClaiming(9000, 9000);

    // The premise, asserted rather than assumed: this really does slip past the
    // byte cap, or the test proves nothing about the pixel cap.
    expect(bomb.length).toBeLessThan(10 * 1024 * 1024);

    // The control, so the refusal below is not just "hand-assembled PNGs are
    // rejected": a genuinely valid one from the same builder is accepted by
    // this same procedure.
    //
    // It cannot be the *tighter* control — the same token `IDAT` under a small
    // header — because that one is refused too, at the decode rather than at
    // the bound, and this procedure answers BAD_REQUEST to both. Telling those
    // two apart needs the error message, and that is asserted in
    // `unit/png-builder.test.ts` where the message is in reach.
    const accepted = await caller.receipt.upload({
      fileBase64: pngOf(60, 40).toString("base64"),
      mimeType: "image/png",
    });
    expect(accepted.id).toBeDefined();

    await expectCode(
      () =>
        caller.receipt.upload({
          fileBase64: bomb.toString("base64"),
          mimeType: "image/png",
        }),
      "BAD_REQUEST",
    );
  }, 30_000);

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
    //
    // **This test passed while the limit was unreachable over HTTP**, and it is
    // worth saying so where somebody will read it. A caller built here reaches
    // the procedure in-process, with no request and therefore no request body;
    // a browser sends the photograph base64'd in JSON, and Next truncated any
    // body over 10 MiB before the router saw it — which is *less* than a 10 MB
    // photograph becomes once encoded. So this assertion was true at the tier
    // it runs in and could not be reached at the tier that matters.
    // `unit/upload-body-limit.test.ts` is what now holds the two numbers
    // together; this one is unchanged and still worth having.
    //
    // What refuses it is now the schema bound rather than the length check
    // below it: both answer BAD_REQUEST. The length check is not redundant —
    // the encoded bound admits two more bytes than the decoded one does — but
    // it is no longer what this test exercises.
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

/**
 * OWASP ASVS V11.1.4 — anti-automation on the expensive operation.
 *
 * Everything above refuses a *bad* upload. Nothing refused a good one arriving
 * a thousand times, and this is the procedure where that matters: up to 10 MB
 * decoded, re-encoded through Sharp, written to a volume, then handed to
 * Tesseract. The rest of the router reads rows.
 */
describe("receipt.upload — how many", () => {
  const ATTEMPTS = 3;
  const original = process.env.RATE_LIMIT_UPLOAD_ATTEMPTS;

  let throttled: Caller;
  let bystander: Caller;

  beforeAll(async () => {
    process.env.RATE_LIMIT_UPLOAD_ATTEMPTS = String(ATTEMPTS);
    // Fresh accounts, so these tests neither spend nor are spent by the budget
    // the refusal tests above consumed.
    throttled = (await callerFor(householdId, "OWNER")).caller;
    bystander = (await callerFor(householdId, "OWNER")).caller;
  });

  afterAll(() => {
    if (original === undefined) delete process.env.RATE_LIMIT_UPLOAD_ATTEMPTS;
    else process.env.RATE_LIMIT_UPLOAD_ATTEMPTS = original;
  });

  /** Refused for being garbage — which is the point: it is counted anyway. */
  const upload = (as: Caller) =>
    as.receipt.upload({
      fileBase64: Buffer.from("not an image").toString("base64"),
      mimeType: "image/png",
    });

  it("stops counting attempts as free once the budget is spent", async () => {
    // Each of these is refused with BAD_REQUEST *and* counted. Counting after
    // validation would leave the cheapest way to spend the server's CPU — send
    // rubbish, get refused, repeat — outside the limit entirely.
    for (let i = 0; i < ATTEMPTS; i++) {
      await expectCode(() => upload(throttled), "BAD_REQUEST");
    }

    await expectCode(() => upload(throttled), "TOO_MANY_REQUESTS");
  });

  it("answers with a code the write queue retries rather than discards", async () => {
    // 429, not 403. `src/lib/offline/classify.ts` treats the first as
    // transient and the second as permanent, so getting this wrong would make
    // a queued receipt vanish instead of waiting.
    let thrown: unknown;
    try {
      await upload(throttled);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as TRPCError).code).toBe("TOO_MANY_REQUESTS");
  });

  it("carries how long to wait, not only that it is too many", async () => {
    // RFC 9110 §10.2.3. The route handler reads this off the error to set
    // `Retry-After` — see `src/server/trpc/throttle.ts`. Without the cause the
    // header would silently stop appearing, and nothing about the refusal
    // itself would look different.
    let thrown: unknown;
    try {
      await upload(throttled);
    } catch (error) {
      thrown = error;
    }

    const cause = (thrown as TRPCError).cause;
    expect(cause).toBeInstanceOf(ThrottledError);
    expect((cause as ThrottledError).retryAfterSeconds).toBeGreaterThan(0);
  });

  it("leaves another account's budget alone", async () => {
    // Keyed on the account rather than the address, so a household behind one
    // NAT does not share a budget for work each member does separately.
    await expectCode(() => upload(bystander), "BAD_REQUEST");
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

  it("is NOT_FOUND for another household's receipt, so the id's existence is not confirmed", async () => {
    const { receipt } = await seedReceipt({});

    await expectCode(
      () => outsider.receipt.getStatus({ receiptId: receipt.id }),
      "NOT_FOUND",
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

  it("is NOT_FOUND for both ways it can be unreachable, so the id's existence is not confirmed", async () => {
    await expectCode(
      () => caller.receipt.getReceiptWithItems({ receiptId: "does-not-exist" }),
      "NOT_FOUND",
    );

    const { receipt } = await seedReceipt({});
    await expectCode(
      () => outsider.receipt.getReceiptWithItems({ receiptId: receipt.id }),
      "NOT_FOUND",
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

  it("is NOT_FOUND for another household's line, so the id's existence is not confirmed, and changes nothing", async () => {
    const { first } = await seedReceipt({});

    await expectCode(
      () => outsider.receipt.confirmItem({ receiptItemId: first.id, action: "SKIP" }),
      "NOT_FOUND",
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

  it("is NOT_FOUND for another household, so the id's existence is not confirmed, and does not move its status", async () => {
    const { receipt, first } = await seedReceipt({});

    await expectCode(
      () =>
        outsider.receipt.confirmAll({
          receiptId: receipt.id,
          items: [{ receiptItemId: first.id, action: "SKIP" }],
        }),
      "NOT_FOUND",
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

  it("is NOT_FOUND for another household, so the id's existence is not confirmed, and writes no stock", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });

    await expectCode(
      () => outsider.receipt.applyReceipt({ receiptId: receipt.id }),
      "NOT_FOUND",
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

  it("applies exactly once under two concurrent calls", async () => {
    // Two people pressing Apply on the kitchen tablet and the phone, or one
    // person pressing it twice on a slow connection. The status check at the
    // top of the resolver is a read, and both calls did it before either wrote,
    // so both passed it and every line was booked twice.
    //
    // Deterministic regardless of interleaving: the claim is an UPDATE filtered
    // on CONFIRMED, so of the two exactly one matches the row and the other
    // sees zero rows — either because it queued behind the winner's lock and
    // re-read an APPLIED row, or because it arrived after the commit.
    const { receipt } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });
    const lines = await prisma.receiptItem.findMany({
      where: { receiptId: receipt.id },
      select: { id: true },
    });
    const appliable = await prisma.receiptItem.count({
      where: {
        receiptId: receipt.id,
        matchedProductId: { not: null },
        matchStatus: { not: MatchStatus.SKIPPED },
      },
    });

    const results = await Promise.allSettled([
      caller.receipt.applyReceipt({ receiptId: receipt.id }),
      caller.receipt.applyReceipt({ receiptId: receipt.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    // The loser refused *on the claim*. Asserting the code matters: a deadlock
    // or a unique-constraint violation would also leave one call standing, and
    // that would be a different defect wearing this test's green.
    const refusal = results.find((r) => r.status === "rejected")?.reason;
    expect(refusal).toBeInstanceOf(TRPCError);
    expect((refusal as TRPCError).code).toBe("BAD_REQUEST");

    // `StockEntry.receiptItemId` is a bare column and not a relation, so the
    // entries are counted through the line ids — the shape `getAppliedSummary`
    // uses two procedures down.
    expect(
      await prisma.stockEntry.count({
        where: { receiptItemId: { in: lines.map((line) => line.id) } },
      }),
    ).toBe(appliable);
    expect(
      await prisma.priceRecord.count({ where: { receiptId: receipt.id } }),
    ).toBe(appliable);
  });

  it("rolls the status back when a write inside fails, so a retry is safe", async () => {
    // The crash-mid-loop half. Unwrapped, the stock entries before the failure
    // were already committed and the receipt was still CONFIRMED — so the
    // obvious thing to do next, press Apply again, booked them a second time.
    const { receipt } = await seedReceipt({ status: ReceiptStatus.CONFIRMED });
    const lines = await prisma.receiptItem.findMany({
      where: { receiptId: receipt.id },
      select: { id: true },
    });
    const entryCount = () =>
      prisma.stockEntry.count({
        where: { receiptItemId: { in: lines.map((line) => line.id) } },
      });

    const { caller: failing } = await callerFor(
      householdId,
      "OWNER",
      clientThatCannotWritePrices(),
    );

    let thrown: unknown;
    try {
      await failing.receipt.applyReceipt({ receiptId: receipt.id });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();

    // Nothing half-written: the stock entry created before the price write went
    // down with it, and the status never left CONFIRMED.
    expect(await entryCount()).toBe(0);
    expect(
      await prisma.priceRecord.count({ where: { receiptId: receipt.id } }),
    ).toBe(0);
    const after = await prisma.receipt.findUnique({ where: { id: receipt.id } });
    expect(after?.status).toBe(ReceiptStatus.CONFIRMED);

    // Which is what "safe to retry" means, and the only assertion that proves
    // the rollback was complete rather than merely partial: the same receipt
    // applies once, cleanly, on a healthy client.
    const result = await caller.receipt.applyReceipt({ receiptId: receipt.id });
    expect(result.stockEntriesCreated).toBe(1);
    expect(await entryCount()).toBe(1);
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

  it("is NOT_FOUND for another household, so the id's existence is not confirmed", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.APPLIED });

    await expectCode(
      () => outsider.receipt.getAppliedSummary({ receiptId: receipt.id }),
      "NOT_FOUND",
    );
  });
});

describe("a receipt line belongs to its receipt, and its receipt to a household", () => {
  /**
   * Found by the Phase 7 review, and it is SEC-1's shape a second time.
   *
   * `confirmAll` authorises the *receipt* named in its input and then updates
   * every `receiptItemId` in the array by bare id. The two are not the same
   * claim: passing a receipt you own alongside line ids you do not is enough to
   * write rows in another household, and nothing refuses it.
   *
   * The caller-supplied `productId` is the same defect one level down — it is
   * written into `matchedProductId` without anyone asking whose product it is.
   * Applying the receipt afterwards would book stock and a price against
   * another household's catalogue.
   */
  it("refuses a line that belongs to another household's receipt", async () => {
    const mine = await seedReceipt({});
    const theirs = await seedReceipt({ household: otherHouseholdId });

    await expectCode(
      () =>
        caller.receipt.confirmAll({
          // A receipt this caller genuinely owns, so the household check passes.
          receiptId: mine.receipt.id,
          // A line from a receipt they do not.
          items: [
            { receiptItemId: theirs.first.id, action: "SKIP" },
          ],
        }),
      "NOT_FOUND",
    );

    // And it is not merely refused — nothing was written on the way to refusing.
    const untouched = await prisma.receiptItem.findUnique({
      where: { id: theirs.first.id },
    });
    expect(untouched?.matchStatus).toBe(MatchStatus.AUTO_MATCHED);
    expect(untouched?.matchedProductId).toBe(productId);
  });

  it("refuses a product that belongs to another household", async () => {
    const mine = await seedReceipt({});
    const strangersProduct = await prisma.product.create({
      data: {
        name: "Producto de otro hogar",
        householdId: otherHouseholdId,
        defaultUnit: "unit",
      },
    });

    await expectCode(
      () =>
        caller.receipt.confirmAll({
          receiptId: mine.receipt.id,
          items: [
            {
              receiptItemId: mine.second.id,
              action: "MATCH",
              productId: strangersProduct.id,
            },
          ],
        }),
      "NOT_FOUND",
    );

    const untouched = await prisma.receiptItem.findUnique({
      where: { id: mine.second.id },
    });
    expect(untouched?.matchedProductId).toBeNull();
  });

  it("refuses the same product through confirmItem", async () => {
    const mine = await seedReceipt({});
    const strangersProduct = await prisma.product.create({
      data: {
        name: "Otro producto ajeno",
        householdId: otherHouseholdId,
        defaultUnit: "unit",
      },
    });

    await expectCode(
      () =>
        caller.receipt.confirmItem({
          receiptItemId: mine.second.id,
          action: "MATCH",
          productId: strangersProduct.id,
        }),
      "NOT_FOUND",
    );
  });

  it("still lets the household confirm its own lines against its own products", async () => {
    // The refusals above must not be a blanket denial: the ordinary path has to
    // keep working, or the fix is just a broken feature.
    const mine = await seedReceipt({});

    const confirmed = await caller.receipt.confirmAll({
      receiptId: mine.receipt.id,
      items: [
        { receiptItemId: mine.second.id, action: "MATCH", productId },
      ],
    });

    expect(confirmed).toBeDefined();
    const updated = await prisma.receiptItem.findUnique({
      where: { id: mine.second.id },
    });
    expect(updated?.matchedProductId).toBe(productId);
    expect(updated?.matchStatus).toBe(MatchStatus.USER_CONFIRMED);
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

  it("parseReceipt is NOT_FOUND for another household, so the id's existence is not confirmed", async () => {
    const { receipt } = await seedReceipt({ status: ReceiptStatus.PROCESSING });

    await expectCode(
      () => outsider.receipt.parseReceipt({ receiptId: receipt.id }),
      "NOT_FOUND",
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

  it("matchItems is NOT_FOUND for a missing receipt and for another household's, so the id's existence is not confirmed", async () => {
    await expectCode(
      () => caller.receipt.matchItems({ receiptId: "does-not-exist" }),
      "NOT_FOUND",
    );

    const { receipt } = await seedReceipt({ status: ReceiptStatus.PARSED });
    await expectCode(
      () => outsider.receipt.matchItems({ receiptId: receipt.id }),
      "NOT_FOUND",
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
