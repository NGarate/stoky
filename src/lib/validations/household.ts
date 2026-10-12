import { z } from "zod";
import { emailSchema } from "./auth";
import { MAX_ID_LENGTH, MAX_NAME_LENGTH } from "./bounds";
import { newPasswordSchema } from "./password";

export const householdSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});

export const updateHouseholdSchema = householdSchema.partial().extend({
  id: z.string().trim().min(1).max(MAX_ID_LENGTH),
});

export const householdMemberSchema = z.object({
  userId: z.string().trim().min(1).max(MAX_ID_LENGTH),
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
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  // The same address sign-in looks up, so the same trim, case and bound.
  email: emailSchema,
  // The same policy as registration: an account an admin creates is an account
  // somebody signs in with, and a weaker rule here would be the way round it.
  password: newPasswordSchema,
  role: z.enum(["MEMBER", "KITCHEN"]),
});

/**
 * Changing an existing member's role — the "own procedure and own thought"
 * `addMemberSchema` above says promotion deserves.
 *
 * **The whole enum, unlike `addMemberSchema`.** Creating an admin out of
 * nothing is escalation with no undo; *promoting* somebody is a decision an
 * owner is entitled to make, and it is the only way ownership can ever move —
 * without it a sole owner can never hand the household on or leave it. The
 * escalation guard lives in the resolver instead, where it can see who is
 * asking: only an `OWNER` may grant or revoke `OWNER`.
 *
 * Not `householdMemberSchema`, which has the same shape and omits `KITCHEN` —
 * so it cannot express turning somebody's account into a kitchen tablet, which
 * is the change this exists for. That schema has no production caller.
 */
export const updateMemberRoleSchema = z.object({
  userId: z.string().trim().min(1).max(MAX_ID_LENGTH),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "KITCHEN"]),
});

/**
 * Removing a member from the household.
 *
 * **Not deleting the account.** `User.householdId` is nullable, and a person
 * who leaves a household is not a person who stops existing — they land in the
 * same householdless state a fresh registration does, which `householdRouter`
 * already knows how to get out of (ISSUES.md HOUSE-1). Deleting somebody's
 * account because they left would also take their name off every row that
 * records who did what.
 */
export const removeMemberSchema = z.object({
  userId: z.string().trim().min(1).max(MAX_ID_LENGTH),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
export type HouseholdInput = z.infer<typeof householdSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type HouseholdMemberInput = z.infer<typeof householdMemberSchema>;
