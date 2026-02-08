import { describe, it, expect } from "bun:test";
import { prisma } from "@/lib/prisma";

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

  it("should maintain singleton instance", () => {
    // Re-import should return same instance
    const { prisma: prisma2 } = require("@/lib/prisma");
    expect(prisma).toBe(prisma2);
  });
});
