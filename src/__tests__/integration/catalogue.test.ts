import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createMockSession,
  createTestHousehold,
  createTestProduct,
} from "../utils/test-helpers";

/**
 * The catalogue's plain round trips: products and shops, read and written by
 * their own household.
 *
 * What is refused lives elsewhere — another household's rows in
 * `cross-household.test.ts`, the roles in `capabilities*.test.ts`, the bounds
 * in `input-bounds.test.ts`, the deletes in `delete-guards.test.ts`. This is
 * what is left when everything is allowed: that what goes in comes back out.
 */

const HOUSEHOLD = `Catalogue ${Date.now().toString(36)}`;

type Caller = ReturnType<typeof appRouter.createCaller>;

let householdId: string;
let api: Caller;

beforeAll(async () => {
  householdId = (await createTestHousehold({ name: HOUSEHOLD })).id;
  // Never signed in with, so no password: the session is built directly.
  const owner = await prisma.user.create({
    data: {
      email: `catalogue-${Date.now()}@example.com`,
      name: "Catalogue Owner",
      householdId,
      role: "OWNER",
    },
  });
  api = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession(owner) }),
  );
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { householdId } });
  await prisma.store.deleteMany({ where: { householdId } });
  await prisma.user.deleteMany({ where: { householdId } });
  await prisma.household.deleteMany({ where: { id: householdId } });
});

describe("a product", () => {
  it("comes back from create as it was given, accents and all", async () => {
    const created = await api.product.create({
      name: "Turrón de Jijona ñ 🎉",
      defaultUnit: "kg",
      brand: "La Fama",
      category: "Dulces",
      minStock: 5,
    });

    const read = await api.product.getById({ id: created.id });

    expect([read.name, read.defaultUnit, read.brand, read.category]).toEqual([
      "Turrón de Jijona ñ 🎉",
      "kg",
      "La Fama",
      "Dulces",
    ]);
    expect(read.minStock?.toNumber()).toBe(5);
  });

  it("clears an optional field with null, and leaves omitted ones alone", async () => {
    // The edit screen's clear case: a wrong barcode has to be removable, and
    // before the schema accepted null there was no way to say so — omitting
    // the field means "leave it", and "" would land in the unique index.
    const product = await createTestProduct({
      name: "Borrable",
      barcode: "8400000000001",
      brand: "Marca",
      minStock: 2,
      householdId,
    });

    const result = await api.product.update({
      id: product.id,
      barcode: null,
      minStock: null,
    });

    expect(result.barcode).toBeNull();
    expect(result.minStock).toBeNull();
    // Omitted, so untouched — null is a statement, absence is not.
    expect(result.brand).toBe("Marca");
  });

  it("is found by its barcode, exactly, as well as by part of its name", async () => {
    await createTestProduct({
      name: "Leche entera",
      barcode: "8410000000123",
      householdId,
    });
    await createTestProduct({ name: "Pan", householdId });

    const names = async (search: string) =>
      (await api.product.list({ search })).products.map((p) => p.name);

    expect(await names("8410000000123")).toEqual(["Leche entera"]);
    // Exactly, not as a fragment: part of a code is not a product.
    expect(await names("84100000")).toEqual([]);
    expect(await names("lech")).toEqual(["Leche entera"]);

    const scanned = await api.product.getByBarcode({
      barcode: "8410000000123",
    });
    expect(scanned?.name).toBe("Leche entera");
    expect(await api.product.getByBarcode({ barcode: "8410000000999" })).toBe(
      null,
    );
  });
});

describe("the product list", () => {
  it("pages by cursor, and hands one back only while there is more", async () => {
    const other = await createTestHousehold({ name: `${HOUSEHOLD} pages` });
    const owner = await prisma.user.create({
      data: {
        email: `catalogue-pages-${Date.now()}@example.com`,
        name: "Catalogue Pages",
        householdId: other.id,
        role: "OWNER",
      },
    });
    const pages = appRouter.createCaller(
      await createTRPCContext({ session: createMockSession(owner) }),
    );

    try {
      const empty = await pages.product.list({ limit: 2 });
      expect(empty.products).toEqual([]);
      expect(empty.nextCursor).toBeUndefined();

      for (const name of ["Aceite", "Bacalao", "Cebolla"]) {
        await createTestProduct({ name, householdId: other.id });
      }

      const first = await pages.product.list({ limit: 2 });
      expect(first.products.map((p) => p.name)).toEqual(["Aceite", "Bacalao"]);
      expect(first.nextCursor).toBeDefined();

      const second = await pages.product.list({
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(second.products.map((p) => p.name)).toEqual(["Cebolla"]);
      expect(second.nextCursor).toBeUndefined();
    } finally {
      await prisma.product.deleteMany({ where: { householdId: other.id } });
      await prisma.user.deleteMany({ where: { id: owner.id } });
      await prisma.household.deleteMany({ where: { id: other.id } });
    }
  });
});

describe("a shop", () => {
  it("comes back from create with its address", async () => {
    const store = await api.store.create({
      name: "Mercado de Abastos",
      address: "Calle Mayor 1",
    });

    expect([store.name, store.address]).toEqual([
      "Mercado de Abastos",
      "Calle Mayor 1",
    ]);
  });

  it("is listed by name, and found by part of it whatever its case", async () => {
    for (const name of ["Eroski", "Alcampo", "Supermercado Dia"]) {
      await prisma.store.create({ data: { name, householdId } });
    }

    const all = (await api.store.list({ limit: 100 })).map((s) => s.name);
    expect(all).toEqual(
      expect.arrayContaining(["Alcampo", "Eroski", "Supermercado Dia"]),
    );
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));

    const found = await api.store.list({ search: "DIA", limit: 100 });
    expect(found.map((s) => s.name)).toEqual(["Supermercado Dia"]);
  });
});
