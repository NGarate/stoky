import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITY_ROLES } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/router";

/**
 * The capability matrix, per procedure.
 *
 * `DECISIONS.md` ROLES says every restriction has to hold on the server,
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
    // rather than limited — the auth API owns that path.
    register: "publicProcedure",
    me: "protectedProcedure",
    // The keep-alive's question, "when does this session end?". Public,
    // because "no session" is an answer (null) rather than a refusal, and it
    // reads or moves nothing but the caller's own session row.
    session: "publicProcedure",
    // An account setting, so `protectedProcedure` and deliberately not
    // `householdProcedure`: snackbars are about the person, not the household,
    // and the matrix has no column for "how long you need to read a message". It is
    // nobody's household data.
    setSnackbarDuration: "protectedProcedure",
    // Listing and ending one's own sessions (D143). An account with no
    // household still has sessions, and needing one to end them would put the
    // control out of reach of the account that has least else, so
    // `protectedProcedure` for the same reason as the row above. What keeps a
    // stolen session from ending the
    // owner's is the current password inside `endSessions` and its two
    // budgets, which a tier cannot express; the list carries no token.
    listSessions: "protectedProcedure",
    endSessions: "protectedProcedure",
    // A person's own password, which an account with no household still has.
    // The same tier as the row above, and for the same reason; what keeps a
    // stolen session from using it is the current password and the limit
    // inside the resolver, which a tier cannot express.
    changePassword: "protectedProcedure",
    // The step-up before a passkey is added or removed (D151): the current
    // password, for an account that may have no household. Every role may
    // have passkeys, the kitchen's shared account included.
    confirmPassword: "protectedProcedure",
  },
  // `current` answers null for an account with no household rather than
  // refusing it. `create`, the way out of that state, went with the state
  // itself (ISSUES.md HOUSE-1).
  "household.ts": {
    current: "protectedProcedure",
    // The rest are admin: the matrix puts "invite people" and "see account
    // data and emails" there, and a kitchen tablet left on a counter must not
    // list the household's email addresses to whoever picks it up.
    members: "adminProcedure",
    addMember: "adminProcedure",
    // Renaming the household is the matrix's "household settings".
    update: "adminProcedure",
    // Changing who may do what, and who is in the household at all, is the
    // same authority as inviting — stricter if anything. The tier is not the
    // whole guard here: only an *owner* may grant or revoke ownership, and
    // that distinction is inside the resolver, because a tier cannot see who
    // is asking. `integration/household.roles.test.ts` holds both.
    updateRole: "adminProcedure",
    removeMember: "adminProcedure",
    // Seeing and ending somebody else's sessions is the same authority as
    // removing them, and a strictly smaller act — it changes nothing about
    // the household. Not the whole guard: not the caller, the member must be
    // this household's, and only an owner may act on an owner — inside the
    // resolver (D145). `integration/session.revocation.test.ts` holds them.
    memberSessions: "adminProcedure",
    endMemberSessions: "adminProcedure",
    // Every session in the household, the owner's own included (D147).
    // Narrower than the tier: owners only, refused inside the resolver
    // before the owner's password is asked — the matrix has no owner tier,
    // and one procedure is no reason to add it.
    // `integration/session.revocation.test.ts` holds the refusals.
    endHouseholdSessions: "adminProcedure",
    // Setting somebody else's password is the same authority that set their
    // first one in `addMember`. Not the whole guard: the member must be this
    // household's, only an owner may act on an owner, and nobody may use it
    // on themselves — all inside the resolver, because a tier cannot see whom
    // the call is about. `integration/household.members.test.ts` holds them.
    resetMemberPassword: "adminProcedure",
    // Taking a member's second step off for a lost authenticator (D150): the
    // same authority as setting their password, which is what it leaves
    // standing alone. Not the whole guard: not the caller, the admin's own
    // password, this household's member, only an owner on an owner — inside
    // the resolver. `integration/household.two-factor-removal.test.ts`.
    removeMemberTwoFactor: "adminProcedure",
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
  },
  "product.ts": {
    list: "householdProcedure",
    getById: "householdProcedure",
    getByBarcode: "householdProcedure",
    // Read like the catalogue it summarises, so the kitchen may see it too.
    suggestions: "householdProcedure",
    create: "writeProcedure",
    update: "writeProcedure",
    // Owner-directed (Phase 8 item 5, D90): a hard delete with no undo is the
    // household's decision, not any member's.
    delete: "adminProcedure",
    scanBarcode: "writeProcedure",
    // T7: the replayable scan. writeProcedure like scanBarcode, so a KITCHEN
    // account cannot create a product by scanning offline any more than online.
    resolveScan: "writeProcedure",
  },
  "receipt.ts": {
    getStatus: "householdProcedure",
    // The photograph carries what rawOcrText does, which the kitchen never
    // receives: only someone who may review a receipt sees it.
    getImage: "writeProcedure",
    getReceiptWithItems: "householdProcedure",
    getAppliedSummary: "householdProcedure",
    list: "householdProcedure",
    upload: "writeProcedure",
    confirmItem: "writeProcedure",
    updateItem: "writeProcedure",
    addItem: "writeProcedure",
    // Framing the ticket again and reading it again: a review's correction.
    reframe: "writeProcedure",
    // Taking out a line that was never an article: a review's correction.
    removeItem: "writeProcedure",
    // Reading a framed part of the photo again: a review's correction.
    readRegion: "writeProcedure",
    updateDetails: "writeProcedure",
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

const ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Where a document states how many procedures there are.
 *
 * Every one of these has been wrong. `docs/STATUS.md` reached 64 while it said
 * 59, then still said 62 after `product.resolveScan` made it 63 (2026-08-31);
 * `SECURITY.md` kept the 60 counted on 2026-08-26 through all four changes
 * after it, until the 2026-10-12 review measured 63. A count kept in step by
 * hand drifts, so the sentences that carry it are held to the router here: a
 * procedure added or removed without them goes red.
 */
const DOCUMENTED_COUNTS = [
  { file: "SECURITY.md", pattern: /\ball (\d+) procedures are assigned\b/g },
  { file: "docs/STATUS.md", pattern: /\*\*(\d+) procedures\*\*/g },
  { file: "docs/STATUS.md", pattern: /\ball (\d+) procedures assigned\b/g },
];

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

  it("is the number of procedures the documents say are assigned", () => {
    // The router as it runs, not as this file parses it: `_def.procedures` is
    // flat and dotted at runtime, one entry per callable procedure.
    const actual = Object.keys(appRouter._def.procedures).length;
    const tabled = Object.values(EXPECTED).reduce(
      (total, table) => total + Object.keys(table).length,
      0,
    );
    expect(actual, "the router and the matrix disagree on the count").toBe(
      tabled,
    );

    for (const { file, pattern } of DOCUMENTED_COUNTS) {
      const claims = [
        ...readFileSync(join(ROOT, file), "utf8").matchAll(pattern),
      ];
      // Exactly one: a reworded sentence must fail here rather than quietly
      // take its number out of this check.
      expect(claims.length, `${file} must state ${pattern} exactly once`).toBe(
        1,
      );
      expect(
        Number(claims[0]?.[1]),
        `${file} states a procedure count the router does not have`,
      ).toBe(actual);
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
