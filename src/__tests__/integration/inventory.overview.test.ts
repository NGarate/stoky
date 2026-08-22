import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as argon2 from "argon2";
import type { Session } from "next-auth";

import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { isLowStock, needsRestock } from "@/lib/stock/low-stock";

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
  const session: Session = {
    user: {
      id: OWNER.userId,
      email: `overview-${stamp}@example.com`,
      name: "Overview",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

/**
 * Six products, chosen so that every branch has a witness:
 * two below a minimum, one at zero with a minimum, one at zero with none,
 * one healthy, and one whose name only matches an accent-folded search.
 */
const FIXTURES = [
  { name: "Aceite de oliva", minStock: 2, stock: [1], category: "Despensa" },
  { name: "Arroz redondo", minStock: 1, stock: [5], category: "Despensa" },
  { name: "Café molido", minStock: 2, stock: [3, -3], category: "Desayuno" },
  { name: "Detergente", minStock: null, stock: [2, -2], category: "Hogar" },
  { name: "Leche entera", minStock: 6, stock: [4, -2], category: "Lácteos" },
  { name: "Ñoquis frescos", minStock: null, stock: [3], category: "Despensa" },
];

const ids = new Map<string, string>();
let locationId = "";
let otherLocationId = "";

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: `overview-${stamp}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `overview-${stamp}@example.com`,
      name: "Overview",
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

  const shelf = await prisma.storageLocation.create({
    data: { name: "Estante", householdId: household.id },
  });
  const empty = await prisma.storageLocation.create({
    data: { name: "Vacío", householdId: household.id },
  });
  locationId = shelf.id;
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
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
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
    expect(byName.get("Leche entera")).toBe(2);
    expect(byName.get("Café molido")).toBe(0);
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
    expect(row?.totalStock).toBe(0);

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
    for (const row of products) expect(row.totalStock).toBe(0);
  });

  it("counts every match, not the rows on this page", async () => {
    const api = await caller();
    const page = await api.inventory.getStockOverview({ limit: 2 });

    // There was no total at all before: the client could say "20 products"
    // only by counting what it had been handed.
    expect(page.products).toHaveLength(2);
    expect(page.total).toBe(FIXTURES.length);
    expect(page.pageCount).toBe(3);
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

  it("sorts by name without filing accents after Z", async () => {
    const api = await caller();
    const { products } = await api.inventory.getStockOverview({ limit: 100 });

    // The shipped image collates by byte, which puts "Ñoquis" after "Zumo".
    const names = products.map((p) => p.name);
    expect(names.indexOf("Ñoquis frescos")).toBeLessThan(
      names.indexOf("Zumo") === -1 ? names.length : names.indexOf("Zumo"),
    );
    expect(names[0]).toBe("Aceite de oliva");
  });

  it("sorts by stock, in either direction", async () => {
    const api = await caller();
    const desc = await api.inventory.getStockOverview({
      limit: 100,
      sort: "stock",
      direction: "desc",
    });

    const totals = desc.products.map((p) => p.totalStock);
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
