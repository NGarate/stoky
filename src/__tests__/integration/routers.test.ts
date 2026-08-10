import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import * as argon2 from "argon2";
import type { Session } from "next-auth";
import { TRPCError } from "@trpc/server";
import type { HouseholdRole } from "@prisma/client";

// Test data tracking for cleanup
const testData = {
  users: [] as string[],
  households: [] as string[],
  products: [] as string[],
  locations: [] as string[],
  stores: [] as string[],
  receipts: [] as string[],
  shoppingLists: [] as string[],
  stockEntries: [] as string[],
  priceRecords: [] as string[],
};

/**
 * Asserts a call was refused with a particular tRPC code.
 *
 * These used to assert on the message text. The code is the thing a client can
 * act on — telling "you are not signed in" apart from "the server fell over"
 * is exactly what ISSUES.md DEBT-4 is about — and the message is free to be
 * reworded without silently loosening the check.
 */
async function expectCode(call: Promise<unknown>, code: TRPCError["code"]) {
  let thrown: unknown;
  try {
    await call;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TRPCError);
  expect((thrown as TRPCError).code).toBe(code);
}

// Helper to create test context with session.
//
// The role defaults to OWNER because this suite predates roles and is about
// what each procedure does, not about who may call it. Who may call what is
// the capability suite's subject, and it names the role at every call site.
async function createTestContext(
  userId: string,
  householdId?: string,
  role: HouseholdRole = "OWNER"
): Promise<{
  ctx: Awaited<ReturnType<typeof createTRPCContext>>;
  caller: ReturnType<typeof appRouter.createCaller>;
}> {
  const session: Session | null =
    userId === "anon"
      ? null
      : {
          user: {
            id: userId,
            email: `test-${userId}@example.com`,
            name: "Test User",
            householdId,
            role,
          },
          expires: new Date(Date.now() + 3600 * 1000).toISOString(),
        };

  const ctx = await createTRPCContext({ session });
  const caller = appRouter.createCaller(ctx);

  return { ctx, caller };
}

// Helper to create a test user with household (always returns householdId)
async function createTestUserWithHousehold(
  email: string,
  name: string,
  householdName: string
) {
  const passwordHash = await argon2.hash("TestPassword123!", {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });

  const household = await prisma.household.create({
    data: { name: householdName },
  });
  testData.households.push(household.id);

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      householdId: household.id,
      role: "OWNER",
    },
  });

  testData.users.push(user.id);
  return { user, householdId: household.id };
}

// Helper to create a test user without household
async function createTestUserWithoutHousehold(email: string, name: string) {
  const passwordHash = await argon2.hash("TestPassword123!", {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: "MEMBER",
    },
  });

  testData.users.push(user.id);
  return { user };
}

// Helper to create test product
async function createTestProduct(householdId: string, overrides = {}) {
  const product = await prisma.product.create({
    data: {
      name: "Test Product",
      defaultUnit: "unit",
      householdId,
      ...overrides,
    },
  });
  testData.products.push(product.id);
  return product;
}

// Helper to create test store
async function createTestStore(householdId: string, overrides = {}) {
  const store = await prisma.store.create({
    data: {
      name: "Test Store",
      householdId,
      ...overrides,
    },
  });
  testData.stores.push(store.id);
  return store;
}

// Helper to create test location
async function createTestLocation(householdId: string, overrides = {}) {
  const location = await prisma.storageLocation.create({
    data: {
      name: "Test Location",
      householdId,
      ...overrides,
    },
  });
  testData.locations.push(location.id);
  return location;
}

// Helper to create test shopping list
async function createTestShoppingList(householdId: string, overrides = {}) {
  const list = await prisma.shoppingList.create({
    data: {
      name: "Test Shopping List",
      householdId,
      ...overrides,
    },
  });
  testData.shoppingLists.push(list.id);
  return list;
}

