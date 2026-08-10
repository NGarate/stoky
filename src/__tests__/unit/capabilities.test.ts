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
 * without calling all 44, is a procedure added later that quietly takes the
 * wrong tier. A new procedure not listed here fails this test, which is the
 * point: adding one is a decision about who may call it.
 */
const EXPECTED: Record<string, Record<string, string>> = {
  "auth.ts": {
    login: "publicProcedure",
    register: "publicProcedure",
    me: "protectedProcedure",
    logout: "protectedProcedure",
  },
  // Reachable by an account with no household, which is the whole reason it
  // exists — see ISSUES.md HOUSE-1. `householdProcedure` here would make the
  // way out of that state unreachable from inside it.
  "household.ts": {
    current: "protectedProcedure",
    create: "protectedProcedure",
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
    getPriceTrends: "householdProcedure",
    getProductPrices: "householdProcedure",
    recordPrice: "writeProcedure",
  },
  "product.ts": {
    list: "householdProcedure",
    getById: "householdProcedure",
    getByBarcode: "householdProcedure",
    searchByName: "householdProcedure",
    create: "writeProcedure",
    update: "writeProcedure",
    delete: "writeProcedure",
    scanBarcode: "writeProcedure",
  },
  "receipt.ts": {
    getStatus: "householdProcedure",
    getReceiptWithItems: "householdProcedure",
    getAppliedSummary: "householdProcedure",
    list: "householdProcedure",
    upload: "writeProcedure",
    parseReceipt: "writeProcedure",
    matchItems: "writeProcedure",
    confirmItem: "writeProcedure",
    confirmAll: "writeProcedure",
    applyReceipt: "writeProcedure",
  },
  "shopping.ts": {
    list: "householdProcedure",
    getById: "householdProcedure",
    getAutoList: "householdProcedure",
    create: "writeProcedure",
    update: "writeProcedure",
    delete: "writeProcedure",
    addItem: "writeProcedure",
    updateItem: "writeProcedure",
    removeItem: "writeProcedure",
    generateFromLowStock: "writeProcedure",
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
