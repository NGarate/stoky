import {
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
  afterEach,
  beforeAll,
} from "bun:test";
import { prisma } from "@/lib/prisma";
import {
  processReceiptOcr,
  sharedWorker,
  terminateWorker,
  timedRecogniser,
} from "@/server/services/ocr";
import {
  parseReceiptText,
  saveParsedItems,
} from "@/server/services/receiptParser";
import { matchReceiptItems } from "@/server/services/productMatcher";
import { failInterruptedReceipts } from "@/server/services/receipt-recovery";
import { ReceiptStatus, MatchStatus } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pngOf } from "../utils/png";
import { num } from "../utils/amount";

describe("OCR Pipeline Integration", () => {
  let testHouseholdId: string;
  let testUserId: string;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "stoky-ocr-test-"));
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-${randomUUID()}@example.com`,
        name: "Test User",
      },
    });
    testUserId = user.id;

    const household = await prisma.household.create({
      data: {
        name: "Test Household",
        members: {
          connect: { id: user.id },
        },
      },
    });
    testHouseholdId = household.id;
  });

  afterEach(async () => {
    await terminateWorker();

    const receipts = await prisma.receipt.findMany({
      where: { householdId: testHouseholdId },
    });

    for (const receipt of receipts) {
      await prisma.receiptItem.deleteMany({
        where: { receiptId: receipt.id },
      });
      await prisma.receipt.delete({
        where: { id: receipt.id },
      });
    }

    await prisma.store.deleteMany({
      where: { householdId: testHouseholdId },
    });

    await prisma.product.deleteMany({
      where: { householdId: testHouseholdId },
    });

    await prisma.user.delete({
      where: { id: testUserId },
    });

    await prisma.household.delete({
      where: { id: testHouseholdId },
    });
  });

  describe("Complete Pipeline - Valid Receipt", () => {
    it("should process receipt through full pipeline and extract items", async () => {
      const ocrText = `SUPERMERCADO MERCADONA
Calle Mayor 123, Madrid
Fecha: 15/03/2024

Leche semi desnatada 1L 1,25
Pan de molde integral 0,95
Huevos frescos docena 2,50
Manzanas Golden kg 2,30
Yogur natural pack 4 1,80

TOTAL: 8,80 EUR
Gracias por su compra`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imageBuffer = Buffer.from("fake-image-data");
      const imagePath = join(receiptDir, "receipt.jpg");
      await writeFile(imagePath, imageBuffer);

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      await prisma.receipt.update({
        where: { id: receipt.id },
        data: {
          rawOcrText: ocrText,
          status: ReceiptStatus.PARSED,
        },
      });

      const parsed = parseReceiptText(ocrText);
      expect(parsed.storeName).toBeDefined();
      expect(parsed.purchaseDate).toBeDefined();
      expect(parsed.totalAmount).toBe(8.8);
      expect(parsed.items.length).toBeGreaterThanOrEqual(3);

      await saveParsedItems(receipt.id, parsed);

      const savedReceipt = await prisma.receipt.findUnique({
        where: { id: receipt.id },
        include: { items: true },
      });

      expect(savedReceipt?.status).toBe(ReceiptStatus.PARSED);
      expect(savedReceipt?.items.length).toBe(parsed.items.length);
      expect(num(savedReceipt?.totalAmount)).toBe(parsed.totalAmount);
    });

    it("should handle multiple products with quantities", async () => {
      const ocrText = `CARREFOUR
Fecha: 20/04/2024

2x Leche entera 2,50
3x Yogur griego 4,50
1x Pan baguette 0,90
5x Agua mineral 5,00

