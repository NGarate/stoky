# Stoky

Privacy-first, self-hosted household inventory management.

Stoky tracks what is in your kitchen, learns prices from your shopping receipts,
and turns low stock into a shopping list. Everything runs on your own hardware —
there is no external service holding your data.

**Primary language:** Spanish (`es`), with English (`en`) as secondary.
**Default currency:** EUR.

> **Status:** MVP feature-complete against its plan, unreviewed for public
> exposure. Both entry screens exist — `/shopping` for the phone, `/kitchen`
> for the tablet — a whole shop works in aeroplane mode and applies exactly
> once on reconnect, receipts scan air-gapped, and the product rating explains
> itself or honestly declines to exist. The design system is 26 theme tokens
> in CSS, light and dark, with a WCAG AAA floor enforced by the suites.
> What remains: the Phase 7 security review document, and the human passes no
> suite can answer. See [`docs/STATUS.md`](docs/STATUS.md) for the
> command-verified breakdown of what works and what does not.

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
Tailwind CSS 4 · TanStack Query v5 · next-intl v4 ·
Tesseract.js · Sharp

Tooling: Bun 1.4 (package manager and test runner), oxlint, Playwright,
Docker Compose.

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
- **Bun**, at the version in `.bun-version` — it installs the dependencies,
  runs the app and runs the test suites. An older one cannot read `bun.lock`

### Setup

```bash
bun install
cp .env.example .env                                  # then set NEXTAUTH_SECRET
docker compose -f docker-compose.dev.yml up -d db cache
bunx prisma generate
bunx prisma migrate dev
bun run dev
```

Generate a secret for `.env` with `openssl rand -base64 32`.

Or let the helper script do all of it:

```bash
bash scripts/dev-local.sh            # add --seed to load demo data
```

The app runs at <http://localhost:3000>.

### Demo data

```bash
bun run db:seed
```

Creates the household *Hogar Demo* with six products (three deliberately below
minimum stock), storage locations two levels deep, three stores, price history,
a shopping list, and **two receipts** — one needing review, one confirmed.

The receipts matter more than they look: without them `/receipts/[id]/review`
and `/receipts/[id]/applied` cannot be reached through the interface at all, so
nothing tested them. That is how a page 505px wide survived on a 390px phone
through three responsive sweeps.

**The E2E suite needs this seed.** It signs in once as the demo user, so an
unseeded database fails the whole matrix at its first step.

Log in as **`demo@stoky.local`** / **`Demo1234!`**.

Re-running the seed is safe — it clears the demo household first.

---

## Commands

### Development

```bash
bun run dev                  # dev server on :3000
bun run dev:services         # start db + cache
bun run dev:services:down    # stop them
bunx prisma studio           # visual database browser
```

### Verification

Run these in order of cost — see
[`docs/VERIFICATION_SEQUENCE.md`](docs/VERIFICATION_SEQUENCE.md) for what each
gate proves.

```bash
bun run verify:local         # lint + typecheck + unit + component tests
bun run verify:ci            # the above + integration tests + build
bunx playwright test e2e/critical-paths.spec.ts
```

Individually:

```bash
bun run lint                 # oxlint
bun run typecheck            # tsc --noEmit
bun run test:unit            # no database needed
bun run test:components      # no database needed
bun run test:integration     # brings up its own db + cache
```

`test:components` must run through `bun run test:components` — the script
preloads the happy-dom environment. `bun test src/__tests__/components` on its
own will fail.

### Database

```bash
bunx prisma migrate dev        # create + apply a migration
bunx prisma migrate deploy     # apply in production
bun run db:seed                # demo data
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
    auth.ts                   Auth.js configuration (the config is this file)
    auth/                     Error-message mapping only
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
- **TanStack Query for server state.** Local UI state is React's; there is no separate client-state library.
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

**Rate limiting** is in place and layered — 5 sign-ins per 15 minutes and 3
registrations per hour per IP, 10 sign-in attempts per account on a hashed
key, and 30 receipt uploads per account per hour, counted in Valkey before the
file is decoded. It fails closed, so signing in needs the cache to be
reachable. Passwords follow NIST SP 800-63B: twelve characters minimum, no
composition rules, common-password and identity checks, a maximum so Argon2id
never takes unbounded input.

**Still not published-ready:** Phase 7's security review has not been written,
and that is the gate — nothing ships to a public address until it passes.
Prefer a LAN or a VPN. See `SECURITY.md` for what is and is not covered.

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

Before every commit: `bun run verify:ci` must pass, new behaviour needs
tests, and user-facing strings go in `messages/es.json` first.

**Tests must be able to fail.** An assertion that holds regardless of the code
is not a test — this repository has been burned by that before, see the note in
[`docs/STATUS.md`](docs/STATUS.md).

---

## Documentation

**[`docs/README.md`](docs/README.md) indexes all thirteen documents** — what each
contains, when to read it, when to write to it, and which one owns which
question. Start there; the table below is the short version.

| Document | Purpose |
|---|---|
| [`docs/README.md`](docs/README.md) | **Index. Start here** — reading order and document ownership |
| [`docs/STATUS.md`](docs/STATUS.md) | Where the project actually is, with gate results |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | What is done, and the 26 decisions taken without asking |
| [`docs/REDESIGN_PLAN.md`](docs/REDESIGN_PLAN.md) | What is being built, in what order, and what done means |
| [`docs/DESIGN_AUDIT.md`](docs/DESIGN_AUDIT.md) | The interface and WCAG AAA audit, with numbered actions |
| [`SECURITY.md`](SECURITY.md) | Threat model and hardening for a self-hosted deployment |
| [`docs/LOCAL_BOOTSTRAP.md`](docs/LOCAL_BOOTSTRAP.md) | Clone → running app, and what to record if it breaks |
| [`docs/VERIFICATION_SEQUENCE.md`](docs/VERIFICATION_SEQUENCE.md) | The command ladder |
| [`docs/SMOKE_JOURNEYS.md`](docs/SMOKE_JOURNEYS.md) | Journeys that must work before work is called done |
| [`docs/TEST_SETUP.md`](docs/TEST_SETUP.md) | Test database configuration and troubleshooting |
| [`ISSUES.md`](ISSUES.md) | Open issues and technical debt |
| [`CLAUDE.md`](CLAUDE.md) | Instructions for AI agents working in this repo. `AGENTS.md` is a symlink to it, so the two cannot drift |

---

## Deployment

```bash
docker compose -f docker-compose.prod.yml up -d
```

Adds Traefik v3 for TLS termination. Set `DOMAIN`, `ACME_EMAIL`,
`POSTGRES_PASSWORD` and a real `NEXTAUTH_SECRET` in `.env` first.

## Licence

ISC
