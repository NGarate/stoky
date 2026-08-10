import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import { householdSchema } from "@/lib/validations/household";

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
});
