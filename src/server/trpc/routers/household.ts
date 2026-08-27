import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import type { HouseholdRole } from "@prisma/client";
import {
  addMemberSchema,
  householdSchema,
  removeMemberSchema,
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
  userId: string,
  householdId: string,
): Promise<{ id: string; role: HouseholdRole }> {
  const member = await prisma.user.findFirst({
    where: { id: userId, householdId },
    select: { id: true, role: true },
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
 */
async function assertAnOwnerRemains(
  householdId: string,
  target: { id: string; role: HouseholdRole },
  becoming: HouseholdRole | null,
): Promise<void> {
  if (target.role !== "OWNER" || becoming === "OWNER") return;

  const others = await prisma.user.count({
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

export const householdRouter = createTRPCRouter({
  /** The caller's household, or null. Never throws for the missing case. */
  current: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
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

      const existing = await prisma.user.findUnique({
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
      const household = await prisma.$transaction(async (tx) => {
        const created = await tx.household.create({ data: { name: input.name } });
        await tx.user.update({
          where: { id: userId },
          data: { householdId: created.id, role: "OWNER" },
        });
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
   */
  members: adminProcedure.query(async ({ ctx }) => {
    return prisma.user.findMany({
      where: { householdId: ctx.householdId },
      select: { id: true, name: true, email: true, role: true },
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
   * inserting would race with itself, which is the bug `auth.register` has.
   */
  addMember: adminProcedure
    .input(addMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await argon2.hash(input.password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });

      const user = await prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          householdId: ctx.householdId,
          role: input.role,
        },
        select: { id: true, name: true, email: true, role: true },
      });

      return user;
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
      const member = await memberOfHousehold(input.userId, ctx.householdId);

      assertMayActOnOwner(ctx.role, member.role, input.role);
      await assertAnOwnerRemains(ctx.householdId, member, input.role);

      return prisma.user.update({
        where: { id: member.id },
        data: { role: input.role },
        select: { id: true, name: true, email: true, role: true },
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
   * **This is the nearest thing to session revocation this application has**,
   * and it is not a substitute for it: it ends a member's access to *this
   * household*, not their session. Removing somebody does not sign them out
   * anywhere else, and there is nowhere else. See §10.
   */
  removeMember: adminProcedure
    .input(removeMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await memberOfHousehold(input.userId, ctx.householdId);

      assertMayActOnOwner(ctx.role, member.role);
      await assertAnOwnerRemains(ctx.householdId, member, null);

      await prisma.user.update({
        where: { id: member.id },
        data: { householdId: null },
      });

      return { success: true };
    }),
});
