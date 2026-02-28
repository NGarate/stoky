# Test Setup Guide

## Prerequisites

Before running tests, ensure you have:

1. **Dependencies installed**
2. **Docker running** (required for integration tests)
3. **Environment variables configured**

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Run fast suites (no DB required)
pnpm test:unit
pnpm test:components

# 3. Run integration tests (starts local DB/cache from this repo)
pnpm test:integration

# 4. Run full test suite
pnpm test

# 5. Run E2E tests
bunx playwright test
```

## Test Database Configuration

### Using Docker (Recommended for CI/CD)

The integration tests use repo-managed infrastructure services from `docker-compose.dev.yml`.
You can start these services manually:

```bash
docker compose -f docker-compose.dev.yml up -d db cache
```

Or let the integration runner manage them automatically:

```bash
pnpm test:integration
```

The runner recreates an isolated PostgreSQL database (`stoky_test`) on every run.
Tests connect from the host to `localhost:5432` and `localhost:6379`.

### Using Local PostgreSQL

For local development without Docker:

1. Create a test database:
```bash
psql -U postgres -c "CREATE DATABASE stoky_test;"
psql -U postgres -c "CREATE USER stoky_test WITH PASSWORD 'test_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE stoky_test TO stoky_test;"
```

2. Set environment variables in `.env`:
```env
DATABASE_URL="postgresql://stoky_test:test_password@localhost:5432/stoky_test?schema=public"
```

## Running Tests

### Unit Tests
```bash
pnpm test:unit
```

### Component + Utility Tests
```bash
pnpm test:components
```

### Integration Tests
```bash
pnpm test:integration
```

### Single Test File
```bash
pnpm test:integration -- src/__tests__/integration/auth.flow.test.ts
```

### Keep DB/Cache Running After Tests
```bash
KEEP_TEST_SERVICES=true pnpm test:integration
```

### E2E Tests
```bash
# Run all E2E tests
bunx playwright test

# Run specific test file
bunx playwright test e2e/critical-paths.spec.ts

# Run with UI mode for debugging
bunx playwright test --ui

# Run in headed mode (see browser)
bunx playwright test --headed
```

## Test Structure

```
src/__tests__/
├── integration/
│   ├── auth.flow.test.ts      # Authentication API tests
│   └── trpc.test.ts           # tRPC infrastructure tests
├── unit/
│   ├── auth.validation.test.ts
│   ├── household.validation.test.ts
│   ├── ocr.test.ts
│   ├── openFoodFacts.test.ts
│   ├── prisma.test.ts
│   ├── receiptParser.test.ts
│   └── utils.test.ts
└── utils/
    └── test-helpers.ts        # Test utilities and fixtures

e2e/
├── auth.spec.ts               # Basic E2E auth tests
└── critical-paths.spec.ts     # Critical user flow tests
```

## Test Data Cleanup

The integration tests automatically clean up test data after each test. Test data is identified by:
- Email patterns containing `@example.com`
- Household names starting with "Test Household"
- Product names starting with "Test Product"

## CI/CD Configuration

For GitHub Actions, use:

```yaml
- name: Run tests
  env:
    NEXTAUTH_SECRET: test-secret
  run: |
    pnpm test:integration
```

## Troubleshooting

### "Can't reach database server" error
- Ensure PostgreSQL is running: `pg_isready -h localhost -p 5432`
- Check DATABASE_URL in `.env`
- Verify database exists: `psql -U postgres -l`

### "Prisma schema not found" error
- Run migrations: `pnpm prisma migrate deploy`
- Generate client: `pnpm prisma generate`

### E2E tests fail with connection refused
- Ensure dev server is running: `pnpm dev`
- Check that port 3000 is available
- Wait for server to fully start before running tests

## Test Coverage

To check test coverage (when configured):

```bash
bun test --coverage
```

## Writing New Tests

### Integration Tests

Use the test helpers for database operations:

```typescript
import { createTestUser, cleanupTestUsers } from "../utils/test-helpers";

describe("My Feature", () => {
  afterEach(async () => {
    await cleanupTestUsers("@example.com");
  });

  it("should work", async () => {
    const user = await createTestUser({
      email: "test@example.com",
      name: "Test User",
      password: "password123",
    });
    // ... test code
  });
});
```

### E2E Tests

Use the page object pattern:

```typescript
import { test, expect } from "@playwright/test";

test("my feature", async ({ page }) => {
  await page.goto("/my-page");
  await expect(page.locator("h1")).toContainText("My Feature");
});
```
