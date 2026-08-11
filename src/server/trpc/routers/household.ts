import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import { addMemberSchema, householdSchema } from "@/lib/validations/household";

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
});
