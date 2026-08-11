import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, writeProcedure, createTRPCContext } from "@/server/trpc/trpc";
import { withReplay } from "@/server/trpc/replay";
import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";

/**
 * A self-contained reproduction of ISSUES.md TEST-5.
 *
 * **Not part of any suite.** It lives outside `src/__tests__` on purpose:
 * `pnpm test:*` targets that directory, so nothing collects this. Run it by
 * hand, in a loop, against a database:
 *
 * ```bash
 * for i in $(seq 1 30); do bunx bun test docs/reproductions/test-5.test.ts; done
 * ```
 *
 * **It only reproduces under load.** 0 failures in 90 runs on a quiet machine;
 * 3 in 24 with another suite running against the same database:
 *
 * ```bash
 * bunx bun test src/__tests__/integration      # in one shell
 * for i in $(seq 1 24); do bunx bun test docs/reproductions/test-5.test.ts; done
 * ```
 *
 * A green loop proves nothing without that.
 *
 * The last statement of the failing test adds its name to `completed`, and an
 * `afterAll` prints the set. On a failing run it prints `COMPLETED: []` *and*
 * bun reports one fewer `expect()` call than on a passing run — the test's own
 * assertion never executes. That is the evidence that bun abandons the body at
 * the rejecting `await`, before the `catch` beside it runs, rather than the
 * application misbehaving.
 *
 * **What it took to reproduce.** Four smaller shapes do not: a rejection through
 * a nested async wrapper; the same through a tRPC caller with no database; a
 * `TRPCError` thrown out of a rolled-back Prisma transaction; and `withReplay`'s
 * sequence without tRPC. Nor does the application's middleware chain around a
 * plain throw. It needs the middleware chain *and* `withReplay`, together, with
 * enough calls before it — which is what this file is.
 */
const completed = new Set<string>();
let userId = "";
let householdId = "";

const router = createTRPCRouter({
  makeLocation: writeProcedure
    .input(z.object({ idempotencyKey: z.string().uuid(), composedByUserId: z.string(), name: z.string() }))
    .mutation(async ({ ctx, input }) =>
      withReplay(ctx, {
        key: input.idempotencyKey,
        composedByUserId: input.composedByUserId,
        procedure: "repro.makeLocation",
        input,
        apply: async (tx) => tx.storageLocation.create({ data: { name: input.name, householdId: ctx.householdId } }),
        ids: (r) => [r.id],
        reread: async (db, ids) => db.storageLocation.findFirstOrThrow({ where: { id: ids[0] } }),
      }),
    ),
});

async function caller() {
  const session = {
    user: { id: userId, email: "r@example.com", name: "R", householdId, role: "OWNER" },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  } as unknown as Session;
  return router.createCaller(await createTRPCContext({ session }));
}

beforeAll(async () => {
  const h = await prisma.household.create({ data: { name: "Repro F Household" } });
  householdId = h.id;
  const u = await prisma.user.create({
    data: { email: `repro-f-${Date.now()}@example.com`, name: "R", passwordHash: "x", householdId, role: "OWNER" },
  });
  userId = u.id;
});

afterAll(async () => {
  console.error("COMPLETED:", JSON.stringify([...completed]));
  await prisma.mutationReplay.deleteMany({ where: { userId } });
  await prisma.storageLocation.deleteMany({ where: { householdId } });
  await prisma.user.deleteMany({ where: { householdId } });
  await prisma.household.deleteMany({ where: { id: householdId } });
  await prisma.$disconnect();
});

describe("shape F", () => {
  for (let i = 0; i < 12; i++) {
    it(`noise ${i}`, async () => {
      const api = await caller();
      const key = randomUUID();
      await api.makeLocation({ idempotencyKey: key, composedByUserId: userId, name: "Estante" });
      await api.makeLocation({ idempotencyKey: key, composedByUserId: userId, name: "Estante" });
      expect(true).not.toBe(false);
    });
  }

  it("refuses a key reused for a different change", async () => {
    const api = await caller();
    const key = randomUUID();
    await api.makeLocation({ idempotencyKey: key, composedByUserId: userId, name: "Estante" });

    let thrown: unknown;
    try {
      await api.makeLocation({ idempotencyKey: key, composedByUserId: userId, name: "Otro sitio" });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as TRPCError)?.code).toBe("BAD_REQUEST");
    completed.add("refuses a key reused");
  });
});
