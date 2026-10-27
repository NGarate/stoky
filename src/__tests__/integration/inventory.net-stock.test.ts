import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { envelope } from "../utils/test-helpers";
import { num } from "../utils/amount";

/**
 * ISSUES.md INV-1, the half that guards writes.
 *
 * Consumption is recorded as a separate `StockEntry` with a negative quantity.
 * Both availability guards selected `quantity: { gt: 0 }` and summed the
 * result, so they measured *gross purchases* and ignored everything ever used.
 * Six litres bought and four drunk read as six available.
 *
 * It was latent rather than live, because `/inventory/consume` computes its own
 * limit from net stock and refuses first. But the page is not the authority —
 * the server is — and Phase 4 puts an offline replay queue in front of these
 * procedures, which is a caller that is not that page. ISSUES.md says it
 * outright: "Phase 4 must not build replay on top of this."
 *
 * These run against a real PostgreSQL because the defect is in a Prisma
 * `where` clause. A mocked client would have returned whatever the test
 * pretended, which is how it survived this long.
 */

const OWNER: { userId: string; householdId: string } = {
  userId: "",
  householdId: "",
};

let productId = "";
let shelfId = "";
let cupboardId = "";

async function caller(db?: PrismaClient) {
  const session: AppSession = {
    user: {
      id: OWNER.userId,
      email: "net-stock@example.com",
      name: "Net Stock",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    expiresKind: "idle",
    sessionId: crypto.randomUUID(),
  };
  return appRouter.createCaller(await createTRPCContext({ session, db }));
}

/** Asserts a call was refused with a particular tRPC code. */
async function expectCode(call: Promise<unknown>, code: TRPCError["code"]) {
  let thrown: unknown;
  try {
    await call;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TRPCError);
  expect((thrown as TRPCError).code).toBe(code);
}

/** Net stock as the overview computes it — the figure the screens show. */
async function netStock(locationId?: string): Promise<number> {
  const entries = await prisma.stockEntry.findMany({
    where: { productId, ...(locationId ? { locationId } : {}) },
  });
  return entries.reduce((sum, entry) => sum + num(entry.quantity), 0);
}

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: "INV-1 household" },
  });
  const user = await prisma.user.create({
    data: {
      email: `net-stock-${Date.now()}@example.com`,
      name: "Net Stock",
      householdId: household.id,
      role: "OWNER",
    },
  });
  OWNER.userId = user.id;
  OWNER.householdId = household.id;

  const shelf = await prisma.storageLocation.create({
    data: { name: "Estante", householdId: household.id },
  });
  const cupboard = await prisma.storageLocation.create({
    data: { name: "Armario", householdId: household.id },
  });
  shelfId = shelf.id;
  cupboardId = cupboard.id;
});

beforeEach(async () => {
  if (productId) {
    await prisma.stockEntry.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
  }
  const product = await prisma.product.create({
    data: {
      name: "Leche entera",
      defaultUnit: "L",
      householdId: OWNER.householdId,
    },
  });
  productId = product.id;
});

afterAll(async () => {
  await prisma.stockEntry.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.storageLocation.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.user.deleteMany({ where: { id: OWNER.userId } });
  await prisma.household.deleteMany({ where: { id: OWNER.householdId } });
  await prisma.$disconnect();
});