// Cleanup function
async function cleanupTestData() {
  if (testData.households.length > 0) {
    await prisma.shoppingItem.deleteMany({
      where: {
        shoppingList: {
          householdId: { in: testData.households },
        },
      },
    });
    await prisma.shoppingList.deleteMany({
      where: { householdId: { in: testData.households } },
    });

    await prisma.receiptItem.deleteMany({
      where: {
        receipt: {
          householdId: { in: testData.households },
        },
      },
    });
    await prisma.receipt.deleteMany({
      where: { householdId: { in: testData.households } },
    });

    await prisma.priceRecord.deleteMany({
      where: {
        product: {
          householdId: { in: testData.households },
        },
      },
    });
    await prisma.stockEntry.deleteMany({
      where: {
        product: {
          householdId: { in: testData.households },
        },
      },
    });

    await prisma.store.deleteMany({
      where: { householdId: { in: testData.households } },
    });
    await prisma.storageLocation.deleteMany({
      where: { householdId: { in: testData.households } },
    });
    await prisma.product.deleteMany({
      where: { householdId: { in: testData.households } },
    });
  }

  // Delete in reverse order of dependencies
  await prisma.shoppingItem.deleteMany({
    where: { shoppingListId: { in: testData.shoppingLists } },
  });
  await prisma.shoppingList.deleteMany({
    where: { id: { in: testData.shoppingLists } },
  });

  await prisma.priceRecord.deleteMany({
    where: { id: { in: testData.priceRecords } },
  });

  await prisma.stockEntry.deleteMany({
    where: { id: { in: testData.stockEntries } },
  });

  await prisma.receiptItem.deleteMany({
    where: { receiptId: { in: testData.receipts } },
  });
  await prisma.receipt.deleteMany({
    where: { id: { in: testData.receipts } },
  });

  await prisma.store.deleteMany({
    where: { id: { in: testData.stores } },
  });

  await prisma.product.deleteMany({
    where: { id: { in: testData.products } },
  });

  await prisma.storageLocation.deleteMany({
    where: { id: { in: testData.locations } },
  });

  await prisma.user.deleteMany({
    where: { id: { in: testData.users } },
  });

  await prisma.household.deleteMany({
    where: { id: { in: testData.households } },
  });

  // Clear tracking arrays
  for (const key of Object.keys(testData)) {
    (testData as Record<string, string[]>)[key] = [];
  }
}

