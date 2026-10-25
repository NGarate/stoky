import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "../trpc";
import { enforceRateLimit } from "../throttle";
import { addMemberRateLimit, clientAddress } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/auth/password-hash";
import {
  createCredentialUser,
  setPasswordAndEndSessions,
} from "@/lib/auth/credentials";
import { endSessions } from "@/lib/auth/end-sessions";
import { liveSessionsOf } from "@/lib/auth/session-list";
import { confirmCurrentPassword } from "@/lib/auth/reauth";
import { logSecurityEvent } from "@/lib/security-log";
import {
  PASSWORD_CONTAINS_IDENTITY_MESSAGE,
  passwordProblems,
} from "@/lib/validations/password";
import type { HouseholdRole, PrismaClient, Prisma } from "@prisma/client";
import {
  addMemberSchema,
  endHouseholdSessionsSchema,
  endMemberSessionsSchema,
  householdSchema,
  memberSessionsSchema,
  OWN_SESSIONS_MESSAGE,
  OWNERS_ONLY_MESSAGE,
  RESET_OWN_PASSWORD_MESSAGE,
  REMOVE_OWN_TWO_FACTOR_MESSAGE,
  removeMemberSchema,
  removeMemberTwoFactorSchema,
  resetMemberPasswordSchema,
  updateMemberRoleSchema,
} from "@/lib/validations/household";

/**
 * The household an account belongs to.
 *
 * `protectedProcedure` rather than `householdProcedure` throughout, and that is
 * the point: these are the procedures an account with **no** household needs,
 * so requiring one would make the router unreachable exactly when it matters.
 *
 * ISSUES.md HOUSE-1. Registration treats the household name as optional, so an
 * account can exist without one; before this, every household-scoped procedure
 * threw and the pages sat on a loading skeleton for ever, with nothing saying
 * why and no way forward.
 */
/**
 * The member this call names, or `NOT_FOUND`.
 *
 * Scoped by `householdId` in the same query rather than looked up and then
 * checked: an id that is not this household's narrows to nothing, so there is
 * no window in which the row is in hand and unauthorised. This is the class
 * `SECURITY_REVIEW.md` §2 found four times, and the reason it is a helper is
 * that both procedures below need exactly the same guard.
 *
 * `NOT_FOUND` rather than `FORBIDDEN`, matching `product.getById`: telling an
 * outsider that an id exists but is not theirs confirms the id exists.
 */
async function memberOfHousehold(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  householdId: string,
): Promise<{ id: string; role: HouseholdRole; name: string; email: string }> {
  const member = await db.user.findFirst({
    where: { id: userId, householdId },
    select: { id: true, role: true, name: true, email: true },
  });

  if (!member) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
  }

  return member;
}

/**
 * Only an `OWNER` may act on an `OWNER`, or hand out `OWNER`.
 *
 * Without this an `ADMIN` could demote every owner and take the household,
 * which is a privilege escalation dressed as member management. It is the same
 * reasoning `addMemberSchema` uses to refuse creating an admin out of nothing,
 * applied to the procedure that *can* promote — the schema cannot enforce it
 * because the schema cannot see who is asking.
 */
function assertMayActOnOwner(
  actor: HouseholdRole,
  target: HouseholdRole,
  becoming?: HouseholdRole,
): void {
  const touchesOwnership = target === "OWNER" || becoming === "OWNER";

  if (touchesOwnership && actor !== "OWNER") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only an owner may change who owns this household",
    });
  }
}

/**
 * The household keeps at least one owner.
 *
 * The invariant that stops a household being locked out of itself — by an
 * owner demoting themselves, or by the last owner being removed. Counted
 * excluding the member being changed, because that member is the one about to
 * stop being an owner.
 *
 * `CONFLICT` rather than `FORBIDDEN`: nothing is wrong with who is asking, and
 * the answer is not "you may not" but "not while you are the last one" — which
 * is a state the caller can resolve by promoting somebody first.
 *
 * **Only meaningful inside `withOwnersLocked`.** Counting and then writing is
 * a check that races with itself: two owners stepping down at once each count
 * the other, both pass, and the household is left with none.
 */
async function assertAnOwnerRemains(
  db: Prisma.TransactionClient,
  householdId: string,
  target: { id: string; role: HouseholdRole },
  becoming: HouseholdRole | null,
): Promise<void> {
  if (target.role !== "OWNER" || becoming === "OWNER") return;

  const others = await db.user.count({
    where: { householdId, role: "OWNER", id: { not: target.id } },
  });

  if (others === 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This household would have no owner. Make somebody else an owner first.",
    });
  }
}

