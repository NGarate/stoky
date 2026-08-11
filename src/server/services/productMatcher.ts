import { prisma } from "@/lib/prisma";
import { MatchStatus, ReceiptStatus } from "@prisma/client";
import { NotFoundError } from "./errors";

interface ProductMatch {
  productId: string;
  name: string;
  similarity: number;
}

interface MatchResult {
  receiptItemId: string;
  parsedName: string;
  autoMatch: ProductMatch | null;
  candidates: ProductMatch[];
}

const AUTO_MATCH_THRESHOLD = 0.7;
const MIN_CANDIDATE_THRESHOLD = 0.3;
const MAX_CANDIDATES = 5;

function normalizeForSimilarity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(
    normalizeForSimilarity(left).split(" ").filter(Boolean),
  );
  const rightTokens = new Set(
    normalizeForSimilarity(right).split(" ").filter(Boolean),
  );

  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let commonTokens = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      commonTokens += 1;
    }
  }

  return commonTokens / Math.min(leftTokens.size, rightTokens.size);
}

export async function matchReceiptItems(
  receiptId: string,
): Promise<MatchResult[]> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      items: true,
      household: {
        include: {
          products: true,
        },
      },
    },
  });

  if (!receipt) {
    throw new NotFoundError("Receipt not found");
  }

  const results: MatchResult[] = [];

  for (const item of receipt.items) {
    const matches = await findProductMatches(
      item.parsedName || item.rawText,
      receipt.householdId,
    );

    const autoMatch =
      matches.length > 0 && matches[0].similarity >= AUTO_MATCH_THRESHOLD
        ? matches[0]
        : null;

    const candidates = matches.filter(
      (m) => m.similarity >= MIN_CANDIDATE_THRESHOLD,
    );

    // Update receipt item with match results
    if (autoMatch) {
      await prisma.receiptItem.update({
        where: { id: item.id },
        data: {
          matchedProductId: autoMatch.productId,
          matchConfidence: autoMatch.similarity,
          matchStatus: MatchStatus.AUTO_MATCHED,
        },
      });
    } else {
      await prisma.receiptItem.update({
        where: { id: item.id },
        data: {
          matchStatus: MatchStatus.PENDING,
        },
      });
    }

    results.push({
      receiptItemId: item.id,
      parsedName: item.parsedName || item.rawText,
      autoMatch,
      candidates: candidates.slice(0, MAX_CANDIDATES),
    });
  }

  // Determine if receipt needs review
  const pendingItems = results.filter((r) => !r.autoMatch).length;
  const autoMatchedItems = results.filter((r) => r.autoMatch).length;

  if (pendingItems === 0) {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { status: ReceiptStatus.CONFIRMED },
    });
  } else if (autoMatchedItems > 0) {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { status: ReceiptStatus.NEEDS_REVIEW },
    });
  } else {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { status: ReceiptStatus.NEEDS_REVIEW },
    });
  }

  return results;
}

async function findProductMatches(
  parsedName: string,
  householdId: string,
): Promise<ProductMatch[]> {
  const normalizedParsedName = normalizeForSimilarity(parsedName);

  // Use pg_trgm similarity function
  const products = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      trigramSimilarity: number;
    }>
  >`
    SELECT
      id,
      name,
      GREATEST(
        similarity(lower(name), ${normalizedParsedName}),
        word_similarity(lower(name), ${normalizedParsedName}),
        strict_word_similarity(lower(name), ${normalizedParsedName}),
        word_similarity(${normalizedParsedName}, lower(name)),
        strict_word_similarity(${normalizedParsedName}, lower(name))
      ) AS "trigramSimilarity"
    FROM "Product"
    WHERE "householdId" = ${householdId}
    ORDER BY "trigramSimilarity" DESC
    LIMIT 50
  `;

  return products
    .map((product) => {
      const boostedSimilarity = Math.max(
        product.trigramSimilarity,
        tokenSimilarity(product.name, parsedName),
      );
      return {
        productId: product.id,
        name: product.name,
        similarity: boostedSimilarity,
      };
    })
    .filter((product) => product.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10);
}

export async function getItemCandidates(
  receiptItemId: string,
): Promise<ProductMatch[]> {
  const item = await prisma.receiptItem.findUnique({
    where: { id: receiptItemId },
    include: {
      receipt: {
        select: {
          householdId: true,
        },
      },
    },
  });

  if (!item) {
    throw new NotFoundError("Receipt item not found");
  }

  const parsedName = item.parsedName || item.rawText;
  return findProductMatches(parsedName, item.receipt.householdId);
}
