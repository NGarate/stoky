import { z } from "zod";
import { existingPasswordSchema, newPasswordSchema } from "./password";

/**
 * An address as this application stores and looks it up: trimmed, lowercased.
 *
 * `User.email` is compared exactly, so every path into it has to agree on one
 * spelling. `household.addMember` lowercased and `auth.register` and sign-in
 * did not: "Noel@Example.com" registered and then could not sign in as
 * "noel@example.com", and the two spellings could be two accounts. The
 * migration `normalise_user_email` lowercased the rows already stored and put
 * a unique index on `lower(email)` under all of it.
 */
const emailSchema = z.string().trim().toLowerCase().email();

export const loginSchema = z.object({
  email: emailSchema,
  // Bounded, not policed. An account created before the policy existed must
  // still be able to sign in; what the cap stops is an unauthenticated caller
  // handing Argon2id a few megabytes to verify.
  password: existingPasswordSchema,
});

export const registerSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1),
  password: newPasswordSchema,
  householdName: z.string().trim().min(1).optional(),
});

export const createHouseholdSchema = z.object({
  name: z.string().trim().min(1),
});

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
