import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * A client for the database at `url`, through node-postgres.
 *
 * Prisma 7 has no query engine of its own: every client is given a driver
 * adapter, and the pool is the driver's. node-postgres waits for a
 * connection forever unless told otherwise, where Prisma 6 gave up after
 * five seconds, so the five seconds are stated here — a request against a
 * database that is down fails and says so instead of hanging until the proxy
 * times it out. The pool size stays pg's ten.
 *
 * The one constructor, so the application, the seed and the tests that need a
 * database of their own all connect the same way. `?schema=public` in a URL
 * is Prisma 6's spelling and pg ignores it; public is where pg looks anyway.
 */
export function createPrismaClient(
  url: string | undefined = process.env.DATABASE_URL,
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter });
}

/** The client kept across hot reloads, and the generated class that made it. */
interface Kept {
  client: PrismaClient;
  generatedBy: unknown;
}

/**
 * The kept client when the class that made it is the one generated now;
 * otherwise none, and the stale one's pool closed.
 *
 * The client is kept on `global` in development so a hot reload does not
 * open another pool each time. But regenerating it after a schema change
 * reloads the generated module as a new class, and the instance kept from
 * before went on serving: it did not know the new column, so every query
 * naming it was a 500 until `next dev` was restarted — on 2026-11-12, every
 * receipt upload, once `Receipt.ticketQuad` existed. Compared by the class
 * kept beside it, because `instanceof` cannot tell: the constructor hands
 * back a proxy, which is an instance of no class.
 */
export function reusableClient(
  kept: Kept | undefined,
  generatedBy: unknown = PrismaClient,
): PrismaClient | undefined {
  if (kept && kept.generatedBy === generatedBy) return kept.client;
  void kept?.client.$disconnect();
  return undefined;
}

const globalForPrisma = global as unknown as { prismaClient?: Kept };

export const prisma =
  reusableClient(globalForPrisma.prismaClient) ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaClient = { client: prisma, generatedBy: PrismaClient };
}
