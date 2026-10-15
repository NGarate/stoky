import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Ending sessions, which is deleting their rows, in one place.
 *
 * A session is a `Session` row and nothing else: Better Auth reads the row on
 * every request (the cookie cache is off, `src/lib/auth/instance.ts`), so a
 * deleted row is a session that has ended everywhere at once. Everything that
 * ends sessions — a person ending their own, an admin ending a member's, a
 * password being set — comes through here, so what "ended" means can change
 * in one file.
 *
 * Deliberately free of `@/` imports, like `credentials.ts`, which calls it and
 * which `prisma/seed.ts` imports by relative path.
 */

/** The root client, or the one an interactive transaction hands its callback. */
export type SessionDb = PrismaClient | Prisma.TransactionClient;

/**
 * Deletes every session matching `where` and returns how many it deleted.
 *
 * **Refuses a filter with a missing value.** Prisma reads `{ userId:
 * undefined }` as "no condition", so a caller that lost its id on the way
 * here would end every session on the instance. An empty filter is refused for
 * the same reason: nothing here ever means "everyone". So is a missing value
 * one level down — `{ id: { not: undefined } }`, "every session but this
 * one" asked by a caller that has no "this one", is no condition either
 * (D143).
 */
export async function endSessions(
  db: SessionDb,
  where: Prisma.SessionWhereInput,
): Promise<number> {
  const entries = Object.entries(where);
  const missing = (value: unknown) =>
    value === undefined ||
    (value !== null &&
      typeof value === "object" &&
      Object.values(value).some((inner) => inner === undefined));
  if (entries.length === 0 || entries.some(([, value]) => missing(value))) {
    throw new Error("endSessions refuses a filter that would match every session");
  }
  const { count } = await db.session.deleteMany({ where });
  return count;
}
