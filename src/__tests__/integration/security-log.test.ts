import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  spyOn,
} from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { openFoodFacts } from "@/server/services/openFoodFacts";
import { accountTag } from "@/lib/account-tag";
import {
  accountIdentifier,
  loginAccountRateLimit,
  resetRateLimit,
} from "@/lib/rate-limit";
import { freshTestAddress, signInWith } from "../utils/authorize";
import {
  createTestUser,
  createTestHousehold,
  createTestProduct,
  createMockSession,
  envelope,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * OWASP ASVS V7.1.3, through the router rather than through the logger.
 *
 * `src/__tests__/unit/security-log.test.ts` proves the line is right. What it
 * cannot prove is that anything writes one, and that is the half that breaks:
 * an access-control failure is thrown from three middlewares, from a resolver
 * or two, and — as NOT_FOUND — from every lookup scoped to `householdId`, so
 * the guarantee worth testing is that a *resolver's* refusal is audited
 * without the resolver knowing anything about it. A new router must not be
 * able to forget.
 */

const HOUSEHOLD = "Security Log Household";
const OTHER_HOUSEHOLD = "Security Log Other Household";

type Caller = ReturnType<typeof appRouter.createCaller>;

let outsider: Caller;
let otherHouseholdId: string;
let kitchen: Caller;
let anonymous: Caller;
let admin: Caller;
let receiptId: string;
let storeId: string;
let productId: string;
let listId: string;
let shoppingItemId: string;
let outsiderId: string;
let ownerId: string;
let adminId: string;
let ownerEmail: string;

/** Every line the code under test wrote, parsed. */
let lines: Record<string, string>[] = [];
const realWarn = console.warn;

function capture() {
  lines = [];
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith('{"ts":')) {
      lines.push(JSON.parse(first));
      return;
    }
    realWarn(...args);
  };
}

beforeAll(async () => {
  const household = await createTestHousehold({ name: HOUSEHOLD });
  const other = await createTestHousehold({ name: OTHER_HOUSEHOLD });

  ownerEmail = generateTestEmail("seclog-owner");
  const owner = await createTestUser({
    email: ownerEmail,
    name: "Security Log Owner",
    householdId: household.id,
    role: "OWNER",
  });
  const stranger = await createTestUser({
    email: generateTestEmail("seclog-outsider"),
    name: "Security Log Outsider",
    householdId: other.id,
    role: "OWNER",
  });
  const tablet = await createTestUser({
    email: generateTestEmail("seclog-kitchen"),
    name: "Security Log Kitchen",
    householdId: household.id,
    role: "KITCHEN",
  });
  const adminUser = await createTestUser({
    email: generateTestEmail("seclog-admin"),
    name: "Security Log Admin",
    householdId: household.id,
    role: "ADMIN",
  });

  outsiderId = stranger.id;
  otherHouseholdId = other.id;
  ownerId = owner.id;
  adminId = adminUser.id;
  outsider = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession(stranger) }),
  );
  kitchen = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession(tablet) }),
  );
  admin = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession(adminUser) }),
  );
  anonymous = appRouter.createCaller(await createTRPCContext({ session: null }));

  const receipt = await prisma.receipt.create({
    data: {
      imagePath: `uploads/receipts/${household.id}/seclog.jpg`,
      householdId: household.id,
      uploadedBy: owner.id,
    },
  });
  receiptId = receipt.id;

  // Rows the outsider reaches for through a scoped *write*, whose miss is a
  // Prisma P2025 rather than a resolver's own NOT_FOUND.
  const store = await prisma.store.create({
    data: { name: "Security Log Store", householdId: household.id },
  });
  storeId = store.id;
  const product = await createTestProduct({
    name: "Security Log Product",
    householdId: household.id,
  });
  productId = product.id;
  const list = await prisma.shoppingList.create({
    data: { name: "Security Log List", householdId: household.id },
  });
  listId = list.id;
  const item = await prisma.shoppingItem.create({
    data: { shoppingListId: list.id, productId: product.id },
  });
  shoppingItemId = item.id;
});