TOTAL: 12,90 EUR`;

      const parsed = parseReceiptText(ocrText);

      const multiQuantityItems = parsed.items.filter(
        (item) => item.parsedQuantity && item.parsedQuantity > 1,
      );

      expect(multiQuantityItems.length).toBeGreaterThan(0);

      for (const item of multiQuantityItems) {
        expect(item.parsedQuantity).toBeGreaterThan(1);
        expect(item.parsedPrice).toBeGreaterThan(0);
        expect(item.parsedName).toBeDefined();
      }
    });
  });

  describe("Product Matching Pipeline", () => {
    it("should auto-match products with >0.7 similarity", async () => {
      const product = await prisma.product.create({
        data: {
          name: "leche semi desnatada",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024

Leche semi desnatada 1,25
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "receipt.jpg");
      await writeFile(imagePath, Buffer.from("fake"));

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      const parsed = parseReceiptText(ocrText);
      await saveParsedItems(receipt.id, parsed);

      const matches = await matchReceiptItems(receipt.id);

      const autoMatched = matches.filter((m) => m.autoMatch !== null);
      expect(autoMatched.length).toBeGreaterThan(0);

      for (const match of autoMatched) {
        if (match.autoMatch) {
          expect(match.autoMatch.similarity).toBeGreaterThanOrEqual(0.7);
        }
      }

      const savedItem = await prisma.receiptItem.findFirst({
        where: { receiptId: receipt.id },
      });

      expect(savedItem?.matchStatus).toBe(MatchStatus.AUTO_MATCHED);
      expect(savedItem?.matchedProductId).toBe(product.id);
    });

    it("should provide candidates for 0.3-0.7 similarity matches", async () => {
      const lecheEntera = await prisma.product.create({
        data: {
          name: "leche entera",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      await prisma.product.create({
        data: {
          name: "yogur natural",
          householdId: testHouseholdId,
          defaultUnit: "unidad",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024

Leche desnatada 1,25
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "receipt.jpg");
      await writeFile(imagePath, Buffer.from("fake"));

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      const parsed = parseReceiptText(ocrText);
      await saveParsedItems(receipt.id, parsed);

      const matches = await matchReceiptItems(receipt.id);

      // One line, not auto-matched, offered "leche entera" (they share
      // "leche") and not "yogur natural" (they share nothing). The assertions
      // used to sit inside `if (candidateMatches.length > 0)`, so a line with
      // no candidates at all passed.
      expect(matches).toHaveLength(1);
      expect(matches[0].autoMatch).toBeNull();
      expect(matches[0].candidates.map((c) => c.productId)).toEqual([
        lecheEntera.id,
      ]);
      expect(matches[0].candidates[0].similarity).toBeGreaterThanOrEqual(0.3);
      expect(matches[0].candidates[0].similarity).toBeLessThan(0.7);
    });

    it("should handle no match for products with <0.3 similarity", async () => {
      await prisma.product.create({
        data: {
          name: "manzanas golden",
          householdId: testHouseholdId,
          defaultUnit: "kg",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024

Producto completamente diferente xyz123 5,00
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "receipt.jpg");
      await writeFile(imagePath, Buffer.from("fake"));

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      const parsed = parseReceiptText(ocrText);
      await saveParsedItems(receipt.id, parsed);

      const matches = await matchReceiptItems(receipt.id);

      const noMatchItems = matches.filter(
        (m) => !m.autoMatch && m.candidates.length === 0,
      );

      expect(noMatchItems.length).toBeGreaterThan(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle non-existent receipt gracefully", async () => {
      try {
        await processReceiptOcr("non-existent-receipt-id");
        expect(false).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain("Receipt not found");
      }
    });

    it("fails a receipt OCR read no text from, instead of leaving it PARSED", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "receipt.png");
      await writeFile(imagePath, pngOf(60, 40));

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      // What tesseract returns for a blank page: whitespace.
      await expect(
        processReceiptOcr(receipt.id, async () => " \n\n "),
      ).rejects.toThrow("No text recognised");

      const updated = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });
      expect(updated?.status).toBe(ReceiptStatus.FAILED);
    });

    it("hands back the text and moves to PARSED when OCR reads some", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "receipt.png");
      await writeFile(imagePath, pngOf(60, 40));

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      const text = await processReceiptOcr(
        receipt.id,
        async () => "LECHE 1,25\n",
      );

      expect(text).toBe("LECHE 1,25\n");
      const updated = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });
      expect(updated?.status).toBe(ReceiptStatus.PARSED);
      expect(updated?.rawOcrText).toBe("LECHE 1,25\n");
    });

    it("moves to FAILED when recognition runs out of time", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "receipt.png");
      await writeFile(imagePath, pngOf(60, 40));

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      // The image tesseract cannot finish: a worker that never answers.
      let terminations = 0;
      const stuck = sharedWorker(async () => ({
        recognize: () => new Promise<{ data: { text: string } }>(() => {}),
        async terminate() {
          terminations += 1;
        },
      }));
      const ocr = processReceiptOcr(
        receipt.id,
        timedRecogniser(stuck, () => 50),
      ).then(
        () => "PARSED",
        (error: unknown) => (error as Error).message,
      );
      const guard = new Promise((resolve) =>
        setTimeout(() => resolve("still waiting"), 3000),
      );

      expect(await Promise.race([ocr, guard])).toBe(
        "OCR did not finish within 50 ms",
      );
      expect(terminations).toBe(1);
      const updated = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });
      expect(updated?.status).toBe(ReceiptStatus.FAILED);
    });

    it("should mark receipt as FAILED on OCR error", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "non-existent.jpg");

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      try {
        await processReceiptOcr(receipt.id);
      } catch {
        // Expected to fail
      }

      const updatedReceipt = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });

      expect(updatedReceipt?.status).toBe(ReceiptStatus.FAILED);
    });

    it("should handle empty OCR text gracefully", async () => {
      const ocrText = "";

      const parsed = parseReceiptText(ocrText);

      expect(parsed.items).toEqual([]);
      expect(parsed.storeName).toBeUndefined();
      expect(parsed.purchaseDate).toBeUndefined();
    });

    it("should handle receipt with no recognizable products", async () => {
      const ocrText = `TIENDA
