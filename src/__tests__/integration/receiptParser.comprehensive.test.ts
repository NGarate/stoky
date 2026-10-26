import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { prisma } from "@/lib/prisma";
import {
  parseReceiptText,
  saveParsedItems,
} from "@/server/services/receiptParser";
import { ReceiptStatus, MatchStatus } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Receipt Parser Service - Comprehensive", () => {
  let testHouseholdId: string;
  let testUserId: string;
  let testDir: string;
  let cleanupDirs: string[] = [];

  beforeEach(async () => {
    testDir = join(tmpdir(), `stoky-parser-test-${randomUUID()}`);
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

  describe("Receipt Format Variations", () => {
    it("should parse Mercadona receipt format", () => {
      const ocrText = `MERCADONA, S.A.
C/ PRINCIPAL, 123
46001 VALENCIA
TEL: 963123456

NIF: A-12345678

15/03/2024 14:30  OP: 123456

FACTURA SIMPLIFICADA: 1234-1234567890

Descripción P. Unit Importe
LECHE SEMI 1L 1,25
PAN DE MOLDE 0,95
HUEVOS FRESCOS DOCENA 2,50
MANZANAS GOLDEN KG 2,30
YOGUR NATURAL PACK 4 1,80

TOTAL (€) 8,80

TARJETA BANCARIA: **** **** **** 1234

IVA BASE IMPONIBLE CUOTA
10% 8,00 0,80

GRACIAS POR SU COMPRA`;

      const result = parseReceiptText(ocrText);

      expect(result.storeName?.toLowerCase()).toContain("mercadona");
      expect(result.purchaseDate?.getFullYear()).toBe(2024);
      expect(result.totalAmount).toBe(8.8);
      // Exactly the five products: not the header, not the card line, and not
      // the `10% 8,00 0,80` tax row, which used to become a product called "10".
      expect(
        result.items.map(({ parsedName, parsedPrice, parsedQuantity }) => ({
          parsedName,
          parsedPrice,
          parsedQuantity,
        })),
      ).toEqual([
        {
          parsedName: "leche semi 1l",
          parsedPrice: 1.25,
          parsedQuantity: undefined,
        },
        {
          parsedName: "pan de molde",
          parsedPrice: 0.95,
          parsedQuantity: undefined,
        },
        {
          parsedName: "huevos frescos docena",
          parsedPrice: 2.5,
          parsedQuantity: undefined,
        },
        {
          parsedName: "manzanas golden kg",
          parsedPrice: 2.3,
          parsedQuantity: undefined,
        },
        {
          parsedName: "yogur natural pack 4",
          parsedPrice: 1.8,
          parsedQuantity: undefined,
        },
      ]);
    });

    it("should parse Carrefour receipt format", () => {
      const ocrText = `CARREFOUR
HYPERMERCADO

C.C. NUEVO CENTRO
AVDA. PÍO XII, SN
46009 VALENCIA

CIF: A-12345678
Teléfono: 963 123 456

20/04/2024 18:45
TICKET: 123456789

Artículo Ud. Precio Total
========================================
LECHE ENTERA 2 1,25 2,50
PAN INTEGRAL 1 0,99 0,99
YOGUR GRIEGO 4 0,75 3,00
HUEVOS DOCENA 1 2,45 2,45

TOTAL COMPRA: 8,94 €`;

      const result = parseReceiptText(ocrText);

      expect(result.storeName?.toLowerCase()).toContain("carrefour");
      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });

    it("should parse DIA receipt format", () => {
      const ocrText = `SUPERMERCADOS DIA
Avda. Diagonal, 456
08001 Barcelona

NIF: A-87654321

Fecha: 10/03/2024
Hora: 10:15
Caja: 05
Ticket: 987654321

Producto Precio
Leche desnatada 1L 0,99
Pan de barra 0,60
Galletas maría 1,20
Refresco cola 2L 1,50

TOTAL: 4,29 €`;

      const result = parseReceiptText(ocrText);

      expect(result.storeName?.toLowerCase()).toContain("dia");
      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });

    it("should parse Lidl receipt format", () => {
      const ocrText = `LIDL SUPERMERCADO
Calle Alcalá, 789
28001 Madrid

CIF: A-56789123
Tel: 915 123 456

FECHA: 05/03/2024
HORA: 19:30

ARTÍCULO IMPORTE
Leche entera 1L 1,09
Pan de molde integral 0,89
Queso lonchas 200g 1,99
Papel higiénico pack 2,49

TOTAL A PAGAR: 6,46 EUR`;

      const result = parseReceiptText(ocrText);

      expect(result.storeName?.toLowerCase()).toContain("lidl");
      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });

    it("should parse El Corte Inglés receipt format", () => {
      const ocrText = `EL CORTE INGLÉS, S.A.
SUPERMERCADO

Plaza de España, s/n
28008 MADRID

CIF: A-12345678

12/03/2024 16:20

ARTÍCULO UNIDADES PRECIO
Jamón ibérico cebo 1 45,00
Queso manchego curado 1 18,50
Vino rioja crianza 1 12,90
Aceite oliva virgen extra 1 8,50

IMPORTE TOTAL: 84,90 €`;

      const result = parseReceiptText(ocrText);

      expect(result.storeName?.toLowerCase()).toContain("corte ingles");
      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });

    it("should handle ALDI receipt format", () => {
      const ocrText = `ALDI
Calle Mayor, 45
28013 Madrid

ALDI Stores España

18/03/2024 11:45

Item €
Milk whole 1L 0,95
Bread wholemeal 0,79
Eggs free range 2,10
Chicken breast 4,50

TOTAL € 8,34`;

      const result = parseReceiptText(ocrText);

      expect(result.storeName?.toLowerCase()).toContain("aldi");
      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Currency Handling", () => {
    it("should parse EUR with comma decimal separator", () => {
      const ocrText = `TIENDA
Leche 1,25
Pan 0,95
Total: 2,20 EUR`;

      const result = parseReceiptText(ocrText);

      expect(result.totalAmount).toBe(2.2);
      for (const item of result.items) {
        expect(item.parsedPrice).toBeGreaterThan(0);
      }
    });

    it("should parse EUR with dot decimal separator", () => {
      const ocrText = `TIENDA
Leche 1.25
Pan 0.95
Total: 2.20 EUR`;

      const result = parseReceiptText(ocrText);

      expect(result.totalAmount).toBe(2.2);
      for (const item of result.items) {
        expect(item.parsedPrice).toBeGreaterThan(0);
      }
    });

    it("should handle € symbol", () => {
      const ocrText = `TIENDA
Leche 1,25 €
Pan 0,95 €
Total: 2,20 €`;

      const result = parseReceiptText(ocrText);

      expect(result.totalAmount).toBe(2.2);
    });

    it("should handle mixed currency formats", () => {
      const ocrText = `TIENDA
Producto A 1.25 EUR
Producto B 2,50 EUR
Producto C 3.75
Producto D 4,00 €
Total: 11,50 EUR`;

      const result = parseReceiptText(ocrText);

      expect(result.totalAmount).toBe(11.5);
      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });

    it("should handle prices without currency indicators", () => {
      const ocrText = `TIENDA
Leche 1.25
Pan 0.95
Huevos 2.50
Total: 4.70`;

      const result = parseReceiptText(ocrText);

      expect(result.items.length).toBe(3);
      for (const item of result.items) {
        expect(item.parsedPrice).toBeGreaterThan(0);
      }
    });
  });

  describe("Date Extraction", () => {
    it("should parse DD/MM/YYYY format", () => {
      const ocrText = `TIENDA
Fecha: 15/03/2024
Producto 1,00`;

      const result = parseReceiptText(ocrText);

      expect(result.purchaseDate?.getDate()).toBe(15);
      expect(result.purchaseDate?.getMonth()).toBe(2);
      expect(result.purchaseDate?.getFullYear()).toBe(2024);
    });

    it("should parse YYYY/MM/DD format", () => {
      const ocrText = `TIENDA
Fecha: 2024/03/15
Producto 1,00`;

      const result = parseReceiptText(ocrText);

      expect(result.purchaseDate?.getFullYear()).toBe(2024);
    });

    it("should parse DD-MM-YYYY format", () => {
      const ocrText = `TIENDA
Fecha: 15-03-2024
Producto 1,00`;

      const result = parseReceiptText(ocrText);

      expect(result.purchaseDate?.getFullYear()).toBe(2024);
    });

    it("should parse DDMMYYYY format", () => {
      const ocrText = `TIENDA
15032024
Producto 1,00`;

      const result = parseReceiptText(ocrText);

      expect(result.purchaseDate?.getFullYear()).toBe(2024);
    });

    it("should handle two-digit year", () => {
      const ocrText = `TIENDA
Fecha: 15/03/24
Producto 1,00`;

      const result = parseReceiptText(ocrText);

      expect(result.purchaseDate?.getFullYear()).toBe(2024);
    });

    it("should handle date with time", () => {
      const ocrText = `TIENDA
Fecha: 15/03/2024 14:30:00
Producto 1,00`;

      const result = parseReceiptText(ocrText);

      expect(result.purchaseDate?.getFullYear()).toBe(2024);
    });
  });

  describe("Malformed OCR Text Handling", () => {
    it("should handle garbled text", () => {
      const ocrText = `asdf1234!@#$%^&*()
qwerty 9999

xyz!!! 12,34`;

      const result = parseReceiptText(ocrText);

      expect(result.items).toBeDefined();
    });

    it("should handle extremely long lines", () => {
      const ocrText = `TIENDA ${"A".repeat(500)} PRODUCTO 1,25
OTRO PRODUCTO CON NOMBRE MUY LARGO QUE OCUPA MUCHO ESPACIO 2,50`;

      const result = parseReceiptText(ocrText);

      expect(result.items.length).toBeGreaterThan(0);
    });

    it("should handle text with no line breaks", () => {
      const ocrText =
        "TIENDA Producto1 1,25 Producto2 2,50 Producto3 3,75 Total 7,50";

      const result = parseReceiptText(ocrText);

      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle duplicate prices in line", () => {
      const ocrText = `TIENDA
Producto especial 1,25 2,50
`;

      const result = parseReceiptText(ocrText);

      // Should handle gracefully, either extracting one or both
      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle prices that look like quantities", () => {
      const ocrText = `TIENDA
Producto 100 1,25
`;

      const result = parseReceiptText(ocrText);

      // 100 might be misinterpreted as price 1.00, ensure it's handled
      for (const item of result.items) {
        expect(item.parsedPrice).toBeGreaterThan(0);
      }
    });

    it("should handle OCR errors in store names", () => {
      const ocrText = `M3RCAD0NA
Producto 1,25`;

      const result = parseReceiptText(ocrText);

      // May or may not recognize the store name with OCR errors
      expect(result).toBeDefined();
    });

    it("should handle mixed languages", () => {
      const ocrText = `STORE TIENDA
Date/Fecha: 15/03/2024
Milk/Leche 1,25
Bread/Pan 0,95
Total: 2,20 EUR`;

      const result = parseReceiptText(ocrText);

      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle receipt with only total", () => {
      const ocrText = `TIENDA
TOTAL: 50,00 EUR`;

      const result = parseReceiptText(ocrText);

      expect(result.totalAmount).toBe(50);
      expect(result.items.length).toBe(0);
    });

    it("should handle items with zero price", () => {
      const ocrText = `TIENDA
Producto gratis 0,00
Producto normal 1,25`;

      const result = parseReceiptText(ocrText);

      const nonZeroItems = result.items.filter((item) => item.parsedPrice > 0);
      expect(nonZeroItems.length).toBeGreaterThan(0);
    });

    it("should handle very high prices", () => {
      const ocrText = `TIENDA
Producto premium 999,99
Producto exclusivo 1500,00`;

      const result = parseReceiptText(ocrText);

      // Very high prices should be filtered out or handled
      for (const item of result.items) {
        expect(item.parsedPrice).toBeLessThan(10000);
      }
    });

    it("should handle items with units in name", () => {
      const ocrText = `TIENDA
Leche 1L 1,25
Aceite 750ml 3,50
Harina 1kg 0,85`;

      const result = parseReceiptText(ocrText);

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      for (const item of result.items) {
        expect(item.parsedName).toBeDefined();
      }
    });

    it("should handle promotional items", () => {
      const ocrText = `TIENDA
Leche 2x1 2,50
Pan 3x2 2,00
Yogur promo 1,80`;

      const result = parseReceiptText(ocrText);

      expect(result.items.length).toBeGreaterThanOrEqual(2);
    });

    it("should handle discounted items", () => {
      const ocrText = `TIENDA
Producto regular 5,00
Descuento -1,00
Producto con dto 4,00`;

      const result = parseReceiptText(ocrText);

      // Should handle negative prices or discounts gracefully
      for (const item of result.items) {
        expect(item.parsedPrice).toBeGreaterThan(0);
      }
    });
  });

  describe("saveParsedItems", () => {
    it("should save items with correct status", async () => {
      const ocrText = `TIENDA
Fecha: 15/03/2024
Leche 1,25
Pan 0,95
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

      const items = await prisma.receiptItem.findMany({
        where: { receiptId: receipt.id },
      });

      for (const item of items) {
        expect(item.matchStatus).toBe(MatchStatus.PENDING);
        expect(item.parsedQuantity).toBeGreaterThanOrEqual(1);
      }
    });

    it("should handle items without quantities", async () => {
      const ocrText = `TIENDA
Leche 1,25
Pan 0,95
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

      const items = await prisma.receiptItem.findMany({
        where: { receiptId: receipt.id },
      });

      for (const item of items) {
        expect(item.parsedQuantity).toBe(1);
      }
    });

    it("should preserve raw text", async () => {
      const ocrText = `TIENDA
Leche semi desnatada 1L 1,25
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

      expect(item?.rawText).toContain("Leche");
    });

    it("keeps the store chosen at upload instead of the one the header names", async () => {
      const chosen = await prisma.store.create({
        data: { name: "Mi Mercadona", householdId: testHouseholdId },
      });

      const receipt = await prisma.receipt.create({
        data: {
          imagePath: join(testDir, "receipt.jpg"),
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
          storeId: chosen.id,
        },
      });

      await saveParsedItems(receipt.id, parseReceiptText("LIDL\nLeche 1,25"));

      const saved = await prisma.receipt.findUnique({
        where: { id: receipt.id },
      });
      expect(saved?.storeId).toBe(chosen.id);
      // And the header's guess was not created as a store on the side.
      const stores = await prisma.store.findMany({
        where: { householdId: testHouseholdId },
      });
      expect(stores.map((store) => store.id)).toEqual([chosen.id]);
    });

    it("files the receipt under the header's store when none was chosen", async () => {
      const receipt = await prisma.receipt.create({
        data: {
          imagePath: join(testDir, "receipt.jpg"),
          status: ReceiptStatus.UPLOADING,
          householdId: testHouseholdId,
          uploadedBy: testUserId,
        },
      });

      await saveParsedItems(receipt.id, parseReceiptText("LIDL\nLeche 1,25"));

      const saved = await prisma.receipt.findUnique({
        where: { id: receipt.id },
        include: { store: true },
      });
      expect(saved?.store?.name).toBe("lidl");
    });

    it("replaces the lines, so running twice is running once", async () => {
      const ocrText = `TIENDA
Leche 1,25
Pan 0,95
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
      await saveParsedItems(receipt.id, parsed);

      const count = await prisma.receiptItem.count({
        where: { receiptId: receipt.id },
      });
      // Not doubled: a second run over the same OCR text replaces the lines
      // it produced last time rather than appending a second copy of them.
      expect(count).toBe(parsed.items.length);
    });
  });
});
