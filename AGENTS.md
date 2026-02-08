# AGENTS.md

This file provides guidance to AI coding agents (including OpenCode) when working with the Stoky codebase.

## Project Overview

Stoky is a privacy-first, self-hosted household inventory management platform. It covers grocery/household inventory tracking, receipt scanning with OCR, price intelligence, and shopping list management. Primary language is Spanish (es), secondary English (en). Default currency is EUR.

## Tech Stack

- **Frontend:** Next.js 16 (App Router), TypeScript 5.x strict, Tailwind CSS 4.x + shadcn/ui, TanStack Query v5, Zustand v5, next-intl v4.x
- **Backend:** tRPC v11 (end-to-end type safety), Node.js 24 LTS, Prisma 7.x
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
bun test                    # Unit + integration tests
bun test <path>             # Run single test file
bunx playwright test        # E2E tests
bunx playwright test <file> # Single E2E test

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

## Git Workflow (GitHub Flow)

1. `master` is the main branch — always deployable
2. Create feature branches from `master`: `feat/<scope>-<description>`, `fix/<scope>-<description>`
3. Make small, focused commits following conventional commit format
4. Open a pull request to `master` when ready
5. Merge after CI passes (lint, typecheck, test, build)
6. Delete branch after merge

## Security Constraints

- All tRPC procedures must have Zod input validation
- Receipt image uploads: validate MIME type + magic bytes, re-encode with Sharp (strips EXIF), store with UUID filenames in isolated Docker volume, serve only through authenticated tRPC queries
- Passwords: Argon2id (64MB memory, 3 iterations, ~250ms)
- Rate limiting: 5 login attempts/15min per IP, 3 registrations/hour per IP
- Docker: only Traefik exposes ports 80/443; PostgreSQL and Valkey have no exposed ports
- Never use raw SQL without parameterized queries (tagged template literals)

## CI Pipeline (GitHub Actions)

- **quality** (parallel): `pnpm lint` + `pnpm typecheck`
- **test** (parallel): PostgreSQL service container + `bun test`
- **build** (depends on quality + test): Docker multi-stage build

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
