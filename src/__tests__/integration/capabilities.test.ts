import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { HouseholdRole } from "@prisma/client";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createTestUser,
  createTestHousehold,
  createTestProduct,
  createTestStockEntry,
  createMockSession,
  generateTestEmail,
  envelope,
} from "../utils/test-helpers";

/**
 * Journey 2 of `docs/SMOKE_JOURNEYS.md`: a kitchen account is refused a write
 * **by the server**.
 *
 * A hidden button is not a control, so nothing here goes through a screen.
 * Every call is made straight at the router with a session for the role under
 * test, which is the only way to prove the restriction holds when the
 * interface is bypassed.
 *
 * The companion check is `src/__tests__/unit/capabilities.test.ts`, which
 * covers all 44 procedures by declaration. This one covers behaviour for the
 * procedures Journey 2 names, plus the admin tier and the no-household state,
 * and asserts that a refusal leaves no row behind — a check that would catch a
 * procedure writing before it authorises.
 */

const HOUSEHOLD_NAME = "Capability Test Household";

type Caller = ReturnType<typeof appRouter.createCaller>;

let householdId: string;
let productId: string;
let shoppingItemId: string;
let kitchen: Caller;
let member: Caller;
let admin: Caller;
let orphan: Caller;
/** The kitchen account's own id, for the replay envelope the writes carry. */
let kitchenUserId: string;

async function callerFor(role: HouseholdRole, withHousehold = true): Promise<Caller> {
  const user = await createTestUser({
    email: generateTestEmail(`cap-${role.toLowerCase()}`),
    name: `Capability ${role}`,
    householdId: withHousehold ? householdId : undefined,
    role,
  });
  if (role === "KITCHEN") kitchenUserId = user.id;
  const ctx = await createTRPCContext({ session: createMockSession(user) });
  return appRouter.createCaller(ctx);
}

/** Asserts the call was refused by the authorisation layer, not by chance. */
async function expectRefused(
  label: string,
  call: () => Promise<unknown>,
  code: "FORBIDDEN" | "PRECONDITION_FAILED" = "FORBIDDEN",
) {
  let thrown: unknown;
  try {
    await call();
  } catch (error) {
    thrown = error;
  }

  expect(thrown, `${label} was not refused`).toBeInstanceOf(TRPCError);
  // The code matters as much as the refusal: DEBT-4's symptom is an
  // authorisation failure arriving at the client as INTERNAL_SERVER_ERROR,
  // which a client cannot tell apart from the server falling over.
  expect((thrown as TRPCError).code, `${label} was refused with the wrong code`).toBe(code);
}

beforeAll(async () => {
  const household = await createTestHousehold({ name: HOUSEHOLD_NAME });
  householdId = household.id;

  const product = await createTestProduct({
    name: "Capability Test Milk",
    householdId,
    defaultUnit: "L",
    minStock: 5,
  });
  productId = product.id;

  const owner = await createTestUser({
    email: generateTestEmail("cap-seed"),
    name: "Capability Seed",
    householdId,
    role: "OWNER",
  });

  await createTestStockEntry({
    productId,
    quantity: 10,
    unit: "L",
    operationType: "PURCHASE",
    createdBy: owner.id,
  });

  const list = await prisma.shoppingList.create({
    data: { name: "Capability Test List", householdId },
  });
  const item = await prisma.shoppingItem.create({
    data: { shoppingListId: list.id, productId, quantity: 1, unit: "L" },
  });
  shoppingItemId = item.id;

  kitchen = await callerFor("KITCHEN");
  member = await callerFor("MEMBER");
  admin = await callerFor("ADMIN");
  orphan = await callerFor("MEMBER", false);
});

afterAll(async () => {
  await prisma.shoppingItem.deleteMany({ where: { productId } });
  await prisma.shoppingList.deleteMany({ where: { householdId } });
  await prisma.stockEntry.deleteMany({ where: { productId } });
  await prisma.priceRecord.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { householdId } });
  await prisma.storageLocation.deleteMany({ where: { householdId } });
  await prisma.store.deleteMany({ where: { householdId } });
  await prisma.user.deleteMany({ where: { name: { startsWith: "Capability " } } });
  await prisma.household.deleteMany({ where: { name: HOUSEHOLD_NAME } });
});

