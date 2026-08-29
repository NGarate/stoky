import { prisma } from "@/lib/prisma";
import { ReceiptStatus, MatchStatus } from "@prisma/client";
import { NotFoundError } from "./errors";

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

const KNOWN_STORES = [
  "mercadona",
  "carrefour",
  "dia",
  "lidl",
  "aldi",
  "el corte ingles",
  "hipercor",
  "alcampo",
  "eroski",
  "consum",
  "spar",
];

const DATE_PATTERNS = [
  /\b(\d{4})[/](\d{1,2})[/](\d{1,2})\b/,
  /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/,
  /\b(\d{2})(\d{2})(\d{4})\b/,
];

const TOTAL_PATTERN = /(?:total|importe|suma)(?:\s+[a-záéíóúñ]+)*\s*[:€()]*\s*(\d+[,.]\d{2})/i;

export function parseReceiptText(ocrText: string): ParsedReceipt {
  const lines = ocrText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const result: ParsedReceipt = {
    items: [],
  };

  result.storeName = extractStoreName(lines);

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
    const line = lines[i].replace(/\b(?:total|importe|suma)\b.*$/i, "").trim();
    const priceMatches = line.match(/\d+[,.]\d{2}/g) ?? [];

    // Skip lines that are likely headers, footers, or irrelevant
    if (
      (line.match(/\b(?:subtotal|iva|descuento|cambio|efectivo|tarjeta|factura|ticket|caja|hora|fecha)\b/i) &&
        priceMatches.length <= 1) ||
      line.match(/^\d{1,2}[/]\d{1,2}[/]\d{2,4}$/) ||
      line.match(/^\d{2}:\d{2}/) ||
      line.length < 3
    ) {
      continue;
    }

    const item = parseLineItem(line);

    if (item) {
      result.items.push(item);
    }
  }

  // Fallback for OCR text without line breaks
  if (result.items.length === 0 && lines.length === 1) {
    const inlineText = lines[0]
      .replace(/\b(?:total|importe|suma)\b.*$/i, "")
      .trim();
    const matches = [
      ...inlineText.matchAll(
        /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s/-]{1,}?)\s+(\d+[,.]\d{2})/g,
      ),
    ];

    for (const match of matches) {
      const name = cleanProductName(match[1]);
      const price = Number.parseFloat(match[2].replace(",", "."));
      if (name && !Number.isNaN(price) && price > 0 && price < 10000) {
        result.items.push({
          rawText: `${match[1]} ${match[2]}`.trim(),
          parsedName: name,
          parsedPrice: price,
        });
      }
    }
  }

  return result;
}

function parseLineItem(line: string): ParsedItem | null {
  const quantityPrefixMatch = line.match(
    /^(\d+(?:[.,]\d+)?)\s*x\s*(.+?)\s+(\d+[,.]\d{2})\s*$/i,
  );
  if (quantityPrefixMatch) {
    const quantity = Number.parseFloat(
      quantityPrefixMatch[1].replace(",", "."),
    );
    const name = cleanProductName(quantityPrefixMatch[2]);
    const price = Number.parseFloat(
      quantityPrefixMatch[3].replace(",", "."),
    );
    if (
      name &&
      !Number.isNaN(quantity) &&
      quantity > 0 &&
      !Number.isNaN(price) &&
      price > 0 &&
      price < 10000
    ) {
      return {
        rawText: line,
        parsedName: name,
        parsedPrice: price,
        parsedQuantity: quantity,
      };
    }
  }

  const prices = [...line.matchAll(/(\d+[,.]\d{2})/g)];
  if (prices.length === 0) return null;

  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  if (firstPrice.index === undefined) return null;
  const price = Number.parseFloat(lastPrice[1].replace(",", "."));
  if (Number.isNaN(price) || price <= 0 || price >= 10000) return null;

  let namePart = line.slice(0, firstPrice.index).trim();
  if (!namePart) return null;

  let parsedQuantity: number | undefined;
  const quantitySuffixMatch = namePart.match(/\b(\d+(?:[.,]\d+)?)$/);
  if (quantitySuffixMatch) {
    const candidateQuantity = Number.parseFloat(
      quantitySuffixMatch[1].replace(",", "."),
    );
    if (!Number.isNaN(candidateQuantity) && candidateQuantity > 0 && candidateQuantity < 1000) {
      parsedQuantity = candidateQuantity;
      namePart = namePart
        .slice(0, quantitySuffixMatch.index ?? namePart.length)
        .trim();
    }
  }

  const name = cleanProductName(namePart);
  if (!name) return null;

  return {
    rawText: line,
    parsedName: name,
    parsedPrice: price,
    parsedQuantity,
  };
}

function extractStoreName(lines: string[]): string | undefined {
  const maxLines = Math.min(8, lines.length);

  for (let i = 0; i < maxLines; i++) {
    const normalized = normalizeText(lines[i]).replace(/[^a-z0-9\s]/g, " ");
    const compact = normalized.replace(/\s+/g, " ").trim();
    if (!compact) continue;

    for (const store of KNOWN_STORES) {
      if (compact.includes(store)) {
        return store;
      }
    }

    const genericStoreMatch = compact.match(
      /^(?:supermercado|tienda|comercio)\s+(.+)$/,
    );
    if (genericStoreMatch && genericStoreMatch[1]) {
      return genericStoreMatch[1].trim();
    }
  }

  return undefined;
}

function cleanProductName(name: string): string {
  return normalizeText(name)
    .replace(/\s+/g, " ")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9\s]+$/, "")
    .trim()
    .toLowerCase();
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export async function saveParsedItems(
  receiptId: string,
  parsed: ParsedReceipt,
): Promise<void> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { householdId: true },
  });
  if (!receipt) {
    throw new NotFoundError("Receipt not found");
  }

  await prisma.$transaction(async (tx) => {
    // Replace, never append: this ran once per upload until the 2026-08-29
    // review asked what a second run does — it doubled every line, and a
    // doubled line double-books stock on apply.
    await tx.receiptItem.deleteMany({ where: { receiptId } });

    // Update receipt with parsed metadata
    await tx.receipt.update({
      where: { id: receiptId },
      data: {
        purchaseDate: parsed.purchaseDate,
        totalAmount: parsed.totalAmount,
        status: ReceiptStatus.PARSED,
      },
    });

    // Find or create store
    if (parsed.storeName) {
      const existingStore = await tx.store.findFirst({
        where: {
          name: { equals: parsed.storeName, mode: "insensitive" },
          householdId: receipt.householdId,
        },
      });

      const store =
        existingStore ??
        (await tx.store.create({
          data: {
            name: parsed.storeName,
            householdId: receipt.householdId,
          },
        }));

      await tx.receipt.update({
        where: { id: receiptId },
        data: { storeId: store.id },
      });
    }

    // Create receipt items
    for (const item of parsed.items) {
      await tx.receiptItem.create({
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
  });
}
