import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { prisma } from "@/lib/prisma";
import {
  matchReceiptItems,
  getItemCandidates,
} from "@/server/services/productMatcher";
import {
  parseReceiptText,
  saveParsedItems,
} from "@/server/services/receiptParser";
import { MatchStatus, ReceiptStatus } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";

/**
 * A receipt's lines matched to the household's products by pg_trgm against
 * the real database: auto above 0.7, candidates from 0.3, nothing below.
 * The pure scoring is `unit/productMatcher.test.ts`'s.
 */

let householdId: string;
let userId: string;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `test-${randomUUID()}@example.com`, name: "Test User" },
  });
  userId = user.id;
  const household = await prisma.household.create({
    data: { name: "Test Household", members: { connect: { id: user.id } } },
  });
  householdId = household.id;
});

afterEach(async () => {
  await prisma.receiptItem.deleteMany({ where: { receipt: { householdId } } });
  await prisma.receipt.deleteMany({ where: { householdId } });
  await prisma.product.deleteMany({ where: { householdId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.household.delete({ where: { id: householdId } });
});

const product = (name: string, inHousehold = householdId) =>
  prisma.product.create({
    data: { name, householdId: inHousehold, defaultUnit: "unidad" },
  });

/** Parse `lines` as a receipt of this household's and match it. */
async function matchReceipt(lines: string) {
  const receipt = await prisma.receipt.create({
    data: {
      imagePath: `/nonexistent/${randomUUID()}.jpg`,
      status: ReceiptStatus.UPLOADING,
      householdId,
      uploadedBy: userId,
    },
  });
  await saveParsedItems(receipt.id, parseReceiptText(`TIENDA\n${lines}`));
  const matches = await matchReceiptItems(receipt.id);
  const saved = await prisma.receipt.findUniqueOrThrow({
    where: { id: receipt.id },
    include: { items: true },
  });
  return { receipt, matches, status: saved.status, items: saved.items };
}

const matchLines = async (lines: string) => (await matchReceipt(lines)).matches;

/** Every product a match names, the auto-match first. */
const named = (match: Awaited<ReturnType<typeof matchLines>>[number]) => [
  ...(match.autoMatch ? [match.autoMatch.productId] : []),
  ...match.candidates.map((c) => c.productId),
];

describe("what a line is matched to", () => {
  it("auto-matches the product of the same name, and saves the line as matched", async () => {
    const leche = await product("leche semi desnatada");

    const { matches, items } = await matchReceipt("Leche semi desnatada 1,25");

    expect(matches[0].autoMatch?.productId).toBe(leche.id);
    expect(matches[0].autoMatch?.similarity).toBeGreaterThanOrEqual(0.7);
    expect(items[0].matchStatus).toBe(MatchStatus.AUTO_MATCHED);
    expect(items[0].matchedProductId).toBe(leche.id);
  });

  it("offers a shortened name as a candidate rather than auto-matching it", async () => {
    // "leche semi" is inside "leche semi desnatada" — and equally inside
    // "leche semi sin lactosa". Containment finds the product; it does not
    // get to confirm it.
    const leche = await product("leche semi desnatada");

    const [match] = await matchLines("leche semi 1,25");

    expect(match.autoMatch).toBeNull();
    expect(match.candidates[0]?.productId).toBe(leche.id);
    expect(match.candidates[0]?.similarity).toBeGreaterThanOrEqual(0.3);
    expect(match.candidates[0]?.similarity).toBeLessThan(0.7);
  });

  it("offers what shares a word, and not what shares nothing", async () => {
    const entera = await product("leche entera");
    await product("yogur natural");

    const [match] = await matchLines("Leche desnatada 1,25");

    expect(match.autoMatch).toBeNull();
    expect(match.candidates.map((c) => c.productId)).toEqual([entera.id]);
    expect(match.candidates[0].similarity).toBeGreaterThanOrEqual(0.3);
    expect(match.candidates[0].similarity).toBeLessThan(0.7);
  });

  it("offers nothing for a line like no product", async () => {
    await product("manzanas golden");

    const [match] = await matchLines(
      "Producto completamente diferente xyz123 5,00",
    );

    expect(match.autoMatch).toBeNull();
    expect(match.candidates).toEqual([]);
  });

  it("does not auto-match a one-word product to every line containing the word", async () => {
    await product("Leche");
    await product("Pan");

    const { matches, status } = await matchReceipt(
      "LECHE DE COCO 2,10\nPAN DE MOLDE 1,20",
    );

    expect(matches.map((m) => m.autoMatch)).toEqual([null, null]);
    // Before: both lines auto-matched, and with nothing left pending the
    // receipt skipped review and went straight to CONFIRMED.
    expect(status).toBe(ReceiptStatus.NEEDS_REVIEW);
  });

  it("auto-matches a receipt's unaccented name to an accented product", async () => {
    const jamon = await product("Jamón");

    const [match] = await matchLines("JAMON 4,50");

    expect(match.autoMatch?.productId).toBe(jamon.id);
    expect(match.autoMatch?.similarity).toBe(1);
  });

  it("folds the same letters the inventory search folds", async () => {
    // The matcher's list lacked "ã" and "õ" while the inventory's had them,
    // so "pao" found "Pão" in a search and only half-matched it here.
    const pao = await product("Pão de forma");

    const [match] = await matchLines("PAO DE FORMA 1,80");

    expect(match.autoMatch?.productId).toBe(pao.id);
    expect(match.autoMatch?.similarity).toBe(1);
  });

  it("finds the product with its words in another order, or misread", async () => {
    const yogur = await product("yogur natural desnatado");
    const chocolate = await product("chocolate con leche");

    const [reordered, misread] = await matchLines(
      "yogur desnatado natural 1,80\nchocolat con leche 2,50",
    );

    expect(named(reordered)).toContain(yogur.id);
    expect(named(misread)).toContain(chocolate.id);
  });

  it("offers five candidates at most", async () => {
    for (let i = 0; i < 10; i++) await product(`producto similar ${i}`);

    const [match] = await matchLines("producto similar 1,00");

    expect(match.candidates).toHaveLength(5);
  });

  it("never offers another household's product", async () => {
    const other = await prisma.household.create({
      data: { name: "Other Household" },
    });
    try {
      await product("leche semi desnatada", other.id);

      const [match] = await matchLines("Leche semi desnatada 1,25");

      expect(match.autoMatch).toBeNull();
      expect(match.candidates).toEqual([]);
    } finally {
      await prisma.product.deleteMany({ where: { householdId: other.id } });
      await prisma.household.delete({ where: { id: other.id } });
    }
  });
});

describe("where the receipt goes next", () => {
  it("is CONFIRMED when every line auto-matched", async () => {
    await product("leche");
    await product("pan");

    const { status } = await matchReceipt("leche 1,25\npan 0,95");

    expect(status).toBe(ReceiptStatus.CONFIRMED);
  });

  it("goes to a person when nothing was read, rather than straight to CONFIRMED", async () => {
    const { matches, status } = await matchReceipt("");

    expect(matches).toEqual([]);
    expect(status).toBe(ReceiptStatus.NEEDS_REVIEW);
  });

  it("refuses a receipt that does not exist", async () => {
    await expect(matchReceiptItems("non-existent-receipt-id")).rejects.toThrow(
      "Receipt not found",
    );
  });
});

describe("getItemCandidates", () => {
  it("offers a line the products that share its words", async () => {
    const lecheProducts = await Promise.all(
      ["leche entera", "leche semi", "leche desnatada"].map((n) => product(n)),
    );
    const { items } = await matchReceipt("leche 1,25");

    const candidates = await getItemCandidates(items[0].id);

    expect(candidates.map((c) => c.productId).sort()).toEqual(
      lecheProducts.map((p) => p.id).sort(),
    );
    for (const candidate of candidates) {
      expect(candidate.similarity).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("refuses a line that does not exist", async () => {
    await expect(getItemCandidates("non-existent-item-id")).rejects.toThrow(
      "Receipt item not found",
    );
  });
});
