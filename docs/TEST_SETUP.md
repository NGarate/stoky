# Test Setup Guide


## Which tier a new test belongs in

Four tiers, and the rule is that **a check belongs in the cheapest one that can
answer it honestly** (PROGRESS.md D25). The browser is not the thorough option;
it is the expensive one, and using it for a question a cheaper tier can settle
buys nothing and costs maintenance for ever.

| Tier | Runner | Answers | Cost |
|---|---|---|---|
| Static | Bun | Facts about source and CSS: token contrast, catalogue parity, internal links, how a procedure is declared, which errors a router throws | ms |
| Rendered | Bun + happy-dom | Facts about the DOM: names, roles, labels, ARIA wiring, keyboard interaction, and — through Tailwind's own compiler — what an element *declares* | s |
| Server | Bun + Postgres + Valkey | Procedures: guards, state transitions, side effects, household isolation, rate limiting | s |
| Browser | Playwright | Only what composition decides: layout, overflow, occlusion, contrast as painted, focus across a real page, the accessibility tree | min |

**A browser test has to justify itself by naming the thing only a browser can
answer.** If you cannot name it, the test belongs one tier down. The audit of
2026-08-11 removed five picker tests that failed this: keyboard navigation,
Escape and tab order are DOM facts, and the component suite already asserted
every one of them against the real component.

### Cross-engine coverage is a separate axis from test coverage

Running a business flow on five engines does not test five things. A sign-in is
tRPC, Prisma and Argon2id; none of it is rendered, and none of it changes
because the engine did. What genuinely varies between engines is layout.

So the matrix separates the two axes instead of multiplying them: chromium runs
everything, Mobile Safari runs the two layout specs, and Firefox and desktop
WebKit run a four-test `@smoke` set. Tag a test `@smoke` only if an engine
breaking it means the engine has broken enough that nothing subtler is worth
measuring.

### The budget is enforced, not aspirational

`globalTimeout` is 5 minutes locally and 9 in CI. The suite runs in 2.9. If a
change pushes it past the ceiling the run fails, which is the point: a suite
that gets slower quietly is one that stops being run.


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

### Without Docker

`pnpm test:integration` runs `scripts/test-integration-local.sh`, which brings up
its own containers **and overwrites `DATABASE_URL`** — so a hand-set value in
`.env` is ignored and the steps below will appear to do nothing.

To point the integration tests at a database you manage yourself, use
`pnpm test:integration:only`, which runs the suite directly against whatever
`DATABASE_URL` is set to. That is also what CI uses, because the runner supplies
its own service containers.

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

**Seed first.** A `setup` project signs in once as the demo account from
`prisma/seed.ts` and every browser project depends on it, so an unseeded
database fails the whole matrix at its first step:

```bash
corepack pnpm db:seed
```

**Do not start a dev server for it.** `playwright.config.ts` declares its own
`webServer`. It adopts an existing server when the port is taken, which is the
trap rather than the convenience: port 3000 is occupied on this machine by an
unrelated application, and the suite will run against that one and report a wall
of meaningless failures. Pass `PLAYWRIGHT_PORT` and check the port is free.

## Test Structure

```
src/__tests__/
├── integration/               # 8 files — needs a database
│   ├── auth.flow.test.ts
│   ├── ocr.pipeline.test.ts
│   ├── openFoodFacts.comprehensive.test.ts
│   ├── performance.error.test.ts
│   ├── productMatcher.comprehensive.test.ts
│   ├── receiptParser.comprehensive.test.ts
│   ├── routers.test.ts
│   └── trpc.test.ts
├── unit/                      # 12 files — no database
│   ├── auth.error-messages.test.ts
│   ├── auth.validation.test.ts
│   ├── design-tokens.test.ts
│   ├── household.validation.test.ts
│   ├── messages.test.ts
│   ├── navigation.test.ts
│   ├── ocr.test.ts
│   ├── openFoodFacts.test.ts
│   ├── prisma.test.ts
│   ├── receiptParser.test.ts
│   ├── theme.test.ts
│   └── utils.test.ts
├── components/                # 13 files — happy-dom, no database
│   ├── CompactNav.test.tsx
│   ├── DashboardNav.test.tsx
│   ├── LocaleSwitcher.test.tsx
│   ├── LocationPicker.test.tsx
│   ├── PriceChart.test.tsx
│   ├── ReceiptStatus.test.tsx
│   ├── Scanner.test.tsx
│   ├── ShoppingItem.test.tsx
│   ├── ThemeControl.test.tsx
│   ├── UploadZone.test.tsx
│   ├── button.test.tsx
│   ├── input.test.tsx
│   └── target-size.test.tsx
├── setup/                     # preloads and helpers, not tests
│   ├── matchers.ts
│   ├── register-dom.ts
│   └── tailwind.ts
└── utils/
    └── test-helpers.ts

e2e/                           # Playwright
├── a11y-aaa.spec.ts
├── a11y-structure.spec.ts
├── accessibility.spec.ts
├── critical-paths.spec.ts
├── dynamic-routes.spec.ts
├── location-picker.spec.ts
├── screen-reader.spec.ts
├── session.setup.ts
├── session.ts
└── settle.ts
```

`setup/register-dom.ts` is the preload that gives the component suite a DOM;
`setup/tailwind.ts` resolves a component's class list through Tailwind's real
compiler, which is how target size and line spacing are checked without a
browser. `e2e/session.ts` and `session.setup.ts` are the sign-in-once mechanism;
`e2e/settle.ts` is the shared wait.

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