describe("consumeStock measures what is left", () => {
  it("refuses to consume more than the net, after an earlier consumption", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 6,
      unit: "L",
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 4,
      unit: "L",
    });

    expect(await netStock()).toBe(2);

    // Gross purchases are 6, net stock is 2. The guard used to read 6.
    await expectCode(
      api.inventory.consumeStock({
        ...envelope(OWNER.userId),
        productId,
        quantity: 5,
        unit: "L",
      }),
      "CONFLICT",
    );

    expect(await netStock()).toBe(2);
  });

  it("still allows a consumption the net supports", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 6,
      unit: "L",
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 4,
      unit: "L",
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
    });

    expect(await netStock()).toBe(0);
  });

  it("never lets stock go negative, however many times it is asked", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
    });

    await expectCode(
      api.inventory.consumeStock({
        ...envelope(OWNER.userId),
        productId,
        quantity: 1,
        unit: "L",
      }),
      "CONFLICT",
    );

    expect(await netStock()).toBe(0);
  });

  it("counts only the named location when one is named", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 5,
      unit: "L",
      locationId: shelfId,
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 4,
      unit: "L",
      consumeFromLocationId: shelfId,
    });

    expect(await netStock(shelfId)).toBe(1);

    await expectCode(
      api.inventory.consumeStock({
        ...envelope(OWNER.userId),
        productId,
        quantity: 2,
        unit: "L",
        consumeFromLocationId: shelfId,
      }),
      "CONFLICT",
    );
  });
});

describe("two people consuming the last of something", () => {
  it("cannot drive stock negative between them", async () => {
    // Two real intentions with *different* keys, so idempotency cannot help:
    // both are genuine and only one can be satisfied. This is the shape a
    // drained queue produces when it arrives as a single batch, which tRPC
    // runs under Promise.all (ISSUES.md INV-2).
    //
    // The interleaving is forced rather than hoped for. Two calls fired
    // together happen to serialise in this runtime — verified by removing the
    // row lock and watching the test still pass three times — so a plain
    // Promise.all here would be a test that cannot fail. Instead the first
    // caller is given a client that pauses between reading the stock and
    // writing the consumption, which is precisely the window the lock exists
    // to close.
    const fast = await caller();

    await fast.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
    });

    let releaseConsume = (): void => {};
    const consumeGate = new Promise<void>((resolve) => {
      releaseConsume = resolve;
    });
    // Observable rather than guessed. A fixed sleep here is a flake waiting
    // for a loaded machine: the test must know the first call is *actually*
    // holding the lock, not assume it after 150ms.
    let holdingTheLock = false;
    const pausingConsumeClient = prisma.$extends({
      query: {
        stockEntry: {
          async create({ args, query }) {
            holdingTheLock = true;
            await consumeGate;
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;

    /** Wait for a condition, with a ceiling — an unbounded wait is not a test. */
    async function until(
      condition: () => boolean,
      what: string,
    ): Promise<void> {
      for (let i = 0; i < 200; i += 1) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`timed out waiting for ${what}`);
    }
    const slowConsumer = await caller(pausingConsumeClient);

    const first = slowConsumer.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
    });

    // The first call has read the stock and is holding the product row.
    await until(() => holdingTheLock, "the first consume to hold the lock");

    const second = fast.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
    });

    // The second call is either blocked on the lock or has already sailed
    // past it. One tick is enough for the latter to have written; the
    // assertions below tell the two apart.
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseConsume();

    const results = await Promise.allSettled([first, second]);
    const rejected = results.filter((r) => r.status === "rejected");

    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      TRPCError,
    );
    expect(
      ((rejected[0] as PromiseRejectedResult).reason as TRPCError).code,
    ).toBe("CONFLICT");

    // Without the row lock the second call reads 2 while the first is still
    // paused, passes the guard, and this is -2.
    expect(await netStock()).toBe(0);
  });
});

/**
 * The date `days` from today on a Madrid calendar, as `/inventory/add` sends
 * it: the picker's "YYYY-MM-DD" parsed by `new Date`, which is UTC midnight.
 * Computed here independently of the code under test.
 */
function calendarDay(days: number): Date {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
  }).format(new Date());
  const date = new Date(today);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

