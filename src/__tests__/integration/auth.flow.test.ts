import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { prisma } from "@/lib/prisma";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import {
  createTestUser,
  createTestHousehold,
  cleanupTestUsers,
  cleanupTestHouseholds,
  generateTestEmail,
  generateTestName,
  createMockSession,
} from "../utils/test-helpers";
import * as argon2 from "argon2";

describe("Authentication Flow Integration Tests", () => {
  const testEmailPattern = "@example.com";
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(async () => {
    // Create a basic context for unauthenticated requests
    const ctx = await createTRPCContext({ session: null });
    caller = appRouter.createCaller(ctx);
  });

  afterEach(async () => {
    // Clean up test users and households
    await cleanupTestUsers(testEmailPattern);
    await cleanupTestHouseholds("Test Household");
  });

  describe("User Registration", () => {
    it("should register a new user with valid data", async () => {
      const email = generateTestEmail("register");
      const name = generateTestName("Register User");
      const password = "SecurePassword123!";
      const householdName = "My Test Household";

      const result = await caller.auth.register({
        email,
        name,
        password,
        householdName,
      });

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(email);
      expect(result.user.name).toBe(name);

      // Verify user was created in database
      const dbUser = await prisma.user.findUnique({
        where: { email },
        include: { household: true },
      });

      expect(dbUser).toBeDefined();
      expect(dbUser?.email).toBe(email);
      expect(dbUser?.name).toBe(name);
      expect(dbUser?.household).toBeDefined();
      expect(dbUser?.household?.name).toBe(householdName);
      expect(dbUser?.role).toBe("OWNER");
    });

    it("should register a new user without household", async () => {
      const email = generateTestEmail("no-household");
      const name = generateTestName("No Household User");
      const password = "SecurePassword123!";

      const result = await caller.auth.register({
        email,
        name,
        password,
      });

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();

      // Verify user was created without household
      const dbUser = await prisma.user.findUnique({
        where: { email },
      });

      expect(dbUser).toBeDefined();
      expect(dbUser?.householdId).toBeNull();
      expect(dbUser?.role).toBe("MEMBER");
    });

    it("should fail to register with duplicate email", async () => {
      const email = generateTestEmail("duplicate");
      const name = generateTestName("Duplicate User");
      const password = "SecurePassword123!";

      // Create first user
      await caller.auth.register({
        email,
        name,
        password,
      });

      // Try to create second user with same email
      let error: Error | null = null;
      try {
        await caller.auth.register({
          email,
          name: "Different Name",
          password: "DifferentPassword123!",
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Email already registered");
    });

    it("should fail to register with invalid email format", async () => {
      const name = generateTestName("Invalid Email User");
      const password = "SecurePassword123!";

      let error: Error | null = null;
      try {
        await caller.auth.register({
          email: "not-an-email",
          name,
          password,
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
    });

    it("should fail to register with short password", async () => {
      const email = generateTestEmail("short-password");
      const name = generateTestName("Short Password User");

      let error: Error | null = null;
      try {
        await caller.auth.register({
          email,
          name,
          password: "short",
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
    });

    it("should fail to register with empty name", async () => {
      const email = generateTestEmail("empty-name");
      const password = "SecurePassword123!";

      let error: Error | null = null;
      try {
        await caller.auth.register({
          email,
          name: "",
          password,
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
    });
  });

  describe("User Login", () => {
    it("should login with valid credentials", async () => {
      const email = generateTestEmail("login");
      const name = generateTestName("Login User");
      const password = "ValidPassword123!";

      // Create user first
      await createTestUser({ email, name, password });

      // Try to login
      const result = await caller.auth.login({
        email,
        password,
      });

      expect(result.success).toBe(true);
    });

    it("should fail to login with invalid password", async () => {
      const email = generateTestEmail("invalid-password");
      const name = generateTestName("Invalid Password User");
      const password = "CorrectPassword123!";

      // Create user
      await createTestUser({ email, name, password });

      // Try to login with wrong password
      let error: Error | null = null;
      try {
        await caller.auth.login({
          email,
          password: "WrongPassword123!",
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Invalid credentials");
    });

    it("should fail to login with non-existent email", async () => {
      const email = generateTestEmail("non-existent");

      let error: Error | null = null;
      try {
        await caller.auth.login({
          email,
          password: "AnyPassword123!",
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Invalid credentials");
    });

    it("should fail to login with empty credentials", async () => {
      let error: Error | null = null;
      try {
        await caller.auth.login({
          email: "",
          password: "",
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
    });
  });

  describe("Get Current User (Me)", () => {
    it("should return current user when authenticated", async () => {
      const email = generateTestEmail("me-auth");
      const name = generateTestName("Me Auth User");
      const password = "SecurePassword123!";
      const householdName = "My Household";

      // Create user with household
      const household = await createTestHousehold({ name: householdName });
      const user = await createTestUser({
        email,
        name,
        password,
        householdId: household.id,
        role: "OWNER",
      });

      // Create authenticated context
      const session = createMockSession({ ...user, household });
      const authCtx = await createTRPCContext({ session });
      const authCaller = appRouter.createCaller(authCtx);

      // Call me endpoint
      const result = await authCaller.auth.me();

      expect(result).toBeDefined();
      expect(result.id).toBe(user.id);
      expect(result.email).toBe(email);
      expect(result.name).toBe(name);
      expect(result.role).toBe("OWNER");
      expect(result.household).toBeDefined();
      expect(result.household?.name).toBe(householdName);
    });

    it("should fail when not authenticated", async () => {
      let error: Error | null = null;
      try {
        await caller.auth.me();
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Not signed in");
    });

    it("should return user without household when user has no household", async () => {
      const email = generateTestEmail("no-household-me");
      const name = generateTestName("No Household Me User");
      const password = "SecurePassword123!";

      // Create user without household
      const user = await createTestUser({ email, name, password });

      // Create authenticated context
      const session = createMockSession(user);
      const authCtx = await createTRPCContext({ session });
      const authCaller = appRouter.createCaller(authCtx);

      // Call me endpoint
      const result = await authCaller.auth.me();

      expect(result).toBeDefined();
      expect(result.id).toBe(user.id);
      expect(result.household).toBeNull();
    });
  });

  describe("User Logout", () => {
    it("should logout successfully when authenticated", async () => {
      const email = generateTestEmail("logout");
      const name = generateTestName("Logout User");
      const password = "SecurePassword123!";

      // Create user
      const user = await createTestUser({ email, name, password });

      // Create authenticated context
      const session = createMockSession(user);
      const authCtx = await createTRPCContext({ session });
      const authCaller = appRouter.createCaller(authCtx);

      // Call logout endpoint
      const result = await authCaller.auth.logout();

      expect(result.success).toBe(true);
    });

    it("should fail to logout when not authenticated", async () => {
      let error: Error | null = null;
      try {
        await caller.auth.logout();
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Not signed in");
    });
  });

  describe("Password Security", () => {
    it("should store password as Argon2id hash", async () => {
      const email = generateTestEmail("password-hash");
      const name = generateTestName("Password Hash User");
      const password = "MySecurePassword123!";

      await caller.auth.register({
        email,
        name,
        password,
      });

      const dbUser = await prisma.user.findUnique({
        where: { email },
      });

      expect(dbUser).toBeDefined();
      expect(dbUser?.passwordHash).not.toBe(password);
      expect(dbUser?.passwordHash).toStartWith("$argon2id$");

      // Verify the hash is valid
      if (dbUser) {
        const isValid = await argon2.verify(dbUser.passwordHash, password);
        expect(isValid).toBe(true);
      }
    });

    it("should reject weak passwords during registration", async () => {
      const email = generateTestEmail("weak-password");
      const name = generateTestName("Weak Password User");

      let error: Error | null = null;
      try {
        await caller.auth.register({
          email,
          name,
          password: "1234567", // Too short
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
    });
  });

  describe("Registration with Household", () => {
    it("should create user as OWNER when household is provided", async () => {
      const email = generateTestEmail("owner-role");
      const name = generateTestName("Owner User");
      const password = "SecurePassword123!";
      const householdName = "Owner Household";

      await caller.auth.register({
        email,
        name,
        password,
        householdName,
      });

      const dbUser = await prisma.user.findUnique({
        where: { email },
      });

      expect(dbUser).toBeDefined();
      expect(dbUser?.role).toBe("OWNER");
    });

    it("should create user as MEMBER when no household is provided", async () => {
      const email = generateTestEmail("member-role");
      const name = generateTestName("Member User");
      const password = "SecurePassword123!";

      await caller.auth.register({
        email,
        name,
        password,
      });

      const dbUser = await prisma.user.findUnique({
        where: { email },
      });

      expect(dbUser).toBeDefined();
      expect(dbUser?.role).toBe("MEMBER");
    });
  });
});
