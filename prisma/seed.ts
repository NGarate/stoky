/**
 * Demo data seeder.
 *
 * Run with `bun run db:seed` (or `bash scripts/dev-local.sh --seed`).
 *
 * The dataset is shaped to exercise the journeys in `docs/SMOKE_JOURNEYS.md`:
 * an inventory with healthy, low and expiring stock; products below their
 * minimum so "generate from low stock" has something to find; and price history
 * across several stores and dates so the price drill-down renders a real chart.
 *
 * Re-running is safe: the demo household and everything hanging off it is
 * removed first, so the result is the same every time.
 */
import { PrismaClient, type StockOperation } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

const HOUSEHOLD_NAME = "Hogar Demo";
const DEMO_EMAIL = "demo@stoky.local";
const DEMO_PASSWORD = "Demo1234!";

/** Days from now, as a date. Negative for the past. */
function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

async function removeExistingDemoData(): Promise<void> {
  const household = await prisma.household.findFirst({
    where: { name: HOUSEHOLD_NAME },
    select: { id: true },
  });

  if (!household) return;

  const householdId = household.id;
  const products = await prisma.product.findMany({
    where: { householdId },
    select: { id: true },
  });
  const productIds = products.map((product) => product.id);

  // Deleted in foreign-key order, deepest first.
  await prisma.receiptItem.deleteMany({
    where: { receipt: { householdId } },
  });
  await prisma.receipt.deleteMany({ where: { householdId } });
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId } },
  });
  await prisma.shoppingList.deleteMany({ where: { householdId } });
  await prisma.stockEntry.deleteMany({
    where: { productId: { in: productIds } },
  });
  await prisma.priceRecord.deleteMany({
    where: { productId: { in: productIds } },
  });
  // Children before parents: StorageLocation is self-referential.
  await prisma.storageLocation.deleteMany({
    where: { householdId, parentId: { not: null } },
  });
  await prisma.storageLocation.deleteMany({ where: { householdId } });
  await prisma.store.deleteMany({ where: { householdId } });
  await prisma.product.deleteMany({ where: { householdId } });
  await prisma.user.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

