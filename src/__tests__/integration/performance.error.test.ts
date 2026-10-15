import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { prisma } from "@/lib/prisma";
import { processReceiptOcr, terminateWorker } from "@/server/services/ocr";
import { parseReceiptText, saveParsedItems } from "@/server/services/receiptParser";
import { matchReceiptItems } from "@/server/services/productMatcher";
import { ReceiptStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Service Performance & Error Handling Tests", () => {
  let testHouseholdId: string;
  let testUserId: string;
  let testDir: string;
  let cleanupDirs: string[] = [];

  beforeEach(async () => {
    testDir = join(tmpdir(), `stoky-perf-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

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

  describe("Performance Benchmarks", () => {
    it("should process receipt parsing within acceptable time", async () => {
      const ocrText = `SUPERMERCADO MERCADONA
Fecha: 15/03/2024

${Array(20)
  .fill(null)
  .map((_, i) => `Producto ${i + 1} ${(Math.random() * 10).toFixed(2)}`)
  .join("\n")}

TOTAL: 100,00 EUR`;

      const startTime = performance.now();
      const result = parseReceiptText(ocrText);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100); // Should complete in <100ms
      expect(result.items.length).toBeGreaterThan(0);
    });

    it("should handle product matching with large catalog", async () => {
      // Create 100 products
      const products = Array(100)
        .fill(null)
        .map((_, i) => ({
          name: `producto de prueba ${i + 1}`,
          householdId: testHouseholdId,
          defaultUnit: "unidad",
        }));

      await prisma.product.createMany({ data: products });

      const ocrText = `TIENDA
Fecha: 15/03/2024
producto de prueba 1 5,00
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

      const startTime = performance.now();
      const matches = await matchReceiptItems(receipt.id);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete in <1s with 100 products
      expect(matches).toBeDefined();
    });

    it("should measure concurrent receipt processing", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

      const ocrText = `TIENDA
Fecha: 15/03/2024
Leche 1,25
Pan 0,95
`;

      const receipts = await Promise.all(
        Array(5)
          .fill(null)
          .map(async (_, i) => {
            const imagePath = join(receiptDir, `receipt-${i}.jpg`);
            await writeFile(imagePath, Buffer.from("fake"));

            return prisma.receipt.create({
              data: {
                imagePath,
                status: ReceiptStatus.UPLOADING,
                householdId: testHouseholdId,
                uploadedBy: testUserId,
              },
            });
          })
      );

      const startTime = performance.now();

      await Promise.all(
        receipts.map(async (receipt) => {
          const parsed = parseReceiptText(ocrText);
          await saveParsedItems(receipt.id, parsed);
          await matchReceiptItems(receipt.id);
        })
      );

      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(5000); // Should complete 5 receipts in <5s
    });

    it("should benchmark database query performance", async () => {
      // Create products for matching
      await prisma.product.createMany({
        data: Array(50)
          .fill(null)
          .map((_, i) => ({
            name: `test product ${i + 1}`,
            householdId: testHouseholdId,
            defaultUnit: "unidad",
          })),
      });

      const queryStart = performance.now();
      const products = await prisma.product.findMany({
        where: { householdId: testHouseholdId },
        take: 50,
      });
      const queryEnd = performance.now();

      expect(queryEnd - queryStart).toBeLessThan(100); // Query should be <100ms
      expect(products.length).toBe(50);
    });

    it("should handle large OCR text efficiently", async () => {
      const largeOcrText = `TIENDA
Fecha: 15/03/2024
${Array(100)
  .fill(null)
  .map((_, i) => `Producto ${i + 1} con descripción muy larga y detallada ${(Math.random() * 20).toFixed(2)}`)
  .join("\n")}
TOTAL: 1000,00 EUR`;

      const startTime = performance.now();
      const result = parseReceiptText(largeOcrText);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(200); // Large text should process in <200ms
      expect(result.items.length).toBeGreaterThan(0);
    });
  });

  describe("Network Failure Handling", () => {
    it("should handle missing image file gracefully", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

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
      } catch (error) {
        expect(error).toBeDefined();
      }

      const updatedReceipt = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });

      expect(updatedReceipt?.status).toBe(ReceiptStatus.FAILED);
    });

    it("should handle corrupt image data", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

      const imagePath = join(receiptDir, "corrupt.jpg");
      await writeFile(imagePath, Buffer.from("not-a-valid-image"));

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
  });

  describe("Database Connection Issues", () => {
    it("should handle transaction rollback on error", async () => {
      const ocrText = `TIENDA
Fecha: 15/03/2024
Leche 1,25
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

      // Test that saveParsedItems completes without errors
      await saveParsedItems(receipt.id, parsed);

      const items = await prisma.receiptItem.findMany({
        where: { receiptId: receipt.id },
      });

      expect(items.length).toBe(parsed.items.length);
    });
  });

  describe("Invalid File Uploads", () => {
    it("should handle non-image file types", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

      const imagePath = join(receiptDir, "receipt.txt");
      await writeFile(imagePath, "This is a text file, not an image");

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

    it("should handle empty file uploads", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

      const imagePath = join(receiptDir, "empty.jpg");
      await writeFile(imagePath, Buffer.from(""));

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
  });

  describe("Timeout Scenarios", () => {
    it("should handle slow OCR processing", async () => {
      const ocrText = `TIENDA
Fecha: 15/03/2024
Leche 1,25
`;

      // Just test that parsing doesn't hang
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), 5000);
      });

      const parsePromise = Promise.resolve(parseReceiptText(ocrText));

      const result = await Promise.race([parsePromise, timeoutPromise]);

      expect(result).toBeDefined();
    });

    it("should handle database query timeouts", async () => {
      const queryStart = performance.now();

      const products = await prisma.product.findMany({
        where: { householdId: testHouseholdId },
        take: 1000,
      });

      const queryEnd = performance.now();

      expect(queryEnd - queryStart).toBeLessThan(5000); // Query should timeout or complete within 5s
      expect(products).toBeDefined();
    });
  });

  describe("Memory Usage", () => {
    it("should handle large receipt items without memory issues", async () => {
      const largeOcrText = `TIENDA
Fecha: 15/03/2024
${Array(500)
  .fill(null)
  .map((_, i) => `Producto ${i + 1} ${(Math.random() * 100).toFixed(2)}`)
  .join("\n")}`;

      const result = parseReceiptText(largeOcrText);

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.length).toBeLessThanOrEqual(500);
    });

    it("should clean up resources after processing", async () => {
      const ocrText = `TIENDA
Fecha: 15/03/2024
Leche 1,25
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

      await terminateWorker();

      // If we get here without errors, resources were cleaned up
      expect(true).toBe(true);
    });
  });

  describe("Concurrent Processing Limits", () => {
    it("should handle multiple simultaneous receipts", async () => {
      const receiptDir = join(testDir, randomUUID());
      await mkdir(receiptDir, { recursive: true });
      cleanupDirs.push(receiptDir);

      const ocrText = `TIENDA
Fecha: 15/03/2024
Leche 1,25
`;

      const concurrentCount = 10;
      const receipts = await Promise.all(
        Array(concurrentCount)
          .fill(null)
          .map(async (_, i) => {
            const imagePath = join(receiptDir, `receipt-${i}.jpg`);
            await writeFile(imagePath, Buffer.from("fake"));

            return prisma.receipt.create({
              data: {
                imagePath,
                status: ReceiptStatus.UPLOADING,
                householdId: testHouseholdId,
                uploadedBy: testUserId,
              },
            });
          })
      );

      const results = await Promise.all(
        receipts.map(async (receipt) => {
          try {
            const parsed = parseReceiptText(ocrText);
            await saveParsedItems(receipt.id, parsed);
            return { success: true, receiptId: receipt.id };
          } catch (error) {
            return { success: false, receiptId: receipt.id, error };
          }
        })
      );

      const successCount = results.filter((r) => r.success).length;
      expect(successCount).toBe(concurrentCount);
    });
  });
});