Fecha: 15/03/2024

TOTAL: 0,00 EUR`;

      const parsed = parseReceiptText(ocrText);

      expect(parsed.items.length).toBe(0);
      expect(parsed.totalAmount).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle receipts with special characters", async () => {
      const ocrText = `SUPERMERCADO EL CORTE INGLÉS
Fecha: 15/03/2024

Café descafeinado 3,50
Caña de pescado 12,90
Jamón ibérico 45,00

TOTAL: 61,40 EUR`;

      const parsed = parseReceiptText(ocrText);

      expect(parsed.items.length).toBeGreaterThan(0);
      expect(parsed.storeName).toBeDefined();
    });

    it("should handle various date formats", async () => {
      const formats = [
        { text: "Fecha: 15/03/2024", description: "DD/MM/YYYY" },
        { text: "Fecha: 2024/03/15", description: "YYYY/MM/DD" },
        { text: "15-03-2024", description: "DD-MM-YYYY" },
        { text: "15032024", description: "DDMMYYYY" },
      ];

      for (const { text, description } of formats) {
        const ocrText = `TIENDA\n${text}\nProducto 1,00`;
        const date = parseReceiptText(ocrText).purchaseDate;

        // Every format must be read, and read as 15 March 2024 — the
        // assertion used to sit inside `if (parsed.purchaseDate)`, so a
        // format that was not read at all passed.
        expect({
          description,
          day: date?.getDate(),
          month: date?.getMonth(),
          year: date?.getFullYear(),
        }).toEqual({ description, day: 15, month: 2, year: 2024 });
      }
    });

    it("should handle receipts with different currency formats", async () => {
      const ocrText = `TIENDA
Producto A 1.25 EUR
Producto B 2,50 €
Producto C 3.75

TOTAL: 7,50 EUR`;

      const parsed = parseReceiptText(ocrText);

      expect(parsed.items.length).toBeGreaterThan(0);
      expect(parsed.totalAmount).toBeGreaterThan(0);
    });

    it("should skip header and footer lines", async () => {
      const ocrText = `FACTURA SIMPLIFICADA
NIF: B12345678
TIENDA: MERCADONA
Fecha: 15/03/2024
Hora: 14:30
Caja: 03
Operador: Juan

Leche 1,25
Pan 0,95

IVA 10%: 0,20
TOTAL: 2,40
GRACIAS POR SU COMPRA
Vuelva pronto`;

      const parsed = parseReceiptText(ocrText);

      const invalidItems = parsed.items.filter((item) =>
        /iva|total|factura|caja|hora|nif|operador/i.test(item.parsedName),
      );

      expect(invalidItems.length).toBe(0);
    });
  });

  describe("Data Persistence", () => {
    it("should persist receipt items to database", async () => {
      const ocrText = `TIENDA
Fecha: 15/03/2024

