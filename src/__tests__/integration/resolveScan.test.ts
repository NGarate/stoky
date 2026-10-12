import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  spyOn,
} from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { openFoodFacts } from "@/server/services/openFoodFacts";
import * as argon2 from "argon2";
import type { Session } from "next-auth";
import { TRPCError } from "@trpc/server";
import { MAX_NAME_LENGTH } from "@/lib/validations/bounds";

/**
 * `product.resolveScan` — the replayable scan T7 adds.
 *
 * `replayable.procedures.test.ts` proves the envelope behaviour for the shop's
 * five writes; this one proves the scan's own three outcomes (local hit, OFF
 * hit, OFF miss) and that its idempotency holds — with Open Food Facts stubbed,
 * because the point is the queue drain, not the network.
 */

const OWNER = { userId: "", householdId: "" };

async function caller() {
  const session: Session = {
    user: {
      id: OWNER.userId,
      email: "resolvescan@example.com",
      name: "Resolve scan",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

function envelope() {
  return {
    idempotencyKey: crypto.randomUUID(),
    composedByUserId: OWNER.userId,
  };
}

/** A minimal OFF product, enough for the mapping helper. */
function offProduct(name: string) {
  return {
    code: "8410000000000",
    product_name: name,
    brands: "Marca",
    categories: "Lácteos, Leche",
    quantity: "1 L",
  } as unknown as Awaited<
    ReturnType<typeof openFoodFacts.getProductByBarcode>
  >;
}

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: "Resolve scan household" },
  });
  const user = await prisma.user.create({
    data: {
      email: `resolvescan-${Date.now()}@example.com`,
      name: "Resolve scan",
      passwordHash: await argon2.hash("TestPassword123!", {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      }),
      householdId: household.id,
      role: "OWNER",
    },
  });
  OWNER.userId = user.id;
  OWNER.householdId = household.id;
});

afterEach(async () => {
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.user.deleteMany({ where: { id: OWNER.userId } });
  await prisma.household.deleteMany({ where: { id: OWNER.householdId } });
  await prisma.$disconnect();
});

async function refusal(call: () => Promise<unknown>): Promise<TRPCError> {
  let thrown: unknown;
  try {
    await call();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TRPCError);
  return thrown as TRPCError;
}

describe("product.resolveScan", () => {
  it("creates the product Open Food Facts knows, once", async () => {
    const spy = spyOn(openFoodFacts, "getProductByBarcode").mockResolvedValue(
      offProduct("Leche entera"),
    );
    const api = await caller();

    const result = await api.product.resolveScan({
      ...envelope(),
      barcode: "8410000111111",
    });

    expect(result.source).toBe("open_food_facts");
    expect(result.product.name).toBe("Leche entera");
    expect(result.product.barcode).toBe("8410000111111");
    expect(
      await prisma.product.count({ where: { barcode: "8410000111111" } }),
    ).toBe(1);
    spy.mockRestore();
  });

  it("answers a replay from the record, without a second row", async () => {
    const spy = spyOn(openFoodFacts, "getProductByBarcode").mockResolvedValue(
      offProduct("Leche entera"),
    );
    const api = await caller();
    const env = envelope();

    const first = await api.product.resolveScan({
      ...env,
      barcode: "8410000222222",
    });
    const second = await api.product.resolveScan({
      ...env,
      barcode: "8410000222222",
    });

    expect(second.product.id).toBe(first.product.id);
    expect(
      await prisma.product.count({ where: { barcode: "8410000222222" } }),
    ).toBe(1);
    spy.mockRestore();
  });

  it("refuses the same key carrying a different barcode", async () => {
    const spy = spyOn(openFoodFacts, "getProductByBarcode").mockResolvedValue(
      offProduct("Leche entera"),
    );
    const api = await caller();
    const env = envelope();

    await api.product.resolveScan({ ...env, barcode: "8410000333333" });
    const error = await refusal(() =>
      api.product.resolveScan({ ...env, barcode: "8410000444444" }),
    );
    expect(error.code).toBe("BAD_REQUEST");
    spy.mockRestore();
  });

  it("is NOT_FOUND when nobody knows the barcode, and claims no key", async () => {
    // The key not being claimed is the point: a retry after OFF recovers must
    // still succeed rather than be refused as reused.
    const miss = spyOn(openFoodFacts, "getProductByBarcode").mockResolvedValue(
      null,
    );
    const api = await caller();
    const env = envelope();

    const error = await refusal(() =>
      api.product.resolveScan({ ...env, barcode: "8410000555555" }),
    );
    expect(error.code).toBe("NOT_FOUND");
    miss.mockRestore();

    // OFF now answers; the same key succeeds because the miss claimed nothing.
    const hit = spyOn(openFoodFacts, "getProductByBarcode").mockResolvedValue(
      offProduct("Leche entera"),
    );
    const result = await api.product.resolveScan({
      ...env,
      barcode: "8410000555555",
    });
    expect(result.source).toBe("open_food_facts");
    hit.mockRestore();
  });

  it("short-circuits to the local product without touching Open Food Facts", async () => {
    const api = await caller();
    await prisma.product.create({
      data: {
        name: "Ya conocido",
        barcode: "8410000666666",
        defaultUnit: "L",
        householdId: OWNER.householdId,
      },
    });

    const spy = spyOn(openFoodFacts, "getProductByBarcode");
    const result = await api.product.resolveScan({
      ...envelope(),
      barcode: "8410000666666",
    });

    expect(result.source).toBe("local");
    expect(result.product.name).toBe("Ya conocido");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("stores Open Food Facts text within the bound the edit form is held to", async () => {
    // OFF is edited by anyone, and its text reaches the row without passing
    // `productSchema`. Stored past `MAX_NAME_LENGTH`, the detail form — which
    // sends name, brand and category back on every save — could not save the
    // product at all. The emoji sits across the cut, so a naive slice would
    // leave half a surrogate pair.
    const long = `${"n".repeat(MAX_NAME_LENGTH - 1)}🥛${"x".repeat(50)}`;
    const hit = offProduct(long);
    const spy = spyOn(openFoodFacts, "getProductByBarcode").mockResolvedValue(
      hit && {
        ...hit,
        brands: "B".repeat(MAX_NAME_LENGTH + 50),
        categories: `${"C".repeat(MAX_NAME_LENGTH + 50)}, Leche`,
      },
    );
    const api = await caller();

    const { product } = await api.product.resolveScan({
      ...envelope(),
      barcode: "8410000777777",
    });
    spy.mockRestore();

    expect(product.name).toBe("n".repeat(MAX_NAME_LENGTH - 1));
    expect(product.brand).toBe("B".repeat(MAX_NAME_LENGTH));
    expect(product.category).toBe("C".repeat(MAX_NAME_LENGTH));

    // What the detail form sends when only the minimum changes.
    const saved = await api.product.update({
      id: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      defaultUnit: product.defaultUnit,
      minStock: 2,
    });
    expect(saved.minStock).toBe(2);
  });
});