describe("tRPC Router Integration Tests", () => {
  beforeAll(async () => {
    // Ensure database connection
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  describe("Auth Router", () => {
    describe("register", () => {
      it("should register a new user successfully", async () => {
        const { ctx } = await createTestContext("anon");
        const caller = appRouter.createCaller(ctx);

        const result = await caller.auth.register({
          email: "newuser@example.com",
          name: "New User",
          password: "TestPassword123!",
          householdName: "My Household",
        });

        expect(result.success).toBe(true);
        expect(result.user).toBeDefined();
        expect(result.user.email).toBe("newuser@example.com");

        // Track for cleanup
        const user = await prisma.user.findUnique({
          where: { email: "newuser@example.com" },
        });
        if (user) {
          testData.users.push(user.id);
          const household = await prisma.household.findFirst({
            where: { name: "My Household" },
          });
          if (household) testData.households.push(household.id);
        }
      });

      it("should reject duplicate email registration", async () => {
        await createTestUserWithoutHousehold(
          "duplicate@example.com",
          "Duplicate User"
        );

        const { ctx } = await createTestContext("anon");
        const caller = appRouter.createCaller(ctx);

        await expect(
          caller.auth.register({
            email: "duplicate@example.com",
            name: "Another User",
            password: "TestPassword123!",
          })
        ).rejects.toThrow("Email already registered");
        // The code, not just the wording: a duplicate email is a conflict the
        // client can act on, not a server fault (ISSUES.md DEBT-4).
        await expectCode(
          caller.auth.register({
            email: "duplicate@example.com",
            name: "Another User",
            password: "TestPassword123!",
          }),
          "CONFLICT"
        );
      });

      it("should reject invalid email format", async () => {
        const { ctx } = await createTestContext("anon");
        const caller = appRouter.createCaller(ctx);

        await expect(
          caller.auth.register({
            email: "invalid-email",
            name: "Test User",
            password: "TestPassword123!",
          })
        ).rejects.toThrow();
      });

      it("should reject short password", async () => {
        const { ctx } = await createTestContext("anon");
        const caller = appRouter.createCaller(ctx);

        await expect(
          caller.auth.register({
            email: "shortpass@example.com",
            name: "Test User",
            password: "short",
          })
        ).rejects.toThrow();
      });
    });

    describe("login", () => {
      it("should login with valid credentials", async () => {
        await createTestUserWithoutHousehold(
          "logintest@example.com",
          "Login Test User"
        );

        const { ctx } = await createTestContext("anon");
        const caller = appRouter.createCaller(ctx);

        // Note: login requires actual auth.js setup, so we expect it might fail in test
        // but should not throw validation errors
        const result = await caller.auth.login({
          email: "logintest@example.com",
          password: "TestPassword123!",
        });

        // If we get here, login succeeded or failed gracefully
        expect(result).toBeDefined();
      });

      it("should reject invalid credentials", async () => {
        const { ctx } = await createTestContext("anon");
        const caller = appRouter.createCaller(ctx);

        await expect(
          caller.auth.login({
            email: "nonexistent@example.com",
            password: "WrongPassword123!",
          })
        ).rejects.toThrow("Invalid credentials");
        await expectCode(
          caller.auth.login({
            email: "nonexistent@example.com",
            password: "WrongPassword123!",
          }),
          "UNAUTHORIZED"
        );
      });

      it("should reject invalid email format", async () => {
        const { ctx } = await createTestContext("anon");
        const caller = appRouter.createCaller(ctx);

        await expect(
          caller.auth.login({
            email: "invalid-email",
            password: "TestPassword123!",
          })
        ).rejects.toThrow();
      });
    });

    describe("me", () => {
      it("should return current user data when authenticated", async () => {
        const { user, householdId } = await createTestUserWithHousehold(
          "metest@example.com",
          "Me Test User",
          "Me Test Household"
        );

        const { caller } = await createTestContext(user.id, householdId);
        const result = await caller.auth.me();

        expect(result.id).toBe(user.id);
        expect(result.email).toBe("metest@example.com");
        expect(result.name).toBe("Me Test User");
        expect(result.household).toBeDefined();
      });

      it("should throw when not authenticated", async () => {
        const { ctx } = await createTestContext("anon");
        const caller = appRouter.createCaller(ctx);

        await expectCode(caller.auth.me(), "UNAUTHORIZED");
      });
    });

    describe("logout", () => {
      it("should logout successfully when authenticated", async () => {
        const { user } = await createTestUserWithoutHousehold(
          "logout@example.com",
          "Logout User"
        );
        const { caller } = await createTestContext(user.id);

        const result = await caller.auth.logout();
        expect(result.success).toBe(true);
      });

      it("should throw when not authenticated", async () => {
        const { ctx } = await createTestContext("anon");
        const caller = appRouter.createCaller(ctx);

        await expectCode(caller.auth.logout(), "UNAUTHORIZED");
      });
    });
  });

  describe("Product Router", () => {
    it("should create a new product", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "product@example.com",
        "Product User",
        "Product Household"
      );
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.product.create({
        name: "New Product",
        defaultUnit: "kg",
        brand: "Test Brand",
        category: "Test Category",
        minStock: 5,
      });

      expect(result.name).toBe("New Product");
      expect(result.defaultUnit).toBe("kg");
      expect(result.brand).toBe("Test Brand");
      testData.products.push(result.id);
    });

    it("should get product by ID", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "product2@example.com",
        "Product User 2",
        "Product Household 2"
      );
      const product = await createTestProduct(householdId, { name: "Test Product" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.product.getById({ id: product.id });

      expect(result.id).toBe(product.id);
      expect(result.name).toBe("Test Product");
    });

    it("should update product", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "product3@example.com",
        "Product User 3",
        "Product Household 3"
      );
      const product = await createTestProduct(householdId, { name: "Old Name" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.product.update({
        id: product.id,
        name: "Updated Name",
      });

      expect(result.name).toBe("Updated Name");
    });

    it("should delete product", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "product4@example.com",
        "Product User 4",
        "Product Household 4"
      );
      const product = await createTestProduct(householdId, { name: "To Delete" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.product.delete({ id: product.id });

      expect(result.success).toBe(true);

      // Remove from tracking since it's deleted
      testData.products = testData.products.filter((id) => id !== product.id);
    });

    it("should list products with pagination", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "product5@example.com",
        "Product User 5",
        "Product Household 5"
      );
      await createTestProduct(householdId, { name: "Product A" });
      await createTestProduct(householdId, { name: "Product B" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.product.list({ limit: 10 });

      expect(result.products).toBeDefined();
      expect(result.products.length).toBeGreaterThanOrEqual(2);
    });

    it("should get product by barcode", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "product6@example.com",
        "Product User 6",
        "Product Household 6"
      );
      await createTestProduct(householdId, {
        name: "Barcoded Product",
        barcode: "123456789",
      });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.product.getByBarcode({ barcode: "123456789" });

      expect(result).not.toBeNull();
      expect(result?.barcode).toBe("123456789");
    });

    it("should reject access to product from different household", async () => {
      const { householdId: household1 } =
        await createTestUserWithHousehold("product7a@example.com", "User 1", "Household 1");
      const { user: user2, householdId: household2 } =
        await createTestUserWithHousehold("product7b@example.com", "User 2", "Household 2");

      const product = await createTestProduct(household1, { name: "Private Product" });
      const { caller } = await createTestContext(user2.id, household2);

      await expect(caller.product.getById({ id: product.id })).rejects.toThrow(
        "Product not found"
      );
    });
  });

  describe("Inventory Router", () => {
    it("should add stock", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "inv1@example.com",
        "Inventory User 1",
        "Inventory Household 1"
      );
      const product = await createTestProduct(householdId);
      const location = await createTestLocation(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.inventory.addStock({
        productId: product.id,
        quantity: 10,
        unit: "unit",
        locationId: location.id,
        operationType: "PURCHASE",
      });

      expect(result.quantity).toBe(10);
      expect(result.productId).toBe(product.id);
      testData.stockEntries.push(result.id);
    });

    it("should consume stock", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "inv2@example.com",
        "Inventory User 2",
        "Inventory Household 2"
      );
      const product = await createTestProduct(householdId);
      const location = await createTestLocation(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      // First add stock
      const addResult = await caller.inventory.addStock({
        productId: product.id,
        quantity: 10,
        unit: "unit",
        locationId: location.id,
        operationType: "PURCHASE",
      });
      testData.stockEntries.push(addResult.id);

      // Then consume
      const consumeResult = await caller.inventory.consumeStock({
        productId: product.id,
        quantity: 5,
        unit: "unit",
        operationType: "CONSUME",
      });

      expect(consumeResult.quantity).toBe(-5);
      testData.stockEntries.push(consumeResult.id);
    });

    it("should reject consuming more stock than available", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "inv3@example.com",
        "Inventory User 3",
        "Inventory Household 3"
      );
      const product = await createTestProduct(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      await expect(
        caller.inventory.consumeStock({
          productId: product.id,
          quantity: 100,
          unit: "unit",
          operationType: "CONSUME",
        })
      ).rejects.toThrow("Not enough stock available");
      await expectCode(
        caller.inventory.consumeStock({
          productId: product.id,
          quantity: 1000,
          unit: "unit",
          operationType: "CONSUME",
        }),
        "CONFLICT"
      );
    });

    it("should adjust stock", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "inv4@example.com",
        "Inventory User 4",
        "Inventory Household 4"
      );
      const product = await createTestProduct(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.inventory.adjustStock({
        productId: product.id,
        quantity: 25,
        unit: "unit",
        operationType: "ADJUST",
        reason: "Inventory correction",
      });

      expect(result.quantity).toBe(25);
      expect(result.operationType).toBe("ADJUST");
      testData.stockEntries.push(result.id);
    });

    it("should get inventory summary", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "inv5@example.com",
        "Inventory User 5",
        "Inventory Household 5"
      );
      const product = await createTestProduct(householdId, { minStock: 10 });
      const { caller } = await createTestContext(user.id, householdId);

      // Add some stock first
      const entry = await caller.inventory.addStock({
        productId: product.id,
        quantity: 5,
        unit: "unit",
        operationType: "PURCHASE",
      });
      testData.stockEntries.push(entry.id);

      const result = await caller.inventory.getStockOverview({ limit: 20 });

      expect(result.products).toBeDefined();
      const foundProduct = result.products.find((p) => p.id === product.id);
      expect(foundProduct).toBeDefined();
      expect(foundProduct?.totalStock).toBe(5);
    });

    it("should get low stock items", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "inv6@example.com",
        "Inventory User 6",
        "Inventory Household 6"
      );
      const product = await createTestProduct(householdId, { minStock: 10 });
      const { caller } = await createTestContext(user.id, householdId);

      // Add low stock
      const entry = await caller.inventory.addStock({
        productId: product.id,
        quantity: 3,
        unit: "unit",
        operationType: "PURCHASE",
      });
      testData.stockEntries.push(entry.id);

      const result = await caller.inventory.getStockOverview({
        lowStock: true,
        limit: 20,
      });

      const foundProduct = result.products.find((p) => p.id === product.id);
      expect(foundProduct).toBeDefined();
      expect(foundProduct?.isLowStock).toBe(true);
    });

    it("should transfer stock between locations", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "inv7@example.com",
        "Inventory User 7",
        "Inventory Household 7"
      );
      const product = await createTestProduct(householdId);
      const location1 = await createTestLocation(householdId, { name: "Location 1" });
      const location2 = await createTestLocation(householdId, { name: "Location 2" });
      const { caller } = await createTestContext(user.id, householdId);

      // Add stock to location 1 first
      const entry = await caller.inventory.addStock({
        productId: product.id,
        quantity: 20,
        unit: "unit",
        locationId: location1.id,
        operationType: "PURCHASE",
      });
      testData.stockEntries.push(entry.id);

      // Transfer to location 2
      const result = await caller.inventory.transferStock({
        productId: product.id,
        quantity: 10,
        unit: "unit",
        fromLocationId: location1.id,
        toLocationId: location2.id,
      });

      expect(result.fromEntry.quantity).toBe(-10);
      expect(result.toEntry.quantity).toBe(10);
      testData.stockEntries.push(result.fromEntry.id, result.toEntry.id);
    });
  });

  describe("Location Router", () => {
    it("should create location", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "loc1@example.com",
        "Location User 1",
        "Location Household 1"
      );
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.location.create({
        name: "Pantry",
      });

      expect(result.name).toBe("Pantry");
      testData.locations.push(result.id);
    });

    it("should create nested location", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "loc2@example.com",
        "Location User 2",
        "Location Household 2"
      );
      const parent = await createTestLocation(householdId, { name: "Kitchen" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.location.create({
        name: "Kitchen Shelf",
        parentId: parent.id,
      });

      expect(result.name).toBe("Kitchen Shelf");
      expect(result.parentId).toBe(parent.id);
      testData.locations.push(result.id);
    });

    it("should get location tree", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "loc3@example.com",
        "Location User 3",
        "Location Household 3"
      );
      await createTestLocation(householdId, { name: "Root 1" });
      await createTestLocation(householdId, { name: "Root 2" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.location.getTree();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("should update location", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "loc4@example.com",
        "Location User 4",
        "Location Household 4"
      );
      const location = await createTestLocation(householdId, { name: "Old Name" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.location.update({
        id: location.id,
        name: "New Name",
      });

      expect(result.name).toBe("New Name");
    });

    it("should delete location without children or stock", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "loc5@example.com",
        "Location User 5",
        "Location Household 5"
      );
      const location = await createTestLocation(householdId, { name: "To Delete" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.location.delete({ id: location.id });

      expect(result.success).toBe(true);
      testData.locations = testData.locations.filter((id) => id !== location.id);
    });

    it("should reject deleting location with children", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "loc6@example.com",
        "Location User 6",
        "Location Household 6"
      );
      const parent = await createTestLocation(householdId, { name: "Parent" });
      const child = await createTestLocation(householdId, {
        name: "Child",
        parentId: parent.id,
      });
      testData.locations.push(child.id);

      const { caller } = await createTestContext(user.id, householdId);

      await expect(caller.location.delete({ id: parent.id })).rejects.toThrow(
        "Cannot delete location with sub-locations"
      );
    });

    it("should prevent circular parent references", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "loc7@example.com",
        "Location User 7",
        "Location Household 7"
      );
      const parent = await createTestLocation(householdId, { name: "Parent" });
      const child = await createTestLocation(householdId, {
        name: "Child",
        parentId: parent.id,
      });
      testData.locations.push(child.id);

      const { caller } = await createTestContext(user.id, householdId);

      await expect(
        caller.location.update({
          id: parent.id,
          parentId: child.id,
        })
      ).rejects.toThrow("Cannot move a location to its own descendant");
    });
  });

  describe("Receipt Router", () => {
    it("should get receipt list", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "rec1@example.com",
        "Receipt User 1",
        "Receipt Household 1"
      );
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.receipt.list({ limit: 20 });

      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it("should filter receipts by status", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "rec2@example.com",
        "Receipt User 2",
        "Receipt Household 2"
      );
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.receipt.list({
        status: "UPLOADING",
        limit: 20,
      });

      expect(result.items).toBeDefined();
    });

    it("should reject receipt upload without household", async () => {
      const { user } = await createTestUserWithoutHousehold(
        "rec3@example.com",
        "Receipt User 3"
      );
      const { caller } = await createTestContext(user.id);

      // Create a minimal JPEG
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
      ]);
      const base64 = jpegBuffer.toString("base64");

      await expectCode(
        caller.receipt.upload({
          fileBase64: base64,
          mimeType: "image/jpeg",
        }),
        "PRECONDITION_FAILED"
      );
    });

    it("should reject invalid file type", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "rec4@example.com",
        "Receipt User 4",
        "Receipt Household 4"
      );
      const { caller } = await createTestContext(user.id, householdId);

      await expect(
        caller.receipt.upload({
          fileBase64: "invalid",
          mimeType: "image/gif",
        })
      ).rejects.toThrow("Invalid file type");
    });
  });

  describe("Store Router", () => {
    it("should create store", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "store1@example.com",
        "Store User 1",
        "Store Household 1"
      );
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.store.create({
        name: "Test Store",
        address: "123 Test St",
      });

      expect(result.name).toBe("Test Store");
      expect(result.address).toBe("123 Test St");
      testData.stores.push(result.id);
    });

    it("should list stores", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "store2@example.com",
        "Store User 2",
        "Store Household 2"
      );
      await createTestStore(householdId, { name: "Store A" });
      await createTestStore(householdId, { name: "Store B" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.store.list({ limit: 20 });

      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("should search stores", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "store3@example.com",
        "Store User 3",
        "Store Household 3"
      );
      await createTestStore(householdId, { name: "Special Store" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.store.list({ search: "Special", limit: 20 });

      expect(result.some((s) => s.name === "Special Store")).toBe(true);
    });

    it("should update store", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "store4@example.com",
        "Store User 4",
        "Store Household 4"
      );
      const store = await createTestStore(householdId, { name: "Old Name" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.store.update({
        id: store.id,
        name: "New Name",
      });

      expect(result.name).toBe("New Name");
    });

    it("should delete store", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "store5@example.com",
        "Store User 5",
        "Store Household 5"
      );
      const store = await createTestStore(householdId, { name: "To Delete" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.store.delete({ id: store.id });

      expect(result.success).toBe(true);
      testData.stores = testData.stores.filter((id) => id !== store.id);
    });

    it("should reject accessing store from different household", async () => {
      const { householdId: household1 } =
        await createTestUserWithHousehold("store6a@example.com", "User 1", "Household 1");
      const { user: user2, householdId: household2 } =
        await createTestUserWithHousehold("store6b@example.com", "User 2", "Household 2");

      const store = await createTestStore(household1, { name: "Private Store" });
      const { caller } = await createTestContext(user2.id, household2);

      // This should either return empty list or not include the store
      const result = await caller.store.list({ limit: 20 });
      expect(result.some((s) => s.id === store.id)).toBe(false);
    });
  });

  describe("Price Router", () => {
    it("should record price", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "price1@example.com",
        "Price User 1",
        "Price Household 1"
      );
      const product = await createTestProduct(householdId);
      const store = await createTestStore(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.price.recordPrice({
        productId: product.id,
        storeId: store.id,
        price: 9.99,
        currency: "EUR",
        unit: "unit",
        quantity: 1,
      });

      expect(result.price).toBe(9.99);
      expect(result.currency).toBe("EUR");
      testData.priceRecords.push(result.id);
    });

    it("should reject recording price for invalid product", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "price2@example.com",
        "Price User 2",
        "Price Household 2"
      );
      const store = await createTestStore(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      await expect(
        caller.price.recordPrice({
          productId: "invalid-product-id",
          storeId: store.id,
          price: 9.99,
          unit: "unit",
        })
      ).rejects.toThrow("Product not found");
    });

    it("should reject recording price for invalid store", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "price3@example.com",
        "Price User 3",
        "Price Household 3"
      );
      const product = await createTestProduct(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      await expect(
        caller.price.recordPrice({
          productId: product.id,
          storeId: "invalid-store-id",
          price: 9.99,
          unit: "unit",
        })
      ).rejects.toThrow("Store not found");
    });

    it("should get price history", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "price4@example.com",
        "Price User 4",
        "Price Household 4"
      );
      const product = await createTestProduct(householdId);
      const store = await createTestStore(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      // Create price record
      const priceRecord = await caller.price.recordPrice({
        productId: product.id,
        storeId: store.id,
        price: 9.99,
        unit: "unit",
      });
      testData.priceRecords.push(priceRecord.id);

      const result = await caller.price.getHistory({
        productId: product.id,
        days: 30,
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("should get latest prices", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "price5@example.com",
        "Price User 5",
        "Price Household 5"
      );
      const product = await createTestProduct(householdId);
      const store = await createTestStore(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      const priceRecord = await caller.price.recordPrice({
        productId: product.id,
        storeId: store.id,
        price: 12.99,
        unit: "unit",
      });
      testData.priceRecords.push(priceRecord.id);

      const result = await caller.price.getLatestPrices({
        productId: product.id,
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("should get price trends", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "price6@example.com",
        "Price User 6",
        "Price Household 6"
      );
      const product = await createTestProduct(householdId);
      const store = await createTestStore(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      const priceRecord = await caller.price.recordPrice({
        productId: product.id,
        storeId: store.id,
        price: 10.0,
        unit: "unit",
      });
      testData.priceRecords.push(priceRecord.id);

      const result = await caller.price.getPriceTrends({
        productId: product.id,
        days: 30,
      });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Shopping Router", () => {
    it("should create shopping list", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop1@example.com",
        "Shopping User 1",
        "Shopping Household 1"
      );
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.shopping.create({
        name: "Weekly Groceries",
        isAutoGenerated: false,
      });

      expect(result.name).toBe("Weekly Groceries");
      testData.shoppingLists.push(result.id);
    });

    it("should list shopping lists", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop2@example.com",
        "Shopping User 2",
        "Shopping Household 2"
      );
      await createTestShoppingList(householdId, { name: "List A" });
      await createTestShoppingList(householdId, { name: "List B" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.shopping.list({ includeCompleted: true });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("should get shopping list by ID", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop3@example.com",
        "Shopping User 3",
        "Shopping Household 3"
      );
      const list = await createTestShoppingList(householdId, { name: "Test List" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.shopping.getById({ id: list.id });

      expect(result.id).toBe(list.id);
      expect(result.name).toBe("Test List");
    });

    it("should add item to shopping list", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop4@example.com",
        "Shopping User 4",
        "Shopping Household 4"
      );
      const list = await createTestShoppingList(householdId);
      const product = await createTestProduct(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.shopping.addItem({
        shoppingListId: list.id,
        productId: product.id,
        quantity: 3,
        unit: "unit",
      });

      expect(result.shoppingListId).toBe(list.id);
      expect(result.productId).toBe(product.id);
      expect(result.quantity).toBe(3);
    });

    it("should add custom item to shopping list", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop5@example.com",
        "Shopping User 5",
        "Shopping Household 5"
      );
      const list = await createTestShoppingList(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.shopping.addItem({
        shoppingListId: list.id,
        customName: "Custom Item",
        quantity: 2,
        unit: "kg",
      });

      expect(result.customName).toBe("Custom Item");
      expect(result.productId).toBeNull();
    });

    it("should check/uncheck shopping item", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop6@example.com",
        "Shopping User 6",
        "Shopping Household 6"
      );
      const list = await createTestShoppingList(householdId);
      const product = await createTestProduct(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      // Add item
      const item = await caller.shopping.addItem({
        shoppingListId: list.id,
        productId: product.id,
        quantity: 1,
      });

      // Check item
      const checkedResult = await caller.shopping.updateItem({
        id: item.id,
        isChecked: true,
      });

      expect(checkedResult.isChecked).toBe(true);
      expect(checkedResult.checkedAt).toBeDefined();

      // Uncheck item
      const uncheckedResult = await caller.shopping.updateItem({
        id: item.id,
        isChecked: false,
      });

      expect(uncheckedResult.isChecked).toBe(false);
    });

    it("should remove item from shopping list", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop7@example.com",
        "Shopping User 7",
        "Shopping Household 7"
      );
      const list = await createTestShoppingList(householdId);
      const product = await createTestProduct(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      const item = await caller.shopping.addItem({
        shoppingListId: list.id,
        productId: product.id,
        quantity: 1,
      });

      const result = await caller.shopping.removeItem({ id: item.id });

      expect(result.success).toBe(true);
    });

    it("should update shopping list", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop8@example.com",
        "Shopping User 8",
        "Shopping Household 8"
      );
      const list = await createTestShoppingList(householdId, { name: "Old Name" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.shopping.update({
        id: list.id,
        name: "Updated Name",
      });

      expect(result.name).toBe("Updated Name");
    });

    it("should delete shopping list", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop9@example.com",
        "Shopping User 9",
        "Shopping Household 9"
      );
      const list = await createTestShoppingList(householdId, { name: "To Delete" });
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.shopping.delete({ id: list.id });

      expect(result.success).toBe(true);
      testData.shoppingLists = testData.shoppingLists.filter((id) => id !== list.id);
    });

    it("should generate auto list from low stock", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop10@example.com",
        "Shopping User 10",
        "Shopping Household 10"
      );
      const product = await createTestProduct(householdId, {
        name: "Low Stock Product",
        minStock: 10,
      });

      // Add some low stock
      const { caller } = await createTestContext(user.id, householdId);
      const entry = await caller.inventory.addStock({
        productId: product.id,
        quantity: 3,
        unit: "unit",
        operationType: "PURCHASE",
      });
      testData.stockEntries.push(entry.id);

      const result = await caller.shopping.generateFromLowStock();

      expect(result).not.toBeNull();
      if (result) {
        expect(result.isAutoGenerated).toBe(true);
        testData.shoppingLists.push(result.id);
      }
    });

    it("should get auto-generated list", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop11@example.com",
        "Shopping User 11",
        "Shopping Household 11"
      );

      // Create auto list
      await prisma.shoppingList.create({
        data: {
          name: "Lista automática - Stock bajo",
          isAutoGenerated: true,
          householdId,
        },
      });

      const { caller } = await createTestContext(user.id, householdId);
      const result = await caller.shopping.getAutoList();

      expect(result).not.toBeNull();
      expect(result?.isAutoGenerated).toBe(true);
    });

    it("should reject adding item to non-existent list", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "shop12@example.com",
        "Shopping User 12",
        "Shopping Household 12"
      );
      const product = await createTestProduct(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      await expect(
        caller.shopping.addItem({
          shoppingListId: "invalid-list-id",
          productId: product.id,
          quantity: 1,
        })
      ).rejects.toThrow("Shopping list not found");
    });

    it("should reject adding product from different household", async () => {
      const { user: user1, householdId: household1 } = await createTestUserWithHousehold(
        "shop13a@example.com",
        "User 1",
        "Household 1"
      );
      const { householdId: household2 } = await createTestUserWithHousehold(
        "shop13b@example.com",
        "User 2",
        "Household 2"
      );

      const list = await createTestShoppingList(household1);
      const product = await createTestProduct(household2, { name: "Private Product" });

      const { caller } = await createTestContext(user1.id, household1);

      await expect(
        caller.shopping.addItem({
          shoppingListId: list.id,
          productId: product.id,
          quantity: 1,
        })
      ).rejects.toThrow("Product not found");
    });
  });

  describe("Cross-cutting Concerns", () => {
    it("should require authentication for protected procedures", async () => {
      const { ctx } = await createTestContext("anon");
      const caller = appRouter.createCaller(ctx);

      // All these should fail without authentication
      await expectCode(caller.product.list({}), "UNAUTHORIZED");
      await expectCode(caller.inventory.getStockOverview({}), "UNAUTHORIZED");
      await expectCode(caller.location.list(), "UNAUTHORIZED");
      await expectCode(caller.receipt.list({}), "UNAUTHORIZED");
      await expectCode(caller.store.list({}), "UNAUTHORIZED");
      await expectCode(
        caller.price.getHistory({ productId: "test", days: 30 }),
        "UNAUTHORIZED"
      );
      await expectCode(caller.shopping.list({}), "UNAUTHORIZED");
    });

    it("should require household membership for household-scoped operations", async () => {
      const { user } = await createTestUserWithoutHousehold(
        "nohousehold@example.com",
        "No Household User"
      );
      const { caller } = await createTestContext(user.id);

      // These should fail without household membership. PRECONDITION_FAILED
      // rather than FORBIDDEN: nothing is wrong with the account, it is
      // missing a household, and that is a state the client can resolve.
      await expectCode(caller.product.create({ name: "Test" }), "PRECONDITION_FAILED");
      await expectCode(caller.inventory.getStockOverview({}), "PRECONDITION_FAILED");
      await expectCode(caller.location.create({ name: "Test" }), "PRECONDITION_FAILED");
      await expectCode(caller.store.create({ name: "Test" }), "PRECONDITION_FAILED");
    });

    it("should isolate data between households", async () => {
      const { user: user1, householdId: household1 } = await createTestUserWithHousehold(
        "isolate1@example.com",
        "User 1",
        "Household 1"
      );
      const { user: user2, householdId: household2 } = await createTestUserWithHousehold(
        "isolate2@example.com",
        "User 2",
        "Household 2"
      );

      // Create product in household 1
      const product1 = await createTestProduct(household1, {
        name: "Household 1 Product",
      });
      const product2 = await createTestProduct(household2, {
        name: "Household 2 Product",
      });

      // User 1 should only see household 1 products
      const { caller: caller1 } = await createTestContext(user1.id, household1);
      const list1 = await caller1.product.list({ limit: 100 });

      expect(list1.products.some((p) => p.id === product1.id)).toBe(true);
      expect(list1.products.some((p) => p.id === product2.id)).toBe(false);

      // User 2 should only see household 2 products
      const { caller: caller2 } = await createTestContext(user2.id, household2);
      const list2 = await caller2.product.list({ limit: 100 });

      expect(list2.products.some((p) => p.id === product1.id)).toBe(false);
      expect(list2.products.some((p) => p.id === product2.id)).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty pagination gracefully", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "edge1@example.com",
        "Edge User 1",
        "Edge Household 1"
      );
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.product.list({ limit: 20 });

      expect(result.products).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });

    it("should handle invalid IDs gracefully", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "edge2@example.com",
        "Edge User 2",
        "Edge Household 2"
      );
      const { caller } = await createTestContext(user.id, householdId);

      await expect(
        caller.product.getById({ id: "nonexistent-id" })
      ).rejects.toThrow("Product not found");
    });

    it("should handle very large quantities", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "edge3@example.com",
        "Edge User 3",
        "Edge Household 3"
      );
      const product = await createTestProduct(householdId);
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.inventory.addStock({
        productId: product.id,
        quantity: 999999,
        unit: "unit",
        operationType: "PURCHASE",
      });

      expect(result.quantity).toBe(999999);
      testData.stockEntries.push(result.id);
    });

    it("should handle unicode characters in names", async () => {
      const { user, householdId } = await createTestUserWithHousehold(
        "edge4@example.com",
        "Edge User 4",
        "Edge Household 4"
      );
      const { caller } = await createTestContext(user.id, householdId);

      const result = await caller.product.create({
        name: "Product with ñ, é, ü, and 🎉",
        defaultUnit: "unit",
      });

      expect(result.name).toBe("Product with ñ, é, ü, and 🎉");
      testData.products.push(result.id);
    });
  });
});
