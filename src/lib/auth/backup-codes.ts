import { createHash } from "node:crypto";

/**
 * Two-step verification's backup codes, made and stored our way (PROGRESS
 * D149, ASVS 5.0.0 6.5.2).
 *
 * Better Auth's own are ten codes of ten characters from 62 — about 60 bits
 * each — kept encrypted with `STOKY_SECRET`, so whoever reads the database and
 * the secret reads every code, and a rotation of the secret leaves a person
 * whose authenticator just became unreadable with codes that are unreadable
 * too (ISSUES AUTH-6). ASVS 6.5.2 lets a lookup secret be stored as a plain
 * hash when it carries at least 112 bits; these carry 120:
 *
 * - **Ten codes of 24 Crockford base32 characters**, five bits each, shown as
 *   six groups of four. Crockford, because it is read off paper and typed:
 *   no I, L, O or U, and the letters people confuse with digits are read as
 *   those digits (`normaliseBackupCode`).
 * - **Stored as `sha256:<hex>`** of the normalised code. A hash, not a
 *   ciphertext: the database alone gives none of them back, and no secret is
 *   involved, so a rotation leaves them working — the way back in for a
 *   person whose authenticator it made unreadable.
 *
 * Better Auth keeps the list and spends a code itself: it reads the stored
 * list through `decrypt`, looks for the typed code with `includes`, and writes
 * the list without it through `encrypt`, conditionally on the list it read.
 * So `encrypt` hashes what is not yet a hash — the new codes at enrolment and
 * regeneration — and leaves the rest alone, `decrypt` hands the hashes back as
 * they are, and the policy plugin turns the typed code into its hash before
 * Better Auth looks (`src/lib/auth/policy-plugin.ts`).
 */

/** Crockford's base32 alphabet: digits, then the letters without I, L, O and U. */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const BACKUP_CODE_COUNT = 10;
/** Characters per code, before grouping. */
export const BACKUP_CODE_LENGTH = 24;
const GROUP = 4;
/** What every stored code starts with: the one form `encrypt` writes. */
export const BACKUP_CODE_HASH_PREFIX = "sha256:";

/** Bits of entropy in one code. ASVS 6.5.2 asks for 112 before a plain hash will do. */
export const BACKUP_CODE_BITS =
  BACKUP_CODE_LENGTH * Math.log2(CROCKFORD_ALPHABET.length);

type RandomBytes = (bytes: Uint8Array) => Uint8Array;

/**
 * Ten new codes, as the person is shown them: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.
 *
 * One random byte per character, its low five bits picking the character:
 * 256 is a multiple of 32, so every character is equally likely.
 */
export function generateBackupCodes(
  random: RandomBytes = (bytes) => crypto.getRandomValues(bytes),
): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const bytes = random(new Uint8Array(BACKUP_CODE_LENGTH));
    const characters = Array.from(
      bytes,
      (byte) => CROCKFORD_ALPHABET[byte & 31],
    ).join("");
    const groups: string[] = [];
    for (let at = 0; at < characters.length; at += GROUP)
      groups.push(characters.slice(at, at + GROUP));
    return groups.join("-");
  });
}

/**
 * A code as typed, in the form it was hashed in: upper case, without spaces
 * or dashes, O read as zero and I or L as one. So `abcd efgh…` and
 * `ABCD-EFGH-…` are the same code, as Crockford intends.
 */
export function normaliseBackupCode(typed: string): string {
  return typed
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** What is stored for a code, and what a typed code is compared as. */
export function hashBackupCode(typed: string): string {
  const digest = createHash("sha256")
    .update(normaliseBackupCode(typed), "utf8")
    .digest("hex");
  return `${BACKUP_CODE_HASH_PREFIX}${digest}`;
}

function codeList(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((code) => typeof code === "string")
  ) {
    throw new Error("[auth] backup codes are not a list of strings");
  }
  return parsed;
}

/**
 * Better Auth's `storeBackupCodes`, in its custom form. `encrypt` is given the
 * list as JSON and is idempotent: a code already stored as a hash stays as it
 * is, which is how the list Better Auth writes back after spending one keeps
 * the others.
 */
export const storeBackupCodes = {
  encrypt: async (json: string): Promise<string> =>
    JSON.stringify(
      codeList(json).map((code) =>
        code.startsWith(BACKUP_CODE_HASH_PREFIX) ? code : hashBackupCode(code),
      ),
    ),
  decrypt: async (stored: string): Promise<string> => stored,
};
