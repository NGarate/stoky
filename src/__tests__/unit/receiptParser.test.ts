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

      expect(result.totalAmount).toBe(5);
    });

    it("takes the total after the discounts, not the subtotal before them", () => {
      const result = parseReceiptText(
        "LECHE 2,09\nSUBTOTAL 2,09\nDESCUENTO 0,50\nTOTAL 1,59",
      );

      expect(result.totalAmount).toBe(1.59);
    });

    it("does not read a total from a separated SUB TOTAL", () => {
      const result = parseReceiptText("LECHE 2,09\nSUB TOTAL 2,09");

      expect(result.totalAmount).toBeUndefined();
    });

    it("does not run a column header on into the first item's price", () => {
      const result = parseReceiptText(
        "Descripción P. Unit Importe\nPAN DE MOLDE 0,95\nLECHE 1,20\nTOTAL 2,15",
      );

      expect(result.totalAmount).toBe(2.15);
    });

    it("ignores the base-and-tax row that closes a tax summary", () => {
      const result = parseReceiptText(
        "PAN 8,80\nTOTAL (€) 8,80\nIVA BASE IMPONIBLE CUOTA\n10% 8,00 0,80\nTOTAL 8,00 0,80",
      );

      expect(result.totalAmount).toBe(8.8);
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

      expect(
        result.items.map(({ parsedName, parsedPrice, parsedQuantity }) => ({
          parsedName,
          parsedPrice,
          parsedQuantity,
        })),
      ).toEqual([
        { parsedName: "leche", parsedPrice: 2.5, parsedQuantity: 2 },
        { parsedName: "pan", parsedPrice: 3, parsedQuantity: 3 },
      ]);
    });

    it("reads a leading quantity and books the line total", () => {
      const result = parseReceiptText("2 LECHE ENTERA 0,89 1,78");

      expect(result.items).toEqual([
        {
          rawText: "2 LECHE ENTERA 0,89 1,78",
          parsedName: "leche entera",
          parsedPrice: 1.78,
          parsedQuantity: 2,
        },
      ]);
    });

    it("takes a leading 1 as the quantity column, not part of the name", () => {
      const [item] = parseReceiptText("1 PAN DE MOLDE 0,95").items;

      expect(item.parsedName).toBe("pan de molde");
      expect(item.parsedQuantity).toBe(1);
    });

    it("reads a trailing quantity that multiplies out to the line total", () => {
      const [item] = parseReceiptText("LECHE ENTERA 2 1,25 2,50").items;

      expect(item.parsedName).toBe("leche entera");
      expect(item.parsedPrice).toBe(2.5);
      expect(item.parsedQuantity).toBe(2);
    });

    it("leaves a pack size in the name instead of booking it as a quantity", () => {
      const [roll] = parseReceiptText("PAPEL HIGIENICO 12 3,50").items;
      const [pizza] = parseReceiptText("4 QUESOS PIZZA 2,50").items;

      expect(roll.parsedName).toBe("papel higienico 12");
      expect(roll.parsedQuantity).toBeUndefined();
      expect(pizza.parsedName).toBe("4 quesos pizza");
      expect(pizza.parsedQuantity).toBeUndefined();
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
      expect(result.items.map((item) => item.parsedName)).toEqual(["producto"]);
    });

    it("books none of the tax, payment, change or discount lines", () => {
      const result = parseReceiptText(
        [
          "PAN 1,00",
          "IVA 10% 8,00 0,80",
          "10% 8,00 0,80",
          "BASE IMPONIBLE 8,00",
          "ENTREGADO 5,00",
          "A DEVOLVER 4,11",
          "CAMBIO 4,00",
          "VISA 1,00",
          "CUPÓN -0,50",
          "LECHE 2X1 0,50-",
        ].join("\n"),
      );

      expect(result.items.map((item) => item.parsedName)).toEqual(["pan"]);
    });

    it("never books a negative line as a purchase", () => {
      const result = parseReceiptText("YOGUR 1,80\nPROMO YOGUR -0,60");

      expect(result.items).toHaveLength(1);
      expect(result.items[0].parsedPrice).toBe(1.8);
    });

    it("still reads a product whose name holds a header word", () => {
      const result = parseReceiptText("PAN 1,00\nGALLETAS CAJA 2,50");

      expect(result.items.map((item) => item.parsedName)).toEqual([
        "pan",
        "galletas caja",
      ]);
    });

    it("should handle various date formats", () => {
      const formats = [
        { text: "Fecha: 15/03/2024", expected: { day: 15, month: 2, year: 2024 } },
        { text: "15-03-2024", expected: { day: 15, month: 2, year: 2024 } },
        { text: "2024/03/15", expected: { day: 15, month: 2, year: 2024 } },
      ];

      for (const { text, expected } of formats) {
        const date = parseReceiptText(text).purchaseDate;
        expect({
          day: date?.getDate(),
          month: date?.getMonth(),
          year: date?.getFullYear(),
        }).toEqual(expected);
      }
    });

    it("does not read a three-digit year", () => {
      // The OCR cut the year short; this used to come out as 5 October 2202.
      const result = parseReceiptText("05/10/202\nPAN 1,00");

      expect(result.purchaseDate).toBeUndefined();
    });

    it("refuses a date in the future and tries the next one", () => {
      const now = new Date(2026, 9, 6, 12, 0);
      const result = parseReceiptText(
        "REF 05/10/2099\nFecha: 04/10/2026\nPAN 1,00",
        now,
      );

      expect(result.purchaseDate?.getFullYear()).toBe(2026);
      expect(result.purchaseDate?.getMonth()).toBe(9);
      expect(result.purchaseDate?.getDate()).toBe(4);
    });

    it("allows a day of slack for a till clock ahead of the server", () => {
      const now = new Date(2026, 9, 6, 12, 0);

      expect(parseReceiptText("07/10/2026", now).purchaseDate?.getDate()).toBe(7);
      expect(parseReceiptText("08/10/2026", now).purchaseDate).toBeUndefined();
    });
  });

  describe("store name", () => {
    it("does not find a known store inside another word", () => {
      for (const header of [
        "C/ AVDA. DIAGONAL 456",
        "MEDIA MARKT",
        "ASOC. CONSUMIDORES",
        "ESPARRAGOS DEL NORTE",
      ]) {
        expect(parseReceiptText(`${header}\nPAN 1,00`).storeName).toBeUndefined();
      }
    });

    it("finds a known store named as a word", () => {
      expect(parseReceiptText("SUPERMERCADOS DIA\nPAN 1,00").storeName).toBe("dia");
      expect(parseReceiptText("EL CORTE INGLÉS, S.A.\nPAN 1,00").storeName).toBe(
        "el corte ingles",
      );
      expect(parseReceiptText("CONSUM S. COOP\nPAN 1,00").storeName).toBe("consum");
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
