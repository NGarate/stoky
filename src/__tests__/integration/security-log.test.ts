import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createTestUser,
  createTestHousehold,
  createMockSession,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * OWASP ASVS V7.1.3, through the router rather than through the logger.
 *
 * `src/__tests__/unit/security-log.test.ts` proves the line is right. What it
 * cannot prove is that anything writes one, and that is the half that breaks:
 * an access-control failure is thrown from three middlewares and from a dozen
 * resolvers checking `householdId`, so the guarantee worth testing is that a
 * *resolver's* refusal is audited without the resolver knowing anything about
 * it. A new router must not be able to forget.
 */

const HOUSEHOLD = "Security Log Household";
const OTHER_HOUSEHOLD = "Security Log Other Household";

type Caller = ReturnType<typeof appRouter.createCaller>;

let outsider: Caller;
let kitchen: Caller;
let anonymous: Caller;
let receiptId: string;
let outsiderId: string;

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

  const owner = await createTestUser({
    email: generateTestEmail("seclog-owner"),
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

  outsiderId = stranger.id;
  outsider = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession(stranger) }),
  );
  kitchen = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession(tablet) }),
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
});

afterAll(async () => {
  console.warn = realWarn;
  await prisma.receipt.deleteMany({ where: { id: receiptId } });
  await prisma.user.deleteMany({ where: { email: { contains: "seclog-" } } });
  await prisma.household.deleteMany({
    where: { name: { in: [HOUSEHOLD, OTHER_HOUSEHOLD] } },
  });
});

beforeEach(capture);

describe("a refusal a resolver made", () => {
  it("is recorded, though the resolver knows nothing about logging", async () => {
    // A reach into another household's receipt: the event an owner would most
    // want to find in the log, and the one thrown furthest from any middleware.
    await expect(outsider.receipt.getReceiptWithItems({ receiptId })).rejects.toThrow();

    const denial = lines.find((line) => line.event === "access.denied");
    expect(denial).toBeDefined();
    expect(denial?.path).toBe("receipt.getReceiptWithItems");
    expect(denial?.userId).toBe(outsiderId);
  });

  it("names the code it was refused with", async () => {
    await expect(outsider.receipt.getReceiptWithItems({ receiptId })).rejects.toThrow();

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

describe("what is not an incident", () => {
  it("says nothing about a request that succeeded", async () => {
    await outsider.product.list({});

    expect(lines).toEqual([]);
  });

  it("says nothing about a row that is merely missing", async () => {
    // Logging every error would bury the refusals in NOT_FOUNDs and turn the
    // log into something nobody greps.
    await expect(
      outsider.receipt.getReceiptWithItems({
        receiptId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();

    expect(lines.some((line) => line.event === "access.denied")).toBe(false);
  });
});
