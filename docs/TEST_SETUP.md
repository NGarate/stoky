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
bun install

# 2. Run fast suites (no DB required)
bun run test:unit
bun run test:components

# 3. Run integration tests (starts local DB/cache from this repo)
bun run test:integration

# 4. Run full test suite
bun run test

# 5. Run E2E tests (in Playwright's image, which brings the browsers)
bun run test:e2e
```

The Playwright driver also runs under Bun. `e2e/package.json` marks only the
browser tests as ES modules so Playwright imports them through Bun's native
TypeScript loader. In Playwright 1.62.1, the CommonJS path replaces `.ts` loaders
with the JavaScript loader; without this scope, `bunx --bun playwright test
--list` fails on TypeScript imports before any test runs. The nested file sets
module format only; it declares no package, dependencies or workspace.

## Test Database Configuration

### Using Docker (Recommended for CI/CD)

The integration tests use repo-managed infrastructure services from `docker-compose.dev.yml`.
You can start these services manually:

```bash
docker compose -f docker-compose.dev.yml up -d db cache
```

Or let the integration runner manage them automatically:

```bash
bun run test:integration
```

The runner recreates an isolated PostgreSQL database (`stoky_test`) on every run.
Tests connect from the host to `localhost:5432` and `localhost:6379`.

### Without Docker

`bun run test:integration` runs `scripts/test-integration-local.sh`, which
brings up its own containers **and overwrites `DATABASE_URL`** — so a hand-set
value in `.env` is ignored and the steps below will appear to do nothing.

To point the integration tests at a database you manage yourself, use
`bun run test:integration:only`, which runs the suite directly against whatever
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
bun run test:unit
```

### Component + Utility Tests
```bash
bun run test:components
```

### Integration Tests
```bash
bun run test:integration
```

### Single Test File
```bash
bun run test:integration -- src/__tests__/integration/auth.flow.test.ts
```

### Keep DB/Cache Running After Tests
```bash
KEEP_TEST_SERVICES=true bun run test:integration
```

### E2E Tests
```bash
# Run all E2E tests — inside Playwright's own image, which carries Chromium,
# Firefox, WebKit and their system libraries (scripts/e2e-in-image.sh)
bun run test:e2e

# Run specific test file, or anything else `playwright test` takes
bun run test:e2e -- e2e/critical-paths.spec.ts
bun run test:e2e -- --project=webkit
```

`--ui` and `--headed` need a display, which the container does not have. For
those, run `bunx --bun playwright test --ui` on the host, with whichever
browsers the host has; a host run that fails with `Executable doesn't exist`
is the machine missing a browser, not a failing test.

**It owns its data.** The suite runs against its **own database and cache** —
`stoky_e2e` in the same Postgres, Valkey db index 1 — derived in
`e2e/db-url.ts` from `DATABASE_URL`/`VALKEY_URL`, or taken verbatim from
`E2E_DATABASE_URL`/`E2E_VALKEY_URL` (what CI sets). A `seed` project runs
`prisma migrate deploy` (which creates the database on first contact) and
`bun run db:seed` against it; a `setup` project signs in as the demo account;
every browser project depends on both, so there is nothing to run first.

It re-seeds on *every* invocation rather than once, because the suite spends
the fixture as it goes — confirming a receipt line is a write, and the fixture
holds three confirmable lines. Before 2026-08-17 the seed ran against the
shared dev database scoped to the demo household, and that scoping was not
enough: it reset the household the owner was actively testing with. The suite
can now be run at any time without touching anything a person is using.

**It serves the production artefact.** The `webServer` runs `bun run build` and
then `bun .next/standalone/server.js` — the same thing the Docker image runs —
on port **3100** by default (`PLAYWRIGHT_PORT` overrides). `next dev` sat there
until 2026-08-17 and hid an entire defect class: production auth broken under
green suites, and `upgrade-insecure-requests` killing every fetch on WebKit
over plain http. The build adds under a minute and the production server serves
faster than dev compiled, so the suite's wall clock barely moved.

