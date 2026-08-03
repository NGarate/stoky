# Stoky Project Status

Updated: 2026-08-03

Single source of truth for where the project actually is. Replaces
`PROJECT_ASSESSMENT.md`, `DEVELOPMENT_ROADMAP.md`, `COMPONENT_AUDIT.md`,
`COMPONENT_TESTING_SUMMARY.md`, `TESTING_SUMMARY.md` and `TEST_SUMMARY.md`,
which contradicted each other and overstated completion.

Rule for this file: **every claim must be reproducible by running a command.**
If a gate could not be run, say so and say why.

---

## Gate status

Measured on 2026-08-03.

| Gate | Command | Result |
|---|---|---|
| Lint | `corepack pnpm lint` | ✅ 0 warnings, 0 errors |
| Typecheck | `corepack pnpm typecheck` | ✅ clean |
| Unit tests | `corepack pnpm test:unit` | ✅ 72 pass / 8 files |
| Component tests | `corepack pnpm test:components` | ✅ 94 pass / 10 files |
| Build | `corepack pnpm build` | ✅ 16 routes, all server-rendered on demand |
| Integration tests | `corepack pnpm test:integration` | ⛔ **not run** — Docker daemon unreachable |
| E2E | `bunx playwright test` | ⛔ **not run** — needs app + database |

### Why two gates are blocked

`docker ps` fails with *permission denied on `/var/run/docker.sock`*. Nothing
that needs PostgreSQL or Valkey can run locally until that is fixed:

```bash
sudo usermod -aG docker $USER && newgrp docker
```

This is the single highest-value unblock in the repo — it gates the integration
suite, the E2E suite, the seed, and local bootstrap. See
`INFRASTRUCTURE_SOLUTIONS.md` for alternatives.

Note that `corepack pnpm verify:ci` will fail at its integration step for this
reason, even though lint, typecheck, both fast suites and the build all pass
individually.

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

**Seed — written, unverified.** `prisma/seed.ts` creates a demo household,
6 products (3 deliberately below minimum stock), 4 storage locations, 3 stores,
price history and a shopping list. It compiles and fails only on database
connectivity; it has **never been run against a live database**. Login is
`demo@stoky.local` / `Demo1234!`.

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
real Prisma — but is unverified here because it needs Docker.

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

1. **Unblock Docker** (needs sudo). Everything below depends on it.
2. Run `corepack pnpm verify:ci` and record the real integration result in this
   file. Lint, typecheck, both fast suites and the build already pass; the
   integration step is the only unknown.
3. Run the seed against a live database and confirm the smoke journeys in
   `docs/SMOKE_JOURNEYS.md` render.
4. Implement rate limiting on login/register — the last critical security gap.
5. Standardise `TRPCError` across the seven routers still throwing bare errors.
6. Start Phase 2: install the shadcn primitives listed above, then refactor the
   domain components onto them.

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
