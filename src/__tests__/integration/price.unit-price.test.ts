import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";

/**
 * A `PriceRecord`'s `price` is what was paid for `quantity` units: the receipt
 * pipeline writes the line total with the parsed quantity, and `addStock`'s
 * hint says "Lo que has pagado en total por esta cantidad". Ranking the raw
 * `price` made a six-pack at 5,34 € look five times dearer than one carton at
 * 0,99 €. The server now hands every reader the unit price, computed once.
 */

const OWNER = { userId: "", householdId: "" };
let productId = "";
let mercadona = "";
let carrefour = "";
let dia = "";

async function caller() {
  const session: Session = {
    user: {
      id: OWNER.userId,
      email: "unit-price@example.com",
      name: "Unit Price",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

beforeAll(async () => {
  const household = await prisma.household.create({ data: { name: "Unit price household" } });
  const user = await prisma.user.create({
    data: {
      email: `unit-price-${Date.now()}@example.com`,
      name: "Unit Price",
      passwordHash: "not-used",
      householdId: household.id,
      role: "OWNER",
    },
  });
  OWNER.userId = user.id;
  OWNER.householdId = household.id;

  productId = (await prisma.product.create({
    data: { name: "Leche", defaultUnit: "unidad", householdId: household.id },
  })).id;
  mercadona = (await prisma.store.create({ data: { name: "Mercadona", householdId: household.id } })).id;
  carrefour = (await prisma.store.create({ data: { name: "Carrefour", householdId: household.id } })).id;
  dia = (await prisma.store.create({ data: { name: "Dia", householdId: household.id } })).id;

  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  await prisma.priceRecord.createMany({
    data: [
      // Six for 5,34 € is 0,89 € each.
      { productId, storeId: mercadona, price: 5.34, quantity: 6, unit: "unidad", recordedAt: at(10) },
      { productId, storeId: carrefour, price: 0.99, quantity: 1, unit: "unidad", recordedAt: at(10) },
      // A row no comparison can use, written before validation refused it.
      // Dia's older, valid sighting is the one to report.
      { productId, storeId: dia, price: 0.95, quantity: 1, unit: "unidad", recordedAt: at(20) },
      { productId, storeId: dia, price: 1, quantity: 0, unit: "unidad", recordedAt: at(5) },
    ],
  });
});

afterAll(async () => {
  await prisma.priceRecord.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.store.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.user.deleteMany({ where: { id: OWNER.userId } });
  await prisma.household.deleteMany({ where: { id: OWNER.householdId } });
  await prisma.$disconnect();
});

describe("price.getLatestPrices", () => {
  it("carries the unit price, so the six-pack is the cheaper buy", async () => {
    const api = await caller();
    const latest = await api.price.getLatestPrices({ productId });
    const byStore = new Map(latest.map((row) => [row.store.name, row]));

    expect(byStore.get("Mercadona")?.unitPrice).toBeCloseTo(0.89, 10);
    expect(byStore.get("Carrefour")?.unitPrice).toBeCloseTo(0.99, 10);
  });

  it("skips a sighting with no usable quantity and keeps the store's last good one", async () => {
    const api = await caller();
    const latest = await api.price.getLatestPrices({ productId });
    const diaRow = latest.find((row) => row.store.name === "Dia");

    expect(diaRow?.quantity).toBe(1);
    expect(diaRow?.unitPrice).toBeCloseTo(0.95, 10);
  });
});

describe("price.getHistory", () => {
  it("carries the unit price and leaves out rows with no usable quantity", async () => {
    const api = await caller();
    const history = await api.price.getHistory({ productId, days: 30 });

    expect(history).toHaveLength(3);
    expect(history.every((row) => row.quantity > 0)).toBe(true);
    const pack = history.find((row) => row.store.name === "Mercadona");
    expect(pack?.unitPrice).toBeCloseTo(0.89, 10);
  });
});

describe("price.getProductPrices", () => {
  it("reports the last usable sighting with its unit price", async () => {
    const api = await caller();
    const [product] = (await api.price.getProductPrices({ search: "Leche" }))
      .filter((row) => row.id === productId);

    const last = product?.priceRecords[0];
    expect(last?.quantity).toBeGreaterThan(0);
    expect(last?.unitPrice).toBeCloseTo(last!.price / last!.quantity, 10);
  });
});
