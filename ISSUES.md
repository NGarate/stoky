# Stoky - Issues & Technical Debt

## Overview

This document tracks open issues and technical debt. It started as the Phase 0
(Foundation) code review and is kept current as items are fixed.

**Last Updated:** 2026-08-03  
**Status:** 3 critical issues resolved, 1 open; 5 debt items open

For overall project state and gate results, see `docs/STATUS.md`.

### Summary

| ID | Title | Status |
|---|---|---|
| CRITICAL-1 | `deleted_at` in product search | ✅ Resolved 2026-08-03 |
| CRITICAL-2 | Auth pages were placeholders | ✅ Resolved (commit `7f393ac`) |
| CRITICAL-3 | Missing database migrations | ✅ Resolved (`20260213234844`) |
| CRITICAL-4 | No rate limiting on auth | 🔴 **OPEN** |
| DEBT-1 | Minimal password validation | 🟡 Open |
| DEBT-2 | Barcode scanner torch is inert | 🟡 Open (pinned by test) |
| DEBT-3 | OpenFoodFacts in-memory cache | 🟡 Open |
| DEBT-4 | Bare `Error` instead of `TRPCError` | 🟡 Open (7 of 8 routers) |
| DEBT-5 | Missing database indexes | 🟡 Open |
| TEST-1 | Integration tests need a database | 🟡 Partly addressed |
| TEST-2 | Mock external API calls | ✅ Resolved |
| DOCS-1 | No API documentation | 🟡 Open |
| DOCS-2 | No environment setup instructions | ✅ Resolved |

---

## Critical Issues

### ✅ CRITICAL-1: Non-existent `deleted_at` field in product search query

**File:** `src/server/trpc/routers/product.ts`  
**Severity:** HIGH  
**Status:** RESOLVED 2026-08-03

**Resolution:** The `AND deleted_at IS NULL` clause was removed from the raw
pg_trgm query. No model in `prisma/schema.prisma` has a soft-delete column, so
Option B below was the correct choice; adding `deletedAt` would have introduced
a column nothing else in the codebase reads.

**Original report follows.**

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

### ✅ CRITICAL-2: Authentication pages are placeholder implementations

**Files:**

- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/register/page.tsx`

**Severity:** HIGH  
**Status:** RESOLVED in commit `7f393ac`

**Resolution:** Both pages are real client components with form submission,
`signIn("credentials")`, translated error mapping via
`src/lib/auth/error-messages.ts`, pending state and post-login redirect.

**Original report follows.**

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

### ✅ CRITICAL-3: Missing database migrations

**Location:** `prisma/migrations/`  
**Severity:** HIGH  
**Status:** RESOLVED

**Resolution:** `prisma/migrations/20260213234844` is committed, together with
`migration_lock.toml`. A seeder now also exists at `prisma/seed.ts`, wired to
`corepack pnpm db:seed` through the `prisma.seed` key in `package.json`.

**Original report follows.**

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
**Status:** OPEN — re-confirmed 2026-08-03

**Description:**
No rate limiting is implemented for login/register endpoints. This leaves the application vulnerable to brute force attacks.

**Verification:** grepping `src/` for `rateLimit`, `redis`, `ioredis` or
`valkey` returns nothing. There is no cache client in the application at all,
despite `cache` (Valkey) being defined in `docker-compose.dev.yml`. This is now
the most serious open issue in the repo.

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
**Status:** OPEN — behaviour pinned by test

**Issue:**
The `torchEnabled` state is defined but never actually passed to the scanner component to control the torch.

**Note:** `src/__tests__/components/Scanner.test.tsx` contains a test named
*"does not yet drive the camera torch"* which documents the current behaviour.
When this debt is fixed, that test must be updated — it asserts the torch prop
is absent.

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

**Files:** all routers except `src/server/trpc/routers/receipt.ts`  
**Severity:** LOW  
**Status:** OPEN — scope measured 2026-08-03

**Issue:**
Many procedures throw generic errors like `"User not in a household"` or `"Product not found"` without proper TRPCError codes.

**Scope:** `receipt.ts` uses `TRPCError` in 24 places. The other seven routers
(`auth`, `product`, `location`, `inventory`, `store`, `price`, `shopping`) use
none, so every one of their failures reaches the client as
`INTERNAL_SERVER_ERROR`.

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
**Status:** PARTLY ADDRESSED

**Resolution so far:** `scripts/test-integration-local.sh` (run by
`corepack pnpm test:integration`) brings up the repo's own `db` and `cache`
services and recreates an isolated `stoky_test` database on every run. See
`docs/TEST_SETUP.md`.

**Still open:** the harness depends on a working Docker daemon, which is
currently unavailable on this machine, so the integration suite is unverified.

**Original report follows.**

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

### ✅ TEST-2: Mock external API calls in tests

**Files:**

- `src/__tests__/unit/openFoodFacts.test.ts`
- `src/__tests__/integration/openFoodFacts.comprehensive.test.ts`

**Severity:** MEDIUM  
**Status:** RESOLVED 2026-08-03

**Resolution:** No test makes a real HTTP request. The integration suite
replaces `global.fetch` with a spy; the unit suite's caching tests now stub
`global.fetch`, count calls and restore the original afterwards. The previous
placeholder test — which only asserted that `clearCache` and `clearAllCache`
were functions — was replaced with four tests that actually exercise cache
hits, per-barcode invalidation, full invalidation and key isolation.

**Original report follows.**

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

### ✅ DOCS-2: Missing environment setup instructions

**Severity:** MEDIUM  
**Status:** RESOLVED 2026-08-03

**Resolution:** `README.md` now covers prerequisites, setup and the command
ladder; `docs/LOCAL_BOOTSTRAP.md` documents the clone-to-running-app path and
its success checks; `docs/TEST_SETUP.md` covers test database configuration and
troubleshooting. `prisma/seed.ts` makes the seeding step real.

**Original report follows.**

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

## What to fix next

### Blocking everything else

1. **Restore Docker access** (needs sudo — `sudo usermod -aG docker $USER`).
   Until this works, the integration suite, the E2E suite and the seed cannot
   be run at all, so TEST-1 stays half-open and nothing database-dependent can
   be verified.

### Before public deployment

2. **CRITICAL-4:** Implement rate limiting on login and register. This is the
   only remaining critical issue and the largest security gap.
3. **DEBT-1:** Strengthen the password policy beyond `min(8)`.

### Correctness and scale

4. **DEBT-4:** Convert the seven routers still throwing bare `Error` to
   `TRPCError` with proper codes.
5. **DEBT-5:** Add the missing indexes on `StockEntry.productId`,
   `PriceRecord.productId`/`storeId`, `Receipt.householdId`/`status` and
   `ReceiptItem.receiptId`.
6. **DEBT-3:** Move the OpenFoodFacts cache from the process-local `Map` to
   Valkey.

### Polish

7. **DEBT-2:** Wire the barcode torch toggle to the camera, and update the test
   that currently pins the inert behaviour.
8. **DOCS-1:** Add JSDoc to the tRPC procedures.

---

## Notes

- Backend, auth, schema and migrations are in place; the UI component library
  (Phase 2) is the largest unstarted body of work.
- Unit and component suites run without a database and are green. The
  integration suite is genuine but unverified here — Docker is unavailable.
- TypeScript strict mode is on and both lint and typecheck are clean.
- Security foundation is good (Argon2id, JWT, httpOnly cookies) with rate
  limiting as the notable hole.

For gate results and overall project state, see `docs/STATUS.md`.