Leche 1,25
Pan 0,95
Huevos 2,50
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "receipt.jpg");
      await writeFile(imagePath, Buffer.from("fake"));

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      const parsed = parseReceiptText(ocrText);
      await saveParsedItems(receipt.id, parsed);

      const savedItems = await prisma.receiptItem.findMany({
        where: { receiptId: receipt.id },
      });

      expect(savedItems.length).toBe(parsed.items.length);

      for (let i = 0; i < parsed.items.length; i++) {
        const original = parsed.items[i];
        const saved = savedItems.find(
          (s) => s.parsedName === original.parsedName,
        );

        expect(saved).toBeDefined();
        expect(num(saved?.parsedPrice)).toBe(original.parsedPrice);
        expect(num(saved?.parsedQuantity)).toBe(original.parsedQuantity ?? 1);
        expect(saved?.rawText).toBe(original.rawText);
        expect(saved?.matchStatus).toBe(MatchStatus.PENDING);
      }
    });

    it("should update receipt status through pipeline stages", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "receipt.jpg");
      await writeFile(imagePath, Buffer.from("fake"));

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      expect(receipt.status).toBe(ReceiptStatus.UPLOADING);

      const ocrText = "TIENDA\nProducto 1,00";
      await prisma.receipt.update({
        where: { id: receipt.id },
        data: {
          rawOcrText: ocrText,
          status: ReceiptStatus.PARSED,
        },
      });

      let updated = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });
      expect(updated?.status).toBe(ReceiptStatus.PARSED);

      const parsed = parseReceiptText(ocrText);
      await saveParsedItems(receipt.id, parsed);

      await matchReceiptItems(receipt.id);

      updated = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });

      const isValidStatus =
        updated?.status === ReceiptStatus.CONFIRMED ||
        updated?.status === ReceiptStatus.NEEDS_REVIEW;
      expect(isValidStatus).toBe(true);
    });

    it("should create or link store when store name is found", async () => {
      const ocrText = `MERCADONA
Calle Principal 123
Fecha: 15/03/2024

Leche 1,25
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });

      const imagePath = join(receiptDir, "receipt.jpg");
      await writeFile(imagePath, Buffer.from("fake"));

      const receipt = await prisma.receipt.create({
        data: {
          imagePath,
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      const parsed = parseReceiptText(ocrText);
      await saveParsedItems(receipt.id, parsed);

      expect(parsed.storeName).toBeDefined();
    });
  });

  describe("Restart recovery", () => {
    // Dated well before anything else in the test database, so the sweep —
    // which is not scoped to a household, because a restart is not — cannot
    // reach another test's receipts, and the count below is this test's own.
    const startedAt = new Date("2001-01-01T00:00:00Z");
    const before = new Date("2000-06-01T00:00:00Z");
    const after = new Date("2001-01-01T00:00:01Z");

    async function receiptIn(status: ReceiptStatus, createdAt: Date) {
      return prisma.receipt.create({
        data: {
          imagePath: join(testDir, `${randomUUID()}.jpg`),
          status,
          createdAt,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });
    }

    it("fails the receipts a previous process left in flight, and nothing else", async () => {
      const stranded = await Promise.all([
        receiptIn(ReceiptStatus.UPLOADING, before),
        receiptIn(ReceiptStatus.PROCESSING, before),
        receiptIn(ReceiptStatus.PARSED, before),
      ]);
      const settled = await Promise.all(
        [
          ReceiptStatus.NEEDS_REVIEW,
          ReceiptStatus.CONFIRMED,
          ReceiptStatus.APPLIED,
        ].map((status) => receiptIn(status, before)),
      );
      // This process's own: created after it started, still being read.
      const current = await receiptIn(ReceiptStatus.PROCESSING, after);

      const failed = await failInterruptedReceipts(startedAt);

      expect(failed).toBe(3);
      const statusOf = async (id: string) =>
        (await prisma.receipt.findUniqueOrThrow({ where: { id } })).status;
      for (const receipt of stranded) {
        expect(await statusOf(receipt.id)).toBe(ReceiptStatus.FAILED);
      }
      for (const receipt of settled) {
        expect(await statusOf(receipt.id)).toBe(receipt.status);
      }
      expect(await statusOf(current.id)).toBe(ReceiptStatus.PROCESSING);
    });
  });
});
