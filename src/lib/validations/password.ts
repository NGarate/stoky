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
 * What the policy's refusal of a common password says, on the wire.
 *
 * Shared for the identity message's reason below: a form whose input has more
 * fields than the password (`household.addMember`) cannot read every
 * BAD_REQUEST as "too easy", and recognises this one by its words.
 */
export const PASSWORD_TOO_EASY_MESSAGE = "That password is too easy to guess";

/** Whether a refusal's message is the policy's "too easy to guess". */
export function isPasswordTooEasyRefusal(message: string | undefined): boolean {
  return Boolean(message?.includes(PASSWORD_TOO_EASY_MESSAGE));
}

/**
 * The schema, for a password being *set*.
 *
 * Deliberately not applied to sign-in beyond the length bounds: an account
 * created before this rule existed must still be able to get in, and a
 * verifier that refuses a stored password because it is now too short locks
 * people out of their own household for a policy change.
 *
 * **Not the whole policy on its own.** A field cannot see the name and
 * address beside it; a form that sets a password also goes through
 * `withIdentityRule` below.
 */
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .max(MAX_PASSWORD_LENGTH)
  .refine((value) => passwordProblems(value).length === 0, {
    message: PASSWORD_TOO_EASY_MESSAGE,
  });

/**
 * What the identity refusal says, on the wire.
 *
 * English and not a translation key, like every other schema message: the
 * screens recognise it and show their own words (`getAuthErrorKey`,
 * `isPasswordIdentityRefusal`). One constant on both sides, so the server
 * cannot reword it out from under the client.
 */
export const PASSWORD_CONTAINS_IDENTITY_MESSAGE =
  "That password contains the person's own name or email address";

/** Whether a refusal's message is the identity rule's. */
export function isPasswordIdentityRefusal(message: string | undefined): boolean {
  return Boolean(message?.includes(PASSWORD_CONTAINS_IDENTITY_MESSAGE));
}

/**
 * What `auth.changePassword` says when the current password is wrong.
 *
 * Carried on a BAD_REQUEST and never on UNAUTHORIZED: the offline write queue
 * and the screens read UNAUTHORIZED as "this session has ended", and a person
 * who mistyped their current password is still signed in. One constant on
 * both sides, for the same reason as the identity message above.
 */
export const WRONG_CURRENT_PASSWORD_MESSAGE = "The current password is not correct";

/** Whether a refusal's message is the wrong-current-password one. */
export function isWrongCurrentPasswordRefusal(message: string | undefined): boolean {
  return Boolean(message?.includes(WRONG_CURRENT_PASSWORD_MESSAGE));
}

/**
 * The identity rule, applied to a whole form rather than to the field.
 *
 * `newPasswordSchema` cannot apply it: a field schema never sees its siblings,
 * so it calls `passwordProblems(value)` with no identity and the
 * `containsIdentity` branch can never fire from it. Until this existed it
 * never did — both schemas that set a password accepted `noelgarate2026` for
 * `noelgarate@example.com` while this file and SECURITY.md said otherwise
 * (security review, 2026-10-12).
 *
 * Object-level, and the issue is attached to `password` so a form reads it as
 * that field's. Zod 3 still runs an object refinement when a field was only
 * *dirty* (too short, too easy), so a short password that also contains the
 * name reports both at once; it is skipped only when a field is missing or
 * the wrong type, and then there is no name to compare against anyway.
 *
 * A procedure whose input carries no identity — changing your own password
 * (`auth.changePassword`), resetting somebody else's — loads the person and
 * calls `passwordProblems` with them instead, refusing with
 * `PASSWORD_CONTAINS_IDENTITY_MESSAGE` so the screens recognise it the same
 * way.
 */
export function withIdentityRule<
  T extends z.ZodType<
    { email: string; name: string; password: string },
    z.ZodTypeDef,
    unknown
  >,
>(schema: T): z.ZodEffects<T> {
  return schema.superRefine((value, ctx) => {
    const problems = passwordProblems(value.password, {
      email: value.email,
      name: value.name,
    });
    if (problems.includes("containsIdentity")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: PASSWORD_CONTAINS_IDENTITY_MESSAGE,
      });
    }
  });
}

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