**Passkeys are tested at `localhost`, everything else at 127.0.0.1.** The
suite names `127.0.0.1` everywhere because `localhost` is two addresses and
stacks disagree about which comes first (STATUS trap 8). A passkey cannot
live there: it belongs to a relying party named by a host, WebAuthn takes no
IP address as that name, and the server registers no passkey plugin at an IP
(`src/lib/auth/passkeys.ts`). So the one `webServer` lists both, **localhost
first** — `STOKY_URLS=http://localhost:3100,http://127.0.0.1:3100` — which
makes `localhost` the canonical address and the relying party while
127.0.0.1 stays a trusted origin for every other spec; both are plain http,
so the cookie's `Secure` decision, the only other thing the first entry
decides, is unchanged. The `passkeys` project runs `e2e/passkeys.spec.ts`
alone, in Chromium at `http://localhost:3100` with
`--host-resolver-rules=MAP localhost 127.0.0.1`, so trap 8 cannot come back
for the one project that has to use the name; its authenticator is
Chromium's virtual one, over the DevTools protocol. Setting
`PLAYWRIGHT_BASE_URL` to any other server leaves the project out, because
nothing says that server lists `localhost` first.

**Do not start a server for it, and do not stop yours.** `reuseExistingServer`
is off, so the suite never adopts a foreign server — a taken port fails loudly
instead. Your own `bun run dev` and the suite coexist: different port, different
database, and the standalone server takes no `next dev` single-instance lock.
The environment must be exported first (`set -a; . ./.env; set +a`), or the
config refuses with a message naming the variables it needs.

## Test Structure

```
src/__tests__/
├── integration/               # ~25 test files — brings up its own db + cache
├── unit/                      # ~42 test files — no database
├── components/                # ~31 test files — happy-dom, no database
├── setup/                     # preloads and helpers, not tests
│   ├── matchers.ts
│   ├── next-environment.ts    # bunfig.toml preloads it into every bun test
│   ├── register-dom.ts
│   └── tailwind.ts            # resolves class lists through Tailwind's compiler
└── utils/
    └── test-helpers.ts

e2e/                           # Playwright — ten spec files
├── *.spec.ts                  # incl. auth.prod and service-worker.prod, which
│                              #   audit the deployed artefact specifically
├── db-url.ts                  # the suite's isolated database/cache URLs
├── seed.setup.ts              # migrate + seed the suite's own database
├── session.setup.ts           # sign in once; session.ts holds the mechanism
└── settle.ts                  # the shared wait
```

This listing used to name every test file and drifted within weeks of being
written — it said 8 integration files while 25 existed. Counts are approximate
on purpose; `ls` is the authority. `setup/register-dom.ts` is the preload that
gives the component suite a DOM; `setup/tailwind.ts` resolves a component's
class list through Tailwind's real compiler, which is how target size and line
spacing are checked without a browser.

`setup/next-environment.ts` is preloaded into every `bun test` by `bunfig.toml`,
whatever the suite or file. It loads Next's `node-environment-baseline` first,
as `next start` does, so `globalThis.AsyncLocalStorage` exists before any of
Next's server modules is evaluated. Without it, the first test file to import
`next/headers` or `next/server` left Next's request storage throwing for every
file after it in the same process (ISSUES TEST-11);
`unit/next-environment.test.ts` goes red if the preload is gone.

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
    # 32 characters or more, the length production requires; the URL is the
    # one Better Auth is built with and the origin the sign-in helper sends.
    STOKY_SECRET: integration-suite-secret-not-a-real-one
    STOKY_URLS: http://localhost:3000
  run: |
    bun run test:integration
```

## Troubleshooting

### "Can't reach database server" error
- Ensure PostgreSQL is running: `pg_isready -h localhost -p 5432`
- Check DATABASE_URL in `.env`
- Verify database exists: `psql -U postgres -l`

### "Prisma schema not found" error
- Run migrations: `bunx prisma migrate deploy`
- Generate client: `bunx prisma generate`

### E2E tests fail with connection refused
- The suite starts its own server — do not start one for it, and do not point
  it at one. A refusal at startup usually means the port is taken: pass
  `PLAYWRIGHT_PORT` with a free one (default 3100)
- A run that goes green for a while and then fails every remaining test with
  `ERR_CONNECTION_REFUSED` means the suite's server died underneath it — look
  at what else touched the machine, not at the tests

## Test Coverage

Measured per tier, and the denominators differ — each report counts only the
files that tier loads, so the three numbers must never be added into a project
figure. `docs/STATUS.md` carries the current numbers.

```bash
bun test --coverage src/__tests__/unit
bun test --coverage --preload ./src/__tests__/setup/register-dom.ts src/__tests__/components
bun test --coverage src/__tests__/integration
```

A path per tier, and not a bare `bun test --coverage`, which would contradict
the paragraph above it: one invocation over everything produces a single
denominator and hides exactly the distinction this section exists to make. It
would also fail — the component tier needs the `register-dom` preload the
`test:components` script carries, and the integration tier needs the database
`test:integration` starts.

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
