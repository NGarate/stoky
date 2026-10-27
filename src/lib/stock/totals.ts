import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Net stock per product: the sum of its movements, rounded once to the
 * hundredth, as `getStockOverview`'s SQL and `netStock` round it.
 *
 * One grouped query in the database. The readers that used this loaded every
 * movement a product had ever had and summed them in JavaScript — work that
 * grew with every week of use — and some rounded while others did not, so a
 * product hovering at its minimum could be low on one screen and not another.
 * A product with no movements is 0, not absent.
 */
export async function stockTotals(
  db: Pick<PrismaClient, "stockEntry">,
  productIds: readonly string[],
): Promise<Map<string, number>> {
  const totals = new Map(productIds.map((id) => [id, 0]));
  if (productIds.length === 0) return totals;

  const rows = await db.stockEntry.groupBy({
    by: ["productId"],
    where: { productId: { in: [...productIds] } },
    _sum: { quantity: true },
  });
  for (const row of rows) {
    totals.set(row.productId, Math.round((row._sum.quantity ?? 0) * 100) / 100);
  }
  return totals;
}
