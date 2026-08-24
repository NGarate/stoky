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
import { signInWith } from "../utils/authorize";

/**
 * Everything this file creates carries this run's own marker, and cleanup
 * deletes by it — **never** by a pattern another suite could match.
 *
 * The `afterEach` here used to delete every user containing `"@example.com"`
 * and every household containing `"Test Household"`, after every one of these
 * tests. Run serially that was invisible: each file's `beforeAll` recreates its
 * rows. Run alongside another suite on the same database — two developers, a
 * watch mode, or TEST-5's load reproduction — it deleted the *other* process's
 * users mid-test, which surfaced as `UNAUTHORIZED "This account no longer
 * exists"` from whichever procedure looked up membership next. That is how it
 * contaminated TEST-5's evidence: some of the failures attributed to the
 * runner were this file reaching across and shooting the replay suite's users.
 */
const RUN_MARKER = `authflow-${Date.now().toString(36)}`;
const runEmail = (prefix: string) => generateTestEmail(`${RUN_MARKER}-${prefix}`);

describe("Authentication Flow Integration Tests", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(async () => {
    // Create a basic context for unauthenticated requests
    const ctx = await createTRPCContext({ session: null });
    caller = appRouter.createCaller(ctx);
  });

  afterEach(async () => {
    // Only what this run made. The marker is in every email and household name.
    await cleanupTestUsers(RUN_MARKER);
    await cleanupTestHouseholds(RUN_MARKER);
  });

  describe("User Registration", () => {
    it("should register a new user with valid data", async () => {
      const email = runEmail("register");
      const name = generateTestName("Register User");
      const password = "SecurePassword123!";
      const householdName = `My Test Household ${RUN_MARKER}`;

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
      const email = runEmail("no-household");
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
      const email = runEmail("duplicate");
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
      const email = runEmail("short-password");
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
      const email = runEmail("empty-name");
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

  describe("Sign-in, through Auth.js", () => {
    // Repointed from `auth.login`, a second credential endpoint on the public
    // tRPC router that nothing in the interface called and that the CRITICAL-4
    // limiter never covered. It has been removed; this is the path the login
    // form uses.

    it("should accept valid credentials", async () => {
      const email = runEmail("login");
      const name = generateTestName("Login User");
      const password = "ValidPassword123!";

      await createTestUser({ email, name, password });

      const result = await signInWith({ email, password });

      expect(result).not.toBeNull();
      expect((result as { email: string }).email).toBe(email);
    });

    it("should refuse an invalid password", async () => {
      const email = runEmail("invalid-password");
      const name = generateTestName("Invalid Password User");
      const password = "CorrectPassword123!";

      await createTestUser({ email, name, password });

      const result = await signInWith({ email, password: "WrongPassword123!" });

      expect(result).toBeNull();
    });

    it("should refuse a non-existent email the same way", async () => {
      const result = await signInWith({
        email: runEmail("non-existent"),
        password: "AnyPassword123!",
      });

      // Indistinguishable from a wrong password, which is what stops an
      // attacker enumerating which addresses have accounts.
      expect(result).toBeNull();
    });

    it("should refuse empty credentials", async () => {
      const result = await signInWith({ email: "", password: "" });

      expect(result).toBeNull();
    });
  });

  describe("Get Current User (Me)", () => {
    it("should return current user when authenticated", async () => {
      const email = runEmail("me-auth");
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
      const email = runEmail("no-household-me");
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

  /**
   * WCAG 2.2.1 asks that a time limit be adjustable, and the adjustment is
   * about the person: somebody who needs longer to read a message needs
   * longer on the phone in the shop as well as on the kitchen tablet. It was
   * in `localStorage`, so it was a property of the browser and was lost with
   * the browser's storage.
   */
  describe("Snackbar duration", () => {
    it("records the choice against the account", async () => {
      const user = await createTestUser({
        email: runEmail("snackbar"),
        name: generateTestName("Snackbar User"),
        password: "SecurePassword123!",
      });

      const authCaller = appRouter.createCaller(
        await createTRPCContext({ session: createMockSession(user) }),
      );

      const result = await authCaller.auth.setSnackbarDuration({
        snackbarDuration: "forever",
      });

      expect(result.snackbarDuration).toBe("forever");

      const stored = await prisma.user.findUnique({
        where: { id: user.id },
        select: { snackbarDuration: true },
      });
      expect(stored?.snackbarDuration).toBe("forever");
    });

    it("hands the stored choice back through me, which is what the shell reads", async () => {
      const user = await createTestUser({
        email: runEmail("snackbar-me"),
        name: generateTestName("Snackbar Me User"),
        password: "SecurePassword123!",
      });

      const authCaller = appRouter.createCaller(
        await createTRPCContext({ session: createMockSession(user) }),
      );

      // The default first: an account that has never chosen must not be
      // handed something the store would reject.
      expect((await authCaller.auth.me()).snackbarDuration).toBe("default");

      await authCaller.auth.setSnackbarDuration({ snackbarDuration: "long" });

      expect((await authCaller.auth.me()).snackbarDuration).toBe("long");
    });

    it("refuses a duration the snackbar could not honour", async () => {
      const user = await createTestUser({
        email: runEmail("snackbar-bad"),
        name: generateTestName("Snackbar Bad User"),
        password: "SecurePassword123!",
      });

      const authCaller = appRouter.createCaller(
        await createTRPCContext({ session: createMockSession(user) }),
      );

      let error: Error | null = null;
      try {
        // The column is TEXT, so nothing below the schema would stop this;
        // the store would then reject it on read and silently fall back,
        // which is a preference that appears to save and does not.
        await authCaller.auth.setSnackbarDuration({
          snackbarDuration: "eternity" as "forever",
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();

      const stored = await prisma.user.findUnique({
        where: { id: user.id },
        select: { snackbarDuration: true },
      });
      expect(stored?.snackbarDuration).toBe("default");
    });

    it("refuses to record anything for a caller with no session", async () => {
      let error: Error | null = null;
      try {
        await caller.auth.setSnackbarDuration({ snackbarDuration: "forever" });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Not signed in");
    });
  });

  describe("User Logout", () => {
    it("should logout successfully when authenticated", async () => {
      const email = runEmail("logout");
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
      const email = runEmail("password-hash");
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
      const email = runEmail("weak-password");
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
      const email = runEmail("owner-role");
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
      const email = runEmail("member-role");
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
