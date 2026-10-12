import * as argon2 from "argon2";

/**
 * How a password becomes a stored hash, and how a stored hash is checked —
 * the one place the application does either.
 *
 * Before this module the Argon2id parameters were written out at every call
 * site: `auth.register`, `household.addMember`, the demo seed and the test
 * factory each carried their own copy, and the dummy hash sign-in verifies
 * unknown addresses against named the same numbers in a comment that nothing
 * checked. A password change and a reset would have been a fifth and sixth
 * copy (security review, 2026-10-12). One copy cannot drift from the others.
 *
 * **The parameters** are the ones SECURITY.md records for passwords: Argon2id,
 * 64 MiB, three passes, four lanes — about a quarter of a second here. The
 * lane count was argon2's default and is written down now because the dummy
 * hash below names it. Changing any of them changes the cost of every new hash
 * and leaves existing ones verifying at the cost they were made with (the
 * encoded hash carries its own parameters); it also means regenerating
 * {@link DUMMY_PASSWORD_HASH}, which `password-hash.test.ts` will insist on.
 */
export const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * What a sign-in for an address with no account is verified against, so it
 * costs the same Argon2id as one with a wrong password.
 *
 * The hash of a random value nobody kept, so no password matches it. **Its
 * parameters must be {@link PASSWORD_HASH_OPTIONS}**: verifying runs at the
 * cost the stored hash names, so a cheaper dummy would reopen the timing
 * difference it exists to close. A constant rather than hashed at start-up, so
 * the first unknown address is not the one request that pays for hashing it.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$VZSmoJF5HpXm3vHhXficPw$b/zA/ilF3dqpyfmO2KWJjiyH4WLE0yQQRj8LZxrAsvg";

/** Hashes a password for storage, with {@link PASSWORD_HASH_OPTIONS}. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, PASSWORD_HASH_OPTIONS);
}

/**
 * Whether `password` is the one `storedHash` was made from.
 *
 * **Argon2id runs whether or not there is a hash to check.** With none — the
 * address has no account — it verifies against {@link DUMMY_PASSWORD_HASH} and
 * answers false. Skipping the work for a missing account answered "no such
 * address" in a few milliseconds and "wrong password" in a quarter of a
 * second, so a stopwatch told anyone which addresses are registered.
 */
export async function verifyPassword(
  storedHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  const matches = await argon2.verify(
    storedHash ?? DUMMY_PASSWORD_HASH,
    password,
  );
  return storedHash != null && matches;
}
