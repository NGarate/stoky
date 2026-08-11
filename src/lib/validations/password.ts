import { z } from "zod";

/**
 * What makes a password acceptable here.
 *
 * **Length over composition, which is the opposite of what `ISSUES.md` DEBT-1
 * proposed.** That entry suggested the familiar four regexes — an uppercase, a
 * lowercase, a digit, a symbol. NIST SP 800-63B §5.1.1.2 advises against
 * exactly that: composition rules push people toward `Password1!`, which is
 * predictable in a way a longer passphrase is not, and they are the reason
 * people write passwords down. This project already cites SP 800-63B for rate
 * limiting; applying it here and ignoring it there would be picking the parts
 * that were easy.
 *
 * So: a longer minimum, no composition rules, a check against the passwords
 * everyone actually uses, and a refusal to accept the account's own name or
 * address as its password.
 *
 * **And a maximum**, which is not a usability rule at all. `argon2.hash` and
 * `argon2.verify` were both taking unbounded input on two endpoints reachable
 * without an account, and Argon2id here is configured at 64 MB per call. A
 * body of a few megabytes turns registration into a memory amplifier. The rate
 * limiter bounds how often, not how much.
 */

/**
 * Twelve, not eight.
 *
 * SP 800-63B's floor for a user-chosen secret is 8, and it assumes the
 * verifier also checks against breached lists at scale — which a self-hosted
 * box with no outbound network cannot do. Twelve buys back some of what the
 * missing breach check gives away, and costs a person one more word.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** SP 800-63B §5.1.1.2 asks for at least 64 to be accepted. This is generous. */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * The passwords people actually pick, lowercased.
 *
 * A floor, not a breach corpus: the real check is against a list of hundreds of
 * millions, and that needs either a large local file or an outbound call to a
 * service — neither of which belongs in a self-hosted install that is expected
 * to work air-gapped. What this catches is the handful that appear at the top
 * of every leak, which is where a guessing attempt starts.
 */
const COMMON_PASSWORDS = new Set([
  "123456789012",
  "password1234",
  "qwertyuiop12",
  "administrator",
  "iloveyou1234",
  "welcome12345",
  "letmein12345",
  "passwordpassword",
  "123123123123",
  "abcabcabcabc",
  "qwerty123456",
  "1q2w3e4r5t6y",
  "contrasena12",
  "contraseña12",
  "mipasswordes",
  "password123!",
  "changeme1234",
  "trustno1trustno1",
  "111111111111",
  "aaaaaaaaaaaa",
]);

export type PasswordProblem =
  | "tooShort"
  | "tooLong"
  | "common"
  | "containsIdentity";

/**
 * Everything wrong with a password, rather than the first thing.
 *
 * A form that reports one problem at a time makes somebody guess their way
 * through the rules, which is `REDESIGN_PLAN.md` §7 rule 4 from the other
 * direction: an error should say what to do next, and "also this" three times
 * is not that.
 */
export function passwordProblems(
  password: string,
  identity: { email?: string; name?: string } = {},
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) problems.push("tooShort");
  if (password.length > MAX_PASSWORD_LENGTH) problems.push("tooLong");

  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) problems.push("common");

  // The local part of the address and the name, both ways round: "noel" is no
  // better a secret for noel@example.com than the address itself.
  const identityParts = [
    identity.email?.split("@")[0],
    identity.name,
  ]
    .filter((part): part is string => Boolean(part && part.trim().length >= 3))
    .map((part) => part.trim().toLowerCase());

  if (identityParts.some((part) => lowered.includes(part))) {
    problems.push("containsIdentity");
  }

  return problems;
}

/**
 * The schema, for a password being *set*.
 *
 * Deliberately not applied to sign-in beyond the length bounds: an account
 * created before this rule existed must still be able to get in, and a
 * verifier that refuses a stored password because it is now too short locks
 * people out of their own household for a policy change.
 */
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .max(MAX_PASSWORD_LENGTH)
  .refine((value) => passwordProblems(value).length === 0, {
    message: "That password is too easy to guess",
  });

/**
 * The bounds a password is *checked* against at sign-in.
 *
 * Only the maximum matters here, and it is the one that is not about the
 * person: it stops an unauthenticated caller handing Argon2id a few megabytes.
 * The minimum stays at 1 so an old short password still verifies.
 */
export const existingPasswordSchema = z
  .string()
  .min(1)
  .max(MAX_PASSWORD_LENGTH);
