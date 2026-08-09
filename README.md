# Stoky

Privacy-first, self-hosted household inventory management.

Stoky tracks what is in your kitchen, learns prices from your shopping receipts,
and turns low stock into a shopping list. Everything runs on your own hardware —
there is no external service holding your data.

**Primary language:** Spanish (`es`), with English (`en`) as secondary.
**Default currency:** EUR.

> **Status:** MVP in development. The backend, auth, schema and routing are in
> place; the shared UI component library is not. See
> [`docs/STATUS.md`](docs/STATUS.md) for an honest, command-verified breakdown
> of what works and what does not.

---

## Features

| Area | What it does |
|---|---|
| **Inventory** | Stock levels per product, hierarchical storage locations, expiry tracking, low-stock detection |
| **Receipts** | Upload a photo → OCR (Tesseract.js) → parse → fuzzy-match against your catalogue → review → apply to stock and price history |
| **Prices** | Price history per product and per store, comparisons and trends |
| **Shopping** | Manual lists plus auto-generated lists built from everything below its minimum stock |
| **Products** | Catalogue with barcode scanning and Open Food Facts enrichment |

---

## Tech stack

Next.js 16 (App Router) · TypeScript 5 strict · tRPC 11 · Prisma 6 ·
PostgreSQL 16 (`pg_trgm`) · Valkey 8 · Auth.js v5 (Argon2id) ·
Tailwind CSS 4 · TanStack Query v5 · Zustand v5 · next-intl v4 ·
Tesseract.js · Sharp

Tooling: pnpm 10, oxlint, Bun test runner, Playwright, Docker Compose.

**Single repository, single Next.js application — not a monorepo.** tRPC needs
client and server colocated for end-to-end type inference. This is an enforced
constraint for the MVP.

---

## Getting started

### Prerequisites

- **Docker**, with a daemon your user can actually reach. Verify with
  `docker ps`. If that says *permission denied*, run
  `sudo usermod -aG docker $USER && newgrp docker` — see
  [`docs/LOCAL_BOOTSTRAP.md`](docs/LOCAL_BOOTSTRAP.md).
- **Node.js 24 LTS**
- **pnpm**, or `corepack` (every command below works with `corepack pnpm`)
- **Bun**, for the test suites

### Setup

```bash
corepack pnpm install
cp .env.example .env                                  # then set NEXTAUTH_SECRET
docker compose -f docker-compose.dev.yml up -d db cache
corepack pnpm prisma generate
corepack pnpm prisma migrate dev
corepack pnpm dev
```

Generate a secret for `.env` with `openssl rand -base64 32`.

Or let the helper script do all of it:

```bash
bash scripts/dev-local.sh            # add --seed to load demo data
```

The app runs at <http://localhost:3000>.

### Demo data

```bash
corepack pnpm db:seed
```

Creates the household *Hogar Demo* with six products (three deliberately below
minimum stock), storage locations, three stores and price history.

Log in as **`demo@stoky.local`** / **`Demo1234!`**.

Re-running the seed is safe — it clears the demo household first.

---

## Commands

### Development

```bash
corepack pnpm dev                  # dev server on :3000
corepack pnpm dev:services         # start db + cache
corepack pnpm dev:services:down    # stop them
corepack pnpm prisma studio        # visual database browser
```

### Verification

Run these in order of cost — see
[`docs/VERIFICATION_SEQUENCE.md`](docs/VERIFICATION_SEQUENCE.md) for what each
gate proves.

```bash
corepack pnpm verify:local         # lint + typecheck + unit + component tests
corepack pnpm verify:ci            # the above + integration tests + build
bunx playwright test e2e/critical-paths.spec.ts
```

Individually:

```bash
corepack pnpm lint                 # oxlint
corepack pnpm typecheck            # tsc --noEmit
corepack pnpm test:unit            # no database needed
corepack pnpm test:components      # no database needed
corepack pnpm test:integration     # brings up its own db + cache
```

`test:components` must run through the pnpm script — it preloads the happy-dom
environment. `bun test src/__tests__/components` on its own will fail.

### Database

```bash
corepack pnpm prisma migrate dev     # create + apply a migration
corepack pnpm prisma migrate deploy  # apply in production
corepack pnpm db:seed                # demo data
```