/**
 * Runs `work` in a transaction holding this household's owner rows.
 *
 * What makes `assertAnOwnerRemains` true by the time the write lands. Two
 * concurrent demotions (or a demotion and a removal) of different owners each
 * passed the count on its own and together left zero owners — measured, not
 * inferred: `household.roles.test.ts` lost every owner in the first round
 * without this.
 *
 * `FOR UPDATE` on the owner rows rather than Serializable: the second caller
 * waits for the first to commit, Postgres then re-checks `role = 'OWNER'` on
 * the rows it was waiting for, and the count that follows sees the first
 * caller's write — so it is refused with `CONFLICT` rather than with a
 * serialization failure the client would have to retry. `ORDER BY id` so two
 * callers take the locks in the same order and cannot deadlock each other.
 *
 * The member is re-read inside, after the lock, so the role the guards judge
 * is the one the write replaces.
 */
async function withOwnersLocked<T>(
  db: PrismaClient,
  householdId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "User"
      WHERE "householdId" = ${householdId} AND role = 'OWNER'
      ORDER BY id
      FOR UPDATE
    `;
    return work(tx);
  });
}

export const householdRouter = createTRPCRouter({
  /** The caller's household, or null. Never throws for the missing case. */
  current: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { role: true, household: { select: { id: true, name: true } } },
    });

    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "This account no longer exists",
      });
    }

    return { household: user.household, role: user.role };
  }),

  /**
   * Creates a household and puts the caller in it as its OWNER.
   *
   * Refuses if the caller already has one: this is the way out of the
   * no-household state, not a way to move between households. Leaving a
   * household, and being invited to another, are Phase 3's neighbours rather
   * than part of it, and both need a membership model this schema does not
   * have — `User.householdId` is a single nullable column.
   */
  create: protectedProcedure
    .input(householdSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const existing = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!existing) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This account no longer exists",
        });
      }

      if (existing.householdId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This account already belongs to a household",
        });
      }

      // One transaction: a household with no members is invisible in the
      // interface and unreachable by anyone, so a half-applied create would
      // leave a row nothing can ever clean up.
      //
      // The read above is only the early answer; the claim is the conditional
      // update below. Two creates sent together from one account (a double
      // tap, two tabs, one batched request) both pass that read, and an
      // update keyed on `id` alone let the second overwrite the first and
      // strand its household with no member. With `householdId: null` in the
      // WHERE, the second waits on the first one's row lock, re-reads the row
      // once it commits (READ COMMITTED), matches nothing, and throws — which
      // rolls its own household back.
      const household = await ctx.db.$transaction(async (tx) => {
        const created = await tx.household.create({
          data: { name: input.name },
        });
        const claimed = await tx.user.updateMany({
          where: { id: userId, householdId: null },
          data: { householdId: created.id, role: "OWNER" },
        });
        if (claimed.count === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This account already belongs to a household",
          });
        }
        return created;
      });

      return household;
    }),

  /**
   * Who is in this household.
   *
   * `adminProcedure`, because the matrix puts "see account data and emails"
   * behind admin — a KITCHEN tablet left on a counter must not list the
   * household's email addresses to whoever picks it up.
   *
   * `twoFactorEnabled` so the screen can say who has a second step and offer
   * to remove it (`removeMemberTwoFactor`, D150) — whether it is on, never
   * anything of the authenticator itself.
   */
  members: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findMany({
      where: { householdId: ctx.householdId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        twoFactorEnabled: true,
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
  }),

  /**
   * Create an account for someone else in this household.
   *
   * **This is what makes the KITCHEN role usable at all.** It has been
   * enforced on the server since Phase 3 and unprovisionable ever since: the
   * value existed in the enum and in the middleware, and the only way to get
   * one was a database write.
   *
   * There is no email in this application and no invitation token, so the
   * admin sets the first password and hands the device over. That is the
   * honest shape for a self-hosted household rather than a placeholder for a
   * flow that does not exist.
   *
   * A duplicate email is answered by the database's own unique constraint,
   * which the Prisma middleware turns into `CONFLICT`. Checking first and then
   * inserting would race with itself. `auth.register` still checks first, as a
   * courtesy in front of the same constraint, and writes its household in the
   * same transaction as the account so the race cannot leave one behind.
   *
   * This is also the way in once registration is closed: `STOKY_REGISTRATION`
   * governs `auth.register` only, never this.
   *
   * **Metered per admin**, before the hash — see `addMemberRateLimit`. Argon2id
   * at 64 MiB is the cost of every call, a duplicate address included, so a
   * limit counted after it would be a way to ask for it. The same limit is
   * what bounds the one thing this still answers about other households:
   * `CONFLICT` says an address has an account somewhere on the instance.
   */
  addMember: adminProcedure
    .input(addMemberSchema)
    .mutation(async ({ ctx, input }) => {
      await enforceRateLimit(
        addMemberRateLimit(),
        ctx.session.user.id,
        "Too many accounts created. Try again in a little while.",
      );

      const passwordHash = await hashPassword(input.password);

      const user = await createCredentialUser(
        ctx.db,
        {
          name: input.name,
          email: input.email,
          householdId: ctx.householdId,
          role: input.role,
        },
        passwordHash,
      );

      // Named fields, never the row: it is the whole `User`, and any column it
      // grows would reach the browser by default.
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      };
    }),
  /**
   * Change what an existing member may do.
   *
   * The procedure `addMemberSchema` says promotion deserves. Three guards, and
   * each one is a way a household could otherwise lose control of itself:
   * the member must be **this** household's, only an owner may grant or revoke
   * ownership, and the household must keep an owner.
   *
   * **It takes effect on the very next request, with no sign-out.**
   * `householdProcedure` re-reads `role` from the database on every call and
   * ignores the token — `integration/session.freshness.test.ts` proves it — so
   * a demotion is as immediate as the session machinery allows. That is what
   * makes this useful before session revocation exists (`REDESIGN_PLAN.md` §10).
   */
  updateRole: adminProcedure
    .input(updateMemberRoleSchema)
    .mutation(async ({ ctx, input }) => {
      return withOwnersLocked(ctx.db, ctx.householdId, async (tx) => {
        const member = await memberOfHousehold(
          tx,
          input.userId,
          ctx.householdId,
        );

        assertMayActOnOwner(ctx.role, member.role, input.role);
        await assertAnOwnerRemains(tx, ctx.householdId, member, input.role);

        return tx.user.update({
          where: { id: member.id },
          data: { role: input.role },
          select: { id: true, name: true, email: true, role: true },
        });
      });
    }),

  /**
   * Remove somebody from the household.
   *
   * Sets `householdId` to null rather than deleting the account — see
   * `removeMemberSchema` for why. The same three guards as `updateRole`, and
   * the same immediacy: the next request that member makes gets
   * `PRECONDITION_FAILED` from `householdProcedure`, because it re-reads the
   * household too.
   *
   * **And it signs them out everywhere** (ASVS 5.0.0 7.4.2, PROGRESS D146).
   * Every session the member has is deleted in the same transaction that
   * takes their household away (`endSessions`), so the phone in their pocket
   * and the kitchen tablet they left signed in are signed out together, and
   * neither the household nor the sessions can go without the other. Losing
   * the household alone already refused every household request; what a
   * session left alive still reached was the account itself — its password,
   * its devices list, a new household of its own (`household.create`) — on
   * a device the household may no longer control, such as the kitchen
   * tablet. The account stays, so the person can sign in
   * again, to an account with no household.
   *
   * Removing yourself, which an owner beside another owner may do, ends your
   * own sessions too, this one included: you no longer belong anywhere, and
   * nothing about that needs a session. Logged as `auth.session.ended` with
   * `reason: "removed"`, after the transaction has committed, so a refused
   * removal writes no line.
   */
  removeMember: adminProcedure
    .input(removeMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const removed = await withOwnersLocked(
        ctx.db,
        ctx.householdId,
        async (tx) => {
          const member = await memberOfHousehold(
            tx,
            input.userId,
            ctx.householdId,
          );

          assertMayActOnOwner(ctx.role, member.role);
          await assertAnOwnerRemains(tx, ctx.householdId, member, null);

          await tx.user.update({
            where: { id: member.id },
            data: { householdId: null },
          });

          return {
            id: member.id,
            ended: await endSessions(tx, { userId: member.id }),
          };
        },
      );

      logSecurityEvent("auth.session.ended", {
        userId: ctx.session.user.id,
        targetUserId: removed.id,
        householdId: ctx.householdId,
        reason: "removed",
        count: removed.ended,
        address: ctx.headers ? clientAddress(ctx.headers) : undefined,
      });

      return { success: true };
    }),

  /**
   * A member's live sessions, for an admin deciding which to end (ASVS 5.0.0
   * 7.4.5, PROGRESS D145).
   *
   * The same reading as the member's own **Tus dispositivos**
   * (`liveSessionsOf`), so an admin is never shown more about somebody than
   * they are shown about themselves: the device and the screen it opens on,
   * when it signed in, was last used and ends, whether it is remembered —
   * never a token, never the device id. There is no "this one": none of
   * these is the admin's.
   *
   * The guards of the rest of member management, in the same order as
   * `endMemberSessions` below, because what an admin may not end they have
   * no reason to list: not the caller (their own are behind their password,
   * D143), the member must be **this** household's (`NOT_FOUND` otherwise,
   * which does not confirm the id exists), and only an owner may act on an
   * owner.
   */
  memberSessions: adminProcedure
    .input(memberSessionsSchema)
    .query(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: OWN_SESSIONS_MESSAGE,
        });
      }

      const member = await memberOfHousehold(
        ctx.db,
        input.userId,
        ctx.householdId,
      );

      assertMayActOnOwner(ctx.role, member.role);

      return liveSessionsOf(ctx.db, member.id);
    }),

  /**
   * End one of a member's sessions, or every one (ASVS 5.0.0 7.4.5, PROGRESS
   * D145).
   *
   * The answer to "the kitchen tablet has walked out of the house" that is
   * not "wait and hope nobody touches it": a session in use lasts up to a
   * day, a remembered one up to a year (`src/lib/auth/session-policy.ts`).
   * Deleting the rows (`endSessions`) signs those devices out on their next
   * request. With a `sessionId` it ends that one — the lost tablet, and not
   * the phone in the member's pocket — and with none, every one.
   *
   * **No password**, unlike ending your own (D143): the owner confirmed on
   * 2026-10-15 that an admin acting on somebody else is not re-asked. What
   * stands in for it is the tier and the guards:
   *
   * 1. **Not yourself.** Your own sessions end from **Tus dispositivos**,
   *    which asks for your password; an admin session that could skip that
   *    question would be the way round it for whoever holds the session.
   * 2. **The member is this household's**, through `memberOfHousehold`.
   * 3. **Only an owner may act on an owner** (`assertMayActOnOwner`): an
   *    admin who could sign an owner out could keep them out of answering.
   *    There is no last-owner guard, and there should not be — ending
   *    somebody's sessions changes nothing about who owns what, and refusing
   *    the last owner would refuse the person most likely to have lost a
   *    device.
   * 4. **Scoped in the filter.** The delete names the member's id beside the
   *    session's, so another account's session id ends nothing and is
   *    `NOT_FOUND`, like an id nobody has; and it repeats the household and
   *    the role that were checked, so a member who left the household or was
   *    made an owner in between is not acted on.
   *
   * Logged as `auth.session.ended` with `reason: "admin"`, who asked, whose,
   * and how many. Answers only the count.
   *
   * Removing a member ends their access to this household and every session
   * they have (D146); this ends sessions and leaves them in the household.
   * They are different acts and the screen offers both, because "they left"
   * and "their phone was stolen" are different problems.
   */
  endMemberSessions: adminProcedure
    .input(endMemberSessionsSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: OWN_SESSIONS_MESSAGE,
        });
      }

      const member = await memberOfHousehold(
        ctx.db,
        input.userId,
        ctx.householdId,
      );

      assertMayActOnOwner(ctx.role, member.role);

      // The guards again, in the write: a member who stopped being the one
      // checked above — gone from the household, or made an owner — matches
      // nothing. Written as two literals rather than a spread, so the session
      // id never sits in a filter without the member's id beside it.
      const still = { householdId: ctx.householdId, role: member.role };
      const where =
        input.sessionId === undefined
          ? { userId: member.id, user: still }
          : { userId: member.id, id: input.sessionId, user: still };
      const ended = await endSessions(ctx.db, where);

      if (input.sessionId !== undefined && ended === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      logSecurityEvent("auth.session.ended", {
        userId: ctx.session.user.id,
        targetUserId: member.id,
        householdId: ctx.householdId,
        reason: "admin",
        count: ended,
        address: ctx.headers ? clientAddress(ctx.headers) : undefined,
      });

      return { ended };
    }),

  /**
   * End every session in the household, the owner's own included, after the
   * owner's password (ASVS 5.0.0 7.4.5, PROGRESS D147).
   *
   * The answer to "somebody has been in the house who should not have been":
   * every phone, tablet and laptop signed in to this household signs in
   * again, and the owner with them. One act rather than a round of
   * `endMemberSessions` per member, which leaves the owner's own and the
   * other owners' for last, or never.
   *
   * The order is the point:
   *
   * 1. **Owners only.** `adminProcedure` lets an admin in, and an admin is
   *    refused here before the password is asked: an admin may not reach an
   *    owner's sessions one at a time (`assertMayActOnOwner`, D145), so not
   *    all at once either. `FORBIDDEN`, which the refusal middleware logs.
   * 2. **The password** (`confirmCurrentPassword`, D143), because this ends
   *    the owner's own sessions too, and a session somebody else is holding
   *    must not be able to sign the household out — the owner included, out
   *    of the screen that would answer it. Unlike an admin ending one
   *    member's (D145), which the owner confirmed is not re-asked.
   * 3. **One filter**, the household through each session's account, so
   *    nothing outside it is touched and a member who joined a moment ago is
   *    included. Removed members have no household and are not.
   *
   * Logged as one `auth.session.ended` with `reason: "owner"`, the owner as
   * `userId`, the household and the count — no `targetUserId`, because it
   * was everybody's. The answer is the count; the screen then signs this
   * device out, as `auth.endSessions` with `"all"` does.
   */
  endHouseholdSessions: adminProcedure
    .input(endHouseholdSessionsSchema)
    .mutation(async ({ ctx, input }) => {
      if (ctx.role !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: OWNERS_ONLY_MESSAGE,
        });
      }

      await confirmCurrentPassword(
        ctx,
        input.currentPassword,
        "household-end-all",
      );

      const ended = await endSessions(ctx.db, {
        user: { householdId: ctx.householdId },
      });

      logSecurityEvent("auth.session.ended", {
        userId: ctx.session.user.id,
        householdId: ctx.householdId,
        reason: "owner",
        count: ended,
        address: ctx.headers ? clientAddress(ctx.headers) : undefined,
      });

      return { ended };
    }),

  /**
   * Set a new password for somebody in the household, and end every session
   * they have.
   *
   * **The way back from a forgotten password.** There is no email in this
   * application, so there is no link to send; until this existed a member who
   * forgot theirs was locked out for good, and the only remedy was the
   * operator writing a hash into the database (security review, 2026-10-12).
   * The admin sets a password, gives it to the person, and the person changes
   * it from Settings (`auth.changePassword`). It is the same trust the
   * household already places in an admin, who set that person's first
   * password in `addMember`.
   *
   * The order of the steps is the point of them:
   *
   * 1. **Not yourself.** Your own password changes through
   *    `auth.changePassword`, which asks for the current one; an admin
   *    session that could skip that question would be a way round it for
   *    whoever holds the session.
   * 2. **The limit**, `addMemberRateLimit`, shared with adding a member and
   *    for the same reason: each call runs Argon2id at 64 MiB. Before any
   *    query, so a refusal below is counted too.
   * 3. **The member is this household's**, through `memberOfHousehold`:
   *    `NOT_FOUND` for anyone else's, which does not confirm the id exists.
   * 4. **Only an owner may act on an owner** (`assertMayActOnOwner`). An
   *    admin who could set an owner's password could sign in as that owner,
   *    which is the escalation the guard exists to refuse.
   * 5. **The identity rule**, against the member's own name and address,
   *    which the input does not carry.
   * 6. **One transaction** sets the hash, deletes every session row and
   *    removes every passkey, so the new password and the end of the old ways
   *    in land together. A password reset because somebody else may know the
   *    old one is half a fix if a session opened with it survives, or a
   *    passkey added with it (D151): a passkey signs in with no password.
   *
   * **The write repeats the guards in its `where`.** Argon2id takes about a
   * quarter of a second between the checks above and the write, and in that
   * time the member can leave the household or be made an owner. A write
   * conditioned on the same household and the same role cannot land on a
   * member who has stopped being the one that was checked; it writes nothing,
   * and the caller is told to try again.
   */
  resetMemberPassword: adminProcedure
    .input(resetMemberPasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const callerId = ctx.session.user.id;

      if (input.userId === callerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: RESET_OWN_PASSWORD_MESSAGE,
        });
      }

      await enforceRateLimit(
        addMemberRateLimit(),
        callerId,
        "Too many accounts created or passwords set. Try again in a little while.",
      );

      const member = await memberOfHousehold(
        ctx.db,
        input.userId,
        ctx.householdId,
      );

      assertMayActOnOwner(ctx.role, member.role);

      const problems = passwordProblems(input.newPassword, {
        email: member.email,
        name: member.name,
      });
      if (problems.includes("containsIdentity")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: PASSWORD_CONTAINS_IDENTITY_MESSAGE,
        });
      }

      const passwordHash = await hashPassword(input.newPassword);

      const count = await setPasswordAndEndSessions(
        ctx.db,
        {
          userId: member.id,
          guard: { householdId: ctx.householdId, role: member.role },
        },
        passwordHash,
      );

      if (count === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This member changed while the password was being set. Try again.",
        });
      }

      logSecurityEvent("auth.password.reset", {
        userId: callerId,
        householdId: ctx.householdId,
        targetUserId: member.id,
        address: ctx.headers ? clientAddress(ctx.headers) : undefined,
      });

      return { success: true };
    }),

  /**
   * Take a member's two-step verification off, after the admin's own
   * password, and end every session they have (PROGRESS D150).
   *
   * **The way back from a lost authenticator.** Somebody whose phone is gone
   * and who has no backup code left could not sign in at all; until this
   * existed the only remedy was the operator's SQL (INSTALL, *A lost
   * authenticator*). The admin removes it, the person signs in with the
   * password alone and sets it up again on the new phone. It is the trust
   * `resetMemberPassword` already places in an admin, who can set the very
   * password this leaves standing on its own.
   *
   * The order is the point:
   *
   * 1. **Not yourself.** Your own is turned off from Seguridad y acceso, with
   *    your password; owners and admins are no exception.
   * 2. **The admin's password** (`confirmCurrentPassword`, D143), before
   *    anything is read about the member: this weakens somebody else's
   *    account, and a session somebody else holds must not be able to — nor
   *    learn, from `NOT_FOUND` against `FORBIDDEN`, which ids are whose.
   *    Unlike ending a member's sessions (D145), which is not re-asked.
   * 3. **The member is this household's** (`memberOfHousehold`), `NOT_FOUND`
   *    for anyone else's.
   * 4. **Only an owner may act on an owner** (`assertMayActOnOwner`): an
   *    admin who could strip an owner's second step, then set their password,
   *    would be signing in as the owner.
   * 5. **One transaction**, its write repeating the guards — the household,
   *    the role that was checked, and that two-step verification is on — so
   *    a member who changed in between, or never had it, is `CONFLICT` and
   *    nothing is touched. Then the authenticator row (secret and backup
   *    codes), then every session and challenge in progress (`endSessions`):
   *    whoever has the lost phone may also have a session open on it, and a
   *    challenge is half a sign-in.
   *
   * Logged as `auth.twofactor.removed` and `auth.session.ended` with
   * `reason: "two-factor-removed"`, the admin as `userId` and the member as
   * `targetUserId`, after the transaction has committed.
   */
  removeMemberTwoFactor: adminProcedure
    .input(removeMemberTwoFactorSchema)
    .mutation(async ({ ctx, input }) => {
      const callerId = ctx.session.user.id;

      if (input.userId === callerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: REMOVE_OWN_TWO_FACTOR_MESSAGE,
        });
      }

      await confirmCurrentPassword(
        ctx,
        input.currentPassword,
        "member-two-factor",
      );

      const member = await memberOfHousehold(
        ctx.db,
        input.userId,
        ctx.householdId,
      );

      assertMayActOnOwner(ctx.role, member.role);

      const ended = await ctx.db.$transaction(async (tx) => {
        const { count } = await tx.user.updateMany({
          where: {
            id: member.id,
            householdId: ctx.householdId,
            role: member.role,
            twoFactorEnabled: true,
          },
          data: { twoFactorEnabled: false },
        });
        if (count === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This member has no two-step verification to remove, or changed. Try again.",
          });
        }
        await tx.twoFactor.deleteMany({ where: { userId: member.id } });
        return endSessions(tx, { userId: member.id });
      });

      const address = ctx.headers ? clientAddress(ctx.headers) : undefined;
      logSecurityEvent("auth.twofactor.removed", {
        userId: callerId,
        targetUserId: member.id,
        householdId: ctx.householdId,
        address,
      });
      logSecurityEvent("auth.session.ended", {
        userId: callerId,
        targetUserId: member.id,
        householdId: ctx.householdId,
        reason: "two-factor-removed",
        count: ended,
        address,
      });

      return { ended };
    }),
});
