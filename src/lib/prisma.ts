import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

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

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
