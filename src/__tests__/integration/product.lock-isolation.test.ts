import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import type { AppSession } from "@/lib/auth/session";
import { envelope } from "../utils/test-helpers";

/**
 * The product row lock is taken inside the caller's household, or not at all.
 *
 * `consumeStock`, `adjustStock`, `transferStock` and `product.update` hold the
 * product row (`SELECT … FOR UPDATE`) so that two writes to one product
 * serialise (ISSUES.md INV-2). Until 2026-10-12 that lock named the product by
 * id alone and ran *before* the `findFirst({ id, householdId })` that refuses a
 * foreign id. So a caller holding another household's product id locked that
 * household's row before being told it did not exist — and, whenever the owner
 * was holding it, waited for the owner, which is a timing oracle on somebody
 * else's activity. `consumeStock` is a `householdProcedure`, so KITCHEN could
 * do it.
 *
 * The lock now carries `"householdId"` in its own WHERE. Postgres filters
 * before it locks, so a foreign id matches no row: it locks nothing and waits
 * on nothing.
 *
 * Observed rather than timed. Household A holds its own product's row lock in
 * an open transaction and does not let go. Household B then calls each
 * procedure with A's product id. Correct, B is refused while A still holds the
 * lock. Without the predicate B queues behind A's lock and cannot settle until
 * A lets go, so the ceiling below expires first and the test goes red. The
 * ceiling is generous because it only has to tell "settled" from "blocked
 * until released", and a blocked call never settles on its own.
 */

/** How long B is given to settle while A holds the lock. */
const SETTLE_CEILING_MS = 5_000;
/** Per test: the ceiling, plus releasing A and draining a blocked B. */
const TEST_TIMEOUT_MS = 30_000;

const A = { userId: "", householdId: "", productId: "" };
const B = { userId: "", householdId: "", shelfId: "", pantryId: "" };

async function callerFor(account: { userId: string; householdId: string }) {
  const session: AppSession = {
    user: {
      id: account.userId,
      email: `${account.userId}@example.com`,
      name: "Lock isolation",
      householdId: account.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    expiresKind: "idle",
    sessionId: crypto.randomUUID(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

async function makeHousehold(label: string) {
  const household = await prisma.household.create({
    data: { name: `Lock isolation ${label}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `lock-isolation-${label}-${Date.now()}@example.com`,
      name: `Lock isolation ${label}`,
      householdId: household.id,
      role: "OWNER",
    },
  });
  return { userId: user.id, householdId: household.id };
}

beforeAll(async () => {
  Object.assign(A, await makeHousehold("A"));
  Object.assign(B, await makeHousehold("B"));

  const product = await prisma.product.create({
    data: { name: "Aceite de oliva", defaultUnit: "L", householdId: A.householdId },
  });
  A.productId = product.id;
  await prisma.stockEntry.create({
    data: {
      productId: product.id,
      quantity: 3,
      unit: "L",
      operationType: "PURCHASE",
      createdBy: A.userId,
    },
  });

  // B's own shelves, so the location checks that run before the transaction
  // pass and the call reaches the product lock.
  const shelf = await prisma.storageLocation.create({
    data: { name: "Estante B", householdId: B.householdId },
  });
  const pantry = await prisma.storageLocation.create({
    data: { name: "Despensa B", householdId: B.householdId },
  });
  B.shelfId = shelf.id;
  B.pantryId = pantry.id;
});

afterAll(async () => {
  const households = [A.householdId, B.householdId];
  await prisma.stockEntry.deleteMany({
    where: { product: { householdId: { in: households } } },
  });
  await prisma.product.deleteMany({ where: { householdId: { in: households } } });
  await prisma.storageLocation.deleteMany({ where: { householdId: { in: households } } });
  await prisma.mutationReplay.deleteMany({ where: { userId: { in: [A.userId, B.userId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [A.userId, B.userId] } } });
  await prisma.household.deleteMany({ where: { id: { in: households } } });
  await prisma.$disconnect();
});

/**
 * A holds its product's row lock until `release` is called.
 *
 * `held` resolves once the lock is actually taken — the test must know A is
 * holding it, not assume so after a sleep.
 */
function ownerHoldsTheLock(): {
  held: Promise<void>;
  release: () => void;
  done: Promise<unknown>;
} {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markHeld = (): void => {};
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${A.productId} FOR UPDATE`;
      markHeld();
      await gate;
    },
    { maxWait: TEST_TIMEOUT_MS, timeout: TEST_TIMEOUT_MS },
  );
  return { held, release, done };
}

/**
 * B's call, made while A holds the lock: what it settled to before the
 * ceiling, or "blocked" if it had not.
 */
async function whileOwnerHoldsTheLock(
  call: () => Promise<unknown>,
): Promise<unknown> {
  const owner = ownerHoldsTheLock();
  await owner.held;

  const settled = call().then(
    () => "resolved",
    (error: unknown) => error,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("blocked"), SETTLE_CEILING_MS);
  });

  const outcome = await Promise.race([settled, ceiling]);
  clearTimeout(timer);

  // Let A go, and let a blocked B finish, so nothing outlives the test.
  owner.release();
  await owner.done;
  await settled;

  return outcome;
}

function expectNotFound(outcome: unknown): void {
  // "blocked" here means B queued behind A's lock on A's row.
  expect(outcome).toBeInstanceOf(TRPCError);
  expect((outcome as TRPCError).code).toBe("NOT_FOUND");
}

describe("another household's product id takes no row lock", () => {
  it(
    "consumeStock is refused while the owner holds the product",
    async () => {
      const api = await callerFor(B);
      const before = await prisma.stockEntry.count({ where: { productId: A.productId } });

      expectNotFound(
        await whileOwnerHoldsTheLock(() =>
          api.inventory.consumeStock({
            ...envelope(B.userId),
            productId: A.productId,
            quantity: 1,
            unit: "L",
          }),
        ),
      );
      expect(await prisma.stockEntry.count({ where: { productId: A.productId } })).toBe(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "adjustStock is refused while the owner holds the product",
    async () => {
      const api = await callerFor(B);

      expectNotFound(
        await whileOwnerHoldsTheLock(() =>
          api.inventory.adjustStock({
            productId: A.productId,
            quantity: -1,
            unit: "L",
            locationId: B.shelfId,
            reason: "Recuento",
          }),
        ),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "transferStock is refused while the owner holds the product",
    async () => {
      const api = await callerFor(B);

      expectNotFound(
        await whileOwnerHoldsTheLock(() =>
          api.inventory.transferStock({
            productId: A.productId,
            quantity: 1,
            unit: "L",
            fromLocationId: B.shelfId,
            toLocationId: B.pantryId,
          }),
        ),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "product.update is refused while the owner holds the product",
    async () => {
      const api = await callerFor(B);

      expectNotFound(
        await whileOwnerHoldsTheLock(() =>
          api.product.update({ id: A.productId, name: "Renombrado por B" }),
        ),
      );
      const product = await prisma.product.findUniqueOrThrow({ where: { id: A.productId } });
      expect(product.name).toBe("Aceite de oliva");
    },
    TEST_TIMEOUT_MS,
  );
});
