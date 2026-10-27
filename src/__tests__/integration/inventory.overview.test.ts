import type { TRPCError } from "@trpc/server";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { AppSession } from "@/lib/auth/session";

import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { isLowStock, needsRestock } from "@/lib/stock/low-stock";
import { num } from "../utils/amount";

/**
 * The aggregate, against a real PostgreSQL.
 *
 * Most of these could not pass against the version this replaces, and that is
 * the point of writing them: it took its page by cursor, summed totals in
 * JavaScript from every ledger row of every product on that page, and then
 * filtered *what it had already fetched*. So a filtered page came back
 * shorter than it asked for, there was no total, and page two of a filtered
 * list was a different set from the one page one implied.
 *
 * A mocked client would have returned whatever the test pretended, which is
 * how none of this was noticed.
 */

const OWNER = { userId: "", householdId: "" };
const stamp = Date.now();

async function caller() {
  const session: AppSession = {
    user: {
      id: OWNER.userId,
      email: `overview-${stamp}@example.com`,
      name: "Overview",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    expiresKind: "idle",
    sessionId: crypto.randomUUID(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

/**
 * Eight products, chosen so that every branch has a witness:
 * two below a minimum, one at zero with a minimum, one at zero with none,
 * one healthy, one whose name only matches an accent-folded search, and two
 * that file in a different place depending on whether the sort folds.
 *
 * The last pair earns its place. "Ñoquis frescos" alone proves nothing about
 * collation, because it is last under either rule — the accent-folding test
 * below used to lean on it and could not fail. `Ácido cítrico` belongs second
 * folded and last unfolded, and `Nuez moscada` sits either side of `Ñoquis`
 * depending on the same question.
 */
const FIXTURES = [
  { name: "Aceite de oliva", minStock: 2, stock: [1], category: "Despensa" },
  { name: "Ácido cítrico", minStock: null, stock: [1], category: "Despensa" },
  { name: "Arroz redondo", minStock: 1, stock: [5], category: "Despensa" },
  { name: "Café molido", minStock: 2, stock: [3, -3], category: "Desayuno" },
  { name: "Detergente", minStock: null, stock: [2, -2], category: "Hogar" },
  { name: "Leche entera", minStock: 6, stock: [4, -2], category: "Lácteos" },
  { name: "Ñoquis frescos", minStock: null, stock: [3], category: "Despensa" },
  { name: "Nuez moscada", minStock: null, stock: [1], category: "Despensa" },
];

const ids = new Map<string, string>();
let otherLocationId = "";

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: `overview-${stamp}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `overview-${stamp}@example.com`,
      name: "Overview",
      householdId: household.id,
      role: "OWNER",
    },
  });
  OWNER.userId = user.id;
  OWNER.householdId = household.id;

  const shelf = await prisma.storageLocation.create({
    data: { name: "Estante", householdId: household.id },
  });
  const empty = await prisma.storageLocation.create({
    data: { name: "Vacío", householdId: household.id },
  });
  otherLocationId = empty.id;

  for (const fixture of FIXTURES) {
    const product = await prisma.product.create({
      data: {
        name: fixture.name,
        category: fixture.category,
        defaultUnit: "unidad",
        minStock: fixture.minStock,
        householdId: household.id,
      },
    });
    ids.set(fixture.name, product.id);
    for (const quantity of fixture.stock) {
      await prisma.stockEntry.create({
        data: {
          productId: product.id,
          quantity,
          unit: "unidad",
          locationId: shelf.id,
          operationType: quantity >= 0 ? "PURCHASE" : "CONSUME",
          createdBy: user.id,
        },
      });
    }
  }
});

afterAll(async () => {
  await prisma.stockEntry.deleteMany({
    where: { product: { householdId: OWNER.householdId } },
  });
  await prisma.product.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.storageLocation.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.user.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.household.deleteMany({ where: { id: OWNER.householdId } });
});

describe("the stock overview", () => {
  it("nets consumption off, rather than counting what was bought", async () => {
    const api = await caller();
    const { products } = await api.inventory.getStockOverview({ limit: 100 });

    const byName = new Map(products.map((p) => [p.name, p.totalStock]));
    expect(num(byName.get("Leche entera"))).toBe(2);
    expect(num(byName.get("Café molido"))).toBe(0);
  });

  it("keeps a product with no stock entry at all", async () => {
    const api = await caller();
    await prisma.product.create({
      data: {
        name: "Zumo sin historial",
        defaultUnit: "unidad",
        householdId: OWNER.householdId,
      },
    });

    const { products } = await api.inventory.getStockOverview({ limit: 100 });
    const row = products.find((p) => p.name === "Zumo sin historial");

    // A LEFT JOIN, not an inner one. A product nobody has bought yet is
    // exactly the product you most want to see on a restock list.
    expect(num(row?.totalStock)).toBe(0);

    await prisma.product.deleteMany({ where: { name: "Zumo sin historial" } });
  });

  it("keeps a product with nothing in the location being filtered by", async () => {
    const api = await caller();
    const { products } = await api.inventory.getStockOverview({
      limit: 100,
      locationId: otherLocationId,
    });

    // The location predicate belongs in the JOIN's ON clause. In the WHERE it
    // turns the LEFT JOIN into an inner one and every product disappears,
    // which answers a different question from the one the screen asks.
    expect(products).toHaveLength(FIXTURES.length);
    for (const row of products) expect(num(row.totalStock)).toBe(0);
  });

  it("counts every match, not the rows on this page", async () => {
    const api = await caller();
    const page = await api.inventory.getStockOverview({ limit: 2 });

    // There was no total at all before: the client could say "20 products"
    // only by counting what it had been handed.
    expect(page.products).toHaveLength(2);
    expect(page.total).toBe(FIXTURES.length);
    expect(page.pageCount).toBe(Math.ceil(FIXTURES.length / 2));
  });

  it("gives page two of a filtered list, which is the case that was wrong", async () => {
    const api = await caller();
    const first = await api.inventory.getStockOverview({
      needsRestock: true,
      limit: 2,
      page: 1,
    });
    const second = await api.inventory.getStockOverview({
      needsRestock: true,
      limit: 2,
      page: 2,
    });

    // Filtering after paging meant page one came back short and page two
    // started from the wrong place. Four products need restocking here.
    expect(first.total).toBe(4);
    expect(first.products).toHaveLength(2);
    expect(second.products).toHaveLength(2);

    const names = [...first.products, ...second.products].map((p) => p.name);
    expect(new Set(names).size).toBe(4);
  });

  it("still knows the total on a page past the end", async () => {
    const api = await caller();
    const page = await api.inventory.getStockOverview({ limit: 2, page: 9 });

    // `COUNT(*) OVER ()` would have returned nothing here, and the pager
    // would have told someone there was nothing to page through.
    expect(page.products).toEqual([]);
    expect(page.total).toBe(FIXTURES.length);
  });

  it("refuses a page number the database could not offset to, as a bad request", async () => {
    const api = await caller();

    // `page` had a floor and no ceiling, and `1e19` is an integer as far as
    // `.int()` is concerned. It reached Postgres as `OFFSET 2e20` and came
    // back `bigint out of range`.
    //
    // The assertion is the *code*, not merely that it was refused: both the
    // bounded and the unbounded schema refuse this call, and asserting "it
    // threw" passes against the defect. Bounded, Zod turns it away as a
    // BAD_REQUEST before a query is built; unbounded, the database fails
    // mid-query and the caller gets an INTERNAL_SERVER_ERROR — a failure
    // screen where an empty page was the honest answer.
    let code = "";
    try {
      await api.inventory.getStockOverview({ limit: 20, page: 1e19 });
    } catch (error) {
      code = (error as TRPCError).code;
    }

    expect(code).toBe("BAD_REQUEST");
  });

  it("still answers for a page number a person could reach", async () => {
    const api = await caller();
    const page = await api.inventory.getStockOverview({
      limit: 20,
      page: 10_000,
    });

    expect(page.products).toEqual([]);
    expect(page.total).toBe(FIXTURES.length);
  });

  it("filters low stock exactly as the shared predicate does", async () => {
    const api = await caller();
    const all = await api.inventory.getStockOverview({ limit: 100 });
    const low = await api.inventory.getStockOverview({
      lowStock: true,
      limit: 100,
    });

    // The rule now exists twice — once in TypeScript, once in SQL, because
    // the database cannot import the first. This is what holds them together.
    const expected = all.products
      .filter((p) => isLowStock(p.totalStock, p.minStock))
      .map((p) => p.name)
      .sort();

    expect(low.products.map((p) => p.name).sort()).toEqual(expected);
  });

  it("filters restock exactly as the shared predicate does", async () => {
    const api = await caller();
    const all = await api.inventory.getStockOverview({ limit: 100 });
    const restock = await api.inventory.getStockOverview({
      needsRestock: true,
      limit: 100,
    });

    const expected = all.products
      .filter((p) => needsRestock(p.totalStock, p.minStock))
      .map((p) => p.name)
      .sort();

    expect(restock.products.map((p) => p.name).sort()).toEqual(expected);
  });

  it("marks a row low by the same rule it filters by", async () => {
    const api = await caller();
    const { products } = await api.inventory.getStockOverview({ limit: 100 });

    for (const row of products) {
      expect(row.isLowStock).toBe(isLowStock(row.totalStock, row.minStock));
    }
  });

  it("sorts by name as Spanish reads it, with accents folded in", async () => {
    const api = await caller();
    const { products } = await api.inventory.getStockOverview({ limit: 100 });

    // The whole order, deliberately, rather than one relative position.
    //
    // This test used to say `indexOf("Ñoquis") < indexOf("Zumo")`, and there
    // is no Zumo in these fixtures — so the bound fell back to the array's
    // length and the assertion read "5 < 6", true under every collation
    // there is. Ñoquis is last either way, so it could not have discriminated
    // even with a real bound.
    //
    // These two do. Folded, `Ácido cítrico` is "acido citrico" and belongs
    // between Aceite and Arroz; collated by byte, `Á` is two bytes above
    // every ASCII letter and it files last. `Nuez moscada` and `Ñoquis
    // frescos` swap for the same reason.
    expect(products.map((p) => p.name)).toEqual([
      "Aceite de oliva",
      "Ácido cítrico",
      "Arroz redondo",
      "Café molido",
      "Detergente",
      "Leche entera",
      "Ñoquis frescos",
      "Nuez moscada",
    ]);
  });

  it("sorts by stock, in either direction", async () => {
    const api = await caller();
    const desc = await api.inventory.getStockOverview({
      limit: 100,
      sort: "stock",
      direction: "desc",
    });

    const totals = desc.products.map((p) => num(p.totalStock));
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it("finds a name whatever its accents, because a keyboard has none", async () => {
    const api = await caller();
    const found = await api.inventory.getStockOverview({
      limit: 100,
      search: "cafe",
    });

    expect(found.products.map((p) => p.name)).toEqual(["Café molido"]);
  });

  it("treats a typed wildcard as a character, not as everything", async () => {
    const api = await caller();
    const found = await api.inventory.getStockOverview({
      limit: 100,
      search: "%",
    });

    // Unescaped, this matches every product — a search box that returns the
    // whole catalogue for one keystroke.
    expect(found.products).toEqual([]);
  });

  it("refuses a sort key it does not know", async () => {
    const api = await caller();

    // The whitelist is what stands between a sort control and an ORDER BY
    // injection, since ORDER BY cannot be parameterised.
    await expect(
      api.inventory.getStockOverview({
        limit: 10,
        sort: "name; DROP TABLE Product" as "name",
      }),
    ).rejects.toThrow();
  });

  it("shows another household nothing of this one", async () => {
    const api = await caller();
    const { products, total } = await api.inventory.getStockOverview({
      limit: 100,
    });

    expect(total).toBe(FIXTURES.length);
    for (const row of products) {
      expect(ids.has(row.name)).toBe(true);
    }
  });
});

describe("what the household's lists already cover", () => {
  let listId = "";

  beforeAll(async () => {
    const list = await prisma.shoppingList.create({
      data: { name: "Semanal", householdId: OWNER.householdId },
    });
    listId = list.id;
  });

  afterAll(async () => {
    await prisma.shoppingItem.deleteMany({ where: { shoppingListId: listId } });
    await prisma.shoppingList.deleteMany({ where: { id: listId } });
  });

  it("reports nothing on a list as zero, not as absent", async () => {
    const api = await caller();
    const { products } = await api.inventory.getStockOverview({ limit: 100 });

    // `undefined` here reaches the kitchen as `left + undefined < min`, which
    // is `NaN < min`, which is false — and the button silently vanishes.
    for (const row of products) expect(num(row.onListQuantity)).toBe(0);
  });

  it("sums every unticked item for a product, across lists", async () => {
    const api = await caller();
    const productId = ids.get("Leche entera")!;
    await prisma.shoppingItem.createMany({
      data: [
        { shoppingListId: listId, productId, quantity: 1, unit: "unidad" },
        { shoppingListId: listId, productId, quantity: 6, unit: "unidad" },
      ],
    });

    const { products } = await api.inventory.getStockOverview({ limit: 100 });
    const row = products.find((p) => p.name === "Leche entera");

    expect(num(row?.onListQuantity)).toBe(7);

    await prisma.shoppingItem.deleteMany({ where: { productId } });
  });

  it("does not multiply the stock by the number of list items", async () => {
    const api = await caller();
    const productId = ids.get("Leche entera")!;
    const before = await api.inventory.getStockOverview({ limit: 100 });
    const stockBefore = before.products.find(
      (p) => p.name === "Leche entera",
    )?.totalStock;

    await prisma.shoppingItem.createMany({
      data: [
        { shoppingListId: listId, productId, quantity: 1, unit: "unidad" },
        { shoppingListId: listId, productId, quantity: 1, unit: "unidad" },
        { shoppingListId: listId, productId, quantity: 1, unit: "unidad" },
      ],
    });

    const after = await api.inventory.getStockOverview({ limit: 100 });
    const row = after.products.find((p) => p.name === "Leche entera");

    // Joined without aggregating first, each of the product's two stock
    // entries pairs with each of its three list items: the stock reads six
    // times over and the list twice.
    expect(num(row?.totalStock)).toBe(num(stockBefore));
    expect(num(row?.onListQuantity)).toBe(3);

    await prisma.shoppingItem.deleteMany({ where: { productId } });
  });

  it("leaves out an amount in a unit the product is not counted in", async () => {
    const api = await caller();
    const productId = ids.get("Leche entera")!;
    await prisma.shoppingItem.createMany({
      data: [
        { shoppingListId: listId, productId, quantity: 2, unit: "unidad" },
        { shoppingListId: listId, productId, quantity: 500, unit: "g" },
      ],
    });

    const { products } = await api.inventory.getStockOverview({ limit: 100 });
    const row = products.find((p) => p.name === "Leche entera");

    // Summed raw, the 500 g read as 500 more of something counted in units.
    expect(num(row?.onListQuantity)).toBe(2);

    await prisma.shoppingItem.deleteMany({ where: { productId } });
  });

  it("ignores what has already been ticked off", async () => {
    const api = await caller();
    const productId = ids.get("Leche entera")!;
    await prisma.shoppingItem.create({
      data: {
        shoppingListId: listId,
        productId,
        quantity: 4,
        unit: "unidad",
        isChecked: true,
        checkedAt: new Date(),
      },
    });

    const { products } = await api.inventory.getStockOverview({ limit: 100 });
    const row = products.find((p) => p.name === "Leche entera");

    // Already in the trolley is not still to buy.
    expect(num(row?.onListQuantity)).toBe(0);

    await prisma.shoppingItem.deleteMany({ where: { productId } });
  });
});