describe("the expiry views report what is left", () => {
  /** An expiry date `days` from today, which the window bounds are relative to. */
  const inDays = calendarDay;

  it("does not list a batch that has already been finished", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 6,
      unit: "L",

      expirationDate: inDays(3),
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 6,
      unit: "L",
    });

    const expiring = await api.inventory.getExpiringItems({ days: 7 });

    expect(expiring).toHaveLength(0);
  });

  it("reports what is left of a partly consumed batch, not what was bought", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 6,
      unit: "L",

      expirationDate: inDays(3),
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 4,
      unit: "L",
    });

    const expiring = await api.inventory.getExpiringItems({ days: 7 });

    expect(expiring).toHaveLength(1);
    // The exact figure ISSUES.md measured: 6 L reported against 2 L in stock.
    expect(num(expiring[0]?.quantity)).toBe(2);
    expect(num(expiring[0]?.quantity)).toBe(await netStock());
    expect(expiring[0]?.product.name).toBe("Leche entera");
  });

  it("leaves quantities unknown when the consumed batch was not recorded", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 6,
      unit: "L",

      expirationDate: inDays(2),
    });
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 6,
      unit: "L",

      expirationDate: inDays(20),
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 6,
      unit: "L",
    });

    const expiring = await api.inventory.getExpiringItems({ days: 7 });

    // The ledger does not identify which carton was used. Neither expiry
    // date proves which one remains.
    expect(expiring).toHaveLength(1);
    expect(expiring[0]?.quantity).toBeNull();

    const monthAhead = await api.inventory.getExpiringItems({ days: 30 });
    expect(monthAhead).toHaveLength(2);
    expect(monthAhead.every((batch) => batch.quantity === null)).toBe(true);
  });

  it("does not list an expired batch that was finished before it turned", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",

      expirationDate: inDays(-4),
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
    });

    expect(await api.inventory.getExpiredItems({})).toHaveLength(0);
  });

  it("does not read the ledger of a product that has run out", async () => {
    // Every product that ever had a dated batch used to be read with its
    // whole history on each visit; one at zero cannot have a batch to list.
    await (
      await caller()
    ).inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
      expirationDate: inDays(-4),
    });
    await (
      await caller()
    ).inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
    });
    const ledgersRead: unknown[] = [];
    const watched = prisma.$extends({
      query: {
        product: {
          findMany({ args, query }) {
            if (args.include?.stockEntries) ledgersRead.push(args.where);
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;

    const api = await caller(watched);

    expect(await api.inventory.getExpiredItems({})).toHaveLength(0);
    expect(ledgersRead).toEqual([]);
  });

  it("still lists an expired batch nobody got to", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",

      expirationDate: inDays(-4),
    });

    const expired = await api.inventory.getExpiredItems({});

    expect(expired).toHaveLength(1);
    expect(num(expired[0]?.quantity)).toBe(2);
    expect(expired[0]?.daysExpired).toBe(4);
  });
});

