import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  spyOn,
} from "bun:test";
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
  storedPasswordHash,
} from "../utils/test-helpers";
import * as argon2 from "argon2";
import { signInWith } from "../utils/authorize";
import { TRPCError } from "@trpc/server";
import {
  isPasswordIdentityRefusal,
  isWrongCurrentPasswordRefusal,
} from "@/lib/validations/password";
import { readSession } from "@/lib/auth";
import { retryAfterSeconds } from "@/server/trpc/throttle";

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

    it("treats an address in any case as one account", async () => {
      // Registration stored the case as typed and sign-in compared exactly:
      // the account below could not sign in with the address in lower case,
      // and the lower-case spelling could be registered as a second account.
      const lower = runEmail("mixed-case");
      const typed = `  ${lower.toUpperCase()} `;
      const password = "SecurePassword123!";

      const result = await caller.auth.register({
        email: typed,
        name: generateTestName("Mixed Case"),
        password,
      });
      expect(result.user.email).toBe(lower);

      // The second through the route's trim and lower-casing, the spaces and
      // the capitals as the person typed them.
      expect((await signInWith({ email: lower, password })).status).toBe(200);
      expect((await signInWith({ email: typed, password })).status).toBe(200);

      await expect(
        caller.auth.register({ email: lower, name: "Second", password }),
      ).rejects.toThrow("Email already registered");
      expect(
        await prisma.user.count({ where: { email: { equals: lower, mode: "insensitive" } } }),
      ).toBe(1);
    });

    it("refuses a second spelling of an address even from a write that skips the schema", async () => {
      // The unique index on lower(email), under the schema's normalisation:
      // a script, a seed or a future procedure that forgets to lowercase
      // still cannot create a twin of an existing account.
      const lower = runEmail("raw-twin");
      await createTestUser({ email: lower, name: generateTestName("Raw Twin") });

      let thrown: unknown;
      try {
        await prisma.user.create({
          data: { email: lower.toUpperCase(), name: "Twin" },
        });
      } catch (error) {
        thrown = error;
      } finally {
        // Not reached by the run marker's cleanup, which matches case-sensitively.
        await prisma.user.deleteMany({ where: { email: lower.toUpperCase() } });
      }

      expect((thrown as { code?: string } | undefined)?.code).toBe("P2002");
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

    it("refuses a password built from the address it is for, and creates nothing", async () => {
      // Through the router rather than the schema alone: the claim in
      // SECURITY.md is about what registration accepts, and the procedure's
      // `.input()` is where that is decided. The local part carries the run
      // marker, so it is unique, and the password is built from it.
      const email = runEmail("identity");
      const localPart = email.split("@")[0] ?? "";

      let refusal: unknown;
      try {
        await caller.auth.register({
          email,
          name: generateTestName("Identity User"),
          password: `${localPart}!`,
        });
      } catch (e) {
        refusal = e;
      }

      expect(refusal).toBeInstanceOf(TRPCError);
      expect((refusal as TRPCError).code).toBe("BAD_REQUEST");
      expect(isPasswordIdentityRefusal((refusal as TRPCError).message)).toBe(true);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
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

  describe("Sign-in, through the auth API", () => {
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

      expect(result.status).toBe(200);
      expect(result.user?.email).toBe(email);
      expect(result.cookieHeader).toContain("stoky.session_token=");
    });

    it("should refuse an invalid password", async () => {
      const email = runEmail("invalid-password");
      const name = generateTestName("Invalid Password User");
      const password = "CorrectPassword123!";

      await createTestUser({ email, name, password });

      const result = await signInWith({ email, password: "WrongPassword123!" });

      expect(result.status).toBe(401);
      expect(result.code).toBe("INVALID_EMAIL_OR_PASSWORD");
      expect(result.setCookie).toEqual([]);
    });

    it("should refuse a non-existent email the same way", async () => {
      const result = await signInWith({
        email: runEmail("non-existent"),
        password: "AnyPassword123!",
      });

      // Indistinguishable from a wrong password, which is what stops an
      // attacker enumerating which addresses have accounts.
      expect(result.status).toBe(401);
      expect(result.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    });

    it("takes as long for a non-existent email as for a wrong password", async () => {
      // Indistinguishable in the answer is not enough if it is distinguishable
      // on a stopwatch. Argon2id ran only when the account existed, so "no
      // such address" came back in a few milliseconds and "wrong password" in
      // a quarter of a second.
      //
      // A ratio rather than a number, and a generous one, so a slow machine
      // or a busy CI runner cannot make it flake: the difference it catches is
      // two orders of magnitude, not a few percent.
      const email = runEmail("timing");
      await createTestUser({ email, name: generateTestName("Timing"), password: "CorrectPassword123!" });

      const elapsed = async (address: string): Promise<number> => {
        const started = performance.now();
        await signInWith({ email: address, password: "WrongPassword123!" });
        return performance.now() - started;
      };
      const median = (values: number[]) => values.sort((a, b) => a - b)[1];

      const wrongPassword: number[] = [];
      const noAccount: number[] = [];
      for (let i = 0; i < 3; i++) {
        wrongPassword.push(await elapsed(email));
        noAccount.push(await elapsed(runEmail(`timing-missing-${i}`)));
      }

      expect(median(noAccount)).toBeGreaterThan(median(wrongPassword) * 0.5);
    });

    it("should refuse empty credentials", async () => {
      const result = await signInWith({ email: "", password: "" });

      // Answered by the route, charged and never handed to Better Auth.
      expect(result.status).toBe(400);
      expect(result.code).toBe("INVALID_REQUEST");
      expect(result.setCookie).toEqual([]);
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

      const dbUser = await prisma.user.findUniqueOrThrow({
        where: { email },
      });
      const passwordHash = await storedPasswordHash(dbUser.id);

      expect(passwordHash).not.toBe(password);
      expect(passwordHash).toStartWith("$argon2id$");
      expect(await argon2.verify(passwordHash, password)).toBe(true);
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
  /**
   * A signed-in person replacing their own password — security review,
   * 2026-10-12. Until `auth.changePassword` existed nothing changed a password
   * once it was set, so a leaked one could not be rotated and one an admin
   * chose stayed the admin's.
   *
   * Through the router, with real Argon2id and a real Valkey, and the old
   * session checked by reading it with the cookie a real sign-in set — the
   * same way `session.revocation.test.ts` does, because a row deleted is only
   * half of a session ended; the cookie being refused is the other.
   */
  describe("Changing your own password", () => {
    const OLD = "cocina despensa nevera";
    const NEW = "tarro de garbanzos azul";

    async function accountWithCaller(label: string, password = OLD) {
      const user = await createTestUser({
        email: runEmail(label),
        name: generateTestName(`Change ${label}`),
        password,
      });
      const ctx = await createTRPCContext({ session: createMockSession(user) });
      return { user, api: appRouter.createCaller(ctx) };
    }

    const stored = async (id: string) => ({
      passwordHash: await storedPasswordHash(id),
      sessions: await prisma.session.count({ where: { userId: id } }),
    });

    async function refusalOf(call: Promise<unknown>): Promise<TRPCError> {
      try {
        await call;
      } catch (error) {
        if (error instanceof TRPCError) return error;
        throw error;
      }
      throw new Error("expected a refusal, and the call succeeded");
    }

    /** The security events written while `run` ran, parsed. */
    async function eventsDuring(run: () => Promise<unknown>) {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      let lines: string[];
      try {
        await run();
      } finally {
        lines = warn.mock.calls.map((call) => String(call[0]));
        warn.mockRestore();
      }
      return lines.flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, string>];
        } catch {
          return [];
        }
      });
    }

    it("refuses a wrong current password with BAD_REQUEST, and changes nothing", async () => {
      // BAD_REQUEST and not UNAUTHORIZED: the offline queue and the screens
      // read UNAUTHORIZED as a session that has ended, and this person is
      // still signed in with a typo.
      const { user, api } = await accountWithCaller("wrong-current");
      const before = await stored(user.id);

      let refusal: TRPCError | undefined;
      const events = await eventsDuring(async () => {
        refusal = await refusalOf(
          api.auth.changePassword({
            currentPassword: "not the password at all",
            newPassword: NEW,
          }),
        );
      });

      expect(refusal?.code).toBe("BAD_REQUEST");
      expect(isWrongCurrentPasswordRefusal(refusal?.message)).toBe(true);
      expect(await stored(user.id)).toEqual(before);
      expect((await signInWith({ email: user.email, password: OLD })).status).toBe(200);

      // Recorded, because the refusal middleware does not see a BAD_REQUEST,
      // and this is the line that says a session is guessing at a password.
      const refused = events.filter((e) => e.event === "auth.password.change.refused");
      expect(refused).toHaveLength(1);
      expect(refused[0]?.userId).toBe(user.id);
      expect(JSON.stringify(events)).not.toContain("not the password at all");
    });

    it("replaces the password, so the new one signs in and the old one does not", async () => {
      const { user, api } = await accountWithCaller("replaces");

      const events = await eventsDuring(() =>
        api.auth.changePassword({ currentPassword: OLD, newPassword: NEW }),
      );

      const after = await stored(user.id);
      expect(after.passwordHash).toStartWith("$argon2id$");
      expect(await argon2.verify(after.passwordHash, NEW)).toBe(true);
      expect(await argon2.verify(after.passwordHash, OLD)).toBe(false);

      expect((await signInWith({ email: user.email, password: NEW })).status).toBe(200);
      expect((await signInWith({ email: user.email, password: OLD })).status).toBe(401);

      const changed = events.filter((e) => e.event === "auth.password.changed");
      expect(changed).toHaveLength(1);
      expect(changed[0]?.userId).toBe(user.id);
      const written = JSON.stringify(events);
      expect(written).not.toContain(NEW);
      expect(written).not.toContain(OLD);
    });

    it("ends every session issued before the change, this one included", async () => {
      // The point of changing a leaked password: whoever used it has a
      // session too, and a new password beside a live session is half a fix.
      const { user, api } = await accountWithCaller("ends-sessions");
      const elsewhere = await signInWith({ email: user.email, password: OLD });
      const cookie = new Headers({ cookie: elsewhere.cookieHeader });

      // The control: the same cookie is accepted before the change, so the
      // refusal below is the change's doing and not the cookie's shape.
      expect(await readSession(cookie, { refresh: false })).not.toBeNull();

      await api.auth.changePassword({ currentPassword: OLD, newPassword: NEW });

      expect((await stored(user.id)).sessions).toBe(0);
      expect(await readSession(cookie, { refresh: false })).toBeNull();
    });

    it("refuses a new password built from the person's own address, and changes nothing", async () => {
      // The input carries no address, so the schema cannot apply the identity
      // rule; the procedure loads the account and applies it itself.
      const { user, api } = await accountWithCaller("identity-change");
      const before = await stored(user.id);
      const localPart = user.email.split("@")[0] ?? "";

      const refusal = await refusalOf(
        api.auth.changePassword({ currentPassword: OLD, newPassword: `${localPart}!` }),
      );

      expect(refusal.code).toBe("BAD_REQUEST");
      expect(isPasswordIdentityRefusal(refusal.message)).toBe(true);
      expect(await stored(user.id)).toEqual(before);
    });

    it("refuses a new password the policy refuses, and changes nothing", async () => {
      const { user, api } = await accountWithCaller("policy-change");
      const before = await stored(user.id);

      for (const newPassword of ["corta", "password1234"]) {
        const refusal = await refusalOf(
          api.auth.changePassword({ currentPassword: OLD, newPassword }),
        );
        expect(refusal.code).toBe("BAD_REQUEST");
      }
      expect(await stored(user.id)).toEqual(before);
    });

    it("accepts a current password set before the policy existed", async () => {
      // The account whose password predates the twelve-character rule is the
      // one with most reason to change it. Policing the current password
      // would lock exactly that account into keeping it.
      const legacy = "corta1";
      const { user, api } = await accountWithCaller("legacy-current", legacy);

      await api.auth.changePassword({ currentPassword: legacy, newPassword: NEW });

      expect(await argon2.verify((await stored(user.id)).passwordHash, NEW)).toBe(true);
    });

    it("refuses a caller who is not signed in", async () => {
      const refusal = await refusalOf(
        caller.auth.changePassword({ currentPassword: OLD, newPassword: NEW }),
      );
      expect(refusal.code).toBe("UNAUTHORIZED");
    });

    describe("how many attempts an account gets", () => {
      // Lowered so the test spends three calls rather than six. Each account
      // is new, so its counter is too.
      const ATTEMPTS = 2;
      const original = process.env.RATE_LIMIT_PASSWORD_CHANGE_ATTEMPTS;

      beforeAll(() => {
        process.env.RATE_LIMIT_PASSWORD_CHANGE_ATTEMPTS = String(ATTEMPTS);
      });

      afterAll(() => {
        if (original === undefined) delete process.env.RATE_LIMIT_PASSWORD_CHANGE_ATTEMPTS;
        else process.env.RATE_LIMIT_PASSWORD_CHANGE_ATTEMPTS = original;
      });

      it("refuses once the budget is spent, before checking anything, even the right password", async () => {
        // A stolen session guessing the password behind it is the attack.
        // The refusal has to come before Argon2id runs, or the limit is a
        // count of guesses already answered.
        const { user, api } = await accountWithCaller("metered");
        const before = await stored(user.id);

        for (let i = 0; i < ATTEMPTS; i++) {
          const wrong = await refusalOf(
            api.auth.changePassword({ currentPassword: `guess number ${i}`, newPassword: NEW }),
          );
          expect(wrong.code).toBe("BAD_REQUEST");
        }

        const verify = spyOn(argon2, "verify");
        let verified: number;
        let refusal: TRPCError;
        try {
          refusal = await refusalOf(
            api.auth.changePassword({ currentPassword: OLD, newPassword: NEW }),
          );
        } finally {
          verified = verify.mock.calls.length;
          verify.mockRestore();
        }

        expect(refusal.code).toBe("TOO_MANY_REQUESTS");
        expect(verified).toBe(0);
        // The same function the HTTP layer reads `Retry-After` with.
        const retryAfter = retryAfterSeconds([refusal]);
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThanOrEqual(900);
        expect(await stored(user.id)).toEqual(before);
      });

      it("leaves another account's budget alone", async () => {
        const spender = await accountWithCaller("spender");
        const other = await accountWithCaller("unspent");

        for (let i = 0; i < ATTEMPTS; i++) {
          await refusalOf(
            spender.api.auth.changePassword({ currentPassword: `guess ${i}`, newPassword: NEW }),
          );
        }
        expect(
          (
            await refusalOf(
              spender.api.auth.changePassword({ currentPassword: OLD, newPassword: NEW }),
            )
          ).code,
        ).toBe("TOO_MANY_REQUESTS");

        await other.api.auth.changePassword({ currentPassword: OLD, newPassword: NEW });
        expect(await argon2.verify((await stored(other.user.id)).passwordHash, NEW)).toBe(true);
      });
    });
  });
});
