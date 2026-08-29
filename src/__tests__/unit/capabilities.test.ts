import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITY_ROLES } from "@/server/trpc/trpc";

/**
 * The capability matrix, per procedure.
 *
 * `REDESIGN_PLAN.md` §5.2 says every restriction has to hold on the server,
 * and the phase's *done when* says the check is repeated per procedure rather
 * than sampled. This is the per-procedure half: it reads how each procedure is
 * declared and compares it against the table below.
 *
 * It cannot see whether the middleware actually refuses anything — that is
 * `src/__tests__/integration/capabilities.test.ts`, which calls the procedures
 * as a kitchen account. What it *can* see, and the behavioural suite cannot
 * without calling all of them, is a procedure added later that quietly takes the
 * wrong tier. A new procedure not listed here fails this test, which is the
 * point: adding one is a decision about who may call it.
 */
const EXPECTED: Record<string, Record<string, string>> = {
  "auth.ts": {
    // `login` used to be here: a second credential-verification procedure the
    // interface never called and the CRITICAL-4 limiter never covered. Removed
    // rather than limited — Auth.js already owns that path.
    register: "publicProcedure",
    me: "protectedProcedure",
    logout: "protectedProcedure",
    // An account setting, so `protectedProcedure` and deliberately not
    // `householdProcedure`: an account with no household still sees
    // snackbars — the form that creates the household raises them — and the
    // matrix has no column for "how long you need to read a message". It is
    // nobody's household data.
    setSnackbarDuration: "protectedProcedure",
    // An account with no household still has sessions, and needing one to end
    // them would put the control out of reach of the account that has least
    // else. `protectedProcedure` for the same reason as the row above.
    revokeMySessions: "protectedProcedure",
  },
  // Reachable by an account with no household, which is the whole reason it
  // exists — see ISSUES.md HOUSE-1. `householdProcedure` here would make the
  // way out of that state unreachable from inside it.
  "household.ts": {
    current: "protectedProcedure",
    create: "protectedProcedure",
    // The rest are admin: the matrix puts "invite people" and "see account
    // data and emails" there, and a kitchen tablet left on a counter must not
    // list the household's email addresses to whoever picks it up.
    members: "adminProcedure",
    addMember: "adminProcedure",
    // Changing who may do what, and who is in the household at all, is the
    // same authority as inviting — stricter if anything. The tier is not the
    // whole guard here: only an *owner* may grant or revoke ownership, and
    // that distinction is inside the resolver, because a tier cannot see who
    // is asking. `integration/household.roles.test.ts` holds both.
    updateRole: "adminProcedure",
    removeMember: "adminProcedure",
    // Ending somebody else's sessions is the same authority as removing them,
    // and a strictly smaller act — it changes nothing about the household.
    revokeMemberSessions: "adminProcedure",
  },
  "inventory.ts": {
    getStockOverview: "householdProcedure",
    getStockHistory: "householdProcedure",
    getExpiringItems: "householdProcedure",
    getExpiredItems: "householdProcedure",
    // The one write a kitchen account has. The matrix row is
    // "Consume stock ✅ ✅ ✅".
    consumeStock: "householdProcedure",
    addStock: "writeProcedure",
    adjustStock: "writeProcedure",
    transferStock: "writeProcedure",
  },
  "location.ts": {
    list: "householdProcedure",
    getTree: "householdProcedure",
    // "Household settings, stores, locations" is the admin row.
    create: "adminProcedure",
    update: "adminProcedure",
    delete: "adminProcedure",
  },
  "price.ts": {
    getHistory: "householdProcedure",
    getLatestPrices: "householdProcedure",
    getProductPrices: "householdProcedure",
    recordPrice: "writeProcedure",
  },
  "product.ts": {
    list: "householdProcedure",
    count: "householdProcedure",
    getById: "householdProcedure",
    getByBarcode: "householdProcedure",
    searchByName: "householdProcedure",
    create: "writeProcedure",
    update: "writeProcedure",
    // Owner-directed (Phase 8 item 5, D90): a hard delete with no undo is the
    // household's decision, not any member's.
    delete: "adminProcedure",
    scanBarcode: "writeProcedure",
  },
  "receipt.ts": {
    getStatus: "householdProcedure",
    getReceiptWithItems: "householdProcedure",
    getAppliedSummary: "householdProcedure",
    list: "householdProcedure",
    upload: "writeProcedure",
    confirmItem: "writeProcedure",
    confirmAll: "writeProcedure",
    applyReceipt: "writeProcedure",
  },
  "shopping.ts": {
    list: "householdProcedure",
    getById: "householdProcedure",
    getBuyList: "householdProcedure",
    getAutoList: "householdProcedure",
    // The two D88 moved to the kitchen-callable tier (owner's pass,
    // 2026-08-18): start a list, add an item. Nothing else moved.
    create: "householdProcedure",
    update: "writeProcedure",
    delete: "writeProcedure",
    addItem: "householdProcedure",
    updateItem: "writeProcedure",
    removeItem: "writeProcedure",
    generateFromLowStock: "writeProcedure",
  },
  // The whole household in one file, including everybody's name and address.
  // §5.2 already puts "see account data and emails" behind admin; an export is
  // that, in bulk.
  "data.ts": {
    exportHousehold: "adminProcedure",
  },
  "store.ts": {
    list: "householdProcedure",
    create: "adminProcedure",
    update: "adminProcedure",
    delete: "adminProcedure",
  },
};

