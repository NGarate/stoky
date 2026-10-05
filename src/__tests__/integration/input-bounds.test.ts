import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import {
  cleanupTestHouseholds,
  cleanupTestUsers,
  createMockSession,
  createTestHousehold,
  createTestUser,
  envelope,
  generateTestEmail,
} from "../utils/test-helpers";
import { MAX_RECEIPT_LINES } from "@/lib/validations/bounds";

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

beforeAll(async () => {
  const household = await createTestHousehold({ name: `${MARKER} household` });
  const user = await createTestUser({
    email: generateTestEmail(MARKER),
    name: MARKER,
    householdId: household.id,
    role: "OWNER",
  });
  userId = user.id;
  api = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession({ ...user, household }) }),
  );
});

afterAll(async () => {
  await cleanupTestUsers(MARKER);
  await cleanupTestHouseholds(MARKER);
});

/** The input paths a call was refused over, or the reason it was not refused. */
async function refusedFields(call: () => Promise<unknown>): Promise<string[] | string> {
  try {
    await call();
    return "accepted";
  } catch (error) {
    if (!(error instanceof TRPCError)) return `not a TRPCError: ${String(error)}`;
    if (error.code !== "BAD_REQUEST") return error.code;
    if (!(error.cause instanceof ZodError)) return "BAD_REQUEST from the resolver";
    // De-duplicated: Infinity breaks `.finite()` and `.max()` at once.
    return [...new Set(error.cause.issues.map((issue) => issue.path.join(".")))];
  }
}

describe("inputs declared beside their procedure", () => {
  it("refuses a page size that would reach LIMIT as -1", async () => {
    expect(await refusedFields(() => api.product.searchByName({ query: "leche", limit: -1 }))).toEqual(["limit"]);
    expect(await refusedFields(() => api.receipt.list({ limit: -1 }))).toEqual(["limit"]);
    expect(await refusedFields(() => api.price.getProductPrices({ limit: 1e9 }))).toEqual(["limit"]);
  });

  it("refuses a day window that cannot become a date", async () => {
    expect(await refusedFields(() => api.inventory.getExpiringItems({ days: 1e12 }))).toEqual(["days"]);
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

    expect(await refusedFields(() => api.receipt.confirmAll({ receiptId: "r", items }))).toEqual(["items"]);
  });

  it("still takes the ordinary values", async () => {
    // So the bounds above are bounds and not a broken procedure.
    expect(await api.receipt.list({ limit: 20 })).toBeDefined();
    expect(Array.isArray(await api.inventory.getExpiringItems({ days: 30 }))).toBe(true);
    expect(Array.isArray(await api.product.searchByName({ query: "leche", limit: 10 }))).toBe(true);
  });
});
