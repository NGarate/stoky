# Stoky Phase 0 - Critical Issues & Technical Debt

## Overview

This document tracks critical issues and technical debt identified during the Phase 0 (Foundation) code review. These issues should be addressed before proceeding to Phase 1 or during the early stages of Phase 1.

**Last Updated:** 2025-02-08  
**Phase:** 0 (Foundation)  
**Status:** Code Review Complete

---

## Critical Issues

### 🔴 CRITICAL-1: Non-existent `deleted_at` field in product search query

**File:** `src/server/trpc/routers/product.ts` (Line 287-297)  
**Severity:** HIGH  
**Status:** OPEN

**Description:**
The `searchByName` procedure uses raw SQL with a `deleted_at IS NULL` filter, but the `Product` model in `prisma/schema.prisma` does not have a `deleted_at` field. This query will fail at runtime.

**Current Code:**
```typescript
const products = await prisma.$queryRaw`
  SELECT 
    id, name, barcode, brand, category, "defaultUnit", "minStock",
    similarity(name, ${input.query}) as similarity
  FROM "Product"
  WHERE "householdId" = ${user.householdId}
    AND deleted_at IS NULL  // <-- THIS FIELD DOESN'T EXIST
    AND name % ${input.query}
  ORDER BY similarity(name, ${input.query}) DESC
  LIMIT ${input.limit}
`;
```

**Impact:**
- Product search functionality will throw database errors
- Users won't be able to search for products
- Blocks Phase 1 feature "Product catalog CRUD + search"

**Suggested Fix:**
Option A: Add soft delete support to Product model:
```prisma
model Product {
  // ... existing fields ...
  deletedAt DateTime?
  // ...
}
```

Option B: Remove the `deleted_at IS NULL` clause from the query if soft deletes are not planned for MVP.

**Priority:** Fix before Phase 1 starts

---

### 🔴 CRITICAL-2: Authentication pages are placeholder implementations

**Files:** 
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/register/page.tsx`

**Severity:** HIGH  
**Status:** OPEN

**Description:**
Both login and register pages are minimal placeholders with no actual form implementation. The Auth.js configuration exists but users cannot actually log in or register.

**Current Code (login):**
```tsx
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1>Login Page</h1>
    </div>
  );
}
```

**Impact:**
- Users cannot authenticate
- Blocks all dashboard functionality
- Blocks Phase 1 entirely

**Required Implementation:**
- Login form with email/password fields
- Register form with email, name, password, optional household name
- Form validation using Zod schemas
- Error handling and user feedback
- Integration with `signIn()` from Auth.js
- Redirect after successful auth

**Priority:** Must implement in Phase 1 Week 1

---

### 🔴 CRITICAL-3: Missing database migrations

**Location:** `prisma/migrations/`  
**Severity:** HIGH  
**Status:** OPEN

**Description:**
No migration files exist in the repository. The schema is defined but hasn't been migrated to create the actual database tables.

**Impact:**
- Database tables don't exist
- All Prisma queries will fail
- Application cannot run

**Required Actions:**
1. Run `pnpm prisma migrate dev --name init` to create initial migration
2. Commit the generated migration files to git
3. Document migration workflow in README

**Note:** Initial migration should include:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

**Priority:** Must complete before any database-dependent features

---

### 🟡 CRITICAL-4: Missing rate limiting for authentication endpoints

**Files:** 
- `src/lib/auth.ts`
- `src/app/api/auth/[...nextauth]/route.ts` (missing)

**Severity:** MEDIUM-HIGH  
**Status:** OPEN

**Description:**
No rate limiting is implemented for login/register endpoints. This leaves the application vulnerable to brute force attacks.

**Requirements from DETAILED_PLAN.md:**
> Rate limiting: 5 login attempts/15min per IP, 3 registrations/hour per IP

**Impact:**
- Security vulnerability
- Brute force password attacks possible
- Registration spam possible

**Suggested Implementation:**
Use Valkey (Redis) to track attempts per IP:
```typescript
// Middleware or custom authorize function
const rateLimitKey = `auth:attempts:${ip}`;
const attempts = await redis.incr(rateLimitKey);
if (attempts === 1) {
  await redis.expire(rateLimitKey, 900); // 15 minutes
}
if (attempts > 5) {
  throw new Error("Too many attempts. Try again later.");
}
```

**Priority:** Implement before public deployment

---

## Technical Debt

### 🟡 DEBT-1: Minimal password validation rules

**File:** `src/lib/validations/auth.ts`  
**Severity:** MEDIUM  
**Status:** OPEN

**Current Rule:**
```typescript
password: z.string().min(8)
```

**Issue:**
Only checks for minimum length. No complexity requirements (uppercase, lowercase, numbers, special chars).

**Suggested Enhancement:**
```typescript
password: z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character")
```

**Priority:** Address in Phase 1

---

### 🟡 DEBT-2: Barcode scanner component has unused torch state

**File:** `src/components/barcode/Scanner.tsx`  
**Severity:** LOW  
**Status:** OPEN

**Issue:**
The `torchEnabled` state is defined but never actually passed to the scanner component to control the torch.

**Current Code:**
```typescript
const [torchEnabled, setTorchEnabled] = useState(false);
// ...
<BarcodeScannerComponent
  doScan={isScanning}
  onSuccess={handleSuccess}
  onError={handleError}
  // torchEnabled prop not passed