const ROUTER_DIR = join(import.meta.dir, "../../server/trpc/routers");

/** Reads a router file and returns `{ procedureName: procedureType }`. */
function declaredProcedures(file: string): Record<string, string> {
  const source = readFileSync(join(ROUTER_DIR, file), "utf8");
  const found: Record<string, string> = {};
  const pattern = /^ {2}(\w+): (\w+Procedure)\b/gm;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    found[match[1]] = match[2];
    match = pattern.exec(source);
  }
  return found;
}

/**
 * The same count, taken a second way, on purpose.
 *
 * The parser above demands exactly two spaces of indentation and the whole
 * declaration on one line. That is true of every procedure written so far, and
 * it is not a rule anything enforces — so a procedure written as
 *
 * ```ts
 *   somethingNew:
 *     householdProcedure
 * ```
 *
 * is invisible to it. And invisible is the one failure this file cannot
 * survive: the comparison below is `toEqual`, so a procedure missing from the
 * parse *and* missing from the table matches an absence with an absence and
 * passes. The check that exists to make adding a procedure a decision would
 * quietly not apply to it.
 *
 * Measured rather than imagined: adding such a procedure to `store.ts` left
 * this file at 14 pass, 0 fail.
 *
 * So the loose pattern allows any indentation and a line break after the colon,
 * and the test below asserts the two agree. It cannot say what the tier is —
 * that is still the strict parser's job — only that nothing was skipped.
 */
function looseProcedureCount(file: string): number {
  const source = readFileSync(join(ROUTER_DIR, file), "utf8");
  const pattern =
    /\b(\w+):\s*(public|protected|household|write|admin)Procedure\b/g;
  return [...source.matchAll(pattern)].length;
}

describe("capability matrix", () => {
  it("has a table entry for every router file", () => {
    const files = readdirSync(ROUTER_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`declares every procedure in ${file} at its matrix tier`, () => {
      expect(declaredProcedures(file)).toEqual(expected);
    });
  }

  it("sees every procedure, however it happens to be written", () => {
    // Without this, a procedure the strict parser cannot see is absent from
    // both sides of the `toEqual` above and passes by matching nothing against
    // nothing. See `looseProcedureCount` for why that is not hypothetical.
    for (const file of Object.keys(EXPECTED)) {
      expect(
        Object.keys(declaredProcedures(file)).length,
        `${file}: a procedure is declared in a shape the matrix check cannot read`,
      ).toBe(looseProcedureCount(file));
    }
  });

  it("gives KITCHEN read access and nothing else", () => {
    expect(CAPABILITY_ROLES.read).toContain("KITCHEN");
    expect(CAPABILITY_ROLES.write).not.toContain("KITCHEN");
    expect(CAPABILITY_ROLES.admin).not.toContain("KITCHEN");
  });

  it("keeps MEMBER out of the household's own settings", () => {
    expect(CAPABILITY_ROLES.write).toContain("MEMBER");
    expect(CAPABILITY_ROLES.admin).not.toContain("MEMBER");
  });

  it("lets OWNER and ADMIN do everything", () => {
    for (const tier of ["read", "write", "admin"] as const) {
      expect(CAPABILITY_ROLES[tier]).toContain("OWNER");
      expect(CAPABILITY_ROLES[tier]).toContain("ADMIN");
    }
  });
});
