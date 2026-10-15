import type { HouseholdRole, Prisma, PrismaClient, User } from "@prisma/client";

/**
 * Where a password hash is stored, and the only code that knows.
 *
 * `password-hash.ts` owns how a password becomes a hash and how one is
 * checked; this module owns where the hash lives. Every caller that creates an
 * account with a password, reads a stored hash or sets a new one comes through
 * here: sign-in, registration, a person changing their own password, an admin
 * adding a member or setting a member's password, the demo seed and the test
 * factories.
 *
 * Today the hash is a column on `User`. Better Auth reads it from a
 * `credential` Account row instead, and with every reader and writer behind
 * these four functions that move changes this file and its callers do not
 * notice. A new `passwordHash` read or write anywhere else would be a second
 * place to move.
 *
 * Deliberately free of `@/` imports and of `server-only` (which is not
 * installed): `prisma/seed.ts` imports it by relative path.
 */

/** The root client, or the one an interactive transaction hands its callback. */
export type CredentialDb = PrismaClient | Prisma.TransactionClient;

/**
 * Creates an account that signs in with a password.
 *
 * The unchecked input — a scalar `householdId`, no nested household write —
 * is the one form every caller can use: registration creates the household
 * first in the same transaction and passes its id, an admin adding a member
 * passes their own household's.
 *
 * The returned row is the whole `User`. A caller that hands it on to a client
 * must pick the fields it means to (`household.addMember` does).
 */
export function createCredentialUser(
  db: CredentialDb,
  data: Omit<Prisma.UserUncheckedCreateInput, "passwordHash">,
  passwordHash: string,
): Promise<User> {
  return db.user.create({ data: { ...data, passwordHash } });
}

/** The account sign-in needs, and its stored hash; null when there is none. */
export interface Credential {
  user: Pick<User, "id" | "email" | "name" | "householdId" | "role">;
  passwordHash: string;
}

/**
 * The account registered at `email`, with its stored hash.
 *
 * Null means "no account", and the caller must then still run Argon2id
 * (against `DUMMY_PASSWORD_HASH`) so the answer costs the same either way.
 */
export async function findCredentialByEmail(
  db: CredentialDb,
  email: string,
): Promise<Credential | null> {
  const row = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      householdId: true,
      role: true,
      passwordHash: true,
    },
  });
  if (!row) return null;

  const { passwordHash, ...user } = row;
  return { user, passwordHash };
}

/** The stored hash of account `userId`; null when the account is gone. */
export async function readPasswordHash(
  db: CredentialDb,
  userId: string,
): Promise<string | null> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  return row?.passwordHash ?? null;
}

/** Whose password is being set, and what must still hold when it is written. */
export interface PasswordTarget {
  userId: string;
  /**
   * The household and role the caller checked before spending Argon2id on the
   * new hash. The write lands only if the account still has both, so a member
   * who left or was promoted in the meantime is not the one written to.
   */
  guard?: { householdId: string; role: HouseholdRole };
}

/**
 * Sets a new password hash and ends every session the account has, in one
 * write, and returns how many accounts it wrote (0 or 1).
 *
 * One write so a new password can never stand beside sessions that were meant
 * to end. 0 means the account is gone or no longer matches `guard`; the caller
 * decides what that means to the person asking.
 */
export async function setPasswordAndEndSessions(
  db: CredentialDb,
  target: PasswordTarget,
  passwordHash: string,
): Promise<number> {
  const { count } = await db.user.updateMany({
    where: { id: target.userId, ...target.guard },
    data: { passwordHash, sessionsValidFrom: new Date() },
  });
  return count;
}
