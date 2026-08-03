# Stoky Project Status

Updated: 2026-08-04

Single source of truth for where the project actually is. Replaces
`PROJECT_ASSESSMENT.md`, `DEVELOPMENT_ROADMAP.md`, `COMPONENT_AUDIT.md`,
`COMPONENT_TESTING_SUMMARY.md`, `TESTING_SUMMARY.md` and `TEST_SUMMARY.md`,
which contradicted each other and overstated completion.

Rule for this file: **every claim must be reproducible by running a command.**
If a gate could not be run, say so and say why.

---

## Gate status

Measured on 2026-08-04, with a live PostgreSQL and Valkey.

| Gate | Command | Result |
|---|---|---|
| Lint | `corepack pnpm lint` | ✅ 0 warnings, 0 errors |
| Typecheck | `corepack pnpm typecheck` | ✅ clean |
| Unit tests | `corepack pnpm test:unit` | ✅ 72 pass / 8 files |
| Component tests | `corepack pnpm test:components` | ✅ 94 pass / 10 files |
| Integration tests | `corepack pnpm test:integration` | ✅ 218 pass / 8 files |
| Build | `corepack pnpm build` | ✅ 16 routes, all server-rendered on demand |
| Migration | `corepack pnpm prisma migrate deploy` | ✅ on a fresh database (after the pg_trgm fix below) |
| Seed | `corepack pnpm db:seed` | ✅ verified end-to-end, and idempotent across re-runs |
| E2E (chromium) | `bunx playwright test --project=chromium` | ✅ 12 pass, 4 skipped (`test.fixme`), 0 fail |

### Two traps that made earlier measurements wrong

**1. The migration could never apply to a fresh database.** The initial
migration creates a GIN index using `gin_trgm_ops` but never created the
`pg_trgm` extension, so `prisma migrate deploy` failed with
*operator class "gin_trgm_ops" does not exist*. It went unnoticed because the
only path anyone ran — `scripts/test-integration-local.sh` — creates the
extensions manually beforehand, masking the defect. Local bootstrap and
production deploy were both broken. Fixed by adding the `CREATE EXTENSION`
statements to the migration itself.

**2. Playwright silently tested a different application.** `playwright.config.ts`
hardcoded port 3000 with `reuseExistingServer`. When an unrelated process holds
that port, Playwright adopts it and runs the whole suite against that other app,
producing a wall of meaningless failures. The config now honours
`PLAYWRIGHT_PORT`. Always confirm the port is free, or set it:

```bash
PLAYWRIGHT_PORT=3177 bunx playwright test e2e/critical-paths.spec.ts
```

### What the E2E failures turned out to be

All six original failures were investigated. **None was an application bug.**

- **3 were broken tests, now fixed.** The login-error assertions searched for
  `/incorrect|inválido|error/i` while the app correctly renders *"Credenciales
  inválidas"* — feminine plural, which that regex misses. The empty-fields test
  expected an app-rendered error, but both inputs are `required`, so the browser
  blocks submission and the app is never reached. And the duplicate-email test
  navigated away while the first registration was still in flight, aborting it,
  so no user existed and the "duplicate" attempt simply succeeded. Assertions
  now read the real strings from `messages/es.json`.
- **1 was test parallelism.** With `fullyParallel` against a single shared
  database, results moved between runs. The suite is now serial.
- **4 are blocked on missing routes** and are marked `test.fixme` with the
  reason inline. See below.

### Dead links: four routes that are linked but do not exist

| Linked from | Target | Exists |
|---|---|---|
| `/products` | `/products/new` | ❌ |
| `/inventory` | `/inventory/add` | ❌ |
| `/inventory` | `/inventory/consume` | ❌ |
| `DashboardNav` | `/settings` | ❌ |

Clicking any of these gives a 404. The last one is in the main navigation of
every dashboard page. The `inventory` router already implements add, consume,
adjust and transfer — only the UI is missing, so Journey 1 of
`docs/SMOKE_JOURNEYS.md` cannot be completed today.

(An earlier revision of this document claimed `/inventory` had no interactive
controls at all. That was wrong — the controls are `<Link>` elements, and they
point at routes that were never built.)

---

## What exists

**Backend — substantially complete.**
8 tRPC routers (`auth`, `product`, `location`, `inventory`, `receipt`, `store`,
`price`, `shopping`), all merged in `src/server/trpc/router.ts`. 8 Zod
validation modules in `src/lib/validations/`. 4 services: `ocr`,
`receiptParser`, `productMatcher`, `openFoodFacts`. Initial migration committed
(`prisma/migrations/20260213234844`).

**Auth — working.** Login and register are real forms wired to Auth.js
`signIn()` with Argon2id hashing, error mapping and i18n (commit `7f393ac`).

**Frontend — routes exist, component library does not.**
16 App Router pages across the dashboard sections (all server-rendered on
demand — nothing is statically prerendered), 16 domain components, and
**2 shadcn primitives** (`button`, `input`). See *Phase 2* below.

**i18n — complete for what exists.** `messages/es.json` and `messages/en.json`
have matching top-level keys. Spanish is primary.

**Seed — verified.** `prisma/seed.ts` creates a demo household, 6 products
(3 deliberately below minimum stock), 4 storage locations, 3 stores, 18 price
records and a shopping list. Confirmed against a live database: it produces
exactly the intended low-stock set (Leche entera 2/6, Aceite 1/2, Café 0/2) and
re-running leaves the row counts unchanged. Login is `demo@stoky.local` /
`Demo1234!`.

---

## Test suite

