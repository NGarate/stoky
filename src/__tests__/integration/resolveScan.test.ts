import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  spyOn,
} from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { openFoodFacts } from "@/server/services/openFoodFacts";
import type { AppSession } from "@/lib/auth/session";
import { TRPCError } from "@trpc/server";
import { MAX_NAME_LENGTH } from "@/lib/validations/bounds";
import { closeValkey } from "@/lib/valkey";
import { valkeyProductCache } from "@/server/services/product-cache";
import { ThrottledError } from "@/server/trpc/throttle";
import { createMockSession, createTestUser, generateTestEmail } from "../utils/test-helpers";

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
  const session: AppSession = {
    user: {
      id: OWNER.userId,
      email: "resolvescan@example.com",
      name: "Resolve scan",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    expiresKind: "idle",
    sessionId: crypto.randomUUID(),
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

/**
 * The meter on lookups that leave for Open Food Facts (security audit, low:
 * "scanBarcode and resolveScan let any member trigger unlimited outbound
 * lookups"). Open Food Facts throttles API clients per address, so one
 * account scanning random codes could get the whole instance throttled.
 *
 * Against the real service, real Valkey and a counted `fetch`, with the limit
 * set to two: what is under test is *which* lookups are counted, and only the
 * real cache can say whether a lookup missed it.
 */
describe("Open Food Facts lookups, metered", () => {
  const ATTEMPTS = 2;
  const original = process.env.RATE_LIMIT_PRODUCT_LOOKUP_ATTEMPTS;
  const users: string[] = [];
  const barcodes: string[] = [];
  let requests: string[] = [];
  let fetchSpy: ReturnType<typeof spyOn>;
  let quiet: ReturnType<typeof spyOn>;

  /** A fresh account, so no test spends another's budget. */
  async function meteredCaller() {
    const user = await createTestUser({
      email: generateTestEmail("lookup-meter"),
      name: "Lookup meter",
      householdId: OWNER.householdId,
      role: "MEMBER",
    });
    users.push(user.id);
    return appRouter.createCaller(
      await createTRPCContext({ session: createMockSession(user) }),
    );
  }

  /**
   * A code no earlier run can have left in the shared cache: a remembered
   * miss lasts a day, and a stale one would make a lookup free.
   */
  function freshBarcode(): string {
    const code = `99${String(Math.floor(Math.random() * 1e11)).padStart(11, "0")}`;
    barcodes.push(code);
    return code;
  }

  beforeAll(() => {
    process.env.RATE_LIMIT_PRODUCT_LOOKUP_ATTEMPTS = String(ATTEMPTS);
  });

  beforeEach(() => {
    requests = [];
    // Open Food Facts' own answer for a code it has no record of: HTTP 404
    // with a status-0 body (measured against the live API, 2026-10-12).
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
      url: string | URL,
    ) => {
      requests.push(String(url));
      const code = /product\/(\d+)\.json/.exec(String(url))?.[1] ?? "";
      return new Response(
        JSON.stringify({ code, status: 0, status_verbose: "product not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch);
    quiet = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    quiet.mockRestore();
  });

  afterAll(async () => {
    if (original === undefined) delete process.env.RATE_LIMIT_PRODUCT_LOOKUP_ATTEMPTS;
    else process.env.RATE_LIMIT_PRODUCT_LOOKUP_ATTEMPTS = original;
    for (const code of barcodes) await valkeyProductCache.delete(code);
    await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await closeValkey();
  });

  it("refuses the lookup past the budget before it leaves, on either procedure", async () => {
    const api = await meteredCaller();

    expect((await api.product.scanBarcode({ barcode: freshBarcode() })).source).toBe(
      "not_found",
    );
    const unknown = await refusal(() =>
      api.product.resolveScan({ ...envelope(), barcode: freshBarcode() }),
    );
    expect(unknown.code).toBe("NOT_FOUND");
    expect(requests).toHaveLength(ATTEMPTS);

    // One budget across both procedures: the connected scan and the queued
    // one are the same request to Open Food Facts.
    const queued = await refusal(() =>
      api.product.resolveScan({ ...envelope(), barcode: freshBarcode() }),
    );
    expect(queued.code).toBe("TOO_MANY_REQUESTS");
    // 429, which `classify.ts` makes a review question for this procedure,
    // carrying the wait for `Retry-After`.
    expect(queued.cause).toBeInstanceOf(ThrottledError);
    expect((queued.cause as ThrottledError).retryAfterSeconds).toBeGreaterThan(0);

    const connected = await refusal(() =>
      api.product.scanBarcode({ barcode: freshBarcode() }),
    );
    expect(connected.code).toBe("TOO_MANY_REQUESTS");

    // The refused lookups never reached Open Food Facts.
    expect(requests).toHaveLength(ATTEMPTS);
  });

  it("never counts a lookup the household or the cache already answers", async () => {
    const api = await meteredCaller();

    // More of each than the whole budget.
    const local = freshBarcode();
    await prisma.product.create({
      data: { name: "Ya conocido", barcode: local, defaultUnit: "unit", householdId: OWNER.householdId },
    });
    const knownUnknown = freshBarcode();
    await valkeyProductCache.setMissing(knownUnknown);
    const cachedHits = [freshBarcode(), freshBarcode(), freshBarcode()];
    for (const code of cachedHits) {
      await valkeyProductCache.set(
        code,
        JSON.stringify({ code, product_name: `Producto ${code}` }),
      );
    }

    for (let i = 0; i <= ATTEMPTS; i++) {
      expect((await api.product.scanBarcode({ barcode: local })).source).toBe("local");
      expect((await api.product.scanBarcode({ barcode: knownUnknown })).source).toBe(
        "not_found",
      );
    }
    for (const code of cachedHits) {
      expect((await api.product.scanBarcode({ barcode: code })).source).toBe(
        "open_food_facts",
      );
    }
    expect(requests).toHaveLength(0);

    // The whole budget is still there, and still enforced.
    for (let i = 0; i < ATTEMPTS; i++) {
      expect((await api.product.scanBarcode({ barcode: freshBarcode() })).source).toBe(
        "not_found",
      );
    }
    const past = await refusal(() => api.product.scanBarcode({ barcode: freshBarcode() }));
    expect(past.code).toBe("TOO_MANY_REQUESTS");
    expect(requests).toHaveLength(ATTEMPTS);
  });

  it("sends nothing it cannot count, and lands the person on the form", async () => {
    // Valkey unreachable: the meter cannot count, so the request is not sent.
    // Not SERVICE_UNAVAILABLE: an unknown code ends on the manual form either
    // way, and refusing would leave the scan page with nowhere to go.
    const api = await meteredCaller();
    const before = process.env.VALKEY_URL;
    await closeValkey();
    // Port 1 is reserved and nothing listens on it.
    process.env.VALKEY_URL = "redis://127.0.0.1:1";

    try {
      expect((await api.product.scanBarcode({ barcode: freshBarcode() })).source).toBe(
        "not_found",
      );
      expect(requests).toHaveLength(0);
    } finally {
      await closeValkey();
      if (before === undefined) delete process.env.VALKEY_URL;
      else process.env.VALKEY_URL = before;
    }
  }, 30_000);
});
