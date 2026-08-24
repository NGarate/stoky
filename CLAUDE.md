# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **Dev Tooling:** pnpm 11.x, oxlint, `react-doctor`, Bun test runner, Playwright, React Compiler (`reactCompiler: true`)

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
pnpm db:seed                # demo data. The E2E suite now seeds itself first, so this is for `pnpm dev`

# Development
pnpm dev                    # Start Next.js dev server (port 3000)

# Or in the image, which is where development is moving. The `development`
# target is the production base — `node:24-alpine`, because Next's standalone
# output is started with `node server.js` — plus Bun for the test runner and
# git for the three tests that ask the repository about itself.
docker compose up -d app    # the dev server, on the compose network
docker compose exec app corepack pnpm test:unit
docker compose exec app corepack pnpm test:components

# Bun is pinned in the Dockerfile and that pin is the version of record. A
# host with a different one is exactly the gap this closes: the answer a suite
# gives should not depend on whose machine asked it.

# Quality
pnpm lint                   # oxlint
pnpm typecheck              # tsc --noEmit
pnpm check:react            # react-doctor — fails on errors (not on the score)
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
    ui/                       # The design system: ItemRow, Badge, Button, Input, BackLink (see Design System below)
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
- **Server state via TanStack Query. Client state that React cannot hold lives in a `zustand` store.** Local UI state is still React's, and server data is still TanStack Query's — a store is neither of those and must not become either. The one taken so far is Phase 4's offline write queue, which is read from everywhere, written from outside React (the `online` event, a backoff timer, another tab) and outlives the components that read it. `REDESIGN_PLAN.md` §5.7 states the case and the scope; a second store is a decision, not a convenience
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

## Design System

**Before building anything that renders, look in `src/components/ui/`.** This
section exists because nine screens grew nine ways of drawing the same list
row, seven pills were written separately in four sizes, and 177 hardcoded
`min-h-[48px]` declarations restated a floor the primitives already guarantee
(`docs/DESIGN_AUDIT.md` A5.3). A new component that duplicates one of these is
a regression, not a new feature.

### The list row

Every list of things uses `<ItemRow>` (`src/components/ui/item-row.tsx`). Its
grammar is fixed: a **title** that links to the thing, a **status** badge
opposite it, the details as a two-column **meta** definition list, and
**actions** last.

| Density | Used by | Why |
|---|---|---|
| `compact` | dense desktop lists | fits more on a screen read at a desk |
| `default` | inventory, products, prices, receipts, settings | the reference — this is the row the owner picked |
| `touch` | `/kitchen`, `/shopping` | Screen A is used with a trolley in one hand and Screen B is read from a metre away (`REDESIGN_PLAN.md` §3) |

Two rules the component enforces, and callers must not work around:

- **The title links; the row does not.** A row that is entirely a link
  announces its whole contents as its accessible name and leaves nowhere to
  put an action.
- **`tone` is never the only carrier.** A tinted row always has the badge that
  says the same thing in words (`REDESIGN_PLAN.md` §8).

A screen that needs a different arrangement needs a conversation, not a fourth
hand-written `<li>`.

### Badges

`<Badge tone=… variant=…>` (`src/components/ui/badge.tsx`) is the only pill.
`ok` / `warn` / `danger` are **reserved for state** and mean healthy,
needs-attention and wrong; anything that is not a state (`auto-generated`,
`best price`) takes `neutral`. Each tone carries the foreground
`scripts/check-contrast.ts` measured for it, so a badge cannot invent an
unaudited colour pair. `variant="outline"` is for a badge sitting on a row
already tinted with its own tone.

Stock state has one answer, in `src/components/inventory/StockStatus.tsx`.
Do not re-derive it: four screens each deriving it is how one product came to
wear two different words (ISSUES UI-11).

### Buttons and links

- **Anything that *does* something is a `<Button>`** — `src/components/ui/button.tsx`,
  colour chosen by the kind of action: `default` to commit, `destructive` to
  destroy, `outline`/`secondary` to step aside, `ghost` for a row action.
  Never a bare `<button>` with hand-written classes, and never a `<Link>`.
- **Anything that *goes* somewhere is a link.** The way back out of a sub-page
  is `<BackLink>` (`src/components/ui/back-link.tsx`), which carries the arrow
  as an `aria-hidden` icon. Never put an arrow in a message string: it is a
  layout decision in a translation file and the screen reader pronounces it.

### Sizes and tokens

- **Never write `min-h-[48px]` outside `src/components/ui/`.** Every primitive
  clears the 48px floor already (PROGRESS D17, above the AAA 44).
  Restating it means changing the floor leaves the restatements behind, which
  is exactly the `h-10` defect `src/__tests__/components/target-size.test.tsx`
  exists to prevent.
- **Colour comes from `src/app/globals.css` and nowhere else.** A new token
  goes in the light block, *both* dark blocks, and `@theme inline` — and needs
  a row in the `PAIRS` list of `scripts/check-contrast.ts`. That list is
  hand-written, so a token added without one is a token nothing audits and
  nothing goes red to say so.

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

## Agent Instructions

When working with this codebase:

1. **Always run lint, typecheck and `pnpm check:react`** after making changes
2. **Check `src/components/ui/` first**, then existing patterns in similar files. Anything that renders a list row, a state pill, an action or a way back already exists — see the Design System section. Writing a second one is a regression
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
