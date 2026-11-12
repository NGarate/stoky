import { describe, it, expect } from "bun:test";
import {
  framedArticle,
  parseEsAmount,
  parseReceiptText,
} from "@/server/services/receiptParser";

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
      const invalidItems = result.items.filter(
        (item) =>
          item.parsedName.toLowerCase().includes("iva") ||
          item.parsedName.toLowerCase().includes("total") ||
          item.parsedName.toLowerCase().includes("factura"),
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

      // Not booked: taken off the yogurt, which is booked at what was paid.
      expect(result.items).toHaveLength(1);
      expect(result.items[0].parsedPrice).toBe(1.2);
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
        {
          text: "Fecha: 15/03/2024",
          expected: { day: 15, month: 2, year: 2024 },
        },
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

      expect(parseReceiptText("07/10/2026", now).purchaseDate?.getDate()).toBe(
        7,
      );
      expect(parseReceiptText("08/10/2026", now).purchaseDate).toBeUndefined();
    });
  });

  describe("the total label", () => {
    const now = new Date(2026, 10, 1);
    const parse = (text: string) => parseReceiptText(text, now);
    const names = (text: string) =>
      parse(text).items.map((item) => [item.parsedName, item.parsedPrice]);

    it("reads Alcampo's TOT as the total and books nothing after it", () => {
      const result = parse("1 LECHE 0,89\n- TOT 8,07\nNA 2.00 E O");

      expect(result.totalAmount).toBe(8.07);
      expect(names("1 LECHE 0,89\n- TOT 8,07\nNA 2.00 E O")).toEqual([
        ["leche", 0.89],
      ]);
    });

    it("keeps a product whose name starts with TOT", () => {
      const result = parse("TOT 3 EN 1 2,50\n1 PAN 0,95");

      expect(result.items).toHaveLength(2);
      expect(result.totalAmount).toBeUndefined();
    });

    it("keeps the A of A pagar, so the line is the total and not a product", () => {
      const result = parse("1 PAN 0,95\nA pagar 63,89");

      expect(result.totalAmount).toBe(63.89);
      expect(result.items).toHaveLength(1);
    });

    it("does not read a discount on the total as the total", () => {
      expect(
        parse("LONCHAS EDAM 1,49 A\nTOTAL 10,94\nDesc. total en compra 0,20")
          .totalAmount,
      ).toBe(10.94);
    });

    it("takes the amount under a label that has none", () => {
      expect(
        parse(
          "BOQUERON 2,99\nTOTAL IVA INCLUIDO. 126,63\nNUEVO TOTAL\nGUZTIRA BERRIA 121,88",
        ).totalAmount,
      ).toBe(121.88);
    });

    it("reads a label the OCR damaged at the start of its line", () => {
      const result = parse("1 PAN 0,95\n; OTAL (€) — 82,04 |");

      expect(result.totalAmount).toBe(82.04);
      expect(result.items).toHaveLength(1);
    });

    it("reads a label whose T the OCR read as J, I or U", () => {
      expect(parse("TOMATE 2,91 A\nN JUIAL 10,94")).toMatchObject({
        totalAmount: 10.94,
        items: [{ parsedName: "tomate" }],
      });
      const iutal = parse("1 FILET 3,00\nIUTAL (€ 35,00");
      expect(iutal.totalAmount).toBe(35);
      expect(iutal.items).toHaveLength(1);
    });

    it("reads a damaged label with its amount on the line below", () => {
      const result = parse("1 PAN 1,95\nTota[ a\nres 1,95");

      expect(result.totalAmount).toBe(1.95);
      expect(names("1 PAN 1,95\nTota[ a\nres 1,95")).toEqual([["pan", 1.95]]);
    });

    it("keeps a last article priced at a total the others already exceed", () => {
      expect(
        parse("LECHE 3,17\nGEL 3,67\nBANDAS CORPO. BE 1,40\nTOTAL A PAGAR 1,40")
          .items,
      ).toHaveLength(3);
    });

    it("reads a last line that is the sum of the others as the total", () => {
      const result = parse(
        "ZUMO 4,11\nCREMA 1,89\nTOMATE 1,00\nPAN 1,58\nAGUA 1,00\nE X TUI 9,58",
      );

      expect(result.totalAmount).toBe(9.58);
      expect(result.items).toHaveLength(5);
    });

    it("reads a letter-spaced label", () => {
      expect(parse("1 PAN 0,95\nT O T A L ....... 815,64").totalAmount).toBe(
        815.64,
      );
    });
  });

  describe("where the articles end", () => {
    const now = new Date(2026, 10, 1);
    const names = (text: string) =>
      parseReceiptText(text, now).items.map((item) => [
        item.parsedName,
        item.parsedPrice,
      ]);

    it("ends at the tax table even when the total was not read", () => {
      expect(
        names(
          "1 BRONCHALES 6L 1,28\n* TOJAL (€) dal\nle TU BASE INPONIBLE (E) CUOTA Ce)\nPeal 2:08 0,10\nMiras 72 7,0% 0.63",
        ),
      ).toEqual([["bronchales 6l", 1.28]]);
    });

    it("ends at the card payment", () => {
      expect(
        names('1 UVA 3,49\nN TARJETA 7,4"\nM207[. 4 MUYZCA 7,94 / eur'),
      ).toHaveLength(1);
    });

    it("does not end at a gift card, which is bought, not paid with", () => {
      expect(
        names("1 LECHE 0,89\nTARJETA REGALO 25,00\n1 PAN 0,95\nTOTAL 26,84"),
      ).toContainEqual(["pan", 0.95]);
    });

    it("books no price a kilo printed under a weighed article", () => {
      expect(names("COSTILLA 3,79\nPRECIO KILO 6.95 -")).toHaveLength(1);
    });
  });

  describe("the total, by agreement", () => {
    const now = new Date(2026, 10, 1);
    const parse = (text: string) => parseReceiptText(text, now);

    it("stops at the tax table, whose TOTAL row is base and tax", () => {
      expect(
        parse(
          "1 PORC A DAUS 3,39\nTOTAL (€) 29,60\nTARGETA BANCARIA 29,60\nIVA BASE IMPOSABLE (€) QUOTA (€)\n2% 5,16 0,10\nTOTAL 21529 2,31",
        ).totalAmount,
      ).toBe(29.6);
    });

    it("takes the cash less the change when the total has no amount", () => {
      expect(
        parse(
          "ALDI\nFRUTOS SECOS NATURALES 2,09 € 2\nA PAGAR 245\nEfectivo 3,00 €\nCambio 0,31 €",
        ).totalAmount,
      ).toBe(2.69);
    });

    it("keeps the labelled total over a payment one digit away from it", () => {
      // The OCR misreads the cash line as often as the total: the other
      // reading of this DIA ticket was TOTAL 28.47 over EFECTIVO 20.47.
      expect(
        parse(
          "LECHE ENTERA DIA 6X 0.56 3.36\nTOTAL A PAGAR EUROS 20.47\nEFECTIVO 28.47\nCAMBIO 0.00",
        ).totalAmount,
      ).toBe(20.47);
    });

    it("takes what the cash and the pesetas agree on", () => {
      expect(
        parse(
          "CAFE MOLIDO 0,99\nTOTAL Eur: Lil\nEFECTIVO Eur. 7,72\n1284 Ptas.",
        ).totalAmount,
      ).toBe(7.72);
    });

    it("reads the tax table's sum and drops the mangled total line above it", () => {
      const result = parse(
        "TOMATE 2,91 A\nN JUIAL 10,94\nENTREGA 5 UV\nSuma 0,70 10,24 10,94",
      );

      expect(result.totalAmount).toBe(10.94);
      expect(result.items.map((item) => item.parsedName)).toEqual(["tomate"]);
    });

    it("takes no sum from a tax table that is only part of itself", () => {
      // An IVA row whose rate the OCR lost, and a row whose cuota is not
      // its rate of its base.
      expect(
        parse(
          "LECHE 3,17\nPAN 1,16\nTOTAL A PAGAR > ,\nBASE IMPONIBLE CUOTA\n21,0% IVA DE 1,16 0,24\n1n 7 TIVA DE 3,17 0,32",
        ).totalAmount,
      ).toBeUndefined();
      expect(
        parse("PAN 5,00\nBASE IMPONIBLE CUOTA\n4% 5,48 9,70").totalAmount,
      ).toBeUndefined();
    });

    it("adds up a tax table's total row printed as base and cuota", () => {
      expect(
        parse(
          "1 YOGUR 5,72\nMAL (e) 5%\nIVA BASE IMPONIBLE (€) CUOTA (€)\n4% 3,48 0,14\n10% 19 0,19\nTOTAL 5,39 0,33",
        ).totalAmount,
      ).toBe(5.72);
      expect(
        parse("SEDA CINTA DENTAL 1,55\nTVA% IVA + PAN -\nSuma 0.27 1,28")
          .totalAmount,
      ).toBe(1.55);
    });

    it("takes the payment from a sale line, a deferred payment or a bare euro amount", () => {
      expect(
        parse("COGOMBRE 1,40\nPAN 2,43\nBASE IMPONIBLE CUOTA\n| VENTA 3.83")
          .totalAmount,
      ).toBe(3.83);
      expect(
        parse("LECHE 3,49\nUVA 2,93\n€ PAGO DIFERIDO 6,42").totalAmount,
      ).toBe(6.42);
      expect(
        parse('UVA 3,49\nPERA 3,95\nN TARJETA 7,4"\n12037 4 MOVICA 7,44 / eur')
          .totalAmount,
      ).toBe(7.44);
    });

    it("does not take a bare euro amount for the payment when cash was handed over too", () => {
      expect(
        parse(
          "LONCHAS 2,91\nPATATAS 1,65\nMU 10,94 MA\nCNTREGA 1,00\nENTREGA 5,94\nIMB.: 5,94 EUR\nSuma 0,70 10,24 10,94",
        ).totalAmount,
      ).toBe(10.94);
    });

    it("takes neither the total nor an article from a plural DESCUENTOS line", () => {
      expect(
        parse(
          "MANTEQUILLA 4,69\n5 ART. TOTAL A PAGAR: 1425\nVENTAJAS OBTENIDAS:\nDESCUENTOS : ÍA 1,48 1",
        ).totalAmount,
      ).toBeUndefined();
      expect(
        parse("PAN 1,00\nDESCUENTOS 0,50\nLECHE 2,00").items.map(
          (item) => item.parsedName,
        ),
      ).toEqual(["pan", "leche"]);
    });

    it("keeps a total two payments add up to", () => {
      expect(
        parse(
          "1 PAN 6,00\nTOTAL 10,94\nENTREGA 5,00\nENTREGA 5,94\nIMP.: 5,94 EUR",
        ).totalAmount,
      ).toBe(10.94);
    });
  });

  describe("a price the OCR misread", () => {
    const now = new Date(2026, 10, 1);
    const priced = (text: string) =>
      parseReceiptText(text, now).items.map((item) => [
        item.parsedName,
        item.parsedPrice,
        item.parsedQuantity,
      ]);

    it("reads a colon as the decimal comma", () => {
      expect(priced("Zanahoria ecológica 1:49 E")).toEqual([
        ["zanahoria ecologica", 1.49, undefined],
      ]);
      expect(priced("Berenjena 1:28: E\n0,734 kg x 1,75 EUR/kg")).toEqual([
        ["berenjena", 1.28, 0.734],
      ]);
    });

    it("puts back a lost leading zero", () => {
      expect(priced("| ENSALADA 2506 ,82 6")[0]?.[1]).toBe(0.82);
    });

    it("closes a space inside an amount", () => {
      expect(priced("VAL YOGUR ISA 300 1, 16")[0]?.[1]).toBe(1.16);
    });

    it("drops a third decimal before the euro sign", () => {
      expect(priced("AGUA DESTILADA 1.006€")[0]?.[1]).toBe(1);
    });

    it("drops a tax letter read as a digit after the price", () => {
      expect(priced("ALITAS DE POLLO 4.958 4")[0]?.[1]).toBe(4.95);
    });

    it("reads a glyph in the decimals as the digit it stands for", () => {
      expect(priced("PISTO 1,/9B")[0]?.[1]).toBe(1.79);
    });

    it("reads a comma read as a digit when the line has no other amount", () => {
      expect(priced("MINI BISCOTE EROSKI 0755")[0]?.[1]).toBe(0.55);
    });

    it("reads no time or date as a price", () => {
      expect(priced("Fecha Hora\n23/08/2024 16:21")).toEqual([]);
      expect(priced("197 10/2026 15:59 CJR:001511")).toEqual([]);
      expect(priced("TIENDA 0231 23/08/24 16:21")).toEqual([]);
    });

    it("repairs only the amount at the end of the line", () => {
      expect(priced("TERMINAL 15:59 CAJERO 001511")).toEqual([]);
      expect(priced("AGUA 1, 5L 0,45")[0]?.[1]).toBe(0.45);
    });

    it("puts back a decimal comma the price lost", () => {
      const second = (line: string) => priced(`1 PAN 0,95\n${line}`)[1];
      expect(second("ARROZ 3 DELICIAS 279 |")).toEqual([
        "arroz 3 delicias",
        2.79,
        undefined,
      ]);
      expect(second("ACEITU MANZ VERD S/ 1798 E")).toEqual([
        "aceitu manz verd s",
        1.79,
        undefined,
      ]);
      expect(second("PAN MOLDE BLAN A 2/15 e")?.[1]).toBe(2.15);
      expect(second("LIIMACAIL OR 317 1MM 3 79")?.[1]).toBe(3.79);
      expect(second("1 PACK 3X500 COLA 540")).toEqual([
        "pack 3x500 cola",
        5.4,
        1,
      ]);
    });

    it("leaves a number that is not a price that lost its comma", () => {
      const names = (text: string) => priced(text).map(([name]) => name);
      expect(names("C/ BERLÍN, 486\n1 PAN 0,95")).toEqual(["pan"]);
      expect(names("1 PAN 0,95\nJAMON ELPLOZO 806 PB")).toEqual(["pan"]);
      expect(names("1 PAN 0,95\nCROQUETAS 1056")).toEqual(["pan"]);
      expect(names("1 PAN 0,95\nJotal 9 Artículos 947")).toEqual(["pan"]);
      expect(priced("1 PAN 0,95\nPIZZA POLLASTRE 410 318%")).toHaveLength(1);
      expect(priced("1 PAN 0,95\nTORTILLA DE PATATAS BLI 50 39")).toHaveLength(
        1,
      );
      expect(priced("1 PAN 0,95\nLECHE ENTERA 250\n1,25")[1]).toEqual([
        "leche entera 250",
        1.25,
        undefined,
      ]);
    });
  });

  describe("count times unit price", () => {
    const now = new Date(2026, 10, 1);
    const summary = (text: string) =>
      parseReceiptText(text, now).items.map((item) => [
        item.parsedName,
        item.parsedPrice,
        item.parsedQuantity,
      ]);

    it("counts a unit price times N when the line total is unreadable", () => {
      expect(summary("PIPAS GIGANTES TOSTA 1,05x 2 2. 1UB")).toEqual([
        ["pipas gigantes tosta", 2.1, 2],
      ]);
      expect(summary("Baresa/Jomate tritur 0,95x-— 3 EOS.A")).toEqual([
        ["baresa/jomate tritur", 2.85, 3],
      ]);
    });

    it("puts back a count line's total that lost its comma when the count proves it", () => {
      expect(summary("PEN 8 COLA 0,39 312")).toEqual([["cola", 3.12, 8]]);
      expect(summary("2 LECHE SEMIDESNATA 0.97. 1944")).toEqual([
        ["leche semidesnata", 1.94, 2],
      ]);
    });

    it("reads an uppercase X on the code line under the name", () => {
      expect(summary("V. TINTO VALDEPENAS\n6X 1H 6,84")[0]?.[2]).toBe(6);
      expect(
        summary("CHUFI HORCHATA ORIGINAL 1\n2 X 1.6%€ 3.36 í")[0]?.[2],
      ).toBe(2);
    });

    it("counts a count-column line that lost its total, on a ticket whose counts multiply out", () => {
      expect(
        summary(
          "2 LECHE ENTERA 0,89 1,78\n2 QUALLADA 1,20 Ea\n2 LEMON CAKE 1,70",
        ),
      ).toEqual([
        ["leche entera", 1.78, 2],
        ["quallada", 2.4, 2],
        ["2 lemon cake", 1.7, undefined],
      ]);
      expect(summary("8 VINO BLANCO 0,95 C")).toEqual([
        ["8 vino blanco", 0.95, undefined],
      ]);
    });

    it("reads a unit price or a total with one leading digit too many", () => {
      expect(summary("2 ELFRESC VACA LIGHT 12,20 4,40")).toEqual([
        ["elfresc vaca light", 4.4, 2],
      ]);
      expect(summary("2 BOSSA PLASTIC 0,15. 10,30")).toEqual([
        ["bossa plastic", 0.3, 2],
      ]);
    });

    it("reads a count line that names its unit", () => {
      expect(
        summary("BOLSA ECOLOGICA COMP MARKANT\n3 Uni. x 0,95 Euro/Uni"),
      ).toEqual([["bolsa ecologica comp markant", 2.85, 3]]);
      expect(
        summary("BATIDO CACAO CACAOLAT 1L\n2 Uni. x 2,50 Euro/Uni. 5,00"),
      ).toEqual([["batido cacao cacaolat 1l", 5, 2]]);
    });

    it("reads a trailing NX with no unit price as a pack size", () => {
      expect(summary("AGUA MINERAL FUENTE PRIMAVERA 6X 2,98")).toEqual([
        ["agua mineral fuente primavera 6x", 2.98, undefined],
      ]);
    });

    it("books the name above at the total after a price a unit", () => {
      expect(summary("CLOISES AL NATURAL M\neLo 90 €/U0 2,70 B")).toEqual([
        ["cloises al natural", 2.7, undefined],
      ]);
      expect(summary("YOGUR NATURAL\n3 0,45 €/U 1,35")).toEqual([
        ["yogur natural", 1.35, 3],
      ]);
    });

    it("reads a 1 the OCR made a letter in the unit price before the count", () => {
      expect(summary("AGUA MINERAL NATURAL 0,9ix 2 1,02 B")).toEqual([
        ["agua mineral natural", 1.82, 2],
      ]);
    });

    it("drops the noise before Mercadona's count column", () => {
      expect(summary("Ne 1 A.RELLENAS 0,53 N")).toEqual([
        ["a.rellenas", 0.53, 1],
      ]);
      expect(summary("1 1 12 HUEVOS GRS 1,07 Way")).toEqual([
        ["12 huevos grs", 1.07, 1],
      ]);
      expect(summary("1 1/2 POLLO 2,50")).toEqual([["1/2 pollo", 2.5, 1]]);
    });

    it("names a count line whose count the OCR read as a short word by the name above", () => {
      expect(summary("TURRON DURO C.S.\nTeX 1,99 5,97")).toEqual([
        ["turron duro c.s", 5.97, 3],
      ]);
    });

    it("reads DIA's count before the unit price", () => {
      expect(summary("LECHE ENTERA DIA 6X 0.56 3.36")).toEqual([
        ["leche entera dia", 3.36, 6],
      ]);
    });

    it("multiplies out a total the OCR could not read", () => {
      expect(summary("LECHE ENTERA DIA 6X 0.56 006")).toEqual([
        ["leche entera dia", 3.36, 6],
      ]);
    });

    it("finds a count no token states from the arithmetic", () => {
      expect(summary("TURRON DURO C.S.\n3 1,99 5,97")).toEqual([
        ["turron duro c.s", 5.97, 3],
      ]);
    });

    it("reads Eroski's count written with a Y", () => {
      expect(summary("BOLSA EROSKI\n4 Y 0,01 0,04")).toEqual([
        ["bolsa eroski", 0.04, 4],
      ]);
    });

    it("takes the product over a total one digit away from it", () => {
      expect(summary("AGUA MINERAL NATURAL 0,91x 2 1,62 8")).toEqual([
        ["agua mineral natural", 1.82, 2],
      ]);
    });

    it("takes the unit price over a total below it", () => {
      expect(summary("PLATANO\n303488 V v1x 7,99 1,239 A E")).toEqual([
        ["platano", 7.99, 1],
      ]);
    });

    it("keeps a total that is the unit price with a digit lost", () => {
      // Costco: the unit price read with a 1 too many, not a lost total.
      expect(summary("Mango Deshidratado\n1946954V ix 115,99 15,99 B")).toEqual(
        [["mango deshidratado", 15.99, undefined]],
      );
    });

    it("allows no cent of slack on a whole count", () => {
      expect(summary("LECHE ENTERA DIA 6X 0.56 3.35")).toEqual([
        ["leche entera dia", 3.36, 6],
      ]);
    });

    it("finds no count in a pack size or a promotion", () => {
      expect(summary("PAPEL HIGIENICO 12 3,50")).toEqual([
        ["papel higienico 12", 3.5, undefined],
      ]);
      expect(summary("3X2 YOGUR 1,20 2,40")[0]?.slice(1)).toEqual([
        2.4,
        undefined,
      ]);
    });
  });

  describe("weights and counts on a line of their own", () => {
    const now = new Date(2026, 10, 1);
    const summary = (text: string) =>
      parseReceiptText(text, now).items.map((item) => [
        item.parsedName,
        item.parsedPrice,
        item.parsedQuantity,
      ]);

    it("reads Costco's ARTPESO block as the kilos of the article under it", () => {
      // The owner's ticket of 2026-11-09, as the OCR read it: the weight
      // line's `/kg` read as `2` and `/ks`, and each article less its REMISE.
      const text = [
        "COSTCO WHOLESALE SPAIN, S.L.U.",
        "ARTPESO",
        "1,886 »x 19,99 2",
        "Rodabal lo Eviscera",
        "11196 V 1x 19,99 37,70 B",
        "va REMISE P3W3 11196",
        "9140925 1x 20,00 20,00-B",
        "ARTPESO",
        "1,711 x 19,99 /ks",
        "Rodaballo Eviscera",
        "11196 V 1x 19,99 34,21 B",
        "Mango Deshidratado",
        "1946954V 4x 15,99 63,96 B",
      ].join("\n");

      expect(summary(text)).toEqual([
        ["rodabal lo eviscera", 17.7, 1.886],
        ["rodaballo eviscera", 34.21, 1.711],
        ["mango deshidratado", 63.96, 4],
      ]);
    });

    it("reads DIA's kilos on the article line, and books no price a kilo", () => {
      expect(
        summary("COSTILLA TRASERO ÁN 0.545 KILOS 3.79B\nPRECIO KILO 6.95 -"),
      ).toEqual([["costilla trasero an", 3.79, 0.545]]);
    });

    it("takes the kilos times the price a kilo over a price they contradict", () => {
      expect(
        summary("FILETE LOMO FAMILIAR Lis -\n0,784 kg x 6,15 - EUR/kg 0.23"),
      ).toEqual([["filete lomo familiar lis", 4.82, 0.784]]);
      expect(summary("1 SÍNDRIA\n6,465 kg 1,15 €/kg 1,43")).toEqual([
        ["sindria", 7.43, 6.465],
      ]);
      expect(summary("COGOMBRE BIO 1,00\n0,540kg x 2,59 €/kg f")).toEqual([
        ["cogombre bio", 1.4, 0.54],
      ]);
    });

    it("books no weight line whose €/kg the OCR garbled", () => {
      expect(summary("rs $ hos\n0.7205 Ka X 77.49 €£/K")).toEqual([]);
    });

    it("reads DIA's kilos after noise in the gap before them", () => {
      expect(summary("FILETES DE AÑOJO 14-:0.715 KILOS! 8.548")).toEqual([
        ["filetes de anojo 14", 8.54, 0.715],
      ]);
    });

    it("prices a weighed article from its kilos when the total is lost", () => {
      expect(summary("SÍNDRIA RATLLADA PAR\n1,620 Kg 1,69 €/KO 4")).toEqual([
        ["sindria ratllada par", 2.74, 1.62],
      ]);
    });

    it("completes a name with the count line under it", () => {
      expect(summary("BOSSA REUTILITZABLE\n3 ud 0,19 €/ud TE")).toEqual([
        ["bossa reutilitzable", 0.57, 3],
      ]);
    });

    it("works out kilos the OCR mangled from the price above", () => {
      expect(summary("PEPINO 2,14 A\n|, 196 kg Xx 1,79 + EUR/kg")).toEqual([
        ["pepino", 2.14, 1.196],
      ]);
    });

    it("counts the article under Alcampo's count line", () => {
      expect(summary("2 x 1,49 B\nAGUA AUCHAN X6 2,98")).toEqual([
        ["agua auchan x6", 2.98, 2],
      ]);
    });

    it("counts the article above a count line", () => {
      expect(
        summary("CERVEZA DORADA LATA 3,30\n6 x 0,55 € **OFERTA**"),
      ).toEqual([["cerveza dorada lata", 3.3, 6]]);
    });

    it("still reads Mercadona's weight line under the name", () => {
      expect(summary("1 SANDIA\n6,465 kg 1,15 €/kg 7,43")).toEqual([
        ["sandia", 7.43, 6.465],
      ]);
    });
  });

  describe("doubtful lines against the total", () => {
    const now = new Date(2026, 10, 1);
    const parse = (text: string) => parseReceiptText(text, now);

    it("takes the reading of a glued digit that makes the total", () => {
      const result = parse(
        "BOQUERON SILVIA 2,939\nMINI BISCOTE 0,55\nTOTAL 3,54",
      );

      expect(result.items.map((item) => item.parsedPrice)).toEqual([
        2.99, 0.55,
      ]);
    });

    it("puts back a printed total the tax table's sum confirms", () => {
      const result = parse(
        [
          "2 GASPATAO 1,68 3,20",
          "1 SINDRIA",
          "6,465 kg 1,15 €/kg 7,43",
          "1 CREMA AVELLANA 2,30",
          "1 MAXI 2,35",
          "TOTAL (4 152%",
          "4% 7,14 0,29",
          "10% 7,14 0,71",
        ].join("\n"),
      );

      expect(result.totalAmount).toBe(15.28);
      expect(result.items[0]).toMatchObject({
        parsedName: "gaspatao",
        parsedPrice: 3.2,
        parsedQuantity: 2,
      });
    });

    it("changes nothing when more than one reading adds up", () => {
      const result = parse("PAN 1,239\nLECHE 1,239\nTOTAL 2,52");

      expect(result.items.map((item) => item.parsedPrice)).toEqual([
        1.23, 1.23,
      ]);
    });
  });

  describe("discounts", () => {
    const now = new Date(2026, 10, 1);
    const summary = (text: string) =>
      parseReceiptText(text, now).items.map((item) => [
        item.parsedName,
        item.parsedPrice,
      ]);

    it("books nothing in DIA's block of offers", () => {
      expect(
        summary(
          "LECHE 3,36\nOFERTAS -\nGALLETA M* DORAD DIA 1.65\n*****\nTOTAL 1,71",
        ),
      ).toEqual([["leche", 3.36]]);
    });

    it("reads a dash glued to a word as no minus sign", () => {
      expect(summary("IFA ELIGES SANGRIA.PET 1,5 L- 2,65")).toEqual([
        ["ifa eliges sangria.pet 1,5 l", 2.65],
      ]);
    });

    it("still reads a dash touching the number as a minus sign", () => {
      expect(summary("CUPON -0,50")).toEqual([]);
      expect(summary("YOGUR 1,00\nYOGUR 2X1 0,50-")).toEqual([["yogur", 0.5]]);
    });
  });

  describe("the purchase date", () => {
    const now = new Date(2026, 10, 1);
    const dateOf = (text: string) => {
      const date = parseReceiptText(text, now).purchaseDate;
      return date && [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    };

    it("does not take a loyalty balance's date", () => {
      expect(dateOf("Saldo acumulado a 25/09/2012 31,55")).toBeUndefined();
    });

    it("prefers the date printed with the time", () => {
      expect(dateOf("VALE 01/02/2025\nFECHA 06/11/2025 17:27")).toEqual([
        2025, 11, 6,
      ]);
    });

    it("reads a letter for a digit inside a date", () => {
      expect(dateOf("FEZH HDR C6/11/25 17:27")).toEqual([2025, 11, 6]);
    });

    it("reads Lidl's dotted date before a time", () => {
      expect(dateOf("0308 61529070 19.01.26 11:23")).toEqual([2026, 1, 19]);
      expect(dateOf("02.12.75 20:12")).toBeUndefined();
    });

    it("reads a Z for a 2 in a dotted date", () => {
      expect(dateOf("0308 93813/03 0Z.12.25 70:12")).toEqual([2025, 12, 2]);
    });

    it("takes a future year one digit off for the recent one, beside a time", () => {
      expect(dateOf("19/11/2095 18:21 UP :0734393")).toEqual([2025, 11, 19]);
      expect(dateOf("REF 05/10/2099\nPAN 1,00")).toBeUndefined();
    });

    it("takes a dotted date only when there is no other", () => {
      // The same Lidl ticket: the dotted copy misread 26 as 20.
      expect(dateOf("19/01/2026 MOZA\n0308 615729070 19.01.20 11:23")).toEqual([
        2026, 1, 19,
      ]);
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
        expect(
          parseReceiptText(`${header}\nPAN 1,00`).storeName,
        ).toBeUndefined();
      }
    });

    it("reads a long name one letter off", () => {
      expect(parseReceiptText('*"CARREFQURI""\nPAN 1,00').storeName).toBe(
        "carrefour",
      );
    });

    it("does not take an own-brand article for the shop", () => {
      expect(
        parseReceiptText("CAFE MOLIDO MEZCLA EROSKI 0,99\nPAN 1,00").storeName,
      ).toBeUndefined();
    });

    it("reads a logo's glyphs and its letter spacing", () => {
      expect(parseReceiptText("v AIDI\nPAN 1,00").storeName).toBe("aldi");
      expect(parseReceiptText("A L D I\nPAN 1,00").storeName).toBe("aldi");
      expect(
        parseReceiptText("| He CADIS A RAMALLOSA\nPAN 1,00").storeName,
      ).toBe("gadis");
      expect(parseReceiptText("S L U\nPAN 1,00").storeName).toBeUndefined();
    });

    it("does not take a short word one letter off for a name", () => {
      expect(
        parseReceiptText("CONSUMO RESPONSABLE\nPAN 1,00").storeName,
      ).toBeUndefined();
    });

    it("finds DIA by its legal name and Lupa by its tax number", () => {
      expect(
        parseReceiptText("PAN 1,00\nTOTAL COMPRA LA PLAZA DE D 54.22")
          .storeName,
      ).toBe("dia");
      expect(parseReceiptText("PAN 1,00\nC.I.F. 139050349").storeName).toBe(
        "lupa",
      );
    });

    it("finds a known store named as a word", () => {
      expect(parseReceiptText("SUPERMERCADOS DIA\nPAN 1,00").storeName).toBe(
        "dia",
      );
      expect(
        parseReceiptText("EL CORTE INGLÉS, S.A.\nPAN 1,00").storeName,
      ).toBe("el corte ingles");
      expect(parseReceiptText("CONSUM S. COOP\nPAN 1,00").storeName).toBe(
        "consum",
      );
    });

    it("finds the chain by its column headers, tax number or a split word", () => {
      const cases: [string, string][] = [
        ["Descripción P. Unit Imp.(€)\n1 PAN 0,95", "mercadona"],
        ["o EUROS/UD - EUROS/TOT -ING.28\nLECHE 0,89", "eroski"],
        ["CANTIDAD + PVR/UNIT\nLECHE 0,89", "dia"],
        ["CANTIDAD PYR/UNIT\nLECHE 0,89", "dia"],
        ["PAN 1,00\nDesc. total en c mpra 1,62", "lidl"],
        ['PAN 1,00\n"“. A28090108', "carrefour"],
        ["E.Lecierc (19)\nPAN 1,00", "leclerc"],
      ];
      for (const [text, store] of cases) {
        expect(parseReceiptText(text).storeName).toBe(store);
      }
    });

    it("reads the shop's name two letters off on the card slip", () => {
      expect(
        parseReceiptText("PAN 1,00\nESTABLECIMIENTO: ALCEPPO C.MEDINACELI")
          .storeName,
      ).toBe("alcampo");
      expect(
        parseReceiptText("PAN 1,00\nALCEPPO C.MEDINACELI").storeName,
      ).toBeUndefined();
    });

    it("does not take the price a kilo's header for a chain", () => {
      expect(parseReceiptText("PAN 1,00\nEUROS/KG").storeName).toBeUndefined();
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

  describe("layouts as the OCR reads them", () => {
    const summary = (text: string) =>
      parseReceiptText(text).items.map((item) => [
        item.parsedName,
        item.parsedPrice,
        item.parsedQuantity,
      ]);

    it("names a code line from the name printed above it", () => {
      // Costco: the name, then the code, count and prices, then the IVA class.
      const text = [
        "COSTCO WHOLESALE SPAIN, S.L.U.",
        "Costco Bolsa Cong E",
        "1000003V 1x 10,49 10,49 A",
        "Mini Babybel x32 =",
        "8543721V 1x / 11,99 11,99 C",
        "Boquerón Aliñado",
        "1003210V 2x 9,99 19,98 B",
      ].join("\n");

      expect(summary(text)).toEqual([
        ["costco bolsa cong", 10.49, 1],
        ["mini babybel x32", 11.99, 1],
        ["boqueron alinado", 19.98, 2],
      ]);
    });

    it("books nothing printed after the total", () => {
      const result = parseReceiptText(
        [
          "Tenders Pollo",
          "562292 V 1x 18,49 18,49 B",
          "**** TOTALCIVA INCL) 18,49",
          "Tarleta 18,49",
          "A 21,00% 63,18 13,28",
          "TOTAL PROMOCIONES: 4,50",
          "Importe IVA 1,68",
        ].join("\n"),
      );

      expect(result.items.map((item) => item.parsedName)).toEqual([
        "tenders pollo",
      ]);
      expect(result.totalAmount).toBe(18.49);
    });

    it("reads a total whose own amount the OCR lost from the card slip", () => {
      const result = parseReceiptText(
        [
          "Tenders Pollo",
          "562292 V 1x 18,49 18,49 B",
          "**** TOTAL(IVA INCL) ■■■■",
          "IMPORTE 18,49 EUR",
          "NUM TOTAL ARTICULOS VENDIDOS = 1",
          "TOTAL PROMOCIONES: 4,50 E",
        ].join("\n"),
      );

      expect(result.totalAmount).toBe(18.49);
      expect(result.items).toHaveLength(1);
    });

    it("takes the kilos under a weighed article", () => {
      // Lidl prints them under the priced line; Mercadona under the name.
      expect(
        summary(
          [
            "Calabacín 0,55 E",
            "0,462 kg x 1,19 EUR/kg",
            "1 PLATANO",
            "1,470 kg 1,84 €/kg 2,70",
          ].join("\n"),
        ),
      ).toEqual([
        ["calabacin", 0.55, 0.462],
        ["platano", 2.7, 1.47],
      ]);
    });

    it("leaves out a lone letter before Mercadona's count column", () => {
      expect(summary("u 1 BACON 1,39")).toEqual([["bacon", 1.39, 1]]);
      expect(summary("N 2 BACON LONCHAS 2,30 4,60 |")).toEqual([
        ["bacon lonchas", 4.6, 2],
      ]);
    });

    it("reads the count column before a name that starts with a number", () => {
      expect(summary("1 12 HUEVOS GRS 1,09")).toEqual([
        ["12 huevos grs", 1.09, 1],
      ]);
      expect(summary("2 (P)JAMON COCIDO E 1.00 2.00 F")[0]?.slice(1)).toEqual([
        2, 2,
      ]);
    });

    it("leaves a count other than 1 before a number in the name", () => {
      expect(summary("2 6 HUEVOS 1,20")).toEqual([
        ["2 6 huevos", 1.2, undefined],
      ]);
    });

    it("reads a count printed between the unit price and the total", () => {
      expect(summary("Cronfield/Copos de 0,65x 3 1,95 B")).toEqual([
        ["cronfield/copos de", 1.95, 3],
      ]);
    });

    it("books no discount line, signed or not", () => {
      expect(
        summary(
          [
            "PEPINO 2,14 A",
            "Desc. -0,72",
            "PISTO 1,79 B",
            "Dto. Pisto 0,40",
          ].join("\n"),
        ),
      ).toEqual([
        ["pepino", 1.42, undefined],
        ["pisto", 1.39, undefined],
      ]);
    });

    it("books an article at what was paid for it, its discount taken off", () => {
      // Costco names a promotion on a line of its own, then prints it with a
      // trailing minus under the article it is for.
      const result = parseReceiptText(
        [
          "Tenders Pollo",
          "562292 V 1x 18,49 18,49 B",
          "MVM P2 562292 FY27",
          "9138848V 1x 4,50 4,50-B",
          "Mango Deshidratado",
          "1946954V 1x 15,99 15,99 B",
          "TOTAL 29,98",
        ].join("\n"),
      );

      expect(
        result.items.map((item) => [item.parsedName, item.parsedPrice]),
      ).toEqual([
        ["tenders pollo", 13.99],
        ["mango deshidratado", 15.99],
      ]);
      expect(result.items[0]?.rawText).toContain("4,50-B");
      expect(result.discountAmount).toBeUndefined();
      expect(result.totalAmount).toBe(29.98);
    });

    it("takes every discount under an article off it, a line's 'total' too", () => {
      // An optician's: `Dto Total` is the line's own discount, and a second
      // one can follow it.
      const result = parseReceiptText(
        [
          "TAN - NAVY 1 40,00 € 40,00 €",
          "Dto Total 0,82 % -0,33 €",
          "ONE RAW - CHERRY RE 1 40,00 € 40,00 €",
          "Dto Total 0,85 % -0,22 €",
          "Tarifa Outlet 33% de De35 % -14,00 €",
          "Total 65,45 €",
        ].join("\n"),
      );

      expect(result.items.map((item) => item.parsedPrice)).toEqual([
        39.67, 25.78,
      ]);
      expect(result.discountAmount).toBeUndefined();
    });

    it("books no tax line printed between the subtotal and the total", () => {
      const result = parseReceiptText(
        "GAFAS 40,00\nSubtotal 33,06\nInpuestos 6,94\nTotal 40,00",
      );

      expect(result.items.map((item) => item.parsedName)).toEqual(["gafas"]);
    });

    it("keeps a discount on the whole purchase off every article", () => {
      const result = parseReceiptText(
        "PAN 1,00\nLECHE 2,00\nDesc. total en compra -0,20\nTOTAL 2,80",
      );

      expect(result.items.map((item) => item.parsedPrice)).toEqual([1, 2]);
      expect(result.discountAmount).toBe(0.2);
    });

    it("keeps a discount larger than the article above off it", () => {
      const result = parseReceiptText("PAN 1,00\nLECHE 2,00\nCUPON -2,50");

      expect(result.items.map((item) => item.parsedPrice)).toEqual([1, 2]);
      expect(result.discountAmount).toBe(2.5);
    });

    it("leaves out the paper's edge before a line", () => {
      expect(summary("| PATATAS GAJO 1,65\nE ARROZ CON LECHE 1,27")).toEqual([
        ["patatas gajo", 1.65, undefined],
        ["arroz con leche", 1.27, undefined],
      ]);
    });

    it("leaves a boxed tax mark out of the name", () => {
      expect(summary("SCOTTEX MEGA 6=12R [0] 2.49")).toEqual([
        ["scottex mega 6=12r", 2.49, undefined],
      ]);
    });

    it("keeps a price whose tax letter ran into it", () => {
      expect(summary("FLAUTA BACON CRISPY 2,098\nPATATAS GAJO 1,6555")).toEqual(
        [
          ["flauta bacon crispy", 2.09, undefined],
          ["patatas gajo", 1.65, undefined],
        ],
      );
    });

    it("books no Catalan payment or tax line", () => {
      expect(
        summary(
          [
            "1 SINDRIA 7,43",
            "TARGETA BANCARIA 7,43",
            "BASE IMPOSABLE (€) QUOTA (€)",
          ].join("\n"),
        ),
      ).toEqual([["sindria", 7.43, 1]]);
    });

    it("finds the chain by its tax number when the logo is not read", () => {
      expect(parseReceiptText("LEHDL\nNIF A60195278\nPAN 1,00").storeName).toBe(
        "lidl",
      );
      expect(parseReceiptText("A-46103834\nPAN 1,00").storeName).toBe(
        "mercadona",
      );
      expect(
        parseReceiptText("COSTCO WHOLESALE SPAIN\nPAN 1,00").storeName,
      ).toBe("costco");
    });

    it("takes a total printed below the tax table when the payment agrees", () => {
      // DIA prints its tax table between TOTAL COMPRA and TOTAL A PAGAR.
      const result = parseReceiptText(
        [
          "PAN BARRA 0,45",
          "LECHE ENTERA 2,53",
          "TOTAL COMPRA 2,93",
          "BASE IMPONIBLE CUOTA",
          "4% 2,82 0,11",
          "TOTAL A PAGAR 2,98",
          "TARGET. TEF 2,98",
        ].join("\n"),
      );

      expect(result.totalAmount).toBe(2.98);
    });

    it("does not take an offer, a saving or a count of units for the total", () => {
      const lidl = parseReceiptText(
        [
          "UVA ROJA 2,75",
          "TOTAL 33,96",
          "Total oferta Lidl Plus:",
          "2,53 EUR",
        ].join("\n"),
      );
      const carrefour = parseReceiptText(
        [
          "MANTEQUILLA 4,69",
          "TOTAL A PAGAR: 4,69",
          "TOTAL VENTAJAS EN ESTA COMPRA: 1,48",
        ].join("\n"),
      );
      const bonarea = parseReceiptText(
        [
          "PIT FILETEJAT 3,29",
          "IVA INCLOS TOTAL) 3,29",
          "TOTAL UNITATS 1 CANVI 0,00",
        ].join("\n"),
      );

      expect(lidl.totalAmount).toBe(33.96);
      expect(carrefour.totalAmount).toBe(4.69);
      expect(bonarea.totalAmount).toBe(3.29);
    });

    it("takes the total the card payment and the articles agree on", () => {
      // The OCR read 24,25 as 24.75 on the label; the card line says 24,25.
      const result = parseReceiptText(
        [
          "HOGAZA CEREAL 2,79",
          "PIT GALL DINDI 5,58",
          "FRANKFURT GEGANT 15,88",
          "IVA INCLOS TOTAL) 24.75",
          "PAGO TARGETA — 24,25",
        ].join("\n"),
      );

      expect(result.totalAmount).toBe(24.25);
    });
  });

  // Each case below is a scenario the 2026-11 adversarial review of the
  // rewritten parser wrote, and each failed before the fix it names.
  describe("names that look like the ticket's own words", () => {
    const now = new Date(2026, 10, 1);
    const parse = (text: string) => parseReceiptText(text, now);
    const names = (text: string) =>
      parse(text).items.map((item) => [item.parsedName, item.parsedPrice]);

    it("reads past an article whose name has TOTAL in it", () => {
      // Colgate Total, Fage Total: the label closed the articles, and every
      // line below the toothpaste was lost.
      expect(
        names(
          "MERCADONA\nPAN 1,20\nDENTIFRICO COLGATE TOTAL 2,99\nLECHE 0,89\nHUEVOS 2,10\nTOTAL 7,18\nTARJETA 7,18",
        ),
      ).toEqual([
        ["pan", 1.2],
        ["dentifrico colgate total", 2.99],
        ["leche", 0.89],
        ["huevos", 2.1],
      ]);
      expect(
        names(
          "CARREFOUR\nLECHE ENTERA 1,25\nCOLGATE TOTAL 75ML 2,49\nPAN BIMBO 2,10\nCAFE MOLIDO 250G 2,49\nTOTAL 8,33\nTARJETA 8,33",
        ),
      ).toHaveLength(4);
    });

    it("still ends at a total after words when its amount is the articles'", () => {
      expect(
        names(
          "PAN 1,00\nLECHE 2,00\nIVA INCLUIDO TOTAL 3,00\nGUZTIRA BERRIA 3,00",
        ),
      ).toEqual([
        ["pan", 1],
        ["leche", 2],
      ]); // An article count before the label closes them whatever the amount.
      expect(
        names("PAN 1,00\nmea 2 ART TOT COMPRA: 69,80\nBOLSA PAPEL 0,10"),
      ).toEqual([["pan", 1]]);
    });

    it("books an article named with a saving, a promotion or a short 'desc.'", () => {
      expect(
        names(
          "MERCADONA\nLECHE PACK AHORRO 6 5,40\nPAN 1,20\nTOTAL 6,60\nTARJETA 6,60",
        ),
      ).toEqual([
        ["leche pack ahorro 6", 5.4],
        ["pan", 1.2],
      ]);
      expect(
        names(
          "CAFE MOLIDO DESC. DIA 2,15\nDETERGENTE ARIEL PROMO 3,99\nTOTAL 6,14",
        ),
      ).toEqual([
        ["cafe molido desc. dia", 2.15],
        ["detergente ariel promo", 3.99],
      ]);
    });

    it("takes nothing off for an article with OFERTA in its name", () => {
      // Booked as a discount too, it hid the count of the line above.
      expect(
        parse("AGUA 0,50 1,00\nGALLETAS OFERTA 1,50\nTOTAL 2,50").items.map(
          (item) => [item.parsedName, item.parsedQuantity],
        ),
      ).toEqual([
        ["agua", 2],
        ["galletas oferta", undefined],
      ]);
    });

    it("books an article whose name starts like a header field", () => {
      expect(
        names("DIA\nPAN 1,20\nCAJA BOMBONES 3,50\nLECHE 0,90\nTOTAL 5,60"),
      ).toEqual([
        ["pan", 1.2],
        ["caja bombones", 3.5],
        ["leche", 0.9],
      ]);
    });

    it("keeps a name of letters and digits rather than the header line above it", () => {
      expect(names("CONDIS\n7UP 0,95\nLLET 0,89\nTOTAL 1,84")).toEqual([
        ["7up", 0.95],
        ["llet", 0.89],
      ]);
    });

    it("books a name made of letters and digits, after its count column", () => {
      expect(
        parse("1 7UP 1,5L 1,25\n1 H2O 0,50\n1 KH7 2,95").items.map((item) => [
          item.parsedName,
          item.parsedPrice,
          item.parsedQuantity,
        ]),
      ).toEqual([
        ["7up 1,5l", 1.25, 1],
        ["h2o", 0.5, 1],
        ["kh7", 2.95, 1],
      ]);
    });

    it("keeps a one-letter word that starts a name", () => {
      expect(names("A la pimienta salsa 1,20 A\nY griego 0,99 A")).toEqual([
        ["a la pimienta salsa", 1.2],
        ["y griego", 0.99],
      ]);
    });

    it("books no time of day on a header line", () => {
      expect(
        names(
          "CARREFOUR EXPRESS\nOPERADOR MARIA 12:30\n15/10/2026\nLECHE 1,25\nPAN 0,95\nTOTAL 2,20",
        ),
      ).toEqual([
        ["leche", 1.25],
        ["pan", 0.95],
      ]);
    });
  });

  describe("an article that adds up to the others", () => {
    const now = new Date(2026, 10, 1);
    const names = (text: string) =>
      parseReceiptText(text, now).items.map((item) => item.parsedName);

    it("keeps the last article when the total counts it", () => {
      expect(
        names(
          "MERCADONA\nPAN 1,00\nLECHE 2,00\nACEITE 3,00\nTOTAL 6,00\nTARJETA 6,00",
        ),
      ).toEqual(["pan", "leche", "aceite"]);
      expect(
        names(
          "LIDL\nPan 0,39\nLeche 0,95\nHuevos 1,34\nTotal 2,68\nEntregado 5,00\nCambio 2,32",
        ),
      ).toEqual(["pan", "leche", "huevos"]);
    });
  });

  describe("sizes and counts", () => {
    const now = new Date(2026, 10, 1);
    const summary = (text: string) =>
      parseReceiptText(text, now).items.map((item) => [
        item.parsedName,
        item.parsedPrice,
        item.parsedQuantity,
      ]);

    it("counts a unit price with a 0 in it when no total is printed", () => {
      expect(
        summary("BONPREU\nIOGURT NATURAL\n3 ud 0,50 €/ud\nTOTAL 1,50"),
      ).toEqual([["iogurt natural", 1.5, 3]]);
      expect(
        summary("DIA\nPAN 1,20\nLECHE ENTERA DIA 6X 0.50 006\nTOTAL 4,20"),
      ).toEqual([
        ["pan", 1.2, undefined],
        ["leche entera dia", 3, 6],
      ]);
    });

    it("reads no count from a size printed as an amount", () => {
      expect(
        summary(
          "LIDL\nCOCA COLA 1,25L 2,50 B\nCERVEZA 0,33L 0,99 B\nACEITE OLIVA 0,75L 4,50 A",
        ),
      ).toEqual([
        ["coca cola 1,25l", 2.5, undefined],
        ["cerveza 0,33l", 0.99, undefined],
        ["aceite oliva 0,75l", 4.5, undefined],
      ]);
      expect(summary("AGUA MINERAL 1,50 L 3,00")).toEqual([
        ["agua mineral 1,50 l", 3, undefined],
      ]);
    });

    it("reads no count from a weight or a volume in the name", () => {
      expect(summary("QUESO CURADO 0,250 3,50\nVINO TINTO 0,750 2,25")).toEqual(
        [
          ["queso curado 0,250", 3.5, undefined],
          ["vino tinto 0,750", 2.25, undefined],
        ],
      );
      expect(
        summary("COSTCO\nPAN 1,00\nVINO RIOJA 0,750 L\n123456 5,99"),
      ).toEqual([
        ["pan", 1, undefined],
        ["vino rioja 0,750", 5.99, undefined],
      ]);
    });

    it("reads no kilos from a prepacked net weight", () => {
      expect(summary("ARROZ 1.000 KG 1,20\nPATATAS 5,000 KG 3,99")).toEqual([
        ["arroz 1.000 kg", 1.2, undefined],
        ["patatas 5,000 kg", 3.99, undefined],
      ]);
    });

    it("undoes a guessed count with the price the total puts back", () => {
      expect(
        summary(
          "MERCADONA\n2 ATUN CLARO 2,79 5,58 A\n4 YOGURES NATURALES 1,20 A\n6 HUEVOS CAMPEROS 1,89 A\nTOTAL 8,67",
        ),
      ).toEqual([
        ["atun claro", 5.58, 2],
        ["4 yogures naturales", 1.2, undefined],
        ["6 huevos camperos", 1.89, undefined],
      ]);
    });
  });

  describe("discounts and payments", () => {
    const now = new Date(2026, 10, 1);
    const parse = (text: string) => parseReceiptText(text, now);

    it("ends a block of signed discounts at the next article", () => {
      expect(
        parse(
          "EROSKI\nLECHE 1,00\nDESCUENTO\n-0,20\nPAN 0,80\nHUEVOS 2,10\nTOTAL 3,70",
        ).items.map((item) => item.parsedName),
      ).toEqual(["leche", "pan", "huevos"]);
    });

    it("does not add the cash paid to the cash handed over", () => {
      expect(
        parse(
          "CONSUM\nPAN 1,20\nLECHE 0,90\nHUEVOS 2,15\nEFECTIVO 4,25\nENTREGADO 20,00\nCAMBIO 15,75",
        ).totalAmount,
      ).toBe(4.25);
      expect(
        parse(
          "CONSUM\nPAN 1,20\nLECHE 0,90\nHUEVOS 2,15\nEFECTIVO 20,00\nENTREGADO 20,00\nCAMBIO 15,75",
        ).totalAmount,
      ).toBe(4.25);
    });

    it("takes the total to pay after a loyalty saving", () => {
      for (const payment of ["EFECTIVO 5,00", "TARJETA BANCARIA"]) {
        expect(
          parse(
            `DIA\nLECHE 1,25\nPAN 2,08\nTOTAL COMPRA 3,33\nAHORRO CLUB DIA 0,40\nTOTAL A PAGAR 2,93\n${payment}`,
          ).totalAmount,
        ).toBe(2.93);
      }
    });
  });

  describe("input no receipt prints", () => {
    const now = new Date(2026, 10, 1);
    // Each input made one pattern backtrack quadratically or worse: seconds
    // to minutes of a server thread on one upload. Linear, each takes a few
    // milliseconds; 100 ms is the margin for a loaded CI runner.
    const took = (text: string) => {
      const started = performance.now();
      parseReceiptText(text, now);
      return performance.now() - started;
    };

    it.each([
      ["a dot leader after TARJETA", `LECHE 1,00\nTARJETA${".".repeat(2000)}x`],
      [
        "separators before a weight",
        `LECHE 1,00\n${"abcd".repeat(250)}${"-".repeat(1000)}x`,
      ],
      ["spaces after TOT", `TOT${" ".repeat(1000)}x`],
      ["spaces after a counted name", `1 abc${" ".repeat(10000)}z`],
      [
        "one-letter tokens after a name",
        `LECHE 1,00\nabc${" a".repeat(5000)} abcd`,
      ],
      [
        "punctuation inside a name",
        `LECHE 1,00\nabc ${"*".repeat(20000)}a 1,23`,
      ],
      ["single letters spaced out", `LECHE 1,00\n${"a ".repeat(10000)}a`],
      ["one line of numbers", "123456 ".repeat(3000)],
      [
        "a long word after Lidl's discount",
        `LECHE 1,00\ndesc total en c${"a".repeat(20000)}`,
      ],
      [
        "a long header",
        Array.from({ length: 8 }, () => "ab ".repeat(4000)).join("\n"),
      ],
    ])("parses %s in linear time", (_, text) => {
      expect(took(text)).toBeLessThan(100);
    });

    it("reads no line past the length a till prints", () => {
      // The price sits past the cut, so nothing is booked.
      expect(parseReceiptText(`PAN${" ".repeat(300)}1,20`, now).items).toEqual(
        [],
      );
    });

    it("reads no more lines than the longest receipt prints", () => {
      const text = Array.from({ length: 2500 }, (_, i) => `ART${i} 1,00`).join(
        "\n",
      );
      expect(parseReceiptText(text, now).items.length).toBeLessThanOrEqual(
        2000,
      );
    });
  });
});

describe("framedArticle", () => {
  it("takes the article and its price from one framed line", () => {
    expect(framedArticle("LECHE ENTERA 1L 1,05")).toEqual({
      name: "leche entera 1l",
      price: 1.05,
      quantity: 1,
    });
  });

  it("takes the discount framed under the article off its price", () => {
    expect(framedArticle("TENDERS POLLO 18,49\nMVM P2 562292 4,50-B")).toEqual({
      name: "tenders pollo",
      price: 13.99,
      quantity: 1,
    });
  });

  it("keeps the quantity of a framed count line", () => {
    expect(framedArticle("2 x 1,50\nYOGUR NATURAL 3,00")).toEqual({
      name: "yogur natural",
      price: 3,
      quantity: 2,
    });
  });

  it("adds up lines the parser split, since the person framed one article", () => {
    expect(framedArticle("PAN 1,00\nLECHE 2,05")).toEqual({
      name: "pan",
      price: 3.05,
      quantity: 1,
    });
  });

  it("says nothing came of lines with no article", () => {
    expect(framedArticle("GRACIAS POR SU VISITA")).toBeNull();
  });
});
