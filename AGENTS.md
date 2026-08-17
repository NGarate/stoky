# AGENTS.md

This file provides guidance to AI coding agents (including OpenCode) when working with the Stoky codebase.

## Project Overview

Stoky is a privacy-first, self-hosted household inventory management platform. It covers grocery/household inventory tracking, receipt scanning with OCR, price intelligence, and shopping list management. Primary language is Spanish (es), secondary English (en). Default currency is EUR.

**Picking this project up? Read [`docs/README.md`](docs/README.md) first.** It
indexes the thirteen planning documents, says which one owns which question, and
gives a three-document reading order. Then come back here for the commit and git
rules, which are unusual in this repository.

For the current state of the project — which gates pass, what is unverified, and what is still missing — read `docs/STATUS.md` before planning work.

## Tech Stack

- **Frontend:** Next.js 16 (App Router), TypeScript 5.x strict, Tailwind CSS 4.x + shadcn/ui, TanStack Query v5, next-intl v4.x
- **Backend:** tRPC v11 (stable, 11.18.0 — end-to-end type safety), Node.js 24 LTS, Prisma 6.x
- **Auth:** Auth.js v5 (credentials provider), Argon2id, JWT with a 15-minute `maxAge` and no refresh token — see ISSUES.md before assuming a session survives longer
- **Database:** PostgreSQL 16 (with pg_trgm for fuzzy search)
- **Cache:** Valkey 8 (Redis-compatible)
- **OCR:** Tesseract.js (server-side Worker thread), Sharp (image processing)
- **Dev Tooling:** pnpm 11.x, oxlint, Bun test runner, Playwright

## Build & Development Commands

```bash
# Setup
pnpm install
cp .env.example .env
# The dev compose file, not the default one: `docker-compose.yml` deliberately
# publishes no ports for db and cache, so `migrate` cannot reach them from the
# host. `docker-compose.dev.yml` is the file that maps 5432 and 6379.
docker compose -f docker-compose.dev.yml up -d db cache
pnpm prisma migrate dev
pnpm db:seed                # required before E2E: the suite signs in as the seeded demo user

# Development
pnpm dev                    # Start Next.js dev server (port 3000)

# Quality
pnpm lint                   # oxlint
pnpm typecheck              # tsc --noEmit
pnpm check:links            # every internal link points at a route that exists
pnpm check:contrast         # every theme token pair meets WCAG AAA

# Testing
pnpm test                   # Unit + component + integration
pnpm test:unit              # No database needed
pnpm test:components        # No database needed (preloads happy-dom)
pnpm test:integration       # Brings up its own db + cache
bunx playwright test        # E2E tests
bunx playwright test <file> # Single E2E test

pnpm verify:local           # lint + typecheck + links + contrast + unit + components
pnpm verify:ci              # the above + integration + build

# Both are held to a ten-minute budget and each step to its own ceiling. An exit
# of 124 means a step was stopped for exceeding its ceiling: it is not slow, it
# is stuck. Override the total with VERIFY_BUDGET_SECONDS if you must.

# Database
pnpm prisma migrate dev     # Create/apply migrations
pnpm prisma migrate deploy  # Production migration
pnpm prisma studio          # Visual DB browser

# Production
docker compose -f docker-compose.prod.yml up -d
```

## Architecture

**Single repo, single Next.js application. No monorepo.** tRPC requires colocation for end-to-end type inference. This is an enforced constraint for the entire MVP.

### Directory Structure

```
src/
  app/                        # Next.js App Router pages
    (auth)/                   # Login, register (public)
    (dashboard)/              # Authenticated layout (inventory, products, receipts, shopping, prices, settings)
    api/trpc/[trpc]/route.ts  # tRPC HTTP handler
  server/
    trpc/
      trpc.ts                 # tRPC init (context, middleware)
      router.ts               # Root router merging all sub-routers
      routers/                # Domain routers: auth, product, location, inventory, receipt, store, price, shopping
    services/                 # Business logic: ocr, receiptParser, productMatcher, openFoodFacts, product-cache, errors
  lib/
    validations/              # Shared Zod schemas (imported by both client and server)
    auth.ts                   # Auth.js configuration (the config is this file)
    auth/                     # Error-message mapping only
  components/
    ui/                       # shadcn/ui components (Radix + Tailwind, copied into project)
    barcode/                  # Barcode scanner
    receipt/                  # Receipt review UI
    inventory/                # Inventory-specific components
    dashboard/                # Dashboard widgets
prisma/
  schema.prisma               # Database schema (source of truth)
  migrations/                 # Committed migration files
  seed.ts                     # Demo data seeder
messages/
  es.json                     # Spanish translations (primary)
  en.json                     # English translations
```

