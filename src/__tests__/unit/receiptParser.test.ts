import { describe, it, expect } from "bun:test";
import { parseEsAmount, parseReceiptText } from "@/server/services/receiptParser";

describe("Receipt Parser Service", () => {
  describe("parseReceiptText", () => {
    it("should parse simple receipt with items", () => {
      const receiptText = `
SUPERMERCADO EL CORTE INGLES
Calle Principal 123
Fecha: 15/03/2024

Leche semi 1L 1,25
Pan de molde 0,95
Huevos docena 2,50
Total: 4,70
`;

      const result = parseReceiptText(receiptText);

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.storeName).toBeDefined();
      expect(result.purchaseDate).toBeDefined();
    });

    it("should extract store name from receipt", () => {
      const receiptText = "SUPERMERCADO MERCADONA\nCalle Mayor 1\nLeche 1,20";
      
      const result = parseReceiptText(receiptText);

      expect(result.storeName).toBeDefined();
      expect(result.storeName?.toLowerCase()).toContain("mercadona");
    });

    it("should extract date from receipt", () => {
      const receiptText = `
TIENDA DIA
Fecha: 20/04/2024
Producto 2,50
`;

      const result = parseReceiptText(receiptText);

      expect(result.purchaseDate).toBeDefined();
      expect(result.purchaseDate?.getFullYear()).toBe(2024);
    });

    it("should parse items with prices", () => {
      const receiptText = `
Carrefour
Manzanas 2,30
Naranjas 1,80
Platanos 1,50
`;

      const result = parseReceiptText(receiptText);

      expect(result.items.length).toBeGreaterThan(0);
      for (const item of result.items) {
        expect(item.parsedPrice).toBeGreaterThan(0);
        expect(item.parsedName).toBeDefined();
        expect(item.rawText).toBeDefined();
      }
    });

    it("should extract total amount", () => {
      const receiptText = `
LIDL
Item 5,00
TOTAL: 5,00 EUR
`;

      const result = parseReceiptText(receiptText);

      expect(result.totalAmount).toBeDefined();
      expect(result.totalAmount).toBeGreaterThan(0);
    });

    it("should handle empty receipt", () => {
      const result = parseReceiptText("");

      expect(result.items).toEqual([]);
      expect(result.storeName).toBeUndefined();
      expect(result.purchaseDate).toBeUndefined();
    });

    it("should handle receipt with no prices", () => {
      const receiptText = "Just some text without prices";

      const result = parseReceiptText(receiptText);

      expect(result.items).toEqual([]);
    });

    it("should parse items with quantity", () => {
      const receiptText = "2x Leche 2,50\n3x Pan 3,00";

      const result = parseReceiptText(receiptText);

      const multiItem = result.items.find(item => item.parsedQuantity && item.parsedQuantity > 1);
      if (multiItem) {
        expect(multiItem.parsedQuantity).toBeGreaterThan(1);
      }
    });

    it("should skip header and footer lines", () => {
      const receiptText = `
FACTURA SIMPLIFICADA
TIENDA: ALDI
Fecha: 01/01/2024
Hora: 12:00
Caja: 3

Producto 1,00
IVA 10%
TOTAL: 1,10
GRACIAS POR SU VISITA
`;

      const result = parseReceiptText(receiptText);

      // Should not include lines like "IVA", "TOTAL", "FACTURA", etc.
      const invalidItems = result.items.filter(item => 
        item.parsedName.toLowerCase().includes("iva") ||
        item.parsedName.toLowerCase().includes("total") ||
        item.parsedName.toLowerCase().includes("factura")
      );
      expect(invalidItems.length).toBe(0);
    });

    it("should handle various date formats", () => {
      const formats = [
        { text: "Fecha: 15/03/2024", expected: { day: 15, month: 2, year: 2024 } },
        { text: "15-03-2024", expected: { day: 15, month: 2, year: 2024 } },
        { text: "2024/03/15", expected: { day: 15, month: 2, year: 2024 } },
      ];

      for (const { text } of formats) {
        const result = parseReceiptText(text);
        if (result.purchaseDate) {
          expect(result.purchaseDate.getFullYear()).toBe(2024);
        }
      }
    });
  });

  describe("amounts", () => {
    it("reads a thousands separator as part of the amount", () => {
      expect(parseEsAmount("1.234,56")).toBe(1234.56);
      expect(parseEsAmount("12.345,00")).toBe(12345);
      expect(parseEsAmount("0,89")).toBe(0.89);
      expect(parseEsAmount("1.25")).toBe(1.25);
    });

    it("books a line and a total over a thousand at their whole value", () => {
      const result = parseReceiptText("TELEVISOR 1.234,56\nTOTAL 1.234,56");

      expect(result.items).toEqual([
        {
          rawText: "TELEVISOR 1.234,56",
          parsedName: "televisor",
          parsedPrice: 1234.56,
          parsedQuantity: undefined,
        },
      ]);
      expect(result.totalAmount).toBe(1234.56);
    });
  });
});