| Suite | Files | Tests | Needs a database |
|---|---|---|---|
| `src/__tests__/unit` | 8 | 72 | no |
| `src/__tests__/components` | 10 | 94 | no |
| `src/__tests__/integration` | 7 | ~240 | **yes** |

The component suite was rewritten on 2026-08-03. The previous one reported
"352 passing tests, 100% component coverage" but every assertion was a
tautology of the form:

```ts
it("should show confirmed state styling", () => {
  const showsConfirmed = true;
  expect(showsConfirmed).toBe(true);   // asserts nothing
});
```

No component was rendered and `@testing-library/react` was not even a
dependency. Real component coverage was 0%. The replacement renders each
component into happy-dom and was validated by mutation testing: four
deliberately broken components produced eight test failures. See
`src/__tests__/components/README.md`.

Also removed: `src/__tests__/visual/` (pointed at a `/test/components` route
that does not exist, and sat outside Playwright's `testDir`, so it never ran)
and `src/__tests__/e2e/` (a divergent duplicate of `e2e/`).

The integration suite is genuine — it drives `appRouter.createCaller` against
real Prisma — and now verified: **218 pass, 0 fail, 406 assertions**. It stubs
`global.fetch` for every Open Food Facts test, so no suite makes real network
calls; the `OFF API error: 403` lines in its output come from the service
logging deliberately malformed fixtures.

---

## Phase 2: UI component library — not started

2 of ~23 useful shadcn primitives are installed. Everything else is hand-rolled
Tailwind, which is why the domain components carry their own colour logic.

Installed: `button`, `input`.

Highest value next, roughly in order of how often the existing pages need them:

```bash
npx shadcn add label card dialog badge select table skeleton
npx shadcn add form textarea checkbox tabs alert dropdown-menu
```

Also missing and likely needed later: `sheet`, `accordion`, `separator`,
`scroll-area`, `avatar`, `tooltip`, `popover`, `toast`/`sonner`, `alert-dialog`,
`progress`, `command`, `breadcrumb`, `pagination`, `calendar`, `switch`,
`radio-group`.

There is no `DashboardLayout`, `Sidebar`, `Header` or `MobileNav` component —
navigation is `DashboardNav` alone.

---

## Known gaps, by severity

**Security**
- No rate limiting anywhere. `CLAUDE.md` specifies 5 login attempts/15min and
  3 registrations/hour per IP; there is no implementation and no Valkey client
  in `src/`. (`ISSUES.md` CRITICAL-4)
- Password policy is `min(8)` only. (`ISSUES.md` DEBT-1)

**Correctness**
- 7 of 8 routers throw bare `Error` instead of `TRPCError`, so clients receive
  `INTERNAL_SERVER_ERROR` for what are really auth and not-found conditions.
  Only `receipt.ts` uses `TRPCError`. (`ISSUES.md` DEBT-4)
- `openFoodFacts` caches in a process-local `Map`; multi-instance deployments
  will diverge. (`ISSUES.md` DEBT-3)
- The barcode scanner's torch toggle is local state that never reaches the
  camera. (`ISSUES.md` DEBT-2 — now pinned by a test that documents the
  behaviour.)

**Coverage**
- No component tests for `MatchSelector`, `CreateProductInline`, `ReviewCard`,
  `AutoListPreview`, `StoreSelector`, `ExpiringItems`, `BestPriceIndicator`,
  `StoreComparison`.
- No accessibility tooling (no axe run). The old "85/100 accessibility score"
  was not produced by any tool.
- No visual regression coverage at all.
- Coverage percentage is unknown; `bun test --coverage` has not been run.

**Operational**
- No error boundaries, no loading skeletons.
- No PWA configuration.
- No error tracking, monitoring or health-check endpoint.
- No data export or backup.

---

## Spec drift

`CLAUDE.md` and `DETAILED_PLAN.md` state versions the repo does not use:

| Claimed | Actual |
|---|---|
| Prisma 7.x | 6.19.2 |
| tRPC v11 | `11.0.0-rc.802` (release candidate) |

Next.js 16, React 19, Tailwind 4, next-intl 4 and pnpm 10 all match.

---

## What to do next

1. **Build the four missing routes** — `/products/new`, `/inventory/add`,
   `/inventory/consume` and `/settings`. They are linked from the UI today and
   404. The routers behind them already exist, so this is UI work only. Doing it
   unblocks the four `test.fixme` E2E tests and Journey 1 of
   `docs/SMOKE_JOURNEYS.md`.
2. **Implement rate limiting** on login and register — the last critical
   security gap (`ISSUES.md` CRITICAL-4).
3. Standardise `TRPCError` across the seven routers still throwing bare errors.
4. Start Phase 2 proper: install the shadcn primitives listed above, then
   refactor the domain components onto them.

### Environment note

The `docker` group exists and includes this user, but a login session started
before that change will not have it. Either re-login, or prefix commands with
`sg docker -c "..."`. Port 3000 is occupied on this machine, so pass
`PLAYWRIGHT_PORT` when running E2E.

---

## Related documents

| Document | Purpose |
|---|---|
| `docs/LOCAL_BOOTSTRAP.md` | Clone → running app |
| `docs/VERIFICATION_SEQUENCE.md` | The command ladder and what each gate proves |
| `docs/SMOKE_JOURNEYS.md` | User journeys that must work before calling work done |
| `docs/TEST_SETUP.md` | Test database configuration and troubleshooting |
| `ISSUES.md` | Open issues and technical debt, with file references |
| `DETAILED_PLAN.md` | The original MVP blueprint (aspirational, not status) |
| `INFRASTRUCTURE_SOLUTIONS.md` | Docker permission fixes |