`prisma/schema.prisma` is the single source of truth. Never edit a migration
that has already been committed.

---

## Project layout

```
src/
  app/
    (auth)/                   login, register
    (dashboard)/              inventory, products, receipts, shopping, prices, settings
    api/trpc/[trpc]/          tRPC HTTP handler
  server/
    trpc/routers/             one router per domain
    services/                 ocr, receiptParser, productMatcher, openFoodFacts
  lib/
    validations/              Zod schemas shared by client and server
    auth/                     Auth.js configuration
  components/
    ui/                       shadcn/ui primitives
    <domain>/                 inventory, receipt, price, shopping, barcode, ...
  __tests__/                  unit, components, integration
prisma/                       schema, migrations, seed
messages/                     es.json (primary), en.json
e2e/                          Playwright specs
docs/                         status, bootstrap, verification, journeys, test setup
```

Code is organised by **domain**, not by technical layer.

### Key patterns

- **tRPC as the API layer.** Every procedure takes a Zod input schema. Types
  flow to the client automatically; Superjson handles serialisation.
- **Zod schemas live in `src/lib/validations/`** and are imported by both sides.
- **Server Components fetch, Client Components interact** — explicit
  `"use client"` boundaries.
- **TanStack Query for server state, Zustand for client-only UI state.**
- **Receipt pipeline:** upload → OCR → parse → match → review → apply.
  `ReceiptStatus` is a state machine with strict phase progression.
- **Product matching** uses PostgreSQL `pg_trgm`: auto-match above 0.7,
  candidates 0.3–0.7, no match below 0.3.

---

## Security

- Passwords hashed with Argon2id (64 MB, 3 iterations).
- Receipt uploads are validated by MIME type and magic bytes, re-encoded with
  Sharp to strip EXIF, stored under UUID filenames in an isolated volume, and
  served only through authenticated tRPC queries.
- Only Traefik exposes ports in production; PostgreSQL and Valkey have none.
- Raw SQL only through parameterised tagged template literals.

**Not yet implemented:** rate limiting on login and register. Do not expose a
Stoky instance to the public internet until `ISSUES.md` CRITICAL-4 is closed.

---

## Contributing

Trunk-based: work directly on `master`, in small focused commits. No feature
branches, no pull requests. Since there is no PR gate, `master` must be green
at every commit — run the checks before committing, not after.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(receipts): add OCR pipeline with Tesseract.js worker
fix(inventory): correct stock quantity aggregation query
```

Scopes: `auth`, `inventory`, `products`, `receipts`, `prices`, `shopping`,
`household`, `ocr`, `db`, `ui`, `i18n`, `pwa`, `docker`, `ci`.

Before every commit: `corepack pnpm verify:ci` must pass, new behaviour needs
tests, and user-facing strings go in `messages/es.json` first.

**Tests must be able to fail.** An assertion that holds regardless of the code
is not a test — this repository has been burned by that before, see the note in
[`docs/STATUS.md`](docs/STATUS.md).

---

## Documentation

| Document | Purpose |
|---|---|
| [`docs/STATUS.md`](docs/STATUS.md) | Where the project actually is, with gate results |
| [`docs/LOCAL_BOOTSTRAP.md`](docs/LOCAL_BOOTSTRAP.md) | Clone → running app, and what to record if it breaks |
| [`docs/VERIFICATION_SEQUENCE.md`](docs/VERIFICATION_SEQUENCE.md) | The command ladder |
| [`docs/SMOKE_JOURNEYS.md`](docs/SMOKE_JOURNEYS.md) | Journeys that must work before work is called done |
| [`docs/TEST_SETUP.md`](docs/TEST_SETUP.md) | Test database configuration and troubleshooting |
| [`ISSUES.md`](ISSUES.md) | Open issues and technical debt |
| [`DETAILED_PLAN.md`](DETAILED_PLAN.md) | The original MVP blueprint |
| [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) | Instructions for AI agents working in this repo |

---

## Deployment

```bash
docker compose -f docker-compose.prod.yml up -d
```

Adds Traefik v3 for TLS termination. Set `DOMAIN`, `ACME_EMAIL`,
`POSTGRES_PASSWORD` and a real `NEXTAUTH_SECRET` in `.env` first.

## Licence

ISC