### Key Architectural Patterns

- **Feature slices:** Code organized by domain (inventory, receipts, prices), not by technical layer
- **tRPC as API layer:** Shared types between client/server via tRPC v11 with Superjson serialization. Every procedure requires a Zod input schema
- **Zod schemas in `src/lib/validations/`:** Single source of truth for validation, shared between client and server
- **Server Components for data fetching, Client Components for interactivity** (explicit `"use client"` boundaries)
- **Server state via TanStack Query.** There is no separate client-state library: local UI state is React's. Do not reach for one without a case that React cannot serve
- **Receipt scanning pipeline:** Upload → OCR (Tesseract.js Worker) → Parser (regex) → Matcher (pg_trgm) → Review UI → Apply (creates StockEntry + PriceRecord). Uses `ReceiptStatus` enum as a state machine with strict phase progression
- **Product matching:** PostgreSQL `pg_trgm` similarity — auto-match >0.7, candidates 0.3–0.7, no match <0.3

### Database

- PostgreSQL 16 with `pg_trgm` and `uuid-ossp` extensions
- Prisma ORM for type-safe queries and migrations
- `prisma/schema.prisma` is the single source of truth; changes require coordination across all work streams
- Key entities: User, Household, Product, StockEntry, StorageLocation, Store, PriceRecord, Receipt, ReceiptItem, ShoppingList, ShoppingItem

### Docker Services (dev)

- `app`: Next.js 16 dev server with volume mounts
- `db`: PostgreSQL 16 (internal network only, no exposed ports)
- `cache`: Valkey 8 (internal network only, no exposed ports)
- Production adds Traefik v3 for TLS termination

## Commit Convention

Use **Conventional Commits** format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

**Scopes:** `auth`, `inventory`, `products`, `receipts`, `prices`, `shopping`, `household`, `ocr`, `db`, `ui`, `i18n`, `pwa`, `docker`, `ci`

Examples:
- `feat(receipts): add OCR pipeline with Tesseract.js worker`
- `fix(inventory): correct stock quantity aggregation query`
- `refactor(auth): extract JWT rotation logic to separate service`

## Git Workflow (trunk-based, master only)

`master` is the only branch. Do not create feature branches, do not open pull
requests, and do not leave work parked on a branch "just for review".

1. `master` is the only long-lived branch — and must always be deployable
2. Commit directly to `master` using the Conventional Commits format above
3. Because there is no PR gate, the validation in "Agent Instructions" below is
   the only safety net: lint, typecheck and the test suites must pass *before*
   each commit, not after a batch of them
4. Never commit something known-broken. If work must be paused mid-change,
   leave it uncommitted or stash it
5. Push when the working tree is green

### Commits must be atomic and self-contained

One commit, one change. This is not a style preference — without a PR gate, the
commit is the only reviewable unit, and `git revert` is the only undo.

A commit is atomic when all of these hold:

- **It does exactly one thing.** A dependency bump and a doc rewrite are two
  commits, even when the same task produced both. If the subject line needs
  "and", split it.
- **It stands on its own.** Checked out in isolation, it builds and its gates
  pass. Never commit a call site in one commit and the function it calls in the
  next.
- **It can be reverted alone** without taking unrelated work with it.
- **Its message explains why, not what.** The diff already says what changed.
  Record the reasoning, the evidence it was verified, and anything surprising a
  future reader would otherwise have to rediscover.

Practical consequence: stage deliberately with `git add <path>`, never
`git add -A` when the working tree holds more than one change. If several
changes are already mixed in the tree, split them before committing rather than
bundling them and apologising in the message.

## Security Constraints