/>
```

**Suggested Fix:**
Either:
1. Pass `torchEnabled` to the scanner component if supported
2. Remove torch functionality if not supported by `@thewirv/react-barcode-scanner`
3. Check library documentation for correct torch API

**Priority:** Fix before barcode scanning feature (F5)

---

### 🟡 DEBT-3: OpenFoodFacts service uses in-memory cache

**File:** `src/server/services/openFoodFacts.ts`  
**Severity:** MEDIUM  
**Status:** OPEN

**Issue:**
The service uses an in-memory Map for caching. In a multi-instance deployment (Docker Swarm, Kubernetes), each instance will have its own cache, leading to inconsistent behavior and cache misses.

**Current Code:**
```typescript
const cache = new Map<string, { data: OpenFoodFactsProduct; timestamp: number }>();
```

**Planned Solution (from DETAILED_PLAN.md):**
Use Valkey (Redis-compatible) cache service for production.

**Suggested Fix:**
Replace in-memory cache with Valkey when implementing the service:
```typescript
import { Redis } from "ioredis";
const redis = new Redis(process.env.VALKEY_URL);

async getProductByBarcode(barcode: string) {
  const cacheKey = `off:${barcode}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  // ... fetch and cache ...
}
```

**Priority:** Address in Phase 1 when implementing F5 (Barcode scanning)

---

### 🟡 DEBT-4: tRPC error handling uses generic messages

**File:** `src/server/trpc/routers/product.ts`  
**Severity:** LOW  
**Status:** OPEN

**Issue:**
Many procedures throw generic errors like `"User not in a household"` or `"Product not found"` without proper TRPCError codes.

**Example:**
```typescript
if (!user?.householdId) {
  throw new Error("User not in a household"); // Should use TRPCError
}
```

**Suggested Fix:**
Use TRPCError with appropriate codes:
```typescript
import { TRPCError } from "@trpc/server";

if (!user?.householdId) {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "User must belong to a household",
  });
}

if (!product) {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Product not found",
  });
}
```

**Priority:** Address during Phase 1 implementation

---

### 🟡 DEBT-5: Missing database indexes

**File:** `prisma/schema.prisma`  
**Severity:** MEDIUM  
**Status:** OPEN

**Issue:**
Several frequently queried fields don't have indexes, which will cause performance issues at scale.

**Missing Indexes:**
1. `StockEntry.productId` - Queried in every stock operation
2. `StockEntry.householdId` (via Product relation) - Queried in inventory overview
3. `PriceRecord.productId` - Queried for price history
4. `Receipt.householdId` - Queried in receipt lists
5. `ReceiptItem.receiptId` - Queried when loading receipt details

**Suggested Additions:**
```prisma
model StockEntry {
  // ... fields ...
  @@index([productId])
}

model PriceRecord {
  // ... fields ...
  @@index([productId])
  @@index([storeId])
}

model Receipt {
  // ... fields ...
  @@index([householdId])
  @@index([status])
}

model ReceiptItem {
  // ... fields ...
  @@index([receiptId])
}
```

**Priority:** Add before Phase 1 if possible, or early in Phase 1

---

## Testing Gaps

### 🟡 TEST-1: Database-dependent tests need setup

**Location:** `src/__tests__/integration/`  
**Severity:** MEDIUM  
**Status:** OPEN

**Issue:**
Integration tests for tRPC routers and services require a test database. Currently, tests are either skipped or will fail without database setup.

**Required Setup:**
1. Create test database schema
2. Add test database URL to environment
3. Set up test fixtures/seeds
4. Add database cleanup between tests

**Suggested Implementation:**
```typescript
// test-setup.ts
import { prisma } from "@/lib/prisma";

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  // Clean database
  await prisma.stockEntry.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.household.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

**Priority:** Complete before writing integration tests for Phase 1 features

---

### 🟡 TEST-2: Mock external API calls in tests

**Files:** 
- `src/__tests__/unit/openFoodFacts.test.ts`

**Severity:** MEDIUM  
**Status:** OPEN

**Issue:**
Tests for OpenFoodFacts service will make real HTTP requests. This is slow, flaky, and rate-limited.

**Suggested Fix:**
Mock `global.fetch` in tests:
```typescript
beforeEach(() => {
  global.fetch = mock(() => 
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        code: "123456789",
        status: 1,
        product: {
          product_name: "Test Product",
          // ...
        }
      })
    })
  );
});
```

**Priority:** Fix before running tests in CI

---

## Documentation Gaps

### 🟡 DOCS-1: Missing API documentation

**Severity:** LOW  
**Status:** OPEN

**Issue:**
No API documentation exists for the tRPC procedures. This makes it hard for frontend developers to understand available endpoints.

**Suggested Solution:**
Add JSDoc comments to all router procedures:
```typescript
/**
 * Search for products by name using fuzzy matching (pg_trgm)
 * @param input.query - Search query string
 * @param input.limit - Maximum results (default: 10)
 * @returns Array of products with similarity scores
 */
