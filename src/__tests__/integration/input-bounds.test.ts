import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import {
  cleanupTestHouseholds,
  cleanupTestProducts,
  cleanupTestUsers,
  createMockSession,
  createTestHousehold,
  createTestProduct,
  createTestUser,
  envelope,
  generateTestEmail,
} from "../utils/test-helpers";
import {
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_RECEIPT_LINES,
} from "@/lib/validations/bounds";

/**
 * The bounds on inputs declared inline in a router, through the router.
 *
 * The shared schemas are pinned in `unit/validation-bounds.test.ts`. These are
 * the ones written beside their procedure, which a unit test cannot import —
 * and `product.searchByName`, because it is the one whose `limit` reaches SQL.
 *
 * Every assertion names the field the refusal is about. A bare "it threw
 * BAD_REQUEST" would pass for an envelope typo just as well as for the bound
 * under test.
 */

const MARKER = `bounds-${process.pid}-${Date.now().toString(36)}`;
let api: ReturnType<typeof appRouter.createCaller>;
let userId: string;
let productId: string;

beforeAll(async () => {
  const household = await createTestHousehold({ name: `${MARKER} household` });
  const user = await createTestUser({
    email: generateTestEmail(MARKER),
    name: MARKER,
    householdId: household.id,
    role: "OWNER",
  });
  userId = user.id;
  productId = (
    await createTestProduct({
      name: `${MARKER} leche`,
      householdId: household.id,
    })
  ).id;
  api = appRouter.createCaller(
    await createTRPCContext({
      session: createMockSession({ ...user, household }),
    }),
  );
});

afterAll(async () => {
  await cleanupTestProducts(MARKER);
  await cleanupTestUsers(MARKER);
  await cleanupTestHouseholds(MARKER);
});

/** The input paths a call was refused over, or the reason it was not refused. */
async function refusedFields(
  call: () => Promise<unknown>,
): Promise<string[] | string> {
  try {
    await call();
    return "accepted";
  } catch (error) {
    if (!(error instanceof TRPCError))
      return `not a TRPCError: ${String(error)}`;
    if (error.code !== "BAD_REQUEST") return error.code;
    if (!(error.cause instanceof ZodError))
      return "BAD_REQUEST from the resolver";
    // De-duplicated: Infinity breaks `.finite()` and `.max()` at once.
    return [
      ...new Set(error.cause.issues.map((issue) => issue.path.join("."))),
    ];
  }
}

describe("inputs declared beside their procedure", () => {
  it("refuses a page size that would reach LIMIT as -1", async () => {
    expect(
      await refusedFields(() =>
        api.product.searchByName({ query: "leche", limit: -1 }),
      ),
    ).toEqual(["limit"]);
    expect(await refusedFields(() => api.receipt.list({ limit: -1 }))).toEqual([
      "limit",
    ]);
    expect(
      await refusedFields(() => api.price.getProductPrices({ limit: 1e9 })),
    ).toEqual(["limit"]);
  });

  it("refuses a fractional page size before it reaches take", async () => {
    // `getStockHistory` hands `limit + 1` to Prisma's `take`, which truncates
    // it: 2.5 answered with two rows and a cursor rather than an error. The
    // product is real so that, unbounded, the call is accepted, not NOT_FOUND.
    expect(
      await refusedFields(() =>
        api.inventory.getStockHistory({ productId, limit: 2.5 }),
      ),
    ).toEqual(["limit"]);
  });

  it("refuses a day window that cannot become a date", async () => {
    expect(
      await refusedFields(() => api.inventory.getExpiringItems({ days: 1e12 })),
    ).toEqual(["days"]);
  });

  it("refuses an infinite price or quantity", async () => {
    expect(
      await refusedFields(() =>
        api.inventory.addStock({
          ...envelope(userId),
          productId: "p",
          unit: "unidad",
          quantity: 1,
          price: Infinity,
        }),
      ),
    ).toEqual(["price"]);
    expect(
      await refusedFields(() =>
        api.inventory.transferStock({
          productId: "p",
          unit: "unidad",
          quantity: Infinity,
          fromLocationId: "a",
          toLocationId: "b",
        }),
      ),
    ).toEqual(["quantity"]);
  });

  it("refuses a review submission with more lines than a receipt has", async () => {
    const items = Array.from({ length: MAX_RECEIPT_LINES + 1 }, (_, index) => ({
      receiptItemId: `line-${index}`,
      action: "SKIP" as const,
    }));

    expect(
      await refusedFields(() =>
        api.receipt.confirmAll({ receiptId: "r", items }),
      ),
    ).toEqual(["items"]);
  });

  it("refuses stored text past its bound before anything is written", async () => {
    // The disk-filling case from the 2026-10-12 review: one call stored as much
    // as the request body could carry. `procedure-input-bounds.test.ts` proves
    // every field has a maximum; this proves the router enforces it.
    expect(
      await refusedFields(() =>
        api.store.create({ name: "M".repeat(MAX_NAME_LENGTH + 1) }),
      ),
    ).toEqual(["name"]);
    expect(
      await refusedFields(() =>
        api.inventory.transferStock({
          productId: "p",
          unit: "unidad",
          quantity: 1,
          fromLocationId: "a",
          toLocationId: "b",
          note: "n".repeat(MAX_NOTE_LENGTH + 1),
        }),
      ),
    ).toEqual(["note"]);
    expect(
      await refusedFields(() =>
        api.price.recordPrice({
          productId: "p",
          storeId: "s",
          price: 1,
          unit: "unidad",
          currency: "EURO",
        }),
      ),
    ).toEqual(["currency"]);
  });

  it("still takes the ordinary values", async () => {
    // So the bounds above are bounds and not a broken procedure.
    expect(await api.receipt.list({ limit: 20 })).toBeDefined();
    // The history screen asks for a hundred, the most a page may hold.
    expect(
      (await api.inventory.getStockHistory({ productId, limit: 100 })).entries,
    ).toEqual([]);
    expect(
      Array.isArray(await api.inventory.getExpiringItems({ days: 30 })),
    ).toBe(true);
    expect(
      Array.isArray(
        await api.product.searchByName({ query: "leche", limit: 10 }),
      ),
    ).toBe(true);
  });
});