afterAll(async () => {
  console.warn = realWarn;
  await prisma.receipt.deleteMany({ where: { id: receiptId } });
  await prisma.shoppingItem.deleteMany({ where: { id: shoppingItemId } });
  await prisma.shoppingList.deleteMany({ where: { id: listId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.user.deleteMany({ where: { email: { contains: "seclog-" } } });
  await prisma.household.deleteMany({
    where: { name: { in: [HOUSEHOLD, OTHER_HOUSEHOLD] } },
  });
});

beforeEach(capture);

describe("a refusal a resolver made", () => {
  // Moved off receipt.getReceiptWithItems: the receipt router now answers a
  // cross-household id with NOT_FOUND (see "a household lookup that missed"
  // below), so it no longer has a resolver-thrown FORBIDDEN to serve as this
  // example. household.ts's assertMayActOnOwner still throws one directly
  // from a resolver body.
  it("is recorded, though the resolver knows nothing about logging", async () => {
    // An admin reaching for an owner's sessions: assertMayActOnOwner refuses
    // it in the resolver body, with no middleware involved.
    await expect(
      admin.household.revokeMemberSessions({ userId: ownerId }),
    ).rejects.toThrow();

    const denial = lines.find((line) => line.event === "access.denied");
    expect(denial).toBeDefined();
    expect(denial?.path).toBe("household.revokeMemberSessions");
    expect(denial?.userId).toBe(adminId);
  });

  it("names the code it was refused with", async () => {
    await expect(
      admin.household.revokeMemberSessions({ userId: ownerId }),
    ).rejects.toThrow();

    // FORBIDDEN and UNAUTHORIZED are different incidents: one is somebody
    // signed in reaching past their household, the other is nobody at all.
    expect(lines[0]?.code).toBe("FORBIDDEN");
  });
});

describe("a refusal a middleware made", () => {
  it("records a role that may not write", async () => {
    await expect(
      kitchen.product.create({ name: "Leche", defaultUnit: "L" }),
    ).rejects.toThrow();

    expect(lines[0]?.event).toBe("access.denied");
    expect(lines[0]?.code).toBe("FORBIDDEN");
    expect(lines[0]?.path).toBe("product.create");
  });

  it("records a request with nobody behind it", async () => {
    await expect(anonymous.product.list({})).rejects.toThrow();

    expect(lines[0]?.code).toBe("UNAUTHORIZED");
    // Nothing to attribute it to, and the line says so by omission rather than
    // by inventing an "anonymous" account.
    expect(lines[0]).not.toHaveProperty("userId");
  });
});

describe("a household lookup that missed", () => {
  // Another household's id is refused with the same NOT_FOUND as an id nobody
  // has, so the browser cannot tell which ids exist. householdProcedure
  // records the miss — ASVS V7.2.2, every failed access-control decision —
  // without the receipt router knowing anything about logging.
  it("is recorded when one household asks for another's row", async () => {
    await expect(
      outsider.receipt.getReceiptWithItems({ receiptId }),
    ).rejects.toThrow("Receipt not found");

    const denials = lines.filter((line) => line.event === "access.denied");
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      path: "receipt.getReceiptWithItems",
      code: "NOT_FOUND",
      reason: "not-found",
      userId: outsiderId,
      householdId: otherHouseholdId,
    });
  });

  it("never names the id that was asked for", async () => {
    // The id is the prober's input. Quoting it would hand whoever reads the
    // log the other household's ids the response refused to confirm.
    await expect(
      outsider.receipt.getReceiptWithItems({ receiptId }),
    ).rejects.toThrow();

    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain(receiptId);
  });

  it("is recorded alike for an id nobody has", async () => {
    // The price of the uniform refusal: the server does not run a second,
    // unscoped read to tell the two apart, so the line cannot either.
    // SECURITY.md says so, so nobody reads a not-found line as proof.
    await expect(
      outsider.receipt.getReceiptWithItems({
        receiptId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();
    const missing = lines.map(({ ts: _ts, ...rest }) => rest);

    capture();
    await expect(
      outsider.receipt.getReceiptWithItems({ receiptId }),
    ).rejects.toThrow();
    const foreign = lines.map(({ ts: _ts, ...rest }) => rest);

    expect(missing).toHaveLength(1);
    expect(missing).toEqual(foreign);
  });

  it("is recorded when the scoped write itself is what missed", async () => {
    // Not every router reads before it writes: store.update and
    // shopping.removeItem put householdId in the write's own where, so a
    // foreign id surfaces as Prisma's P2025, translated to NOT_FOUND only by
    // domainErrors. The line has to follow the code the caller received, or
    // these procedures are a way to probe that leaves no trace.
    await expect(
      outsider.store.update({ id: storeId, name: "Mine now" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.shopping.removeItem({
        ...envelope(outsiderId),
        id: shoppingItemId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const denials = lines.filter((line) => line.event === "access.denied");
    expect(denials.map((line) => line.path)).toEqual([
      "store.update",
      "shopping.removeItem",
    ]);
    for (const denial of denials) {
      expect(denial).toMatchObject({
        code: "NOT_FOUND",
        reason: "not-found",
        userId: outsiderId,
        householdId: otherHouseholdId,
      });
    }
    expect(JSON.stringify(lines)).not.toContain(storeId);
    expect(JSON.stringify(lines)).not.toContain(shoppingItemId);

    // And the refusal was only a refusal.
    expect(
      await prisma.shoppingItem.count({ where: { id: shoppingItemId } }),
    ).toBe(1);
    expect(
      (await prisma.store.findUnique({ where: { id: storeId } }))?.name,
    ).toBe("Security Log Store");
  });
});

describe("what is not an incident", () => {
  it("says nothing about a request that succeeded", async () => {
    await outsider.product.list({});

    expect(lines).toEqual([]);
  });

  it("says nothing about a barcode nobody knows", async () => {
    // A NOT_FOUND about Open Food Facts, not about a row: a kitchen scanning
    // unknown products offline is not probing anybody's household.
    const miss = spyOn(openFoodFacts, "getProductByBarcode").mockResolvedValue(
      null,
    );
    try {
      await expect(
        outsider.product.resolveScan({
          ...envelope(outsiderId),
          barcode: "8410000777777",
        }),
      ).rejects.toThrow("Barcode not found");
    } finally {
      miss.mockRestore();
    }

    expect(lines).toEqual([]);
  });
});

/**
 * The address a sign-in tried, through the auth route rather than the writer
 * (security review, 2026-10-12).
 *
 * The unit suite proves `securityLine` drops an `email` key; it cannot prove
 * that the sign-in path stopped handing it one and hands a tag instead. A line
 * with neither would pass there and lose the correlation the tag exists for.
 */
describe("a refused sign-in", () => {
  const WRONG = "no es la contraseña";

  /** Each line as written, so a match anywhere in it counts. */
  function written(): string {
    return lines.map((line) => JSON.stringify(line)).join("\n");
  }

  it("names the account by its tag, not by the address", async () => {
    expect((await signInWith({ email: ownerEmail, password: WRONG })).status).toBe(401);

    const failed = lines.find((line) => line.event === "auth.signin.failed");
    expect(failed).toBeDefined();
    expect(failed?.account).toBe(accountTag(ownerEmail));
    expect(failed).not.toHaveProperty("email");
    expect(written()).not.toContain(ownerEmail.split("@")[0]);

    await resetRateLimit(loginAccountRateLimit(), accountIdentifier(ownerEmail));
  });

  it("does the same for an address nobody registered", async () => {
    // The case the finding was about: a typo or a stuffing list, a person the
    // database has never held, written into the log in full.
    const stranger = generateTestEmail("seclog-nobody");

    expect((await signInWith({ email: stranger, password: WRONG })).status).toBe(401);

    const failed = lines.find((line) => line.event === "auth.signin.failed");
    expect(failed?.account).toBe(accountTag(stranger));
    expect(written()).not.toContain(stranger.split("@")[0]);

    await resetRateLimit(loginAccountRateLimit(), accountIdentifier(stranger));
  });

  it("names the account by its tag when the account's limit refuses it", async () => {
    const original = process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
    process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = "1";
    const stranger = generateTestEmail("seclog-throttled");

    try {
      expect((await signInWith({ email: stranger, password: WRONG })).status).toBe(401);
      const refused = await signInWith({ email: stranger, password: WRONG });
      expect(refused.status).toBe(429);
      expect(refused.code).toBe("ACCOUNT_RATE_LIMITED");
    } finally {
      if (original === undefined) delete process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
      else process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = original;
      await resetRateLimit(loginAccountRateLimit(), accountIdentifier(stranger));
    }

    const throttled = lines.find((line) => line.event === "auth.signin.throttled");
    expect(throttled).toBeDefined();
    expect(throttled?.account).toBe(accountTag(stranger));
    expect(throttled).not.toHaveProperty("email");
    expect(written()).not.toContain(stranger.split("@")[0]);
  });
});

/**
 * ASVS 5.0.0 16.3.1, through the auth route: a successful sign-in is logged, with
 * the factor it used. The unit suite proves `signInSucceeded` writes the line;
 * this proves the sign-in path calls it, once, and with the account it
 * actually signed in.
 */
describe("an accepted sign-in", () => {
  it("is recorded once, with the factor, the user and the account's tag", async () => {
    const address = freshTestAddress();
    const user = await signInWith(
      { email: ownerEmail, password: "TestPassword123!" },
      { address },
    );
    expect(user.status).toBe(200);

    const succeeded = lines.filter((line) => line.event === "auth.signin.succeeded");
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0]).toMatchObject({
      method: "password",
      userId: ownerId,
      account: accountTag(ownerEmail),
      address,
    });
    expect(succeeded[0]).not.toHaveProperty("email");
    expect(JSON.stringify(succeeded)).not.toContain(ownerEmail.split("@")[0]);
  });

  it("is not recorded for a refused one", async () => {
    expect(
      (await signInWith({ email: ownerEmail, password: "no es la contraseña" })).status,
    ).toBe(401);

    expect(lines.some((line) => line.event === "auth.signin.succeeded")).toBe(false);
    await resetRateLimit(loginAccountRateLimit(), accountIdentifier(ownerEmail));
  });
});

/**
 * What a run of wrong passwords costs the log: one line each, ours, and
 * nothing from the library. At its default level Better Auth writes a
 * warning for every wrong password, and several lines per refused sign-in is
 * how an unauthenticated client came to multiply what it could write to the
 * log (security review, 2026-10-12). The logger's `error` level in
 * `src/lib/auth/instance.ts` is what keeps it to the one.
 */
const WRONG_TEN = "tampoco es esta contraseña";

describe("ten wrong passwords", () => {
  it("write ten lines of the security log and nothing else", async () => {
    const original = process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
    process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = "20";
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const logs = spyOn(console, "log").mockImplementation(() => {});
    let library: string[];
    try {
      for (let i = 0; i < 10; i++) {
        expect((await signInWith({ email: ownerEmail, password: WRONG_TEN })).status).toBe(401);
      }
    } finally {
      library = [...errors.mock.calls, ...logs.mock.calls].map((call) => call.map(String).join(" "));
      errors.mockRestore();
      logs.mockRestore();
      if (original === undefined) delete process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
      else process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = original;
      await resetRateLimit(loginAccountRateLimit(), accountIdentifier(ownerEmail));
    }

    expect(lines.filter((line) => line.event === "auth.signin.failed")).toHaveLength(10);
    expect(lines).toHaveLength(10);
    expect(library).toEqual([]);
  });
});
