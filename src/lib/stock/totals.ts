import { Prisma, type PrismaClient } from "@/generated/prisma/client";

/**
 * Net stock per product: the sum of its movements, exact, since they are
 * `numeric`.
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
): Promise<Map<string, Prisma.Decimal>> {
  const totals = new Map(
    productIds.map((id) => [id, new Prisma.Decimal(0)] as const),
  );
  if (productIds.length === 0) return totals;

  const rows = await db.stockEntry.groupBy({
    by: ["productId"],
    where: { productId: { in: [...productIds] } },
    _sum: { quantity: true },
  });
  for (const row of rows) {
    if (row._sum.quantity) totals.set(row.productId, row._sum.quantity);
  }
  return totals;
}
