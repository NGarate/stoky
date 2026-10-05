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

/** What `normalizeForSimilarity` strips, for the SQL side of the comparison. */
const ACCENTED = "áàâäéèêëíìîïóòôöúùûüñç";
const UNACCENTED = "aaaaeeeeiiiioooouuuunc";

function normalizeForSimilarity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words that join a product name together without saying what it is. "Pan de
 * molde" and "pan" share "pan"; they do not share "de".
 */
const STOP_WORDS = new Set([
  "a", "al", "con", "de", "del", "el", "en", "la", "las", "los", "para", "por", "y",
]);

function contentTokens(value: string): Set<string> {
  return new Set(
    normalizeForSimilarity(value)
      .split(" ")
      .filter((token) => token && !STOP_WORDS.has(token)),
  );
}

/**
 * How much of both names their shared words cover — Dice's coefficient,
 * `2·common / (|A| + |B|)`.
 *
 * It divided by the *smaller* name until the 2026-10-05 review: one shared
 * word out of a one-word name scored 1.0, so "Leche" scored 1.0 against
 * "LECHE DE COCO" and "Pan" against "Pan de molde", and a household with a
 * product called "Leche" had every line containing that word auto-matched to
 * it. Over both sizes those come to 0.67.
 */
export function tokenSimilarity(left: string, right: string): number {
  const leftTokens = contentTokens(left);
  const rightTokens = contentTokens(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let commonTokens = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      commonTokens += 1;
    }
  }

  return (2 * commonTokens) / (leftTokens.size + rightTokens.size);
}

/**
 * The score a product is ranked and decided by.
 *
 * **Only pg_trgm's `similarity()` can reach the auto-match threshold.** It is
 * symmetric, so a short name inside a long one scores low from both ends —
 * "leche" against "leche de coco" is 0.43. The other signals are containment
 * measures: `word_similarity` is 1.0 whenever one name appears inside the
 * other, in whichever argument order, and the token overlap is high whenever
 * one name is mostly the other's words. They are good at finding candidates
 * and wrong about identity, so they are capped just under the threshold: they
 * can put a product in front of the person, never confirm it for them.
 */
export function matchScore(trigramSimilarity: number, containment: number): number {
  return Math.max(
    trigramSimilarity,
    Math.min(containment, AUTO_MATCH_THRESHOLD - 0.01),
  );
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

  // pg_trgm, both ways: the symmetric `similarity()` that decides, and the
  // containment measures that only rank (see `matchScore`). Ordered by the
  // larger so a product found only by containment is still among the fifty.
  const products = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      trigramSimilarity: number;
      containment: number;
    }>
  >`
    SELECT
      id,
      name,
      similarity(folded, ${normalizedParsedName}) AS "trigramSimilarity",
      GREATEST(
        word_similarity(folded, ${normalizedParsedName}),
        strict_word_similarity(folded, ${normalizedParsedName}),
        word_similarity(${normalizedParsedName}, folded),
        strict_word_similarity(${normalizedParsedName}, folded)
      ) AS "containment"
    FROM (
      -- Lower-cased and accent-folded like the parsed name it is compared
      -- with: receipts print "JAMON" for the household's "Jamón".
      SELECT id, name, translate(lower(name), ${ACCENTED}, ${UNACCENTED}) AS folded
      FROM "Product"
      WHERE "householdId" = ${householdId}
    ) AS product
    ORDER BY GREATEST(
      similarity(folded, ${normalizedParsedName}),
      word_similarity(folded, ${normalizedParsedName}),
      word_similarity(${normalizedParsedName}, folded)
    ) DESC
    LIMIT 50
  `;

  return products
    .map((product) => ({
      productId: product.id,
      name: product.name,
      similarity: matchScore(
        product.trigramSimilarity,
        Math.max(product.containment, tokenSimilarity(product.name, parsedName)),
      ),
    }))
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