describe("transferStock measures what is left at the source", () => {
  it("refuses to move more than the source holds after a consumption", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 6,
      unit: "L",
      locationId: shelfId,
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 4,
      unit: "L",
      consumeFromLocationId: shelfId,
    });

    expect(await netStock(shelfId)).toBe(2);

    await expectCode(
      api.inventory.transferStock({
        productId,
        quantity: 5,
        unit: "L",
        fromLocationId: shelfId,
        toLocationId: cupboardId,
      }),
      "CONFLICT",
    );

    expect(await netStock(shelfId)).toBe(2);
    expect(await netStock(cupboardId)).toBe(0);
  });

  it("cannot be emptied twice by two transfers at once", async () => {
    // INV-2's other half. The guard used to sit outside the transaction that
    // covered the writes, so two transfers could read the same figure, both
    // pass, and both write. Idempotency cannot help: they carry different
    // keys because they are two real intentions.
    const fast = await caller();

    await fast.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
      locationId: shelfId,
    });

    // The interleaving is forced rather than hoped for, the same way the
    // consume test does it: a client that pauses between reading the stock
    // and writing the movement, which is exactly the window the lock closes.
    let releaseTransfer = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseTransfer = resolve;
    });
    let holdingTheLock = false;
    const pausing = prisma.$extends({
      query: {
        stockEntry: {
          async create({ args, query }) {
            holdingTheLock = true;
            await gate;
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const slow = await caller(pausing);

    async function until(
      condition: () => boolean,
      what: string,
    ): Promise<void> {
      for (let i = 0; i < 200; i += 1) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`timed out waiting for ${what}`);
    }

    const first = slow.inventory.transferStock({
      productId,
      quantity: 2,
      unit: "L",
      fromLocationId: shelfId,
      toLocationId: cupboardId,
    });

    await until(() => holdingTheLock, "the first transfer to hold the lock");

    const second = fast.inventory.transferStock({
      productId,
      quantity: 2,
      unit: "L",
      fromLocationId: shelfId,
      toLocationId: cupboardId,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseTransfer();

    const results = await Promise.allSettled([first, second]);
    const rejected = results.filter((r) => r.status === "rejected");

    expect(rejected).toHaveLength(1);
    expect(
      ((rejected[0] as PromiseRejectedResult).reason as TRPCError).code,
    ).toBe("CONFLICT");

    // Without the lock both read 2, both pass the guard, and the shelf is -2.
    expect(await netStock(shelfId)).toBe(0);
    expect(await netStock(cupboardId)).toBe(2);
  });

  it("refuses to move the same stock out twice", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 4,
      unit: "L",
      locationId: shelfId,
    });
    await api.inventory.transferStock({
      productId,
      quantity: 4,
      unit: "L",
      fromLocationId: shelfId,
      toLocationId: cupboardId,
    });

    expect(await netStock(shelfId)).toBe(0);
    expect(await netStock(cupboardId)).toBe(4);

    await expectCode(
      api.inventory.transferStock({
        productId,
        quantity: 4,
        unit: "L",
        fromLocationId: shelfId,
        toLocationId: cupboardId,
      }),
      "CONFLICT",
    );

    expect(await netStock(shelfId)).toBe(0);
  });
});

/**
 * ISSUES.md UI-3 item 2, at the layer that matters.
 *
 * `src/__tests__/unit/inventory-input.test.ts` proves the schema refuses a
 * negative quantity. What it cannot prove is that the *procedure* uses that
 * schema and no longer launders the sign itself: the handler used to call
 * `Math.abs`, so even a rejected sign would have been quietly corrected if the
 * two changes had gone in separately.
 */
describe("a quantity with the wrong sign", () => {
  it("is refused rather than flipped", async () => {
    const api = await caller();
    const before = await netStock();

    await expectCode(
      api.inventory.addStock({
        ...envelope(OWNER.userId),
        productId,
        quantity: -5,
        unit: "L",
      }),
      "BAD_REQUEST",
    );

    // The whole point: it did not become +5.
    expect(await netStock()).toBe(before);
  });

  it("is refused for a consumption too", async () => {
    const api = await caller();
    const before = await netStock();

    await expectCode(
      api.inventory.consumeStock({
        ...envelope(OWNER.userId),
        productId,
        quantity: -2,
        unit: "L",
      }),
      "BAD_REQUEST",
    );

    // A negative consumption ran through `-Math.abs()` and *removed* stock,
    // which is at least the same direction — but it also skipped the
    // availability guard's intent by arriving as a different number than sent.
    expect(await netStock()).toBe(before);
  });

  it("still lets a reconciliation take stock down", async () => {
    // The exception that makes the three schemas separate: `adjustStock` is
    // signed, because `ReconcileDialog` sends `actual - netStock` and a shelf
    // with less on it than the ledger says is the ordinary case.
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 5,
      unit: "L",
    });
    const before = await netStock();

    await api.inventory.adjustStock({
      productId,
      quantity: -2,
      unit: "L",
      reason: "Recuento",
    });

    expect(await netStock()).toBe(before - 2);
  });
});

