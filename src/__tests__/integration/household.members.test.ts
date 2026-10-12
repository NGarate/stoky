import { describe, it, expect, beforeAll, afterAll, beforeEach, spyOn } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import type { HouseholdRole } from "@prisma/client";
import type { Session } from "next-auth";
import { isPasswordIdentityRefusal } from "@/lib/validations/password";
import { retryAfterSeconds } from "@/server/trpc/throttle";
import { RESET_OWN_PASSWORD_MESSAGE } from "@/lib/validations/household";
import { authConfig } from "@/lib/auth";
import { signInWith } from "../utils/authorize";

/**
 * Making the KITCHEN role reachable.
 *
 * It has been enforced on the server since Phase 3 and unprovisionable ever
 * since: the value was in the enum and in the middleware, and the only way to
 * get one was a database write. Phase 5's kitchen screen cannot be tested
 * honestly without this — a week-long run on a tablet under an *owner's*
 * account proves nothing about what a kitchen account can reach.
 */

const HOUSEHOLD = { id: "", ownerId: "", memberId: "" };
const OTHER = { id: "", adminId: "" };

async function callerFor(userId: string, householdId: string) {
  const session: Session = {
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: "Someone",
      householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

async function makeUser(
  householdId: string,
  role: HouseholdRole,
  label: string,
) {
  return prisma.user.create({
    data: {
      email: `people-${label}-${Date.now()}-${Math.round(performance.now())}@example.com`,
      name: `People ${label}`,
      passwordHash: await argon2.hash("TestPassword123!", {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      }),
      householdId,
      role,
    },
  });
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "no error";
  } catch (error) {
    return error instanceof TRPCError ? error.code : `not TRPCError: ${error}`;
  }
}

beforeAll(async () => {
  const household = await prisma.household.create({ data: { name: "People A" } });
  const other = await prisma.household.create({ data: { name: "People B" } });
  HOUSEHOLD.id = household.id;
  OTHER.id = other.id;

  HOUSEHOLD.ownerId = (await makeUser(household.id, "OWNER", "owner")).id;
  HOUSEHOLD.memberId = (await makeUser(household.id, "MEMBER", "member")).id;
  OTHER.adminId = (await makeUser(other.id, "ADMIN", "otheradmin")).id;
});

beforeEach(async () => {
  await prisma.user.deleteMany({
    where: { householdId: HOUSEHOLD.id, email: { contains: "created-" } },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { householdId: { in: [HOUSEHOLD.id, OTHER.id] } },
  });
  await prisma.household.deleteMany({
    where: { id: { in: [HOUSEHOLD.id, OTHER.id] } },
  });
  await prisma.$disconnect();
});

function newAccount(role: "MEMBER" | "KITCHEN") {
  return {
    name: role === "KITCHEN" ? "Tablet de la cocina" : "Alguien",
    email: `created-${role.toLowerCase()}-${Date.now()}-${Math.round(performance.now())}@example.com`,
    password: "TabletPassword123!",
    role,
  };
}

describe("creating a kitchen account", () => {
  it("puts it in the caller's household with the KITCHEN role", async () => {
    const api = await callerFor(HOUSEHOLD.ownerId, HOUSEHOLD.id);

    const created = await api.household.addMember(newAccount("KITCHEN"));

    expect(created.role).toBe("KITCHEN");
    const stored = await prisma.user.findUnique({ where: { id: created.id } });
    expect(stored?.householdId).toBe(HOUSEHOLD.id);
  });

  it("gives it a password it can actually sign in with", async () => {
    const api = await callerFor(HOUSEHOLD.ownerId, HOUSEHOLD.id);
    const account = newAccount("KITCHEN");

    const created = await api.household.addMember(account);
    const stored = await prisma.user.findUnique({ where: { id: created.id } });

    // Argon2id, the same as registration. A row with an unusable hash would
    // look created and be a locked-out tablet.
    expect(stored?.passwordHash).toStartWith("$argon2id$");
    expect(
      await argon2.verify(stored?.passwordHash ?? "", account.password),
    ).toBe(true);
  });

  it("never returns the hash", async () => {
    const api = await callerFor(HOUSEHOLD.ownerId, HOUSEHOLD.id);

    const created = await api.household.addMember(newAccount("KITCHEN"));

    expect(JSON.stringify(created)).not.toContain("argon2");
    expect(created).not.toHaveProperty("passwordHash");
  });

  it("refuses a password built from the person's own name, and creates nothing", async () => {
    // The identity rule was documented and unapplied until the schema carried
    // it (security review, 2026-10-12). Through the router, so the procedure's
    // `.input()` is what is proved to use it, not only the schema in isolation.
    const api = await callerFor(HOUSEHOLD.ownerId, HOUSEHOLD.id);
    const account = { ...newAccount("MEMBER"), name: "Rosalía", password: "rosalía despensa 2026" };

    let refusal: unknown;
    try {
      await api.household.addMember(account);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(TRPCError);
    expect((refusal as TRPCError).code).toBe("BAD_REQUEST");
    expect(isPasswordIdentityRefusal((refusal as TRPCError).message)).toBe(true);
    expect(await prisma.user.count({ where: { email: account.email } })).toBe(0);
  });

  it("refuses an address that already has an account", async () => {
    const api = await callerFor(HOUSEHOLD.ownerId, HOUSEHOLD.id);
    const account = newAccount("KITCHEN");
    await api.household.addMember(account);

    // The database's own unique constraint, translated. Checking first and
    // then inserting would race with itself.
    expect(await codeOf(api.household.addMember(account))).toBe("CONFLICT");
  });
});

/**
 * How many accounts an admin may create — security review, 2026-10-12.
 *
 * Every call hashes a password with Argon2id at 64 MiB before the database is
 * asked anything, and until this was metered nothing bounded how many: any
 * account that admins a household could ask for hashes in a loop. Through the
 * router, with the limit lowered so the test spends two calls rather than
 * twenty, and with accounts of their own so the tests above neither spend nor
 * are spent by this budget.
 */
describe("how many accounts an admin may create", () => {
  const ATTEMPTS = 2;
  const original = process.env.RATE_LIMIT_ADD_MEMBER_ATTEMPTS;

  beforeAll(() => {
    process.env.RATE_LIMIT_ADD_MEMBER_ATTEMPTS = String(ATTEMPTS);
  });

  afterAll(() => {
    if (original === undefined) delete process.env.RATE_LIMIT_ADD_MEMBER_ATTEMPTS;
    else process.env.RATE_LIMIT_ADD_MEMBER_ATTEMPTS = original;
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

  it("refuses once the budget is spent, says when to come back, and creates nothing", async () => {
    const owner = await makeUser(HOUSEHOLD.id, "OWNER", "metered");
    const api = await callerFor(owner.id, HOUSEHOLD.id);

    for (let i = 0; i < ATTEMPTS; i++) {
      await api.household.addMember(newAccount("KITCHEN"));
    }

    // Watched from here on: a refusal is worth something only if it comes
    // before the 64 MiB hash. Counted before restoring, which clears the calls.
    const hash = spyOn(argon2, "hash");
    const account = newAccount("KITCHEN");
    let hashed: number;
    let refusal: TRPCError;
    try {
      refusal = await refusalOf(api.household.addMember(account));
    } finally {
      hashed = hash.mock.calls.length;
      hash.mockRestore();
    }
    expect(hashed).toBe(0);

    // 429, so the write queue waits rather than discards
    // (`src/lib/offline/classify.ts`), and the HTTP layer reads `Retry-After`
    // off the refusal with the same function asserted here.
    expect(refusal.code).toBe("TOO_MANY_REQUESTS");
    const retryAfter = retryAfterSeconds([refusal]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(await prisma.user.count({ where: { email: account.email } })).toBe(0);
  });

  it("counts an address that is already taken, which costs the same hash", async () => {
    // The unique index answers only after Argon2id has run. A limit that
    // spared a CONFLICT would leave the cheapest loop — the same address,
    // over and over — outside it, and that loop is also the one that asks
    // whether an address has an account anywhere on the instance.
    const owner = await makeUser(HOUSEHOLD.id, "OWNER", "dupes");
    const api = await callerFor(owner.id, HOUSEHOLD.id);
    const taken = newAccount("MEMBER");

    await api.household.addMember(taken);
    expect(await codeOf(api.household.addMember(taken))).toBe("CONFLICT");

    expect(await codeOf(api.household.addMember(newAccount("MEMBER")))).toBe(
      "TOO_MANY_REQUESTS",
    );
  });

  it("leaves another admin's budget alone", async () => {
    // Keyed on the account, so one admin who has spent theirs does not stop
    // the household's other admin.
    const spender = await makeUser(HOUSEHOLD.id, "OWNER", "spender");
    const other = await makeUser(HOUSEHOLD.id, "ADMIN", "other");
    const spending = await callerFor(spender.id, HOUSEHOLD.id);
    const api = await callerFor(other.id, HOUSEHOLD.id);

    for (let i = 0; i < ATTEMPTS; i++) {
      await spending.household.addMember(newAccount("KITCHEN"));
    }
    expect(await codeOf(spending.household.addMember(newAccount("KITCHEN")))).toBe(
      "TOO_MANY_REQUESTS",
    );

    const created = await api.household.addMember(newAccount("KITCHEN"));
    expect(created.role).toBe("KITCHEN");
  });
});

describe("what an admin may not create", () => {
  it("refuses to mint another OWNER or ADMIN", async () => {
    const api = await callerFor(HOUSEHOLD.ownerId, HOUSEHOLD.id);

    for (const role of ["OWNER", "ADMIN"]) {
      const attempt = api.household.addMember({
        ...newAccount("MEMBER"),
        role: role as "MEMBER",
      });
      // Letting an admin mint an admin is a privilege escalation with no undo
      // in a schema where `User.householdId` is a single column.
      expect(await codeOf(attempt)).toBe("BAD_REQUEST");
    }
  });
});

describe("who may do any of this", () => {
  it("refuses a MEMBER", async () => {
    const api = await callerFor(HOUSEHOLD.memberId, HOUSEHOLD.id);

    expect(await codeOf(api.household.members())).toBe("FORBIDDEN");
    expect(await codeOf(api.household.addMember(newAccount("KITCHEN")))).toBe(
      "FORBIDDEN",
    );
  });

  it("writes nothing when it refuses", async () => {
    const api = await callerFor(HOUSEHOLD.memberId, HOUSEHOLD.id);
    const before = await prisma.user.count({
      where: { householdId: HOUSEHOLD.id },
    });

    await api.household.addMember(newAccount("KITCHEN")).catch(() => undefined);

    expect(
      await prisma.user.count({ where: { householdId: HOUSEHOLD.id } }),
    ).toBe(before);
  });
});

describe("listing who is in the household", () => {
  it("shows this household and no other", async () => {
    const api = await callerFor(HOUSEHOLD.ownerId, HOUSEHOLD.id);

    const members = await api.household.members();
    const ids = members.map((member) => member.id);

    expect(ids).toContain(HOUSEHOLD.ownerId);
    expect(ids).toContain(HOUSEHOLD.memberId);
    // The failure that would be invisible in single-household testing.
    expect(ids).not.toContain(OTHER.adminId);
  });

  it("does not hand out password hashes", async () => {
    const api = await callerFor(HOUSEHOLD.ownerId, HOUSEHOLD.id);

    const members = await api.household.members();

    expect(JSON.stringify(members)).not.toContain("argon2");
  });
});

/**
 * An admin setting a new password for a member — security review,
 * 2026-10-12. There is no email in this application, so before this a member
 * who forgot their password was locked out for good.
 *
 * Through the router, with real Argon2id, a real Valkey and the `jwt`
 * callback that actually refuses a session, the same way the change of one's
 * own password is tested in `auth.flow.test.ts`: a timestamp written is not a
 * session ended. Every test makes its own admin, so none spends another's
 * budget, and the accounts it acts on, so none sees another's password.
 */
describe("setting a member's password", () => {
  const OLD = "TestPassword123!";
  const NEW = "tarro de garbanzos azul";

  const stored = (id: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: { passwordHash: true, sessionsValidFrom: true, householdId: true },
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

  /** The configured `jwt` callback, which is where a session is refused. */
  function jwtCallback() {
    const callback = authConfig.callbacks?.jwt;
    if (typeof callback !== "function") {
      throw new Error("authConfig exposes no jwt callback");
    }
    return callback;
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

  it("sets the password, so the new one signs in, the old one does not, and old sessions end", async () => {
    const admin = await makeUser(HOUSEHOLD.id, "ADMIN", "reset-admin");
    const member = await makeUser(HOUSEHOLD.id, "MEMBER", "reset-target");
    const api = await callerFor(admin.id, HOUSEHOLD.id);
    const token = { sub: member.id, iat: Math.floor((Date.now() - 60_000) / 1000) };

    // The control: the same token is accepted before, so the refusal after is
    // the reset's doing and not the token's shape.
    expect(await jwtCallback()({ token: { ...token } } as never)).not.toBeNull();

    let result: unknown;
    const events = await eventsDuring(async () => {
      result = await api.household.resetMemberPassword({
        userId: member.id,
        newPassword: NEW,
      });
    });

    expect(JSON.stringify(result)).not.toContain("argon2");
    const after = await stored(member.id);
    expect(after.passwordHash).toStartWith("$argon2id$");
    expect(await signInWith({ email: member.email, password: NEW })).not.toBeNull();
    expect(await signInWith({ email: member.email, password: OLD })).toBeNull();

    // Whoever knew the old password may hold a session opened with it.
    expect(after.sessionsValidFrom).not.toBeNull();
    expect(await jwtCallback()({ token: { ...token } } as never)).toBeNull();

    // Who did it, to whom — and neither password.
    const reset = events.filter((e) => e.event === "auth.password.reset");
    expect(reset).toHaveLength(1);
    expect(reset[0]?.userId).toBe(admin.id);
    expect(reset[0]?.targetUserId).toBe(member.id);
    expect(reset[0]?.householdId).toBe(HOUSEHOLD.id);
    expect(JSON.stringify(events)).not.toContain(NEW);
  });

  it("refuses a member of another household with NOT_FOUND, and changes nothing", async () => {
    // The class SECURITY_REVIEW.md §2 found four times: the tier says an
    // admin may do this, and only the household check says *to whom*.
    const api = await callerFor(OTHER.adminId, OTHER.id);
    const before = await stored(HOUSEHOLD.memberId);

    const refusal = await refusalOf(
      api.household.resetMemberPassword({ userId: HOUSEHOLD.memberId, newPassword: NEW }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
    expect(await stored(HOUSEHOLD.memberId)).toEqual(before);
  });

  it("refuses an admin acting on an owner, and changes nothing", async () => {
    // Setting an owner's password is signing in as that owner.
    const admin = await makeUser(HOUSEHOLD.id, "ADMIN", "reset-admin-owner");
    const api = await callerFor(admin.id, HOUSEHOLD.id);
    const before = await stored(HOUSEHOLD.ownerId);

    const refusal = await refusalOf(
      api.household.resetMemberPassword({ userId: HOUSEHOLD.ownerId, newPassword: NEW }),
    );

    expect(refusal.code).toBe("FORBIDDEN");
    expect(await stored(HOUSEHOLD.ownerId)).toEqual(before);
  });

  it("lets an owner act on another owner", async () => {
    // The guard is "only an owner may act on an owner", not "nobody may": a
    // household with two owners must be able to recover either.
    const owner = await makeUser(HOUSEHOLD.id, "OWNER", "reset-owner");
    const other = await makeUser(HOUSEHOLD.id, "OWNER", "reset-owner-target");
    const api = await callerFor(owner.id, HOUSEHOLD.id);

    await api.household.resetMemberPassword({ userId: other.id, newPassword: NEW });

    expect(await argon2.verify((await stored(other.id)).passwordHash, NEW)).toBe(true);
  });

  it("refuses the caller's own account, which changes through its current password", async () => {
    const admin = await makeUser(HOUSEHOLD.id, "ADMIN", "reset-self");
    const api = await callerFor(admin.id, HOUSEHOLD.id);
    const before = await stored(admin.id);

    const refusal = await refusalOf(
      api.household.resetMemberPassword({ userId: admin.id, newPassword: NEW }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
    expect(refusal.message).toBe(RESET_OWN_PASSWORD_MESSAGE);
    expect(await stored(admin.id)).toEqual(before);
  });

  it("refuses a MEMBER", async () => {
    const api = await callerFor(HOUSEHOLD.memberId, HOUSEHOLD.id);
    const target = await makeUser(HOUSEHOLD.id, "KITCHEN", "reset-by-member");

    expect(
      await codeOf(api.household.resetMemberPassword({ userId: target.id, newPassword: NEW })),
    ).toBe("FORBIDDEN");
  });

  it("refuses a password built from the member's own name, and changes nothing", async () => {
    // The input names the member by id only, so the schema cannot apply the
    // identity rule; the procedure loads the member and applies it itself.
    const admin = await makeUser(HOUSEHOLD.id, "ADMIN", "reset-identity");
    const member = await makeUser(HOUSEHOLD.id, "MEMBER", "reset-identity-target");
    const api = await callerFor(admin.id, HOUSEHOLD.id);
    const before = await stored(member.id);

    const refusal = await refusalOf(
      api.household.resetMemberPassword({
        userId: member.id,
        newPassword: `${member.name} despensa`,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
    expect(isPasswordIdentityRefusal(refusal.message)).toBe(true);
    expect(await stored(member.id)).toEqual(before);
  });

  it("writes nothing to a member who left the household while the password was hashed", async () => {
    // Argon2id runs between the checks and the write. The write repeats the
    // household and role in its `where`, so a member who has stopped being
    // the one that was checked is not written to.
    const admin = await makeUser(HOUSEHOLD.id, "ADMIN", "reset-race");
    const member = await makeUser(HOUSEHOLD.id, "MEMBER", "reset-race-target");
    const api = await callerFor(admin.id, HOUSEHOLD.id);
    const before = await stored(member.id);

    const realHash = argon2.hash;
    const hash = spyOn(argon2, "hash").mockImplementation((async (
      ...args: Parameters<typeof argon2.hash>
    ) => {
      await prisma.user.update({ where: { id: member.id }, data: { householdId: OTHER.id } });
      return realHash(...args);
    }) as typeof argon2.hash);
    let refusal: TRPCError;
    try {
      refusal = await refusalOf(
        api.household.resetMemberPassword({ userId: member.id, newPassword: NEW }),
      );
    } finally {
      hash.mockRestore();
    }

    expect(refusal.code).toBe("CONFLICT");
    const after = await stored(member.id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.sessionsValidFrom).toBeNull();
  });

  it("writes nothing to a member made an owner while the password was hashed", async () => {
    // The household is the same, so only the role in the write's `where`
    // stands between an ADMIN and the password of somebody who is now an
    // owner: the escalation `assertMayActOnOwner` refuses, reached by timing.
    const admin = await makeUser(HOUSEHOLD.id, "ADMIN", "reset-race-role");
    const member = await makeUser(HOUSEHOLD.id, "MEMBER", "reset-race-role-target");
    const api = await callerFor(admin.id, HOUSEHOLD.id);
    const before = await stored(member.id);

    const realHash = argon2.hash;
    const hash = spyOn(argon2, "hash").mockImplementation((async (
      ...args: Parameters<typeof argon2.hash>
    ) => {
      await prisma.user.update({ where: { id: member.id }, data: { role: "OWNER" } });
      return realHash(...args);
    }) as typeof argon2.hash);
    let refusal: TRPCError;
    try {
      refusal = await refusalOf(
        api.household.resetMemberPassword({ userId: member.id, newPassword: NEW }),
      );
    } finally {
      hash.mockRestore();
    }

    expect(refusal.code).toBe("CONFLICT");
    const after = await stored(member.id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.sessionsValidFrom).toBeNull();
  });

  describe("how often", () => {
    const ATTEMPTS = 2;
    const original = process.env.RATE_LIMIT_ADD_MEMBER_ATTEMPTS;

    beforeAll(() => {
      process.env.RATE_LIMIT_ADD_MEMBER_ATTEMPTS = String(ATTEMPTS);
    });

    afterAll(() => {
      if (original === undefined) delete process.env.RATE_LIMIT_ADD_MEMBER_ATTEMPTS;
      else process.env.RATE_LIMIT_ADD_MEMBER_ATTEMPTS = original;
    });

    it("shares adding a member's budget, and refuses before the hash", async () => {
      // Both run Argon2id at 64 MiB per call; two budgets would be twice the
      // hashes one admin can ask for.
      const admin = await makeUser(HOUSEHOLD.id, "OWNER", "reset-metered");
      const member = await makeUser(HOUSEHOLD.id, "MEMBER", "reset-metered-target");
      const api = await callerFor(admin.id, HOUSEHOLD.id);

      await api.household.addMember(newAccount("KITCHEN"));
      await api.household.resetMemberPassword({ userId: member.id, newPassword: NEW });
      const before = await stored(member.id);

      const hash = spyOn(argon2, "hash");
      let hashed: number;
      let refusal: TRPCError;
      try {
        refusal = await refusalOf(
          api.household.resetMemberPassword({ userId: member.id, newPassword: OLD }),
        );
      } finally {
        hashed = hash.mock.calls.length;
        hash.mockRestore();
      }

      expect(hashed).toBe(0);
      expect(refusal.code).toBe("TOO_MANY_REQUESTS");
      expect(retryAfterSeconds([refusal])).toBeGreaterThan(0);
      expect(await stored(member.id)).toEqual(before);
    });
  });
});
