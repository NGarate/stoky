import { describe, it, expect } from "bun:test";
import { $Enums, PrismaClient } from "@/generated/prisma/client";
import { prisma, reusableClient } from "@/lib/prisma";

describe("Prisma Client", () => {
  it("should export prisma client singleton", () => {
    expect(prisma).toBeDefined();
    expect(prisma).toHaveProperty("$connect");
    expect(prisma).toHaveProperty("$disconnect");
    expect(prisma).toHaveProperty("$queryRaw");
    expect(prisma).toHaveProperty("$transaction");
  });

  it("should have all expected models", () => {
    // Check that all Prisma models are available
    expect(prisma.user).toBeDefined();
    expect(prisma.household).toBeDefined();
    expect(prisma.product).toBeDefined();
    expect(prisma.stockEntry).toBeDefined();
    expect(prisma.storageLocation).toBeDefined();
    expect(prisma.store).toBeDefined();
    expect(prisma.priceRecord).toBeDefined();
    expect(prisma.receipt).toBeDefined();
    expect(prisma.receiptItem).toBeDefined();
    expect(prisma.shoppingList).toBeDefined();
    expect(prisma.shoppingItem).toBeDefined();
  });

  it("should carry every household role the capability matrix names", () => {
    // The matrix in DECISIONS.md ROLES has three columns — Admin, User,
    // Kitchen — and OWNER/ADMIN share the first. KITCHEN is the value the
    // kitchen tablet runs under; without it, a tablet that walks out of the
    // house holds an account that can write.
    expect(Object.keys($Enums.HouseholdRole).sort()).toEqual([
      "ADMIN",
      "KITCHEN",
      "MEMBER",
      "OWNER",
    ]);
  });

  it("should maintain singleton instance", () => {
    // Re-import should return same instance
    const { prisma: prisma2 } = require("@/lib/prisma");
    expect(prisma).toBe(prisma2);
  });

  it("keeps the client across a hot reload while its class is the one generated now", () => {
    expect(reusableClient({ client: prisma, generatedBy: PrismaClient })).toBe(
      prisma,
    );
  });

  it("drops a client kept from before the client was regenerated, closing its pool", () => {
    // What a reload after `prisma generate` finds on `global`: a client made
    // by the previous generated class, which is not this one.
    let closed = 0;
    const stale = {
      client: { $disconnect: async () => void closed++ } as never,
      generatedBy: class Previous {},
    };

    expect(reusableClient(stale)).toBeUndefined();
    expect(closed).toBe(1);
    expect(reusableClient(undefined)).toBeUndefined();
  });
});