describe("Journey 2 — a kitchen account is refused a write by the server", () => {
  it("lets a kitchen account look at the stock", async () => {
    const overview = await kitchen.inventory.getStockOverview({ limit: 20 });
    expect(overview.products.some((p) => p.id === productId)).toBe(true);
  });

  it("lets a kitchen account use something up", async () => {
    // The one write the matrix grants it. If this ever starts failing, the
    // tablet has become a picture frame.
    const entry = await kitchen.inventory.consumeStock({
      ...envelope(kitchenUserId),
      productId,
      quantity: 1,
      unit: "L",
      operationType: "CONSUME",
    });

    expect(entry.quantity).toBe(-1);
  });

  it("refuses every other write named by Journey 2, and writes nothing", async () => {
    const stockBefore = await prisma.stockEntry.count({ where: { productId } });
    const itemsBefore = await prisma.shoppingItem.count({
      where: { shoppingList: { householdId } },
    });
    const productsBefore = await prisma.product.count({ where: { householdId } });

    await expectRefused("inventory.addStock", () =>
      kitchen.inventory.addStock({
        ...envelope(kitchenUserId),
        productId,
        quantity: 5,
        unit: "L",
        operationType: "PURCHASE",
      }),
    );
    await expectRefused("shopping.updateItem", () =>
      kitchen.shopping.updateItem({
        ...envelope(kitchenUserId),
        id: shoppingItemId,
        isChecked: true,
      }),
    );
    await expectRefused("shopping.generateFromLowStock", () =>
      kitchen.shopping.generateFromLowStock(),
    );
    await expectRefused("product.create", () =>
      kitchen.product.create({ name: "Kitchen Should Not Create", defaultUnit: "unit" }),
    );
    await expectRefused("product.scanBarcode", () =>
      kitchen.product.scanBarcode({ barcode: "8410000000000" }),
    );

    expect(await prisma.stockEntry.count({ where: { productId } })).toBe(stockBefore);
    expect(
      await prisma.shoppingItem.count({ where: { shoppingList: { householdId } } }),
    ).toBe(itemsBefore);
    expect(await prisma.product.count({ where: { householdId } })).toBe(productsBefore);

    const item = await prisma.shoppingItem.findUnique({ where: { id: shoppingItemId } });
    expect(item?.isChecked).toBe(false);
  });

  it("refuses a kitchen account the household's own settings", async () => {
    await expectRefused("location.create", () =>
      kitchen.location.create({ name: "Kitchen Should Not Create" }),
    );
    await expectRefused("store.create", () =>
      kitchen.store.create({ name: "Kitchen Should Not Create" }),
    );
  });
});

describe("the tiers above kitchen", () => {
  it("lets a member change household data", async () => {
    const product = await member.product.create({
      name: "Member Created Product",
      defaultUnit: "unit",
    });
    expect(product.id).toBeDefined();
  });

  it("refuses a member the household's own settings", async () => {
    // The middle column of the matrix: a user manages what is in the house,
    // an admin manages the house.
    await expectRefused("location.create", () =>
      member.location.create({ name: "Member Should Not Create" }),
    );
    await expectRefused("store.create", () =>
      member.store.create({ name: "Member Should Not Create" }),
    );
  });

  it("lets an admin change the household's own settings", async () => {
    const location = await admin.location.create({ name: "Admin Created Location" });
    const store = await admin.store.create({ name: "Admin Created Store" });

    expect(location.id).toBeDefined();
    expect(store.id).toBeDefined();
  });
});

describe("an account with no household", () => {
  it("is told the precondition failed rather than that the server did", async () => {
    // ISSUES.md HOUSE-1. The client needs to tell "you have no household yet"
    // apart from "something broke", because only the first has a way forward.
    await expectRefused(
      "inventory.getStockOverview",
      () => orphan.inventory.getStockOverview({ limit: 20 }),
      "PRECONDITION_FAILED",
    );
    await expectRefused(
      "product.list",
      () => orphan.product.list({ limit: 20 }),
      "PRECONDITION_FAILED",
    );
  });
});
