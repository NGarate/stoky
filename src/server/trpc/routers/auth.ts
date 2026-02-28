import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import { signIn, signOut } from "@/lib/auth";
import * as argon2 from "argon2";
import { loginSchema, registerSchema } from "@/lib/validations/auth";

export const authRouter = createTRPCRouter({
  login: publicProcedure
    .input(loginSchema)
    .mutation(async ({ input }) => {
      const result = await signIn("credentials", {
        email: input.email,
        password: input.password,
        redirect: false,
      });

      if (!result || result.error) {
        throw new Error("Invalid credentials");
      }

      return { success: true };
    }),

  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ input }) => {
      const { email, name, password, householdName } = input;

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new Error("Email already registered");
      }

      // Hash password with Argon2id
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });

      // Create household if provided
      let householdId: string | undefined;
      if (householdName) {
        const household = await prisma.household.create({
          data: {
            name: householdName,
          },
        });
        householdId = household.id;
      }

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          householdId,
          role: householdId ? "OWNER" : "MEMBER",
        },
      });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    }),

  me: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          household: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale,
        role: user.role,
        household: user.household,
      };
    }),

  logout: protectedProcedure
    .mutation(async () => {
      await signOut({ redirect: false });
      return { success: true };
    }),
});
