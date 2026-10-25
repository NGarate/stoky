import { z } from "zod";
import { emailSchema } from "./auth";
import { MAX_ID_LENGTH, MAX_NAME_LENGTH } from "./bounds";
import {
  existingPasswordSchema,
  newPasswordSchema,
  withIdentityRule,
} from "./password";

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
export const addMemberSchema = withIdentityRule(
  z.object({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    // The same address sign-in looks up, so the same trim, case and bound.
    email: emailSchema,
    // The same policy as registration, identity rule included: an account an
    // admin creates is an account somebody signs in with, and a weaker rule
    // here would be the way round it.
    password: newPasswordSchema,
    role: z.enum(["MEMBER", "KITCHEN"]),
  }),
);

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

/**
 * An admin setting a new password for somebody in the household.
 *
 * The way back for a member who has forgotten theirs: there is no email in
 * this application, so there is no link to send, and until this existed a
 * forgotten password was an account lost for good (security review,
 * 2026-10-12).
 *
 * `newPassword` is the policy every password that is *set* meets. The
 * identity rule is not applied here and cannot be: the input names the member
 * by id and carries neither their name nor their address, so
 * `household.resetMemberPassword` loads the member and applies it itself, the
 * way `auth.changePassword` does for the caller.
 */
export const resetMemberPasswordSchema = z.object({
  userId: z.string().trim().min(1).max(MAX_ID_LENGTH),
  newPassword: newPasswordSchema,
});

/**
 * What `household.resetMemberPassword` says when the member named is the
 * caller. English and shared, like the password messages: the screen never
 * offers it, and a client that sends it anyway gets a sentence that says
 * where to go instead.
 */
export const RESET_OWN_PASSWORD_MESSAGE =
  "Change your own password from Settings, with your current one";

/**
 * The member whose sessions an admin is looking at (`household.memberSessions`,
 * D145). Never the caller: their own are in **Tus dispositivos**, behind
 * their password (`OWN_SESSIONS_MESSAGE`).
 */
export const memberSessionsSchema = z.object({
  userId: z.string().trim().min(1).max(MAX_ID_LENGTH),
});

/**
 * An admin ending a member's sessions: one, by the id `memberSessions`
 * listed, or — with no `sessionId` — every one (`household.endMemberSessions`,
 * ASVS 5.0.0 7.4.5, D145).
 *
 * No password. An admin acting on somebody else is the household's authority
 * over its own accounts, the same one that sets their password in
 * `resetMemberPassword`, and the owner confirmed on 2026-10-15 that it is
 * not re-asked here. A person ending their *own* sessions is asked
 * (`auth.endSessions`, D143), which is why the caller's own id is refused.
 */
export const endMemberSessionsSchema = z.object({
  userId: z.string().trim().min(1).max(MAX_ID_LENGTH),
  sessionId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
});

/**
 * An owner ending every session in the household, their own included
 * (`household.endHouseholdSessions`, ASVS 5.0.0 7.4.5, D147).
 *
 * The current password, bounded like sign-in's and not policed, as
 * `auth.endSessions` asks it: this ends the owner's own sessions too, and a
 * session somebody else is holding must not be able to sign the whole
 * household out. Nothing else: there is no "which", it is every one.
 */
export const endHouseholdSessionsSchema = z.object({
  currentPassword: existingPasswordSchema,
});

/**
 * What `household.endHouseholdSessions` says to an admin who is not an owner.
 * English and shared, like `OWN_SESSIONS_MESSAGE`: the screen offers the
 * control to owners only.
 */
export const OWNERS_ONLY_MESSAGE =
  "Only an owner may end every session in the household";

/**
 * An admin removing a member's two-step verification, for somebody who has
 * lost the phone with their authenticator and has no backup code left
 * (`household.removeMemberTwoFactor`, PROGRESS D150).
 *
 * **The admin's own password**, bounded like sign-in's and not policed, as
 * `auth.endSessions` asks it: this takes a second factor off somebody else's
 * account and signs them out everywhere, and a session somebody else is
 * holding must not be able to do either. Unlike ending a member's sessions
 * (D145), which the owner decided is not re-asked, this weakens the account
 * it is done to, so it is.
 *
 * Never the caller's own id: your own is turned off from Seguridad y acceso,
 * with your password (`REMOVE_OWN_TWO_FACTOR_MESSAGE`).
 */
export const removeMemberTwoFactorSchema = z.object({
  userId: z.string().trim().min(1).max(MAX_ID_LENGTH),
  currentPassword: existingPasswordSchema,
});

/**
 * What `household.removeMemberTwoFactor` says when the member named is the
 * caller. English and shared, like `OWN_SESSIONS_MESSAGE`: the screen never
 * offers it.
 */
export const REMOVE_OWN_TWO_FACTOR_MESSAGE =
  "Turn your own two-step verification off in Settings, under Security, with your password";

/**
 * What `household.memberSessions` and `household.endMemberSessions` say when
 * the member named is the caller. English and shared, like
 * `RESET_OWN_PASSWORD_MESSAGE`: the screen never offers it.
 */
export const OWN_SESSIONS_MESSAGE =
  "Your own sessions are in Settings, under Security, where ending them asks for your password";

export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
export type EndMemberSessionsInput = z.infer<typeof endMemberSessionsSchema>;
export type EndHouseholdSessionsInput = z.infer<
  typeof endHouseholdSessionsSchema
>;
export type RemoveMemberTwoFactorInput = z.infer<
  typeof removeMemberTwoFactorSchema
>;
export type ResetMemberPasswordInput = z.infer<
  typeof resetMemberPasswordSchema
>;
export type HouseholdInput = z.infer<typeof householdSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type HouseholdMemberInput = z.infer<typeof householdMemberSchema>;