describe("stock integrity after an adjustment and kitchen taps", () => {
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);
  it("two separate taps debit exactly two units from the chosen batch; retries add nothing", async () => {
    const api = await caller();
    const early = await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
      expirationDate: inDays(1),
      locationId: shelfId,
    });
    const later = await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
      expirationDate: inDays(2),
      locationId: cupboardId,
    });
    const first = {
      ...envelope(OWNER.userId),
      productId,
      batchId: later.id,
      quantity: 1,
      unit: "L",
    };
    await api.inventory.consumeStock(first);
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      batchId: later.id,
      quantity: 1,
      unit: "L",
    });
    await api.inventory.consumeStock(first);
    const movements = await prisma.stockEntry.findMany({
      where: { productId, operationType: "CONSUME" },
    });
    expect(movements).toHaveLength(2);
    expect(movements.map((entry) => num(entry.quantity))).toEqual([-1, -1]);
    expect(
      movements.every(
        (entry) =>
          entry.batchId === later.id && entry.locationId === cupboardId,
      ),
    ).toBe(true);
    expect(await netStock()).toBe(4);
    const batches = await api.inventory.getExpiringItems({ days: 7 });
    expect(num(batches.find((batch) => batch.id === early.id)?.quantity)).toBe(
      3,
    );
    expect(num(batches.find((batch) => batch.id === later.id)?.quantity)).toBe(
      1,
    );
  });

  it("refuses an unknown or foreign batch without changing stock", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
    });
    await expectCode(
      api.inventory.consumeStock({
        ...envelope(OWNER.userId),
        productId,
        quantity: 1,
        unit: "L",
        batchId: "not-this-products-batch",
      }),
      "NOT_FOUND",
    );
    expect(await netStock()).toBe(3);
  });

  it("does not invent a source for an ambiguous adjustment", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
      expirationDate: inDays(1),
      locationId: shelfId,
    });
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
      expirationDate: inDays(2),
      locationId: cupboardId,
    });
    const adjusted = await api.inventory.adjustStock({
      productId,
      quantity: -1,
      expectedStock: 4,
      unit: "L",
      reason: "Recuento",
    });
    expect(adjusted.locationId).toBeNull();
    expect(adjusted.expirationDate).toBeNull();
    const batches = await api.inventory.getExpiringItems({ days: 7 });
    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.quantity)).toEqual([null, null]);
    const filtered = await api.inventory.getExpiringItems({
      days: 7,
      locationId: shelfId,
    });
    expect(filtered[0]?.quantity).toBeNull();
    expect(await netStock()).toBe(3);
  });

  it("refuses a stale recount after another consumption", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "L",
    });
    await expectCode(
      api.inventory.adjustStock({
        productId,
        quantity: -1,
        expectedStock: 3,
        unit: "L",
        reason: "Recuento",
      }),
      "CONFLICT",
    );
    expect(await netStock()).toBe(2);
  });

  it("records an explicitly provided adjustment expiry", async () => {
    const api = await caller();
    const date = inDays(5);
    const adjusted = await api.inventory.adjustStock({
      productId,
      quantity: 3,
      unit: "L",
      reason: "Recuento",
      expirationDate: date,
    });
    expect(adjusted.expirationDate).toEqual(date);
    expect(adjusted.locationId).toBeNull();
  });

  it("three dozen eggs are 36 units, and two uses leave 34", async () => {
    const api = await caller();
    await prisma.product.update({
      where: { id: productId },
      data: { name: "Huevos", defaultUnit: "unidad" },
    });
    const batch = await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "docena",
      expirationDate: inDays(2),
    });
    expect(num(batch.quantity)).toBe(36);
    expect(batch.unit).toBe("unidad");
    for (let tap = 0; tap < 2; tap++) {
      await api.inventory.consumeStock({
        ...envelope(OWNER.userId),
        productId,
        batchId: batch.id,
        quantity: 1,
        unit: "unidad",
      });
    }
    expect(await netStock()).toBe(34);
    expect(
      num((await api.inventory.getExpiringItems({ days: 7 }))[0]?.quantity),
    ).toBe(34);
  });

  it("converts legacy dozen entries without replacing their recorded details", async () => {
    const api = await caller();
    await prisma.product.update({
      where: { id: productId },
      data: { defaultUnit: "docena", minStock: 1 },
    });
    const date = inDays(2);
    const batch = await prisma.stockEntry.create({
      data: {
        productId,
        quantity: 3,
        unit: "docena",
        operationType: "PURCHASE",
        createdBy: OWNER.userId,
        expirationDate: date,
        locationId: shelfId,
        note: "Dato aportado",
      },
    });
    const product = await api.product.update({
      id: productId,
      defaultUnit: "unidad",
    });
    expect(num(product.minStock)).toBe(12);
    const saved = await prisma.stockEntry.findUniqueOrThrow({
      where: { id: batch.id },
    });
    expect(num(saved.quantity)).toBe(36);
    expect(saved.unit).toBe("unidad");
    expect(saved.locationId).toBe(shelfId);
    expect(saved.expirationDate).toEqual(date);
    expect(saved.note).toBe("Dato aportado");
    expect(saved.createdAt).toEqual(batch.createdAt);
  });

  it("requires a quantity basis for queued list edits after converting dozens", async () => {
    const api = await caller();
    const list = await prisma.shoppingList.create({
      data: { name: "Conversion", householdId: OWNER.householdId },
    });
    try {
      const item = await api.shopping.addItem({
        ...envelope(OWNER.userId),
        shoppingListId: list.id,
        productId,
        quantity: 2,
        unit: "docena",
      });
      expect(num(item.quantity)).toBe(24);
      expect(item.unit).toBe("unidad");
      await expectCode(
        api.shopping.updateItem({
          ...envelope(OWNER.userId),
          id: item.id,
          quantity: 3,
        }),
        "BAD_REQUEST",
      );
      expect(
        num(
          (
            await prisma.shoppingItem.findUniqueOrThrow({
              where: { id: item.id },
            })
          ).quantity,
        ),
      ).toBe(24);
      const updated = await api.shopping.updateItem({
        ...envelope(OWNER.userId),
        id: item.id,
        quantity: 3,
        quantityUnit: "docena",
      });
      expect(num(updated.quantity)).toBe(36);
      expect(updated.unit).toBe("unidad");
    } finally {
      await prisma.shoppingItem.deleteMany({
        where: { shoppingListId: list.id },
      });
      await prisma.shoppingList.delete({ where: { id: list.id } });
    }
  });

  it("changing a unit cannot just relabel incompatible existing stock", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
    });
    await expectCode(
      api.product.update({ id: productId, defaultUnit: "kg" }),
      "BAD_REQUEST",
    );
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: productId } }))
        .defaultUnit,
    ).toBe("L");
    expect(await netStock()).toBe(3);
  });
});

