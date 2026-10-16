import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createMockSession,
  createTestHousehold,
  createTestUser,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * Deleting a shopping list — the state a list is actually in when it is deleted.
 *
 * `shopping.delete` had one test and it deleted an **empty** list
 * (`routers.test.ts`, "should delete shopping list"). Every list a household
 * wants rid of has something on it, and that case had never been run.
 *
 * It did not work. `ShoppingItem`'s foreign key is `ON DELETE RESTRICT` — the
 * schema has no cascades outside the auth tables, deliberately — so `shoppingList.delete` hit
 * the constraint, and the error translation turned P2003 into `BAD_REQUEST`,
 * *"That refers to something that does not exist"*. About a list the person was
 * looking at. Measured before the fix, not inferred: the call threw that, and
 * the list was still there afterwards.
 *
 * The router's own comment said the opposite — "this one really does cascade" —
 * which is how it survived: the intent was written down, agreed with, and never
 * performed. The comment is now true because the resolver does the cascade
 * itself.
 *
 * Two of these tests would pass against the broken version (`NOT_FOUND` for a
 * stranger's list, and the empty-list case `routers.test.ts` already had). The
 * first one is the one that matters.
 */

const HOUSEHOLD = "Shopping Delete Household";
const STRANGER_HOUSEHOLD = "Shopping Delete Stranger Household";
const NAME_PREFIX = "Shopping Delete ";

type Caller = ReturnType<typeof appRouter.createCaller>;

let caller: Caller;
let householdId: string;
let strangerHouseholdId: string;
let productId: string;

async function callerForHousehold(id: string, label: string): Promise<Caller> {
  const household = await prisma.household.findUniqueOrThrow({ where: { id } });
  const user = await createTestUser({
    email: generateTestEmail(`shop-del-${label}`),
    name: `${NAME_PREFIX}${label}`,
    password: "cocina despensa nevera",
    householdId: id,
  });

  const ctx = await createTRPCContext({
    session: createMockSession({ ...user, household }),
  });
  return appRouter.createCaller(ctx);
}

/** A list with `items` products on it, which is what a real list looks like. */
async function listWithItems(items: number, name: string): Promise<string> {
  const list = await prisma.shoppingList.create({
    data: { name, householdId },
  });

  for (let i = 0; i < items; i++) {
    await prisma.shoppingItem.create({
      data: {
        shoppingList: { connect: { id: list.id } },
        product: { connect: { id: productId } },
        quantity: 1,
        unit: "L",
      },
    });
  }

  return list.id;
}

beforeAll(async () => {
  const household = await createTestHousehold({ name: HOUSEHOLD });
  householdId = household.id;

  const stranger = await createTestHousehold({ name: STRANGER_HOUSEHOLD });
  strangerHouseholdId = stranger.id;

  const product = await prisma.product.create({
    data: { name: `${NAME_PREFIX}Leche`, defaultUnit: "L", householdId },
  });
  productId = product.id;

  caller = await callerForHousehold(householdId, "owner");
});

afterAll(async () => {
  // Items before lists before products, because nothing here cascades.
  const households = [householdId, strangerHouseholdId];
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId: { in: households } } },
  });
  await prisma.shoppingList.deleteMany({
    where: { householdId: { in: households } },
  });
  await prisma.product.deleteMany({ where: { householdId: { in: households } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
  await prisma.household.deleteMany({ where: { id: { in: households } } });
});

describe("deleting a shopping list that has things on it", () => {
  it("works, which it did not before", async () => {
    const listId = await listWithItems(3, `${NAME_PREFIX}Weekly Shop`);

    const result = await caller.shopping.delete({ id: listId });

    expect(result.success).toBe(true);
    expect(
      await prisma.shoppingList.findUnique({ where: { id: listId } }),
    ).toBeNull();
  });

  it("takes the items with it, rather than orphaning them", async () => {
    const listId = await listWithItems(3, `${NAME_PREFIX}Takes Items`);

    await caller.shopping.delete({ id: listId });

    expect(
      await prisma.shoppingItem.count({ where: { shoppingListId: listId } }),
    ).toBe(0);
  });

  it("leaves the products alone", async () => {
    // The cascade is one level deep on purpose. A shopping item has no history
    // worth keeping; the product it named certainly does — its stock, its
    // prices and its receipt lines all hang off it.
    const listId = await listWithItems(2, `${NAME_PREFIX}Keeps Products`);

    await caller.shopping.delete({ id: listId });

    expect(
      await prisma.product.findUnique({ where: { id: productId } }),
    ).not.toBeNull();
  });

  it("leaves other lists in the household untouched", async () => {
    // `deleteMany` keyed on the wrong column would take the household's other
    // lists with it, and the test above could not tell.
    const doomed = await listWithItems(2, `${NAME_PREFIX}Doomed`);
    const bystander = await listWithItems(2, `${NAME_PREFIX}Bystander`);

    await caller.shopping.delete({ id: doomed });

    expect(
      await prisma.shoppingList.findUnique({ where: { id: bystander } }),
    ).not.toBeNull();
    expect(
      await prisma.shoppingItem.count({ where: { shoppingListId: bystander } }),
    ).toBe(2);
  });
});

describe("whose list it is", () => {
  it("refuses another household's list, and removes nothing", async () => {
    // The ownership check moved: it used to ride on the delete's own `where`,
    // and now happens before anything is removed — because the item delete is
    // keyed on the list alone and could not carry a household filter.
    const strangersList = await prisma.shoppingList.create({
      data: { name: `${NAME_PREFIX}Stranger List`, householdId: strangerHouseholdId },
    });
    const strangersProduct = await prisma.product.create({
      data: {
        name: `${NAME_PREFIX}Stranger Milk`,
        defaultUnit: "L",
        householdId: strangerHouseholdId,
      },
    });
    await prisma.shoppingItem.create({
      data: {
        shoppingList: { connect: { id: strangersList.id } },
        product: { connect: { id: strangersProduct.id } },
        quantity: 1,
      },
    });

    let thrown: unknown;
    try {
      await caller.shopping.delete({ id: strangersList.id });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("NOT_FOUND");

    // Both halves: the list, and the items the new cascade could otherwise
    // have taken before the check ran.
    expect(
      await prisma.shoppingList.findUnique({ where: { id: strangersList.id } }),
    ).not.toBeNull();
    expect(
      await prisma.shoppingItem.count({
        where: { shoppingListId: strangersList.id },
      }),
    ).toBe(1);
  });

  it("refuses a list that is not there at all", async () => {
    let thrown: unknown;
    try {
      await caller.shopping.delete({ id: "clnonexistentnonexistent" });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as TRPCError).code).toBe("NOT_FOUND");
  });
});

describe("an empty list", () => {
  it("still deletes, which is the case that always worked", async () => {
    // Kept so a fix aimed at the items cannot quietly break the case that was
    // never broken.
    const listId = await listWithItems(0, `${NAME_PREFIX}Empty`);

    expect((await caller.shopping.delete({ id: listId })).success).toBe(true);
    expect(
      await prisma.shoppingList.findUnique({ where: { id: listId } }),
    ).toBeNull();
  });
});
