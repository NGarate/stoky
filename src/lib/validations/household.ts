import { z } from "zod";
import { newPasswordSchema } from "./password";

export const householdSchema = z.object({
  name: z.string().trim().min(1),
});

export const updateHouseholdSchema = householdSchema.partial().extend({
  id: z.string().trim().min(1),
});

export const householdMemberSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
});

/**
 * An account an admin creates for someone else in the household.
 *
 * **`OWNER` and `ADMIN` are deliberately not offered.** The capability matrix
 * (`REDESIGN_PLAN.md` §5.2) lets an admin invite people; letting one mint
 * another admin is a privilege escalation with no undo in a schema where
 * `User.householdId` is a single column. Promoting somebody is a decision that
 * deserves its own procedure and its own thought.
 *
 * There is no email in this application and no invitation token, so an admin
 * sets the first password. That is the honest shape for a self-hosted
 * household: the kitchen tablet is set up by the person holding it.
 */
export const addMemberSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  // The same policy as registration: an account an admin creates is an account
  // somebody signs in with, and a weaker rule here would be the way round it.
  password: newPasswordSchema,
  role: z.enum(["MEMBER", "KITCHEN"]),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type HouseholdInput = z.infer<typeof householdSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type HouseholdMemberInput = z.infer<typeof householdMemberSchema>;