/**
 * Floating-point residue in the availability guards.
 *
 * 1 − 0.9 is 0.09999999999999998 in IEEE 754. Every screen rounds the ledger
 * to two decimals and shows 0.1, so the guard must ask the same rounded
 * question — or the last tenth on the shelf can never be used or moved.
 */
describe("the guards round the ledger the way the screens do", () => {
  it("lets the last 0.1 L be consumed after 1 L − 0.9 L", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "L",
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 0.9,
      unit: "L",
    });

    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 0.1,
      unit: "L",
    });

    expect(await netStock()).toBeCloseTo(0, 6);
  });

  it("lets the last 0.1 L be moved after 1 L − 0.9 L", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "L",
      locationId: shelfId,
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 0.9,
      unit: "L",
      consumeFromLocationId: shelfId,
    });

    await api.inventory.transferStock({
      productId,
      quantity: 0.1,
      unit: "L",
      fromLocationId: shelfId,
      toLocationId: cupboardId,
    });

    expect(await netStock(cupboardId)).toBeCloseTo(0.1, 6);
  });
});

/**
 * `adjustStock` is the one signed movement, and it had no floor: without
 * `expectedStock` (optional in the schema) a negative correction larger than
 * the ledger was written as-is and the product read minus something.
 */
describe("an adjustment cannot take stock below zero", () => {
  it("refuses a correction larger than what is there", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
    });

    await expectCode(
      api.inventory.adjustStock({
        productId,
        quantity: -3,
        unit: "L",
        reason: "Recuento",
      }),
      "CONFLICT",
    );

    expect(await netStock()).toBe(2);
  });

  it("still allows a correction down to exactly zero, float residue included", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "L",
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 0.9,
      unit: "L",
    });

    await api.inventory.adjustStock({
      productId,
      quantity: -0.1,
      unit: "L",
      reason: "Recuento",
    });

    expect(await netStock()).toBeCloseTo(0, 6);
  });
});