searchByName: protectedProcedure
  .input(productSearchSchema)
  .query(async ({ ctx, input }) => { ... })
```

**Priority:** Low, can be addressed in Phase 2

---

### 🟡 DOCS-2: Missing environment setup instructions

**Severity:** MEDIUM  
**Status:** OPEN

**Issue:**
`.env.example` exists but there's no documentation on how to:
- Generate `NEXTAUTH_SECRET`
- Set up PostgreSQL locally
- Configure Docker for development
- Run migrations
- Seed database

**Suggested Addition:**
Create `docs/setup.md` or expand README with:
1. Prerequisites (Node.js 24, Docker, pnpm)
2. Environment variable explanations
3. Step-by-step setup commands
4. Troubleshooting guide

**Priority:** Complete before onboarding new developers

---

## Recommendations for Phase 1

### Week 1 Priorities:

1. **Fix CRITICAL-1:** Remove or add `deleted_at` field
2. **Fix CRITICAL-2:** Implement login/register forms
3. **Fix CRITICAL-3:** Create and commit initial migration
4. **Setup TEST-1:** Configure test database for integration tests

### Week 2 Priorities:

5. **Address DEBT-3:** Implement Valkey caching for OpenFoodFacts
6. **Address DEBT-5:** Add missing database indexes
7. **Address DEBT-1:** Enhance password validation

### Before Production:

8. **Fix CRITICAL-4:** Implement rate limiting
9. **Address DEBT-4:** Standardize TRPCError usage
10. **Fix TEST-2:** Mock all external API calls

---

## Notes

- All Phase 0 core infrastructure is in place and committed
- The remaining untracked files (inventory, products, receipts, etc.) are Phase 1 features
- Tests are comprehensive but need database setup to run
- Code quality is generally high with TypeScript strict mode
- Security foundation is good (Argon2id, JWT, httpOnly cookies)

---

**Next Steps:**
1. Fix Critical issues 1-3 before Phase 1
2. Set up test database environment
3. Begin Phase 1 feature implementation (F4-F7)
4. Address technical debt incrementally during Phase 1

**Sign-off:**
- Code Review: COMPLETE
- Phase 0 Commit History: 12 commits
- Test Suite: 10 test files, 897 lines
- Issues Documented: 12 items
