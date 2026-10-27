import type {
  HouseholdRole,
  Prisma,
  PrismaClient,
  User,
} from "@/generated/prisma/client";
import { endSessions } from "./end-sessions";

/**
 * The `providerId` of the Account row that holds a password hash. Better Auth's
 * email-and-password sign-in reads exactly this row, with `accountId` equal to
 * the user's id.
 */
const CREDENTIAL_PROVIDER = "credential";

/**
 * Where a password hash is stored, and the only code that knows.
 *
 * `password-hash.ts` owns how a password becomes a hash and how one is
 * checked; this module owns where the hash lives. Every caller of ours that
 * creates an account with a password, reads a stored hash or sets a new one
 * comes through here: registration, the re-entered password
 * (`src/lib/auth/reauth.ts`), an admin adding a member or setting a member's
 * password, the demo seed and the test factories. Better Auth is the one other
 * reader and writer, through its own contract with the row: it reads the hash
 * at sign-in and writes it when a person changes their own password (PROGRESS
 * D144), with our Argon2id either way (`password-hash.ts`).
 *
 * The hash lives in the `credential` Account row (`providerId` "credential",
 * `accountId` the user's id), which is where Better Auth reads it (PROGRESS
 * D134). It moved there from a column on `User` without any caller noticing,
 * because every reader and writer was already behind these functions. A
 * read or write of `Account.password` anywhere else would be a second place
 * that knows.
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
 * Two rows, the user and its credential Account, and never one without the
 * other: a user with no credential cannot sign in and cannot be registered
 * again under the same address. Given the root client, the two writes run in a
 * transaction of their own; given a transaction's client, they join the
 * caller's, whose rollback then takes both.
 *
 * The returned row is the `User`. It no longer carries the hash, but a caller
 * that hands it on to a client still picks the fields it means to
 * (`household.addMember` does).
 */
export function createCredentialUser(
  db: CredentialDb,
  data: Prisma.UserUncheckedCreateInput,
  passwordHash: string,
): Promise<User> {
  const create = async (tx: Prisma.TransactionClient): Promise<User> => {
    const user = await tx.user.create({ data });
    await tx.account.create({
      data: {
        accountId: user.id,
        providerId: CREDENTIAL_PROVIDER,
        userId: user.id,
        password: passwordHash,
      },
    });
    return user;
  };
  return "$transaction" in db ? db.$transaction(create) : create(db);
}

/**
 * The stored hash among a user's Account rows: the credential one, keyed on the
 * user's own id. Anything else (none exists today) is not a password.
 */
function credentialHash(
  userId: string,
  accounts: { accountId: string; password: string | null }[],
): string | null {
  return accounts.find((a) => a.accountId === userId)?.password ?? null;
}

const CREDENTIAL_ACCOUNTS = {
  where: { providerId: CREDENTIAL_PROVIDER },
  select: { accountId: true, password: true },
} as const;

/**
 * The stored hash of account `userId`; null when the account is gone or has no
 * credential row.
 */
export async function readPasswordHash(
  db: CredentialDb,
  userId: string,
): Promise<string | null> {
  const accounts = await db.account.findMany({
    where: { userId, ...CREDENTIAL_ACCOUNTS.where },
    select: CREDENTIAL_ACCOUNTS.select,
  });
  return credentialHash(userId, accounts);
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
 * Sets a new password hash, ends every session the account has and removes
 * its passkeys, in one transaction, and returns how many accounts it wrote
 * (0 or 1).
 *
 * One transaction so a new password can never stand beside sessions that were
 * meant to end: the session rows are deleted with the hash written
 * (`endSessions`). 0 means the account is gone or no longer matches `guard`;
 * the caller decides what that means to the person asking.
 *
 * **The passkeys go too** (D151). Anybody who knew the old password and held
 * a session could have added one — the step-up asks for that password — and
 * a passkey signs in without any password, so a reset meant to shut out
 * whoever knew the old one would leave them a way back in. Nobody but the
 * account can see its passkeys to judge which are whose, so all of them go;
 * the person adds theirs again from Seguridad y acceso.
 *
 * The User write goes first and is the guard: its `where` carries the guard,
 * and the row lock it takes — the write is to `updatedAt`, which changes
 * nothing anyone reads — holds the account still until the hash is written, so
 * a promotion or a move between households cannot slip in between the check
 * and the credential write.
 */
export function setPasswordAndEndSessions(
  db: CredentialDb,
  target: PasswordTarget,
  passwordHash: string,
): Promise<number> {
  const write = async (tx: Prisma.TransactionClient): Promise<number> => {
    const { count } = await tx.user.updateMany({
      where: { id: target.userId, ...target.guard },
      data: { updatedAt: new Date() },
    });
    if (count === 0) return 0;

    await tx.account.updateMany({
      where: {
        userId: target.userId,
        accountId: target.userId,
        providerId: CREDENTIAL_PROVIDER,
      },
      data: { password: passwordHash },
    });
    await tx.passkey.deleteMany({ where: { userId: target.userId } });
    await endSessions(tx, { userId: target.userId });
    return count;
  };
  return "$transaction" in db ? db.$transaction(write) : write(db);
}
