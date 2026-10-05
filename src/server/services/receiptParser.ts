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

/**
 * One printed amount, as a Spanish till prints it: `0,89`, `1.234,56`, and the
 * dot-decimal `1.25` some tills and most OCR slips produce.
 *
 * Written once, because there used to be four `\d+[,.]\d{2}` patterns and
 * none of them knew about the thousands separator: `1.234,56` read as `1.23`
 * followed by `4,56`, so a 1.234,56 € line was booked at 4,56 € and a total of
 * the same at 1,23 €. Bounded on both sides so a number is taken whole or not
 * at all — `0,345` (a weight) is not the price `0,34`, and the `234,56` inside
 * `1.234,56` is never a match of its own.
 */
const AMOUNT_SOURCE = String.raw`(?<![\d.,])(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{2})(?![\d])`;

function amountPattern(): RegExp {
  return new RegExp(AMOUNT_SOURCE, "g");
}

/**
 * The value of one amount `AMOUNT_SOURCE` matched — the only place a printed
 * amount becomes a number, so the separator rules cannot drift between the
 * total, the lines and the no-newline fallback again.
 */
export function parseEsAmount(text: string): number {
  const trimmed = text.trim();
  // `1.234,56`: the dots group thousands and the comma is the decimal point.
  const normalised = /^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(trimmed)
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed.replace(",", ".");
  return Number.parseFloat(normalised);
}

/**
 * The word that labels a total, as a whole word and not after "sub": a
 * subtotal is the amount *before* the discounts the total is after.
 *
 * Followed by what it must not be followed by — `TOTAL AHORRO 0,50` and
 * `IMPORTE ENTREGADO 10,00` are labelled with the same word and are not what
 * was paid.
 */
const TOTAL_LABEL =
  /(?<!sub[\s.-]?)\b(?:total|importe|suma)\b(?!\s*(?:ahorr|descuento|dto|puntos|entregad|devol|cambio))/gi;

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
  result.totalAmount = extractTotal(lines);

  // Extract items
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\b(?:total|importe|suma)\b.*$/i, "").trim();
    const priceMatches = line.match(amountPattern()) ?? [];

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
        new RegExp(
          String.raw`([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s/-]{1,}?)\s+(${AMOUNT_SOURCE})`,
          "g",
        ),
      ),
    ];

    for (const match of matches) {
      const name = cleanProductName(match[1]);
      const price = parseEsAmount(match[2]);
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

/**
 * What the receipt says was paid.
 *
 * Read a line at a time, and from the last line that carries a total. It used
 * to be one pattern over the whole text, which went wrong two ways: `total`
 * matched inside `SUBTOTAL`, so `SUBTOTAL 2,09 / DESCUENTO 0,50 / TOTAL 1,59`
 * came out at 2,09; and its `\s` crossed newlines, so a column header ending in
 * `Importe` ran on into the first item line and took that item's price.
 *
 * The last total line rather than the first because what a till prints after
 * its subtotal and discounts is the amount charged. Only a line with a single
 * amount after its label counts: the tax summary at the foot of a Mercadona
 * ticket closes with `TOTAL 8,00 0,80` — base and tax, not the charge — and
 * would otherwise be the last total line on the receipt.
 */
function extractTotal(lines: string[]): number | undefined {
  let total: number | undefined;

  for (const line of lines) {
    const labels = [...line.matchAll(TOTAL_LABEL)];
    const label = labels.at(-1);
    if (label?.index === undefined) continue;

    const after = line.slice(label.index + label[0].length);
    const amounts = after.match(amountPattern()) ?? [];
    if (amounts.length === 1) {
      total = parseEsAmount(amounts[0]);
    }
  }

  return total;
}

function parseLineItem(line: string): ParsedItem | null {
  const quantityPrefixMatch = line.match(
    new RegExp(
      String.raw`^(\d+(?:[.,]\d+)?)\s*x\s*(.+?)\s+(${AMOUNT_SOURCE})\s*$`,
      "i",
    ),
  );
  if (quantityPrefixMatch) {
    const quantity = Number.parseFloat(
      quantityPrefixMatch[1].replace(",", "."),
    );
    const name = cleanProductName(quantityPrefixMatch[2]);
    const price = parseEsAmount(quantityPrefixMatch[3]);
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

  const prices = [...line.matchAll(amountPattern())];
  if (prices.length === 0) return null;

  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  if (firstPrice.index === undefined) return null;
  const price = parseEsAmount(lastPrice[0]);
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