/**
 * Every row of a product's ledger is in the product's unit — `product.update`
 * already assumes so when it converts them all on a unit change. The four
 * movements took any free-text unit and summed the number regardless, so
 * 500 "g" into a product counted in "kg" read as 501 kg.
 */
describe("a movement is stored in the product's unit", () => {
  it("refuses a purchase in a unit that cannot be converted", async () => {
    const api = await caller();
    await prisma.product.update({
      where: { id: productId },
      data: { defaultUnit: "kg" },
    });
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "kg",
    });

    await expectCode(
      api.inventory.addStock({
        ...envelope(OWNER.userId),
        productId,
        quantity: 500,
        unit: "g",
      }),
      "BAD_REQUEST",
    );

    expect(await netStock()).toBe(1);
  });

  it("refuses a consumption, adjustment or transfer in such a unit", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 4,
      unit: "L",
      locationId: shelfId,
    });

    await expectCode(
      api.inventory.consumeStock({
        ...envelope(OWNER.userId),
        productId,
        quantity: 1,
        unit: "kg",
      }),
      "BAD_REQUEST",
    );
    await expectCode(
      api.inventory.adjustStock({
        productId,
        quantity: -1,
        unit: "ml",
        reason: "Recuento",
      }),
      "BAD_REQUEST",
    );
    await expectCode(
      api.inventory.transferStock({
        productId,
        quantity: 1,
        unit: "botella",
        fromLocationId: shelfId,
        toLocationId: cupboardId,
      }),
      "BAD_REQUEST",
    );

    expect(await netStock()).toBe(4);
    expect(await netStock(shelfId)).toBe(4);
  });

  it("stores a convertible unit as the product's, converted", async () => {
    const api = await caller();
    await prisma.product.update({
      where: { id: productId },
      data: { defaultUnit: "unidad" },
    });

    const entry = await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "docena",
    });
    // Case is not a different unit.
    const lower = await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "Unidad",
    });

    expect(num(entry.quantity)).toBe(24);
    expect(entry.unit).toBe("unidad");
    expect(lower.unit).toBe("unidad");
    expect(await netStock()).toBe(21);
  });
});

/**
 * A transfer moves a batch, and a batch has an expiry date.
 *
 * The outgoing row carried no `batchId` and the incoming one no
 * `expirationDate`, so the source batch was drawn down by the move (or made
 * unknown) and what arrived was undated: moved milk vanished from the expiring
 * and expired screens.
 */