async function main(): Promise<void> {
  await removeExistingDemoData();

  const household = await prisma.household.create({
    data: { name: HOUSEHOLD_NAME },
  });

  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Usuario Demo",
      passwordHash,
      locale: "es",
      role: "OWNER",
      householdId: household.id,
    },
  });

  // --- Storage locations (two levels, to exercise the location tree) -------
  const kitchen = await prisma.storageLocation.create({
    data: { name: "Cocina", householdId: household.id },
  });
  const pantry = await prisma.storageLocation.create({
    data: { name: "Despensa", householdId: household.id, parentId: kitchen.id },
  });
  const fridge = await prisma.storageLocation.create({
    data: { name: "Nevera", householdId: household.id, parentId: kitchen.id },
  });
  const cellar = await prisma.storageLocation.create({
    data: { name: "Trastero", householdId: household.id },
  });

  // --- Stores --------------------------------------------------------------
  const [mercadona, carrefour, lidl] = await Promise.all([
    prisma.store.create({
      data: {
        name: "Mercadona",
        address: "Calle Mayor 1",
        householdId: household.id,
      },
    }),
    prisma.store.create({
      data: {
        name: "Carrefour",
        address: "Avenida de la Constitución 45",
        householdId: household.id,
      },
    }),
    prisma.store.create({
      data: { name: "Lidl", householdId: household.id },
    }),
  ]);

  // --- Products ------------------------------------------------------------
  // `stock` entries sum to the product's current quantity; a sum below
  // `minStock` makes the product show as low stock and makes it a candidate
  // for the auto-generated shopping list.
  const catalogue = [
    {
      name: "Leche entera",
      brand: "Hacendado",
      category: "Lácteos",
      barcode: "8480000123456",
      defaultUnit: "L",
      minStock: 6,
      location: fridge.id,
      // 2 L against a minimum of 6 → low stock.
      stock: [{ quantity: 6, days: -20 }, { quantity: -4, days: -3 }],
      expiration: daysFromNow(5),
      prices: [
        { store: mercadona.id, price: 0.89, days: -60 },
        { store: mercadona.id, price: 0.95, days: -30 },
        { store: carrefour.id, price: 1.05, days: -30 },
        { store: lidl.id, price: 0.85, days: -10 },
        { store: mercadona.id, price: 0.99, days: -2 },
      ],
    },
    {
      name: "Arroz redondo",
      brand: "SOS",
      category: "Despensa",
      barcode: "8410000234567",
      defaultUnit: "kg",
      minStock: 2,
      location: pantry.id,
      stock: [{ quantity: 5, days: -45 }],
      expiration: daysFromNow(400),
      prices: [
        { store: mercadona.id, price: 1.35, days: -45 },
        { store: carrefour.id, price: 1.49, days: -20 },
        { store: lidl.id, price: 1.29, days: -5 },
      ],
    },
    {
      name: "Aceite de oliva virgen extra",
      brand: "Carbonell",
      category: "Despensa",
      barcode: "8410000345678",
      defaultUnit: "L",
      minStock: 2,
      location: pantry.id,
      // 1 L against a minimum of 2 → low stock.
      stock: [{ quantity: 3, days: -90 }, { quantity: -2, days: -15 }],
      expiration: daysFromNow(300),
      prices: [
        { store: mercadona.id, price: 8.45, days: -90 },
        { store: mercadona.id, price: 9.2, days: -45 },
        { store: carrefour.id, price: 9.75, days: -30 },
        { store: lidl.id, price: 8.99, days: -7 },
      ],
    },
    {
      name: "Huevos frescos",
      brand: null,
      category: "Frescos",
      barcode: "8480000456789",
      defaultUnit: "unidad",
      minStock: 12,
      location: fridge.id,
      stock: [{ quantity: 24, days: -6 }],
      // Expiring soon, for the expiring-items widget.
      expiration: daysFromNow(3),
      prices: [
        { store: mercadona.id, price: 2.15, days: -35 },
        { store: carrefour.id, price: 2.39, days: -6 },
      ],
    },
    {
      name: "Papel higiénico",
      brand: "Scottex",
      category: "Hogar",
      barcode: "8410000567890",
      defaultUnit: "paquete",
      minStock: 1,
      location: cellar.id,
      stock: [{ quantity: 3, days: -30 }],
      expiration: null,
      prices: [
        { store: carrefour.id, price: 6.49, days: -30 },
        { store: lidl.id, price: 5.99, days: -12 },
      ],
    },
    {
      name: "Café molido natural",
      brand: "Marcilla",
      category: "Desayuno",
      barcode: "8410000678901",
      defaultUnit: "paquete",
      minStock: 2,
      location: pantry.id,
      // Fully consumed → low stock at zero.
      stock: [{ quantity: 2, days: -50 }, { quantity: -2, days: -8 }],
      expiration: daysFromNow(180),
      prices: [
        { store: mercadona.id, price: 2.79, days: -50 },
        { store: lidl.id, price: 2.55, days: -8 },
      ],
    },
  ];

  const createdProducts: Array<{ id: string; name: string }> = [];

  for (const item of catalogue) {
    const product = await prisma.product.create({
      data: {
        name: item.name,
        brand: item.brand,
        category: item.category,
        barcode: item.barcode,
        defaultUnit: item.defaultUnit,
        minStock: item.minStock,
        householdId: household.id,
      },
    });
    createdProducts.push({ id: product.id, name: product.name });

    for (const entry of item.stock) {
      await prisma.stockEntry.create({
        data: {
          productId: product.id,
          quantity: entry.quantity,
          unit: item.defaultUnit,
          expirationDate: entry.quantity > 0 ? item.expiration : null,
          locationId: item.location,
          operationType: (entry.quantity > 0
            ? "PURCHASE"
            : "CONSUME") as StockOperation,
          createdBy: user.id,
          createdAt: daysFromNow(entry.days),
        },
      });
    }

    for (const price of item.prices) {
      await prisma.priceRecord.create({
        data: {
          productId: product.id,
          storeId: price.store,
          price: price.price,
          currency: "EUR",
          unit: item.defaultUnit,
          quantity: item.name === "Huevos frescos" ? 12 : 1,
          recordedAt: daysFromNow(price.days),
        },
      });
    }
  }

  // --- A manual shopping list ---------------------------------------------
  // The auto-generated list is intentionally left for the app to build, so the
  // "generate from low stock" journey has visible work to do.
  const weeklyList = await prisma.shoppingList.create({
    data: { name: "Compra semanal", householdId: household.id },
  });

  // Not in the catalogue above: this is the household writing down something
  // it has never bought, which is the case free text used to serve.
  const bulbs = await prisma.product.create({
    data: {
      name: "Bombillas LED",
      category: "Hogar",
      defaultUnit: "unidad",
      householdId: household.id,
    },
  });

  // Found rather than assumed, and asserted rather than defaulted: an item
  // without a product is no longer a row the database will take, so a seed
  // that silently wrote one would fail at the insert with nothing to read.
  const milk = createdProducts.find((p) => p.name === "Leche entera");
  const coffee = createdProducts.find((p) => p.name === "Café molido natural");
  if (!milk || !coffee) {
    throw new Error("Seed catalogue is missing a product the shopping list needs");
  }

  await prisma.shoppingItem.createMany({
    data: [
      {
        shoppingListId: weeklyList.id,
        productId: milk.id,
        quantity: 6,
        unit: "L",
        isChecked: false,
      },
      {
        shoppingListId: weeklyList.id,
        productId: coffee.id,
        quantity: 2,
        unit: "paquete",
        isChecked: true,
        checkedAt: daysFromNow(-1),
      },
      {
        shoppingListId: weeklyList.id,
        // A product created for the list rather than a name typed onto it:
        // free text stopped being a thing an item can be, and this is what
        // the add form does now — one step, and the household keeps something
        // it can price next time.
        productId: bulbs.id,
        quantity: 4,
        unit: "unidad",
        isChecked: false,
      },
    ],
  });

  // --- Two receipts, so the receipt routes exist at all --------------------
  //
  // Before this the seed deleted receipts and created none, which meant
  // `/receipts` was empty on every fresh install and in CI, and
  // `/receipts/[id]/review` and `/receipts/[id]/applied` were unreachable
  // through the interface. That is not a cosmetic gap: it is why the review
  // page's horizontal overflow at 390px (ISSUES UI-5) survived three responsive
  // sweeps — every one of them enumerated the static routes, and there was no
  // id to put in the dynamic one.
  //
  // Two, because the two states a reviewer meets are different pages: one still
  // needing decisions, one already confirmed and waiting to be applied. No
  // APPLIED receipt is seeded on purpose — reaching that state by pressing the
  // button is the journey worth keeping testable.
  // Looked up by name and then asserted, because `find` returns undefined for a
  // typo and Prisma accepts a null `matchedProductId` without complaint — the
  // fixture would quietly become "matched nothing", which is a different test.
  const eggs = createdProducts.find((p) => p.name === "Huevos frescos");
  const rice = createdProducts.find((p) => p.name === "Arroz redondo");
  for (const [label, product] of [
    ["Leche entera", milk],
    ["Huevos frescos", eggs],
    ["Arroz redondo", rice],
  ] as const) {
    if (!product) throw new Error(`Seed: no product named "${label}" to match a receipt line against.`);
  }

  const needsReview = await prisma.receipt.create({
    data: {
      imagePath: "seed/ticket-mercadona-pendiente.jpg",
      status: "NEEDS_REVIEW",
      storeId: mercadona.id,
      purchaseDate: daysFromNow(-3),
      totalAmount: 7.44,
      householdId: household.id,
      uploadedBy: user.id,
      processedAt: daysFromNow(-3),
      rawOcrText: [
        "MERCADONA S.A.",
        "LECHE ENTERA 1L        1,09",
        "ARROZ REDONDO 1KG      1,85",
        "HUEVOS FRESCOS 12U     3,20",
        "SERVILLETAS 100U       1,30",
        "TOTAL                  7,44",
      ].join("\n"),
    },
  });

  // One of each match outcome, so the review page has something to review: a
  // confident automatic match, a weak one worth a second look, and a line that
  // matched nothing and needs a product created.
  await prisma.receiptItem.createMany({
    data: [
      {
        receiptId: needsReview.id,
        rawText: "LECHE ENTERA 1L        1,09",
        parsedName: "Leche entera 1L",
        parsedPrice: 1.09,
        parsedQuantity: 1,
        matchedProductId: milk?.id ?? null,
        matchConfidence: 0.92,
        matchStatus: "AUTO_MATCHED",
      },
      {
        receiptId: needsReview.id,
        rawText: "ARROZ REDONDO 1KG      1,85",
        parsedName: "Arroz redondo 1kg",
        parsedPrice: 1.85,
        parsedQuantity: 1,
        matchedProductId: rice?.id ?? null,
        matchConfidence: 0.61,
        matchStatus: "PENDING",
      },
      {
        receiptId: needsReview.id,
        rawText: "HUEVOS FRESCOS 12U     3,20",
        parsedName: "Huevos frescos 12u",
        parsedPrice: 3.2,
        parsedQuantity: 1,
        matchedProductId: eggs?.id ?? null,
        matchConfidence: 0.88,
        matchStatus: "AUTO_MATCHED",
      },
      {
        receiptId: needsReview.id,
        rawText: "SERVILLETAS 100U       1,30",
        parsedName: "Servilletas 100u",
        parsedPrice: 1.3,
        parsedQuantity: 1,
        matchedProductId: null,
        matchConfidence: null,
        matchStatus: "PENDING",
      },
    ],
  });

  const confirmed = await prisma.receipt.create({
    data: {
      imagePath: "seed/ticket-lidl-confirmado.jpg",
      status: "CONFIRMED",
      storeId: lidl.id,
      purchaseDate: daysFromNow(-1),
      totalAmount: 3.94,
      householdId: household.id,
      uploadedBy: user.id,
      processedAt: daysFromNow(-1),
      rawOcrText: [
        "LIDL",
        "LECHE ENTERA 1L        1,09",
        "ARROZ REDONDO 1KG      1,85",
        "TOTAL                  3,94",
      ].join("\n"),
    },
  });

  await prisma.receiptItem.createMany({
    data: [
      {
        receiptId: confirmed.id,
        rawText: "LECHE ENTERA 1L        1,09",
        parsedName: "Leche entera 1L",
        parsedPrice: 1.09,
        parsedQuantity: 2,
        matchedProductId: milk?.id ?? null,
        matchConfidence: 0.95,
        matchStatus: "USER_CONFIRMED",
      },
      {
        receiptId: confirmed.id,
        rawText: "ARROZ REDONDO 1KG      1,85",
        parsedName: "Arroz redondo 1kg",
        parsedPrice: 1.85,
        parsedQuantity: 1,
        matchedProductId: rice?.id ?? null,
        matchConfidence: 0.9,
        matchStatus: "USER_CONFIRMED",
      },
    ],
  });

  const lowStock = ["Leche entera", "Aceite de oliva virgen extra", "Café molido natural"];

  console.log("Seed complete.");
  console.log(`  Household : ${HOUSEHOLD_NAME}`);
  console.log(`  Login     : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Products  : ${createdProducts.length} (${lowStock.length} below minimum)`);
  console.log(`  Low stock : ${lowStock.join(", ")}`);
  console.log("  Stores    : Mercadona, Carrefour, Lidl");
  console.log("  Receipts  : 2 (one needing review, one confirmed and ready to apply)");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
