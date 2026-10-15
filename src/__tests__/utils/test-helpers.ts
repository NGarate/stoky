import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password-hash";
import { createCredentialUser } from "@/lib/auth/credentials";
import type { User, Household, HouseholdRole, Product, StockEntry, StorageLocation } from "@prisma/client";

/**
 * Test data factories for creating database entities
 */

export interface TestUserData {
  email: string;
  name: string;
  password?: string;
  householdId?: string;
  role?: HouseholdRole;
}

export interface TestHouseholdData {
  name: string;
}

export interface TestProductData {
  name: string;
  barcode?: string;
  brand?: string;
  category?: string;
  householdId: string;
  defaultUnit?: string;
  minStock?: number;
}

export interface TestStockEntryData {
  productId: string;
  quantity: number;
  unit?: string;
  locationId?: string;
  expirationDate?: Date;
  operationType?: "PURCHASE" | "CONSUME" | "ADJUST" | "TRANSFER";
  createdBy: string;
}

export interface TestLocationData {
  name: string;
  householdId: string;
  parentId?: string;
}

/**
 * Creates a test user with optional household
 */
export async function createTestUser(data: TestUserData): Promise<User> {
  const passwordHash = await hashPassword(data.password ?? "TestPassword123!");

  return createCredentialUser(
    prisma,
    {
      email: data.email,
      name: data.name,
      householdId: data.householdId,
      role: data.role || "MEMBER",
    },
    passwordHash,
  );
}

/**
 * The password hash stored for `userId`, read straight from its credential
 * Account row — the row Better Auth reads — rather than through
 * `src/lib/auth/credentials.ts`, so a test of that module is not checked by
 * the module itself. Throws when the account has no credential row.
 */
export async function storedPasswordHash(userId: string): Promise<string> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { providerId_accountId: { providerId: "credential", accountId: userId } },
    select: { userId: true, password: true },
  });
  if (account.userId !== userId || account.password === null) {
    throw new Error(`the credential row of ${userId} holds no password of its own`);
  }
  return account.password;
}

/**
 * Creates a test household
 */
export async function createTestHousehold(data: TestHouseholdData): Promise<Household> {
  return prisma.household.create({
    data: {
      name: data.name,
    },
  });
}

/**
 * Creates a test product
 */
export async function createTestProduct(data: TestProductData): Promise<Product> {
  return prisma.product.create({
    data: {
      name: data.name,
      barcode: data.barcode,
      brand: data.brand,
      category: data.category,
      householdId: data.householdId,
      defaultUnit: data.defaultUnit || "unit",
      minStock: data.minStock,
    },
  });
}

/**
 * Creates a test storage location
 */
export async function createTestLocation(data: TestLocationData): Promise<StorageLocation> {
  return prisma.storageLocation.create({
    data: {
      name: data.name,
      householdId: data.householdId,
      parentId: data.parentId,
    },
  });
}

/**
 * Creates a test stock entry
 */
export async function createTestStockEntry(data: TestStockEntryData): Promise<StockEntry> {
  return prisma.stockEntry.create({
    data: {
      productId: data.productId,
      quantity: data.quantity,
      unit: data.unit || "unit",
      locationId: data.locationId,
      expirationDate: data.expirationDate,
      operationType: data.operationType || "PURCHASE",
      createdBy: data.createdBy,
    },
  });
}

/**
 * Clean up test data by email pattern
 */
export async function cleanupTestUsers(emailPattern: string): Promise<void> {
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: emailPattern,
      },
    },
  });
}

/**
 * Clean up test households by name pattern
 */
export async function cleanupTestHouseholds(namePattern: string): Promise<void> {
  await prisma.household.deleteMany({
    where: {
      name: {
        contains: namePattern,
      },
    },
  });
}

/**
 * Clean up test products by name pattern
 */
export async function cleanupTestProducts(namePattern: string): Promise<void> {
  await prisma.product.deleteMany({
    where: {
      name: {
        contains: namePattern,
      },
    },
  });
}

/**
 * Database cleanup helper - removes all test data
 */
export async function cleanupAllTestData(): Promise<void> {
  // Delete in correct order to respect foreign key constraints
  await prisma.stockEntry.deleteMany({});
  await prisma.priceRecord.deleteMany({});
  await prisma.receiptItem.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.shoppingItem.deleteMany({});
  await prisma.shoppingList.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.storageLocation.deleteMany({});
  await prisma.store.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.household.deleteMany({});
}

/**
 * Creates a complete test scenario with user, household, and products
 */
export async function createTestScenario() {
  const timestamp = Date.now();
  
  // Create household
  const household = await createTestHousehold({
    name: `Test Household ${timestamp}`,
  });

  // Create user with household
  const user = await createTestUser({
    email: `test.user.${timestamp}@example.com`,
    name: "Test User",
    password: "TestPassword123!",
    householdId: household.id,
    role: "OWNER",
  });

  // Create a location
  const location = await createTestLocation({
    name: "Test Pantry",
    householdId: household.id,
  });

  // Create some products
  const product1 = await createTestProduct({
    name: `Test Product 1 ${timestamp}`,
    barcode: `TEST-${timestamp}-001`,
    brand: "Test Brand",
    category: "Food",
    householdId: household.id,
    defaultUnit: "unit",
    minStock: 2,
  });

  const product2 = await createTestProduct({
    name: `Test Product 2 ${timestamp}`,
    barcode: `TEST-${timestamp}-002`,
    category: "Beverages",
    householdId: household.id,
    defaultUnit: "liter",
  });

  return {
    household,
    user,
    location,
    products: [product1, product2],
  };
}

/**
 * Generates unique test email
 */
export function generateTestEmail(prefix = "test"): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
}

/**
 * Generates unique test name
 */
export function generateTestName(prefix = "Test"): string {
  return `${prefix} ${Date.now()}`;
}

/**
 * Helper to create a mock session for tRPC context
 */
export function createMockSession(user: User & { household?: Household | null }) {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      householdId: user.householdId || undefined,
      // Taken from the row rather than defaulted, so a test that creates a
      // KITCHEN user gets a KITCHEN session and the capability middleware is
      // exercised instead of bypassed.
      role: user.role,
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
}

/**
 * The envelope every replayable mutation carries.
 *
 * A fresh key per call, because reusing one is what the replay mechanism is
 * *for* — a test that accidentally shared a key would get the first call's
 * result back and pass while proving nothing.
 */
export function envelope(userId: string): {
  idempotencyKey: string;
  composedByUserId: string;
} {
  return { idempotencyKey: crypto.randomUUID(), composedByUserId: userId };
}
