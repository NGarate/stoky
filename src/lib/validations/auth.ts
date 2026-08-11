import { z } from "zod";
import { existingPasswordSchema, newPasswordSchema } from "./password";

export const loginSchema = z.object({
  email: z.string().email(),
  // Bounded, not policed. An account created before the policy existed must
  // still be able to sign in; what the cap stops is an unauthenticated caller
  // handing Argon2id a few megabytes to verify.
  password: existingPasswordSchema,
});

export const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
  password: newPasswordSchema,
  householdName: z.string().trim().min(1).optional(),
});

export const createHouseholdSchema = z.object({
  name: z.string().trim().min(1),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
