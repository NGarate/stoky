import { prisma } from "@/lib/prisma";
import { MatchStatus, ReceiptStatus } from "@prisma/client";

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
    throw new Error("Receipt not found");
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
  // Use pg_trgm similarity function
  const products = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      similarity: number;
    }>
  >`
    SELECT 
      id,
      name,
      similarity(name, ${parsedName}) as similarity
    FROM "Product"
    WHERE "householdId" = ${householdId}
      AND similarity(name, ${parsedName}) > 0.1
    ORDER BY similarity DESC
    LIMIT 10
  `;

  return products.map((p) => ({
    productId: p.id,
    name: p.name,
    similarity: p.similarity,
  }));
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
    throw new Error("Receipt item not found");
  }

  const parsedName = item.parsedName || item.rawText;
  return findProductMatches(parsedName, item.receipt.householdId);
}
