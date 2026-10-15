import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import type { AppSession } from "@/lib/auth/session";
import type { LocationTreeNode } from "@/server/trpc/routers/location";

/**
 * Locations never end up inside each other (ISSUES.md LOC-1).
 *
 * `location.update` refuses a move into the moved location's own subtree. It
 * used to check with plain reads and write afterwards, so two moves sent
 * together — A into B and B into A, one batched request — each checked the
 * tree before either wrote, both passed, and left a loop. Once a loop existed,
 * a move of anything else into it walked the loop for ever, because the walk
 * had no visited set and no depth limit, and `getTree` drew neither member,
 * because both had a parent present.
 *
 * Against a real PostgreSQL, because the defence is a row lock and a stub
 * cannot hold one. The loop below is written directly, as the race left it.
 */

/** A refusal comes back in milliseconds; a walk round a loop never does. */
const SETTLE_CEILING_MS = 5_000;
const ROUNDS = 20;

const account = { userId: "", householdId: "" };

async function caller() {
  const session: AppSession = {
    user: {
      id: account.userId,
      email: `${account.userId}@example.com`,
      name: "Location cycles",
      householdId: account.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    sessionId: crypto.randomUUID(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

/** Settles with the call's outcome, or with "hung" if it outlives the ceiling. */
async function within<T>(call: Promise<T>): Promise<T | "hung"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), SETTLE_CEILING_MS);
  });
  try {
    return await Promise.race([call, ceiling]);
  } finally {
    clearTimeout(timer);
  }
}

function idsIn(nodes: LocationTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...idsIn(node.children)]);
}

async function location(name: string, parentId: string | null = null) {
  return prisma.storageLocation.create({
    data: { name, parentId, householdId: account.householdId },
  });
}

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: "Location cycles" },
  });
  const user = await prisma.user.create({
    data: {
      email: `location-cycles-${Date.now()}@example.com`,
      name: "Location cycles",
      // Never signed in with: the session above is built directly.
      householdId: household.id,
      role: "OWNER",
    },
  });
  account.userId = user.id;
  account.householdId = household.id;
});

afterAll(async () => {
  // Cut every link first, so the rows can go in any order — a loop has no
  // leaf to start from.
  await prisma.storageLocation.updateMany({
    where: { householdId: account.householdId },
    data: { parentId: null },
  });
  await prisma.storageLocation.deleteMany({
    where: { householdId: account.householdId },
  });
  await prisma.user.deleteMany({ where: { id: account.userId } });
  await prisma.household.deleteMany({ where: { id: account.householdId } });
  await prisma.$disconnect();
});

describe("a loop of locations already in the database", () => {
  it("refuses a move into it instead of walking it for ever, and getTree still draws it", async () => {
    const a = await location("Bucle A");
    const b = await location("Bucle B", a.id);
    await prisma.storageLocation.update({
      where: { id: a.id },
      data: { parentId: b.id },
    });
    const below = await location("Bajo el bucle", a.id);
    const outside = await location("Fuera");
    const api = await caller();

    const outcome = await within(
      api.location.update({ id: outside.id, parentId: a.id }).catch((e: unknown) => e),
    );
    expect(outcome).toBeInstanceOf(TRPCError);
    expect((outcome as TRPCError).code).toBe("BAD_REQUEST");
    // The visited set's refusal, not the depth cap's: the loop is two rows.
    expect((outcome as TRPCError).message).toMatch(/loop/);

    const after = await prisma.storageLocation.findUniqueOrThrow({
      where: { id: outside.id },
    });
    expect(after.parentId).toBeNull();

    // Both members at the top level, and what is stored under the loop stays
    // under its own parent rather than also being lifted out.
    const tree = await api.location.getTree();
    const roots = tree.map((node) => node.id);
    expect(roots).toContain(a.id);
    expect(roots).toContain(b.id);
    const nodeA = tree.find((node) => node.id === a.id);
    expect(nodeA?.children.map((child) => child.id)).toEqual([below.id]);
    expect(idsIn(tree).filter((id) => [a.id, b.id, below.id].includes(id))).toHaveLength(3);
  });

  it("refuses a chain of ancestors deeper than the walk will read", async () => {
    let parent = await location("Nivel 0");
    for (let depth = 1; depth <= 70; depth++) {
      parent = await location(`Nivel ${depth}`, parent.id);
    }
    const loose = await location("Suelto");
    const api = await caller();

    const outcome = await within(
      api.location.update({ id: loose.id, parentId: parent.id }).catch((e: unknown) => e),
    );
    expect(outcome).toBeInstanceOf(TRPCError);
    expect((outcome as TRPCError).code).toBe("BAD_REQUEST");
    expect((outcome as TRPCError).message).toMatch(/deep/);
  });
});

describe("two moves sent together", () => {
  it(
    `never leave two locations inside each other (${ROUNDS} rounds)`,
    async () => {
      const api = await caller();
      const loops: number[] = [];
      const refusals: string[] = [];

      for (let round = 0; round < ROUNDS; round++) {
        const a = await location(`Carrera ${round} A`);
        const b = await location(`Carrera ${round} B`);

        // As one batched request runs them: concurrently.
        const outcomes = await Promise.allSettled([
          api.location.update({ id: a.id, parentId: b.id }),
          api.location.update({ id: b.id, parentId: a.id }),
        ]);

        const [rowA, rowB] = await Promise.all([
          prisma.storageLocation.findUniqueOrThrow({ where: { id: a.id } }),
          prisma.storageLocation.findUniqueOrThrow({ where: { id: b.id } }),
        ]);
        if (rowA.parentId === b.id && rowB.parentId === a.id) loops.push(round);

        // One move lands; the other reads the tree it left and is refused.
        refusals.push(
          outcomes
            .filter((outcome) => outcome.status === "rejected")
            .map((outcome) => ((outcome as PromiseRejectedResult).reason as TRPCError).code)
            .join(","),
        );
      }

      expect(loops).toEqual([]);
      expect(refusals).toEqual(Array(ROUNDS).fill("BAD_REQUEST"));
    },
    60_000,
  );
});