- All tRPC procedures must have Zod input validation
- Receipt image uploads: validate MIME type + magic bytes, re-encode with Sharp (strips EXIF), store with UUID filenames in isolated Docker volume, serve only through authenticated tRPC queries
- Passwords: Argon2id (64MB memory, 3 iterations, ~250ms)
- Rate limiting: 5 login attempts/15min per IP, 3 registrations/hour per IP
- Docker: only Traefik exposes ports 80/443; PostgreSQL and Valkey have no exposed ports
- Never use raw SQL without parameterized queries (tagged template literals)

## CI Pipeline (GitHub Actions)

Seven jobs. `quality`, `test`, `e2e` and `audit` run in parallel, each capped
at ten minutes — the budget is for all verification, not just the browser
suite.

- **quality**: `bash scripts/check-ci.sh` first (actionlint + shellcheck over
  the pipeline itself), then `lint`, `typecheck`, `check:react`,
  `check:contrast`, `check:links`
- **test**: `test:unit`, `test:components`, `test:integration:only` (the `:only`
  variant, because the runner supplies its own service containers)
- **e2e**: Playwright inside the pinned `mcr.microsoft.com/playwright`
  container — four browser projects (chromium runs everything; Mobile Safari
  the two layout specs; firefox and webkit a four-test `@smoke` set) plus
  `seed` and `setup` projects. The suite builds and serves the standalone
  production artefact and migrates/seeds its own database; the workflow only
  installs and hands it service URLs
- **audit**: `pnpm audit --audit-level moderate`
- **changes**: decides in ~5s whether the push could have altered the image; a
  docs-only push skips the two image jobs, never the tests
- **image-build** (no `needs` — runs beside the tests): Docker build and Trivy
  scan; holds no push rights, so a failing run can waste a build but cannot
  ship one
- **image-publish** (needs the four test jobs, the build and `changes`):
  rebuilds from the warm layer cache and pushes, with SBOM and provenance
  attestation where GitHub offers them

## Coding Guidelines

### General

- Prefer TypeScript strict mode features
- Use explicit type annotations for function parameters and return types
- Avoid `any` types; use `unknown` with proper type guards when necessary
- Write self-documenting code; comments should explain "why", not "what"

### Import Order

1. React/Next.js imports
2. Third-party libraries
3. Absolute imports from project (`@/...`)
4. Relative imports
5. Type-only imports (`import type`)

### Naming Conventions

- Components: PascalCase (e.g., `ReceiptScanner.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useInventory.ts`)
- Utilities: camelCase (e.g., `formatCurrency.ts`)
- Constants: SCREAMING_SNAKE_CASE for true constants
- Database models: PascalCase (e.g., `StockEntry`)
- tRPC routers: camelCase with domain suffix (e.g., `inventoryRouter`)

### Error Handling

- Use custom error classes extending `Error`
- All async operations must handle errors explicitly
- Never expose internal error details to the client
- Log errors with sufficient context for debugging

### Testing

- Unit tests for utilities and services
- Integration tests for tRPC procedures
- E2E tests for critical user flows
- Mock external dependencies (OCR, external APIs)

## Agent Instructions

When working with this codebase:

1. **Always run lint and typecheck** after making changes
2. **Check existing patterns** in similar files before implementing new features
3. **Follow the domain-driven structure** — add code to the appropriate domain folder
4. **Update migrations** when changing the Prisma schema
5. **Add tests** for new functionality
6. **Verify Docker services are running** before testing database-dependent features
7. **Use Spanish (es)** for user-facing strings in i18n files
8. **Never commit secrets** — use `.env.example` for documentation
9. **Maintain backward compatibility** — especially for database migrations
10. **Commit all changes** directly to `master`, following the Git Workflow section above. Every commit is atomic and self-contained: one change, passing its gates on its own, revertable alone. No feature branches, no pull requests
11. **Test all changes** — every new component, piece of logic, or modification must include appropriate tests (unit, integration, or E2E) following the Testing section standards. **A test must be able to fail** — an assertion that holds regardless of the implementation (`expect(true).toBe(true)`, or a locally-declared boolean) is not a test. If unsure, break the code deliberately and confirm the test goes red
12. **Validate before committing** — never commit without: (a) running the full test suite (`pnpm verify:ci` and, for UI-affecting work, `bunx playwright test`), (b) verifying lint and typecheck pass, (c) manually testing the feature works correctly, and (d) assessing that no visual regressions, bugs, security threats, or degradation of project standards have been introduced

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
