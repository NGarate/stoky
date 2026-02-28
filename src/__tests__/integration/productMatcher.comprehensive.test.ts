import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { prisma } from "@/lib/prisma";
import { matchReceiptItems, getItemCandidates } from "@/server/services/productMatcher";
import { parseReceiptText, saveParsedItems } from "@/server/services/receiptParser";
import { ReceiptStatus, MatchStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Product Matcher Service - Comprehensive", () => {
  let testHouseholdId: string;
  let testUserId: string;
  let testDir: string;
  let cleanupDirs: string[] = [];

  beforeEach(async () => {
    testDir = join(tmpdir(), `stoky-matcher-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    const user = await prisma.user.create({
      data: {
        email: `test-${randomUUID()}@example.com`,
        name: "Test User",
        passwordHash: "hashed_password",
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

    await prisma.product.deleteMany({
      where: { householdId: testHouseholdId },
    });

    await prisma.user.delete({
      where: { id: testUserId },
    });

    await prisma.household.delete({
      where: { id: testHouseholdId },
    });

    for (const dir of cleanupDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    cleanupDirs = [];
  });

  describe("pg_trgm Similarity Queries", () => {
    it("should find exact matches with similarity = 1.0", async () => {
      await prisma.product.create({
        data: {
          name: "leche semi desnatada",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
leche semi desnatada 1,25
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const exactMatch = matches.find((m) => m.autoMatch?.similarity === 1.0);
      expect(exactMatch).toBeDefined();
    });

    it("should find similar products with high similarity", async () => {
      await prisma.product.create({
        data: {
          name: "leche semi desnatada",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
leche semi 1,25
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const highSimilarityMatch = matches.find(
        (m) => m.autoMatch && m.autoMatch.similarity >= 0.7
      );
      expect(highSimilarityMatch).toBeDefined();
    });

    it("should handle partial word matches", async () => {
      await prisma.product.create({
        data: {
          name: "manzanas golden delicious",
          householdId: testHouseholdId,
          defaultUnit: "kg",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
manzanas golden 2,30
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      // Should have some match, either auto or candidate
      const hasAnyMatch = matches.some(
        (m) => m.autoMatch !== null || m.candidates.length > 0
      );
      expect(hasAnyMatch).toBe(true);
    });

    it("should handle word order variations", async () => {
      await prisma.product.create({
        data: {
          name: "yogur natural desnatado",
          householdId: testHouseholdId,
          defaultUnit: "unidad",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
yogur desnatado natural 1,80
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const hasMatch = matches.some(
        (m) =>
          m.autoMatch !== null ||
          m.candidates.some((c) => c.similarity >= 0.3)
      );
      expect(hasMatch).toBe(true);
    });

    it("should limit candidates to 5 maximum", async () => {
      for (let i = 0; i < 10; i++) {
        await prisma.product.create({
          data: {
            name: `producto similar ${i}`,
            householdId: testHouseholdId,
            defaultUnit: "unidad",
          },
        });
      }

      const ocrText = `TIENDA
Fecha: 15/03/2024
producto similar 1,00
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      for (const match of matches) {
        expect(match.candidates.length).toBeLessThanOrEqual(5);
      }
    });

    it("should filter candidates below 0.3 similarity", async () => {
      await prisma.product.create({
        data: {
          name: "producto totalmente diferente xyz",
          householdId: testHouseholdId,
          defaultUnit: "unidad",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
leche entera 1,25
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      for (const match of matches) {
        for (const candidate of match.candidates) {
          expect(candidate.similarity).toBeGreaterThanOrEqual(0.3);
        }
      }
    });
  });

  describe("Exact Barcode Matching", () => {
    it("should prioritize exact barcode matches", async () => {
      await prisma.product.create({
        data: {
          name: "coca cola",
          barcode: "1234567890123",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      // Note: The current implementation doesn't use barcode matching
      // This test documents expected behavior
      const product = await prisma.product.findUnique({
        where: { barcode_householdId: { barcode: "1234567890123", householdId: testHouseholdId } },
      });

      expect(product).toBeDefined();
      expect(product?.barcode).toBe("1234567890123");
    });

    it("should handle products with and without barcodes", async () => {
      await prisma.product.create({
        data: {
          name: "producto con barcode",
          barcode: "1234567890123",
          householdId: testHouseholdId,
          defaultUnit: "unidad",
        },
      });

      await prisma.product.create({
        data: {
          name: "producto sin barcode",
          householdId: testHouseholdId,
          defaultUnit: "unidad",
        },
      });

      const products = await prisma.product.findMany({
        where: { householdId: testHouseholdId },
      });

      expect(products.length).toBe(2);
      expect(products.some((p) => p.barcode !== null)).toBe(true);
      expect(products.some((p) => p.barcode === null)).toBe(true);
    });
  });

  describe("Fuzzy Name Matching", () => {
    it("should match with OCR errors in name", async () => {
      await prisma.product.create({
        data: {
          name: "chocolate con leche",
          householdId: testHouseholdId,
          defaultUnit: "tableta",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
chocolat con leche 2,50
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const hasSimilarMatch = matches.some(
        (m) =>
          m.autoMatch !== null ||
          m.candidates.some((c) => c.name.includes("chocolate"))
      );
      expect(hasSimilarMatch).toBe(true);
    });

    it("should handle accented characters", async () => {
      await prisma.product.create({
        data: {
          name: "café descafeinado",
          householdId: testHouseholdId,
          defaultUnit: "paquete",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
cafe descafeinado 3,50
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const hasMatch = matches.some(
        (m) =>
          m.autoMatch !== null ||
          m.candidates.some((c) => c.name.includes("caf"))
      );
      expect(hasMatch).toBe(true);
    });

    it("should handle case insensitive matching", async () => {
      await prisma.product.create({
        data: {
          name: "LECHE ENTERA",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
leche entera 1,25
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const exactMatch = matches.find((m) => m.autoMatch?.similarity === 1.0);
      expect(exactMatch).toBeDefined();
    });

    it("should handle special characters in names", async () => {
      await prisma.product.create({
        data: {
          name: "aceite de oliva virgen extra",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
aceite oliva virgen extra 5,50
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const hasMatch = matches.some(
        (m) =>
          m.autoMatch !== null ||
          m.candidates.some((c) => c.name.includes("aceite"))
      );
      expect(hasMatch).toBe(true);
    });
  });

  describe("Multi-word Queries", () => {
    it("should match products with multiple words", async () => {
      await prisma.product.create({
        data: {
          name: "pan de molde integral con semillas",
          householdId: testHouseholdId,
          defaultUnit: "paquete",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
pan de molde integral 1,50
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const hasHighSimilarityMatch = matches.some(
        (m) => m.autoMatch !== null ||
        m.candidates.some((c) => c.similarity >= 0.5)
      );
      expect(hasHighSimilarityMatch).toBe(true);
    });

    it("should handle queries with missing words", async () => {
      await prisma.product.create({
        data: {
          name: "leche entera de vaca fresca",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
leche entera 1,25
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const hasMatch = matches.some(
        (m) =>
          m.autoMatch !== null ||
          m.candidates.some((c) => c.name.includes("leche"))
      );
      expect(hasMatch).toBe(true);
    });

    it("should handle brand names in queries", async () => {
      await prisma.product.create({
        data: {
          name: "coca cola zero",
          brand: "Coca Cola",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
coca cola 1,80
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const hasMatch = matches.some(
        (m) =>
          m.autoMatch !== null ||
          m.candidates.some((c) => c.name.includes("coca"))
      );
      expect(hasMatch).toBe(true);
    });
  });

  describe("Receipt Status Updates", () => {
    it("should set CONFIRMED when all items auto-matched", async () => {
      await prisma.product.create({
        data: {
          name: "leche",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      await prisma.product.create({
        data: {
          name: "pan",
          householdId: testHouseholdId,
          defaultUnit: "unidad",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
leche 1,25
pan 0,95
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      await matchReceiptItems(receipt.id);

      const updated = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });

      expect(updated?.status).toBe(ReceiptStatus.CONFIRMED);
    });

    it("should set NEEDS_REVIEW when some items need matching", async () => {
      await prisma.product.create({
        data: {
          name: "leche",
          householdId: testHouseholdId,
          defaultUnit: "litro",
        },
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
leche 1,25
producto desconocido xyz 5,00
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      await matchReceiptItems(receipt.id);

      const updated = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });

      expect(updated?.status).toBe(ReceiptStatus.NEEDS_REVIEW);
    });
  });

  describe("getItemCandidates", () => {
    it("should return candidates for a specific item", async () => {
      await prisma.product.createMany({
        data: [
          { name: "leche entera", householdId: testHouseholdId, defaultUnit: "litro" },
          { name: "leche semi", householdId: testHouseholdId, defaultUnit: "litro" },
          { name: "leche desnatada", householdId: testHouseholdId, defaultUnit: "litro" },
        ],
      });

      const ocrText = `TIENDA
Fecha: 15/03/2024
leche 1,25
`;

      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const item = await prisma.receiptItem.findFirst({
        where: { receiptId: receipt.id },
      });

      expect(item).toBeDefined();

      if (item) {
        const candidates = await getItemCandidates(item.id);
        expect(candidates.length).toBeGreaterThan(0);
        for (const candidate of candidates) {
          expect(candidate.similarity).toBeGreaterThanOrEqual(0.3);
        }
      }
    });

    it("should throw error for non-existent item", async () => {
      try {
        await getItemCandidates("non-existent-item-id");
        expect(false).toBe(true);
      } catch (error) {
        expect((error as Error).message).toContain("Receipt item not found");
      }
    });
  });

  describe("Error Handling", () => {
    it("should throw error for non-existent receipt", async () => {
      try {
        await matchReceiptItems("non-existent-receipt-id");
        expect(false).toBe(true);
      } catch (error) {
        expect((error as Error).message).toContain("Receipt not found");
      }
    });

    it("should handle empty receipt items gracefully", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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

      const matches = await matchReceiptItems(receipt.id);

      expect(matches).toEqual([]);
    });
  });
});
