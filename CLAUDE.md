# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stoky is a privacy-first, self-hosted household inventory management platform. It covers grocery/household inventory tracking, receipt scanning with OCR, price intelligence, and shopping list management. Primary language is Spanish (es), secondary English (en). Default currency is EUR.

For the current state of the project — which gates pass, what is unverified, and what is still missing — read `docs/STATUS.md` before planning work.

## Tech Stack

- **Frontend:** Next.js 16 (App Router), TypeScript 5.x strict, Tailwind CSS 4.x + shadcn/ui, TanStack Query v5, Zustand v5, next-intl v4.x
- **Backend:** tRPC v11 (currently the `11.0.0-rc.802` release candidate, end-to-end type safety), Node.js 24 LTS, Prisma 6.x
- **Auth:** Auth.js v5 (credentials provider), Argon2id, JWT (15min access + 7d refresh)
- **Database:** PostgreSQL 16 (with pg_trgm for fuzzy search)
- **Cache:** Valkey 8 (Redis-compatible)
- **OCR:** Tesseract.js (server-side Worker thread), Sharp (image processing)
- **Dev Tooling:** pnpm 10.x, oxlint, Bun test runner, Playwright, dprint/biome

## Build & Development Commands

```bash
# Setup
pnpm install
cp .env.example .env
docker compose up -d db cache
pnpm prisma migrate dev
pnpm prisma db seed

# Development
pnpm dev                    # Start Next.js dev server (port 3000)

# Quality
pnpm lint                   # oxlint
pnpm typecheck              # tsc --noEmit

# Testing
pnpm test                   # Unit + component + integration
pnpm test:unit              # No database needed
pnpm test:components        # No database needed (preloads happy-dom)
pnpm test:integration       # Brings up its own db + cache
bunx playwright test        # E2E tests
bunx playwright test <file> # Single E2E test

pnpm verify:local           # lint + typecheck + unit + components
pnpm verify:ci              # the above + integration + build

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
      routers/                # Domain routers: auth, product, inventory, receipt, store, price, shopping, household
    services/                 # Business logic: ocr, receiptParser, productMatcher, openFoodFacts
  lib/
    validations/              # Shared Zod schemas (imported by both client and server)
    auth/                     # Auth.js configuration
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
- **State bifurcation:** TanStack Query for server state, Zustand for client-only UI state
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

- **quality** (parallel): `pnpm lint` + `pnpm typecheck`
- **test** (parallel): `pnpm test:unit && pnpm test:components && pnpm test:integration`
- **build** (depends on quality + test): Docker multi-stage build

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