describe("a transfer carries the expiry of what it moves", () => {
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

  it("moves part of one dated batch, keeping its date on both shelves", async () => {
    const api = await caller();
    const date = inDays(3);
    const batch = await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
      expirationDate: date,
      locationId: shelfId,
    });

    const { fromEntries, toEntries } = await api.inventory.transferStock({
      productId,
      quantity: 2,
      unit: "L",
      fromLocationId: shelfId,
      toLocationId: cupboardId,
    });

    expect(fromEntries.map((entry) => entry.batchId)).toEqual([batch.id]);
    expect(toEntries.map((entry) => entry.expirationDate)).toEqual([date]);

    const atShelf = await api.inventory.getExpiringItems({
      days: 7,
      locationId: shelfId,
    });
    const atCupboard = await api.inventory.getExpiringItems({
      days: 7,
      locationId: cupboardId,
    });
    expect(atShelf.map((row) => num(row.quantity))).toEqual([1]);
    expect(
      atCupboard.map((row) => [num(row.quantity), row.expirationDate]),
    ).toEqual([[2, date]]);
  });

  it("takes the soonest-expiring first and writes one movement per batch", async () => {
    const api = await caller();
    const soon = inDays(2);
    const later = inDays(5);
    // Bought in the opposite order, so FEFO is not creation order.
    const laterBatch = await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
      expirationDate: later,
      locationId: shelfId,
    });
    const soonBatch = await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
      expirationDate: soon,
      locationId: shelfId,
    });

    const { fromEntries, toEntries } = await api.inventory.transferStock({
      productId,
      quantity: 3,
      unit: "L",
      fromLocationId: shelfId,
      toLocationId: cupboardId,
    });

    expect(
      fromEntries.map((entry) => [entry.batchId, num(entry.quantity)]),
    ).toEqual([
      [soonBatch.id, -2],
      [laterBatch.id, -1],
    ]);
    expect(
      toEntries.map((entry) => [entry.expirationDate, num(entry.quantity)]),
    ).toEqual([
      [soon, 2],
      [later, 1],
    ]);

    const atShelf = await api.inventory.getExpiringItems({
      days: 7,
      locationId: shelfId,
    });
    const atCupboard = await api.inventory.getExpiringItems({
      days: 7,
      locationId: cupboardId,
    });
    expect(
      atShelf.map((row) => [num(row.quantity), row.expirationDate]),
    ).toEqual([[2, later]]);
    expect(
      atCupboard.map((row) => [num(row.quantity), row.expirationDate]),
    ).toEqual([
      [2, soon],
      [1, later],
    ]);
    expect(await netStock(shelfId)).toBe(2);
    expect(await netStock(cupboardId)).toBe(3);
  });

  it("still lists an expired batch as expired after it is moved", async () => {
    const api = await caller();
    const date = inDays(-3);
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 2,
      unit: "L",
      expirationDate: date,
      locationId: shelfId,
    });

    await api.inventory.transferStock({
      productId,
      quantity: 2,
      unit: "L",
      fromLocationId: shelfId,
      toLocationId: cupboardId,
    });

    const expired = await api.inventory.getExpiredItems({});
    expect(expired.map((row) => [num(row.quantity), row.locationId])).toEqual([
      [2, cupboardId],
    ]);
  });
});

/**
 * An expiry date is a calendar date, not an instant.
 *
 * The picker's "06/10" is stored as 2026-10-06T00:00Z and both views compared
 * it with `new Date()`: from 02:00 in Madrid on the 6th the milk was listed as
 * expired on the very day it says it is good until, and "days left" rounded a
 * part-day of milliseconds.
 */
describe("expiry is compared by calendar day", () => {
  it("lists a batch dated today as expiring today, not as expired", async () => {
    const api = await caller();
    const batch = await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "L",
      expirationDate: calendarDay(0),
    });

    const expiring = await api.inventory.getExpiringItems({ days: 7 });
    const expired = await api.inventory.getExpiredItems({});

    expect(expiring.map((row) => [row.id, row.daysUntilExpiry])).toEqual([
      [batch.id, 0],
    ]);
    expect(expired).toEqual([]);
  });

  it("counts whole days either side of today", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "L",
      expirationDate: calendarDay(1),
    });
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "L",
      expirationDate: calendarDay(7),
    });
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "L",
      expirationDate: calendarDay(8),
    });
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 1,
      unit: "L",
      expirationDate: calendarDay(-1),
    });

    const expiring = await api.inventory.getExpiringItems({ days: 7 });
    const expired = await api.inventory.getExpiredItems({});

    // Seven days ahead includes the seventh day itself, and not the eighth.
    expect(expiring.map((row) => row.daysUntilExpiry)).toEqual([1, 7]);
    expect(expired.map((row) => row.daysExpired)).toEqual([1]);
  });
});
