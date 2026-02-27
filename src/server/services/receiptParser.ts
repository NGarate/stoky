import { prisma } from "@/lib/prisma";
import { ReceiptStatus, MatchStatus } from "@prisma/client";

interface ParsedItem {
  rawText: string;
  parsedName: string;
  parsedPrice: number;
  parsedQuantity?: number;
}

interface ParsedReceipt {
  storeName?: string;
  purchaseDate?: Date;
  totalAmount?: number;
  items: ParsedItem[];
}

const STORE_PATTERNS = [
  /^(?:supermercado|tienda|comercio)\s+(.+)$/im,
  /^([A-Z][A-Za-z\s]+(?:SL|SA|\.S\.A|\.S\.L|\.S\.A\.U|GMBH|INC|LTD))$/im,
  /^([A-Z][A-Za-z\s&]+(?:MARKET|SUPER|DIA|CARREFOUR|MERCADONA|ALDI|LIDL|ALCAMPO|CONSUM|MAS Y MAS|SPAR|EROSKI|HIPERCOR|EL CORTE INGLES))$/im,
];

const DATE_PATTERNS = [
  /\b(\d{4})[/](\d{1,2})[/](\d{1,2})\b/,
  /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/,
  /\b(\d{2})(\d{2})(\d{4})\b/,
];

const ITEM_PATTERNS = [
  // Standard format: PRODUCT NAME 2,50
  /^(.+?)\s+(\d+[,.]\d{2})\s*$/m,
  // With quantity: 2x PRODUCT NAME 5,00
  /^(\d+)\s*x\s*(.+?)\s+(\d+[,.]\d{2})\s*$/m,
  // Price at end: PRODUCT ... 2,50
  /^(.+?)\s+.*?(\d+[,.]\d{2})\s*$/m,
];

const PRICE_PATTERN = /(\d+)[,.](\d{2})/;
const TOTAL_PATTERN = /(?:total|importe|suma)\s*:?\s*(\d+[,.]\d{2})/i;

export function parseReceiptText(ocrText: string): ParsedReceipt {
  const lines = ocrText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const result: ParsedReceipt = {
    items: [],
  };

  // Extract store name (usually in first few lines)
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    for (const pattern of STORE_PATTERNS) {
      const match = lines[i].match(pattern);
      if (match) {
        result.storeName = match[1].trim();
        break;
      }
    }
    if (result.storeName) break;
  }

  // Extract date
  for (const line of lines) {
    for (const [patternIndex, pattern] of DATE_PATTERNS.entries()) {
      const match = line.match(pattern);
      if (match) {
        let day: number;
        let month: number;
        let year: number;

        if (patternIndex === 0) {
          // YYYY/MM/DD format
          year = Number.parseInt(match[1], 10);
          month = Number.parseInt(match[2], 10) - 1;
          day = Number.parseInt(match[3], 10);
        } else if (patternIndex === 2) {
          // DDMMYYYY format
          day = Number.parseInt(match[1], 10);
          month = Number.parseInt(match[2], 10) - 1;
          year = Number.parseInt(match[3], 10);
        } else if (match[3].length === 4) {
          // DD/MM/YYYY or similar
          day = Number.parseInt(match[1], 10);
          month = Number.parseInt(match[2], 10) - 1;
          year = Number.parseInt(match[3], 10);
        } else {
          // Assume YY format
          day = Number.parseInt(match[1], 10);
          month = Number.parseInt(match[2], 10) - 1;
          year = 2000 + Number.parseInt(match[3], 10);
        }

        const date = new Date(year, month, day);
        const isValidDate =
          !Number.isNaN(date.getTime()) &&
          date.getFullYear() === year &&
          date.getMonth() === month &&
          date.getDate() === day;

        if (isValidDate) {
          result.purchaseDate = date;
          break;
        }
      }
    }
    if (result.purchaseDate) break;
  }

  // Extract total amount
  const totalMatch = ocrText.match(TOTAL_PATTERN);
  if (totalMatch) {
    result.totalAmount = Number.parseFloat(totalMatch[1].replace(",", "."));
  }

  // Extract items
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip lines that are likely headers, footers, or irrelevant
    if (
      line.match(/(?:total|subtotal|iva|descuento|cambio|efectivo|tarjeta|factura|ticket|caja|hora|fecha)/i) ||
      line.match(/^\d{1,2}[/]\d{1,2}[/]\d{2,4}$/) ||
      line.match(/^\d{2}:\d{2}/) ||
      line.length < 3
    ) {
      continue;
    }

    // Try to match item patterns
    let item: ParsedItem | null = null;

    for (const pattern of ITEM_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        if (match.length === 4) {
          // Has quantity
          const quantity = Number.parseInt(match[1], 10);
          const name = cleanProductName(match[2]);
          const priceStr = match[3].replace(",", ".");
          const price = Number.parseFloat(priceStr);

          if (name && !Number.isNaN(price) && price > 0) {
            item = {
              rawText: line,
              parsedName: name,
              parsedPrice: price,
              parsedQuantity: quantity,
            };
          }
        } else {
          // No quantity
          const name = cleanProductName(match[1]);
          const priceStr = match[2].replace(",", ".");
          const price = Number.parseFloat(priceStr);

          if (name && !Number.isNaN(price) && price > 0 && price < 10000) {
            item = {
              rawText: line,
              parsedName: name,
              parsedPrice: price,
            };
          }
        }
        break;
      }
    }

    // Fallback: just look for any price in the line
    if (!item) {
      const priceMatch = line.match(PRICE_PATTERN);
      if (priceMatch) {
        const price = Number.parseFloat(`${priceMatch[1]}.${priceMatch[2]}`);
        const name = cleanProductName(line.replace(priceMatch[0], "").trim());

        if (name && price > 0 && price < 10000) {
          item = {
            rawText: line,
            parsedName: name,
            parsedPrice: price,
          };
        }
      }
    }

    if (item) {
      result.items.push(item);
    }
  }

  return result;
}

function cleanProductName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/^[^a-zA-Z]+/, "")
    .replace(/[^a-zA-Z0-9\s]+$/, "")
    .trim()
    .toLowerCase();
}

export async function saveParsedItems(
  receiptId: string,
  parsed: ParsedReceipt,
): Promise<void> {
  // Update receipt with parsed metadata
  await prisma.receipt.update({
    where: { id: receiptId },
    data: {
      purchaseDate: parsed.purchaseDate,
      totalAmount: parsed.totalAmount,
      status: ReceiptStatus.PARSED,
    },
  });

  // Find or create store
  if (parsed.storeName) {
    const existingStore = await prisma.store.findFirst({
      where: {
        name: { equals: parsed.storeName, mode: "insensitive" },
        householdId: (
          await prisma.receipt.findUnique({
            where: { id: receiptId },
            select: { householdId: true },
          })
        )?.householdId,
      },
    });

    if (existingStore) {
      await prisma.receipt.update({
        where: { id: receiptId },
        data: { storeId: existingStore.id },
      });
    }
  }

  // Create receipt items
  for (const item of parsed.items) {
    await prisma.receiptItem.create({
      data: {
        receiptId,
        rawText: item.rawText,
        parsedName: item.parsedName,
        parsedPrice: item.parsedPrice,
        parsedQuantity: item.parsedQuantity ?? 1,
        matchStatus: MatchStatus.PENDING,
      },
    });
  }
}
