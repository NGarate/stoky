import { z } from "zod";
import { MAX_EMAIL_LENGTH, MAX_ID_LENGTH, MAX_NAME_LENGTH } from "./bounds";
import {
  existingPasswordSchema,
  newPasswordSchema,
  withIdentityRule,
} from "./password";

/**
 * An address as this application stores and looks it up: trimmed, lowercased.
 *
 * `User.email` is compared exactly, so every path into it has to agree on one
 * spelling. `household.addMember` lowercased and `auth.register` and sign-in
 * did not: "Noel@Example.com" registered and then could not sign in as
 * "noel@example.com", and the two spellings could be two accounts. The
 * migration `normalise_user_email` lowercased the rows already stored and put
 * a unique index on `lower(email)` under all of it.
 *
 * Bounded after the trim, so the limit applies to the spelling that is
 * stored. Sign-in parses this without an account, and a failed one is logged:
 * unbounded, a 10 MB address was a 10 MB line in the security log.
 */
export const emailSchema = z.string().trim().max(MAX_EMAIL_LENGTH).toLowerCase().email();

export const loginSchema = z.object({
  email: emailSchema,
  // Bounded, not policed. An account created before the policy existed must
  // still be able to sign in; what the cap stops is an unauthenticated caller
  // handing Argon2id a few megabytes to verify.
  password: existingPasswordSchema,
});

export const registerSchema = withIdentityRule(
  z.object({
    email: emailSchema,
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    password: newPasswordSchema,
    householdName: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
  }),
);

/**
 * A signed-in person replacing their own password.
 *
 * The current one is bounded rather than policed, like sign-in's: an account
 * whose password predates the policy must still be able to change it, and
 * that is the account with most reason to. The new one meets the policy —
 * except the identity rule, which needs the account's name and address and
 * neither is in the input; `auth.changePassword` loads them and applies it.
 */
export const changePasswordSchema = z.object({
  currentPassword: existingPasswordSchema,
  newPassword: newPasswordSchema,
});

/**
 * A signed-in person ending their own sessions (`auth.endSessions`, D143):
 * one of them, every one but this, or every one.
 *
 * The current password every time — bounded like sign-in's, not policed — so
 * a session somebody else is holding cannot end the owner's. `sessionId` is a
 * row id from `auth.listSessions`, bounded like every other id; `"one"`
 * needs it and the others ignore it. It is only ever matched beside the
 * caller's own account id, so an id that is not theirs ends nothing.
 */
export const endSessionsSchema = z
  .object({
    currentPassword: existingPasswordSchema,
    scope: z.enum(["one", "others", "all"]),
    sessionId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  })
  .refine((input) => input.scope !== "one" || input.sessionId !== undefined, {
    message: "Choose the session to end",
    path: ["sessionId"],
  });

export const createHouseholdSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type EndSessionsInput = z.infer<typeof endSessionsSchema>;
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
