# Stoky - Issues & Technical Debt

## Overview

This document tracks open issues and technical debt. It started as the Phase 0
(Foundation) code review and is kept current as items are fixed.

**Last Updated:** 2026-10-12

**Status:** after Phase 7's slice of the backlog, the browser suite's move
to isolated data and the production artefact, and the owner's first pass
(2026-08-18), which filed two new entries. Everything older is closed —
the four criticals, SEC-1, all of INV, I18N, A11Y and DEBT, and UI through
UI-9.

**Open: TEST-5, RUNTIME-1, LOC-2, OFFLINE-1, SHOP-2, DB-1, UPLOAD-1 and TEST-9.** TEST-7 closed on 2026-09-12 by removing
two process-wide ProductRating mocks from unrelated component tests.
TEST-5 is the intermittent bun
failure in the suite that guards the offline queue — upstream, diagnosed,
reproduction in `docs/reproductions/`, and bun 1.4.0 was measured on 2026-08-25
and does not fix it. On 2026-10-12, when the pin moved to 1.4.3, the
reproduction failed **0 times in 80 on each of 1.4.0 and 1.4.3** under the
documented load, so it no longer separates the two and neither can be said to
fix it; the entry has the runs. TEST-6 closed on 2026-08-27: running its eight tests at a phone viewport
failed four, all four on locators rather than on anything the product does, and
they pass 8 of 8 now. RUNTIME-1 is the unhandled
rejections Bun raises and Node does not, which cost the logs this project uses
instead of error tracking. It turned out to be **two** causes filed as one: the
prerender chain through `auth()` is fixed (`d0e7566`, which also corrects the
entry's conclusion that it was not ours to fix), and the `AbortError` family —
the larger number — is reproduced and localised but not fixed: one per completed
router prefetch under Bun, none under Node on the identical artefact, and a
one-line `curl -sL` reproduces it. `partialPrefetching` is what exposes it and
stays on by the owner's decision. That line stopped reproducing with Next 16.4.0
(`d258c6e`), on Bun 1.4.0 and 1.4.3 alike — measured 2026-10-12, recorded in
the entry, which stays open until what 16.4.0 changed is understood.

**BUILD-1 closed on 2026-08-26** (`e2a6a8e`), in the direction its own entry
advised against: `.bun-version` went forward to 1.4.0 on the owner's
instruction, and a test now compares it with the Dockerfile. The entry keeps
the argument it made, because the concern that motivated it — TEST-5's rate
under 1.4.0 — is untouched by the move. PRICE-1 came out of the
owner's first pass on 2026-08-18; UI-10 and PRICE-1, filed the same day,
closed the same day (`d7c178d`, `4bbb82d`). UI-11, found verifying the third
unit in the browser, closed with the design-system extraction that gave it
one place to be fixed.

PROD-1 and SHOP-1 were found while writing DOCS-1's docblocks, which is the
argument for having written them, and are closed.

The 2026-10-12 security review fixed what it could on its branch and filed
the rest: LOC-2 and OFFLINE-1 alongside the fixes that found them, then
SHOP-2, DB-1 and UPLOAD-1 — a race that is a defect rather than a weakness,
and two gaps whose fixes need a schema change it did not take — and, from the
final review of its branch, TEST-9, a test gap in the member password reset.

The individual entries below are authoritative; this line is a summary and has
twice been the last thing updated. If it disagrees with an entry, the entry is
right.

Phase 4 also filed nothing new that it did not also close, except INV-2 — which
it then closed by half.

For overall project state and gate results, see `docs/STATUS.md`.

### Summary

| ID | Title | Status |
|---|---|---|
| CRITICAL-1 | `deleted_at` in product search | ✅ Resolved 2026-08-03 |
| CRITICAL-2 | Auth pages were placeholders | ✅ Resolved (commit `7f393ac`) |
| CRITICAL-3 | Missing database migrations | ✅ Resolved (`20260213234844`) |
| CRITICAL-4 | No rate limiting on auth | ✅ Resolved (Phase 3) |
| DEBT-1 | Minimal password validation | ✅ Resolved (Phase 7 slice) |
| DEBT-2 | Barcode scanner torch is inert | ✅ Resolved (Phase 4) |
| DEBT-3 | OpenFoodFacts in-memory cache | ✅ Resolved (Phase 7 slice) |
| DEBT-4 | Bare `Error` instead of `TRPCError` | ✅ Resolved (Phase 3) |
| DEBT-6 | The services layer still throws bare `Error` | ✅ Resolved (Phase 7 slice) |
| DEBT-5 | Missing database indexes | ✅ Resolved (Phase 7 slice) |
| TEST-1 | Integration tests need a database | ✅ Resolved (Phase 7 slice) |
| TEST-2 | Mock external API calls | ✅ Resolved |
| DOCS-1 | No API documentation | ✅ Resolved (Phase 7 slice) |
| DOCS-2 | No environment setup instructions | ✅ Resolved |
| UI-1 | Four linked routes do not exist (404) | ✅ Resolved (Phase 1) |
| OCR-1 | OCR downloads language data at runtime in production | ✅ Resolved (Phase 7 slice) |
| INV-1 | Expiring items report entry quantity, not net stock | ✅ Resolved (Phase 4) |
| INV-2 | The availability guards are read-then-write, no transaction | ✅ Resolved |
| INV-3 | Recounts display old batch amounts and infer stock details | ✅ Fixed in code — 2026-09-12 |
| SEC-1 | `addStock` wrote a price record against any household's store | ✅ Resolved (Phase 4) |
| UI-2 | LocationPicker never renders child locations | ✅ Resolved (`a6b01c2`) |
| UI-3 | Assorted validation and a11y gaps found building the add-stock route | ✅ Resolved (Phase 7 slice) |
| PROD-1 | Deleting a used product fails, and says something else | ✅ Resolved (Phase 7 slice) |
| SHOP-1 | A shopping item with no name at all is accepted | ✅ Resolved (Phase 7 slice), superseded 2026-08-22 |
| OCR-2 | Receipt scanning does not work in the production image | ✅ Resolved |
| AUTH-1 | An inert adapter picks a session strategy the schema cannot serve | ✅ Resolved `3e973ff` — the adapter is gone, so the default is right |
| TEST-5 | bun abandons a test body at a rejecting `await` | 🟡 Open upstream — reproduction in `docs/reproductions/` |
| TEST-6 | Two inert mobile skips cite a phase that closed | ✅ Resolved `bcd1e74` — 8 of 8 pass on a phone once the locators were fixed |
| TEST-7 | ProductRating tests fail in the component suite but pass alone | ✅ Resolved — removed process-wide mocks from product-detail tests |
| TEST-8 | `resolveScan` key-reuse test fails about one full run in four | ✅ Resolved `395570d` — an unawaited refusal in `withReplay` was an unhandled rejection |
| BUILD-1 | The image and CI pin different bun versions, and nothing compares them | ✅ Resolved `e2a6a8e` — direction chosen by the owner, against this entry's recommendation; see the entry |
| BUILD-2 | Development image cannot run Bash fixtures or inspect its mounted checkout | ✅ Resolved 2026-09-25 — Bash installed and Git trusts only `/app` |
| RUNTIME-1 | Serving under Bun raises unhandled rejections Node does not | 🟡 Partly closed — the `crypto` half fixed `d0e7566`; the `AbortError` half open, though its reproduction gives 0 since Next 16.4.0 (2026-10-12) |
| NAV-1 | No mobile navigation — the dashboard is unusable on a phone | ✅ Resolved (`fcb3cad`) |
| HOUSE-1 | An account without a household loads a skeleton forever | ✅ Resolved (Phase 3) |
| UI-4 | LocationPicker's dropdown is not a real listbox | ✅ Resolved (`a6b01c2`) |
| I18N-1 | The receipts routes are hardcoded Spanish | ✅ Resolved (`621185d`) |
| UI-5 | The receipt review page overflows at 390px | ✅ Resolved (`621185d`) |
| A11Y-1 | A saved stock movement is never announced | ✅ Resolved (Phase 5) |
| A11Y-2 | Confirming a receipt line changes nothing on screen | ✅ Resolved |
| UI-6 | The picker's options open under the bottom bar | ✅ Resolved (`0e74c32`) |
| UI-7 | The review page's pending count never moves | ✅ Resolved |
| I18N-2..6 | Wording and untranslated strings | ✅ Resolved (Phase 7 slice) |
| I18N-7 | The low-stock badge is hardcoded | ✅ Resolved (Phase 4) |
| I18N-8 | Both auth pages hardcoded, in the wrong two languages | ✅ Resolved (Phase 7 slice) |
| UI-8 | A failed query leaves two routes on a skeleton forever | ✅ Resolved (Phase 3) |
| UI-9 | Two routes show an empty state when the query failed | ✅ Resolved (Phase 4) |
| TEST-3 | A seeded-session E2E test writes stock the low-stock test asserts | ✅ Resolved (Phase 3) |
| TEST-4 | The low-stock badge is unchecked on the card tier | ✅ Resolved (Phase 4) |
| UI-10 | The auth hero panels are painted with the action colour | ✅ Resolved (`d7c178d`) |
| UI-11 | A run-out product with a minimum is labelled low, not out | ✅ Resolved 2026-08-20 |
| PRICE-1 | No UI path can create a price record | ✅ Resolved (`4bbb82d`) |
| REV-1 | 2026-08-29 review: receipt pipeline discordances (apply untransacted, review edge-less, CREATE injection, append-on-reparse) | ✅ Resolved (this plan's commits) |
| SEC-2 | `consumeStock` guards `?? ` but writes `\|\|`, so an empty `consumeFromLocationId` writes an unchecked `locationId` | ✅ Resolved 2026-08-31 |
| LOC-1 | Two concurrent location moves could leave two locations inside each other, and a move into the loop never finished | ✅ Resolved 2026-10-12 |
| LOC-2 | No screen or call can move a nested location back to the top level | 🟡 Open — found fixing LOC-1 |
| HOUSE-2 | Two concurrent `household.create` calls from one account left a household with no member | ✅ Resolved 2026-10-12 |
| OFFLINE-1 | A queued change resent after its replay record was swept is applied a second time | 🟡 Open — window widened from 7 to 90 days 2026-10-12; the client-side age gate is the fix |
| OCR-3 | A restart left a receipt that was being read spinning on the upload screen for ever | ✅ Resolved 2026-10-12 |
| SHOP-2 | Two concurrent "Añadir lo que se está acabando" make two automatic lists, or the same product twice on one | 🟡 Open — deferred by the 2026-10-12 security review; reproduced 10 of 10 |
| DB-1 | The data model's invariants are held only by application code | 🟡 Open — deferred by the 2026-10-12 security review; needs a data audit first |
| UPLOAD-1 | Receipt photographs have no per-household storage quota | 🟡 Open — deferred by the 2026-10-12 security review |
| TEST-9 | Nothing pins that the caller's own row has no reset button, and a self-reset would be reported as "too easy" | 🟡 Open — deferred by the final review of the 2026-10-12 security branch |

---

## Critical Issues

### ✅ CRITICAL-1: Non-existent `deleted_at` field in product search query

**File:** `src/server/trpc/routers/product.ts`  
**Severity:** HIGH  
**Status:** RESOLVED 2026-08-03

**Resolution:** The `AND deleted_at IS NULL` clause was removed from the raw
pg_trgm query. No model in `prisma/schema.prisma` has a soft-delete column, so
Option B below was the correct choice; adding `deletedAt` would have introduced
a column nothing else in the codebase reads.

**Original report follows.**

**Description:**
The `searchByName` procedure uses raw SQL with a `deleted_at IS NULL` filter, but the `Product` model in `prisma/schema.prisma` does not have a `deleted_at` field. This query will fail at runtime.

**Current Code:**

```typescript
const products = await prisma.$queryRaw`
  SELECT 
    id, name, barcode, brand, category, "defaultUnit", "minStock",
    similarity(name, ${input.query}) as similarity
  FROM "Product"
  WHERE "householdId" = ${user.householdId}
    AND deleted_at IS NULL  // <-- THIS FIELD DOESN'T EXIST
    AND name % ${input.query}
  ORDER BY similarity(name, ${input.query}) DESC
  LIMIT ${input.limit}
`;
```

**Impact:**

- Product search functionality will throw database errors
- Users won't be able to search for products
- Blocks Phase 1 feature "Product catalog CRUD + search"

**Suggested Fix:**
Option A: Add soft delete support to Product model:

```prisma
model Product {
  // ... existing fields ...
  deletedAt DateTime?
  // ...
}
```

Option B: Remove the `deleted_at IS NULL` clause from the query if soft deletes are not planned for MVP.

**Priority:** Fix before Phase 1 starts

---

### ✅ CRITICAL-2: Authentication pages are placeholder implementations

**Files:**

- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/register/page.tsx`

**Severity:** HIGH  
**Status:** RESOLVED in commit `7f393ac`

**Resolution:** Both pages are real client components with form submission,
`signIn("credentials")`, translated error mapping via
`src/lib/auth/error-messages.ts`, pending state and post-login redirect.

**Original report follows.**

**Description:**
Both login and register pages are minimal placeholders with no actual form implementation. The Auth.js configuration exists but users cannot actually log in or register.

**Current Code (login):**

```tsx
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1>Login Page</h1>
    </div>
  );
}
```

**Impact:**

- Users cannot authenticate
- Blocks all dashboard functionality
- Blocks Phase 1 entirely

**Required Implementation:**

- Login form with email/password fields
- Register form with email, name, password, optional household name
- Form validation using Zod schemas
- Error handling and user feedback
- Integration with `signIn()` from Auth.js
- Redirect after successful auth

**Priority:** Must implement in Phase 1 Week 1

---

### ✅ CRITICAL-3: Missing database migrations

**Location:** `prisma/migrations/`  
**Severity:** HIGH  
**Status:** RESOLVED

**Resolution:** `prisma/migrations/20260213234844` is committed, together with
`migration_lock.toml`. A seeder now also exists at `prisma/seed.ts`, wired to
`bun run db:seed` through the `prisma.seed` key in `package.json`.

**Original report follows.**

**Description:**
No migration files exist in the repository. The schema is defined but hasn't been migrated to create the actual database tables.

**Impact:**

- Database tables don't exist
- All Prisma queries will fail
- Application cannot run

**Required Actions:**

1. Run `pnpm prisma migrate dev --name init` to create initial migration
2. Commit the generated migration files to git
3. Document migration workflow in README

**Note:** Initial migration should include:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

**Priority:** Must complete before any database-dependent features

---

### ✅ CRITICAL-4: Missing rate limiting for authentication endpoints

**Files:**

- `src/lib/rate-limit.ts` (new)
- `src/lib/auth.ts`
- `src/server/trpc/routers/auth.ts`

**Severity:** MEDIUM-HIGH  
**Status:** RESOLVED 2026-08-10 (Phase 3)

**Resolution.** `src/lib/rate-limit.ts` counts attempts per IP in Valkey — a
fixed window of INCR/EXPIRE — at the numbers this file quotes below: 5 sign-ins
per 15 minutes, 3 registrations per hour. Sign-in is counted inside Auth.js's
`authorize`, before the credentials are looked at, so the endpoint cannot be
used to make the server spend 250ms of Argon2id on demand. Registration is
counted in the tRPC procedure, which needed the request headers in the context.

Three decisions worth knowing, each recorded in PROGRESS.md:

- **The identifier is the last hop of `X-Forwarded-For`, not the first.** The
  leftmost entry is whatever the client sent; varying it per request would turn
  a per-IP limit into no limit at all. A unit test asserts this specifically.
- **A successful sign-in clears its counter.** The specification counts
  attempts, and taken literally that locks out a household signing in from a
  phone, a tablet and a laptop. Clearing on success keeps the ceiling exactly
  where the specification puts it for someone who *cannot* sign in.
- **It fails closed.** An attempt that cannot be counted is refused. The cost is
  that Valkey is now a hard dependency of signing in, which is stated in
  SECURITY.md and reported to the operator by name in the server log.

Verified in a browser as well as by test: five wrong passwords refused as
wrong, the sixth refused as rate-limited with the Spanish message, a *correct*
password still refused while the window was open (TTL 893s of 900), and the
counter gone after a successful sign-in. Counting is proven against a real
Valkey in `src/__tests__/integration/rate-limit.test.ts`; the identifier and
the shipped defaults in `src/__tests__/unit/rate-limit.test.ts`.

**A second door, found by review after this was first marked resolved.** The
limiter went into Auth.js's `authorize`, which is what the login form uses —
but `auth.login` was a *second* credential-verification procedure on the public
tRPC router, doing its own `argon2.verify` and returning the account's identity
on a hit. Nothing in the interface called it; the login page has always used
`signIn("credentials")`. So five wrong passwords on the Auth.js door locked an
address out while the same guesses through `/api/trpc/auth.login` were
unlimited, unmetered and parallel — an exact credential oracle, and a cheap way
to make the server spend Argon2id on demand.

It was removed rather than limited: Auth.js already owns credential
verification, and a second path that nothing calls is a liability whether or
not it is metered. The four integration tests that pointed at it were repointed
at `authorize`, which had no coverage below the browser until then — including,
now, that the limit actually refuses the *correct* password once the budget is
spent.

That repointing immediately caught something else: reading
`authConfig.providers[0].authorize` gets Auth.js's placeholder `() => null`,
not the configured function, which lives in `options`. Three sign-in tests
passed against a stub for one run before the helper was corrected;
`src/__tests__/utils/authorize.ts` now refuses to run against a function that
does not take `(credentials, request)`.

**Still open, and deliberately out of scope:** only the two auth endpoints are
limited, and the limit is per IP rather than per account. Phase 7 §3 verifies
this rather than introduces it.

**Original report follows.**

**Description:**
No rate limiting is implemented for login/register endpoints. This leaves the application vulnerable to brute force attacks.

**Verification:** grepping `src/` for `rateLimit`, `redis`, `ioredis` or
`valkey` returns nothing. There is no cache client in the application at all,
despite `cache` (Valkey) being defined in `docker-compose.dev.yml`. This is now
the most serious open issue in the repo.

**Requirement (`CLAUDE.md`, Security Constraints):**
> Rate limiting: 5 login attempts/15min per IP, 3 registrations/hour per IP

**Impact:**

- Security vulnerability
- Brute force password attacks possible
- Registration spam possible

**Suggested Implementation:**
Use Valkey (Redis) to track attempts per IP:

```typescript
// Middleware or custom authorize function
const rateLimitKey = `auth:attempts:${ip}`;
const attempts = await redis.incr(rateLimitKey);
if (attempts === 1) {
  await redis.expire(rateLimitKey, 900); // 15 minutes
}
if (attempts > 5) {
  throw new Error("Too many attempts. Try again later.");
}
```

**Priority:** Implement before public deployment

---

### ✅ UI-1: Four linked routes do not exist

**Files:** `src/app/(dashboard)/products/page.tsx`,
`src/app/(dashboard)/inventory/page.tsx`,
`src/components/dashboard/DashboardNav.tsx`  
**Severity:** HIGH  
**Status:** RESOLVED in Phase 1 — and it was six routes, not four.
`/products/[id]` and `/receipts/[id]/applied` surfaced while building the first
four, both missed by three manual audits because their call sites use template
literals. `bun run check:links` now gates CI: 74 links against 24 routes,
none broken. No `test.fixme` remains in `e2e/`.

**Original report follows.**

**Description:**
The UI links to four routes that have no `page.tsx`. Every one of them 404s:

| Linked from | Target |
|---|---|
| `/products` | `/products/new` |
| `/inventory` | `/inventory/add` |
| `/inventory` | `/inventory/consume` |
| `DashboardNav` (every dashboard page) | `/settings` |
| `/products` (every row), `/inventory` (every row), `/products/scan` | `/products/[id]` |

**The fifth was missed in the original audit** (added 2026-08-09). It is the
most-linked of the lot: `src/app/(dashboard)/products/[id]/` is an empty
directory, while three call sites link to it — every row of the product list,
every product name in the inventory table, and both success paths of the
scanner, which also passes a `?new=true` that nothing reads. Confirmed with a
real product id: HTTP 404.

It was missed because the first audit compared `href="/…"` string literals
against the route tree, and these are template literals — `` `/products/${id}` ``
— which that pattern does not catch.

**Impact:**
Stock movement is unreachable from the UI even though `inventory.addStock`,
`consumeStock`, `adjustStock` and `transferStock` are all implemented in the
router. Journey 1 in `docs/SMOKE_JOURNEYS.md` cannot be completed. The
`/settings` link is in the main navigation, so it is reachable from anywhere.

**Detection:**

```bash
comm -13 \
  <(find "src/app/(dashboard)" -name page.tsx | sed 's|src/app/(dashboard)||;s|/page.tsx||' | sort) \
  <(grep -rhoE 'href="/[a-z/]+"' src/app src/components | tr -d '"' | sed 's|href=||' | sort -u)
```

**Blocks:** four `test.fixme` tests in `e2e/critical-paths.spec.ts`.

**Priority:** This is the largest functional gap in the MVP.

---

### ✅ OCR-1: OCR downloads its language data at runtime in production

**Files:** `src/server/services/ocr.ts`, `Dockerfile`  
**Severity:** MEDIUM  
**Status:** OPEN — found 2026-08-09

**Description:**
`createWorker("spa")` makes tesseract.js fetch the Spanish traineddata (~3.3 MB)
from a CDN on first use and cache it in the working directory. The production
image does not carry it: that stage copies only the standalone build, static
assets, `public`, `prisma` and `package.json` — not the repository root.

**Impact:**
The first receipt scan on a fresh container needs outbound internet. On an
air-gapped or firewalled self-hosted install it fails; everywhere else it is a
silent runtime download into a container with a read-only root filesystem,
which will fail there too unless the path happens to be writable.

This is the same class of defect as the Prisma CLI being fetched by `npx` at
container start, fixed in `fix(docker): stop the production image fetching code
at every start`. This one was missed because the OCR path was never exercised
in a production image.

**Suggested fix:**
Bake the traineddata into the image and point tesseract.js at it with
`langPath`/`cachePath`, so no network access is needed to read a receipt.

**Note:** the file was previously committed at the repository root as a 3.3 MB
binary. It was a cache artefact that landed in git by accident and has been
untracked; it never reached the production image, so removing it changes
nothing about this issue.

**Resolution.** The Dockerfile fetches the model once at build time, pinned to a
tag and checksummed, into `/app/tessdata`; `TESSDATA_PATH` points the worker at
it. `workerOptions()` in `ocr.ts` supplies `langPath`, `cachePath` and
`gzip: false` — the last because the baked file is uncompressed and the default
makes tesseract.js look for `spa.traineddata.gz`, find nothing, and go back to
the network.

**A different model, deliberately.** tesseract.js defaults to
`@tesseract.js-data/spa/4.0.0` — over 12 MB on disk, carrying the legacy
engine's data. This bakes in `tessdata_fast` at 2.3 MB, the LSTM model Tesseract
recommends for printed text. Nothing here measures OCR accuracy: the parser
tests run against fixed strings rather than OCR output. The trade is reasoned,
not measured, and is the first thing to look at if receipt parsing degrades.

**Development is unaffected**: with no model present, `workerOptions()` returns
nothing and tesseract.js behaves as before. Pointing `langPath` at a directory
without a model does not fall back to the CDN — it throws — so this had to be a
lookup rather than a constant.

**Verified, and the limit of that.** The image was built and run with
`--network none`: the model is present with the pinned checksum, `TESSDATA_PATH`
is set, and the built server bundle carries both the variable and the filename.
A receipt has *not* been scanned inside the image — the library's main entry is
bundled into Next's server chunks and cannot be driven standalone — so what
stays unproven is that the bundled copy honours these options the same way the
source does.

---

### ✅ INV-3: Recounts display old batch amounts and infer stock details

**Reported 2026-09-12:** the product list's “Ajustar” flow appeared to invent
quantity, location and expiry; two separate kitchen taps appeared to use three.

The adjustment wrote a delta, but product detail displayed the original positive
entries. The expiry queries chose a source by earliest expiry, while kitchen
consumption named no batch. Separately, the add form and + button assigned a
location from purchase history. Eggs in the sample catalogue used dozens, so
“one” meant a dozen eggs. These were verified in code. The local ledger read on 2026-09-12 contains
a purchase of +2 dozen, two uses of -1 dozen, then an adjustment of +3 dozen;
there is no third consume row. That old dated purchase was depleted before
the adjustment, yet product detail still showed it.

**Correction:** explicit `StockEntry.batchId` provenance for kitchen consumption;
one shared remainder calculation; unknown amounts remain null when a source
cannot be determined; no inferred location on new stock. A recount checks its
expected balance under the product lock, with additions and uses taking the
same lock. Supplied adjustment expiry is retained. The unit migration converts
only the exact dozen aliases, preserving signed quantities and price amounts;
new count inputs normalize the same way. Persisted reads are invalidated and
queued quantity edits name their unit, so an older unitless list edit is
refused instead of changing basis silently. Unit edits convert quantities when
the factor is known, otherwise refuse a relabel of existing records.

**Evidence:** `inventory.net-stock.test.ts`, `batches.test.ts`, the stock form,
stepper and kitchen component suites, and the recount/kitchen browser regression
in `e2e/critical-paths.spec.ts`. Mutation checks restore guessed quantities,
remove batch provenance, bypass the stale check and break the dozen factor;
the corresponding regression tests fail. Existing physical stock still needs
a human recount; no historical consumption intent is reconstructed.

### ✅ INV-1: Expiring items report entry quantity, not net stock

**File:** `src/server/trpc/routers/inventory.ts` (`getExpiringItems`)  
**Severity:** HIGH  
**Status:** RESOLVED in Phase 4 — found 2026-08-09

**Description:**
`getExpiringItems` selects `StockEntry` rows with `quantity: { gt: 0 }` and
reports each row's own quantity. Consumption is recorded as a *separate* entry
with a negative quantity and no expiry date, so it is filtered out and never
subtracted. The figure returned is therefore the size of the original purchase,
not what is left.

**Evidence** — from the seeded demo household:

```
Leche entera: entries with an expiry date and quantity > 0 = 6 L
              net stock                                    = 2 L
```

The product has a +6 L purchase carrying the expiry date and a −4 L consumption
carrying none.

**Impact:**
The kitchen screen is built on this procedure while the phone screen is built on
`getStockOverview`, which sums correctly. The two screens will show different
numbers for the same product on the same day — 6 L expiring against 2 L in
stock — which reads as a bug in the app to anyone using both. It also
overstates how much food is about to be wasted, which is the one number the
kitchen screen exists to get right.

**A second location, found 2026-08-09 while building `/inventory/consume`:**
`consumeStock`'s availability guard has the same shape. It selects entries with
`quantity: { gt: 0 }` and sums them, so it measures *gross purchases* and
ignores every prior consumption. Measured on the seeded household after adding
3 paquete of coffee: `gross = 5`, `net = 3`. The server would accept a
consumption of 5 and drive stock to −2.

It is latent rather than live, because `/inventory/consume` computes its own
limit from net stock and refuses first — verified in a browser, asking for 5
against a net of 3 is blocked on the page. But the server is the authority, and
anything that is not that page — an API client, or the offline replay queue
planned for Phase 4 — would corrupt stock. **Phase 4 must not build replay on
top of this.**

**A third location, found 2026-08-11 while fixing the second:** `transferStock`
has it too, and this entry did not name it. Its guard filters the source
location's entries by `quantity: { gt: 0 }`, so it counts what arrived at a
shelf and not what left it — six in and four out offered six to move.

**✅ The write guards are fixed** (Phase 4). Both `consumeStock` and
`transferStock` now sum every entry rather than only the positive ones, which
is the whole fix: the negative rows *are* the consumption. Pinned by
`src/__tests__/integration/inventory.net-stock.test.ts`, six tests against a
real PostgreSQL because the defect lived in a Prisma `where` clause and a
mocked client would have returned whatever the test pretended. Verified failing
first: 5 of the 6 go red with the router reverted.

The read half followed in the next commit, below.

**Suggested fix:**
Report net stock per product alongside the soonest expiry date, rather than
per-entry quantities, and make `consumeStock` guard against net rather than
gross. If per-batch detail is wanted later, consumption has to be
attributed to a batch, which is a larger modelling change and should be a
deliberate decision rather than a side effect.

**✅ The read half is fixed** (Phase 4). Both expiry views now ask per
*product* rather than per entry, because a batch's remaining quantity cannot be
known without the rest of that product's ledger, and report what is left of
each batch instead of what was bought. A batch drawn down to nothing does not
appear at all, which was the visible half of this: the component never showed
the quantity, so what a reader actually saw was a carton drunk weeks ago listed
as about to spoil.

**The drawdown rule is soonest-expiry-first**, stated in
`src/lib/inventory/batches.ts` rather than assumed silently in a router.
Someone taking milk out of the fridge reaches for the carton that has to go
first. Undated batches are drawn down last, because a batch with no expiry has
no urgency and putting it first would make dated batches look fuller than they
are. Per-batch attribution at write time remains the larger modelling change
described above, and is still not taken.

Also corrected in passing, because the same test found it: `daysExpired`
rounded elapsed time *up*, reporting a carton four days and one second gone as
five days gone. Days remaining and days elapsed are now one measurement with
two signs.

Pinned by `src/__tests__/unit/batches.test.ts` (19 tests, 35ms — the rule is
arithmetic over an array and needs neither a database nor a DOM) and five
tests in `src/__tests__/integration/inventory.net-stock.test.ts` that prove the
router calls it. Verified failing first: all five go red with the router
reverted.

**Blocks:** Journey 7 in `docs/SMOKE_JOURNEYS.md` cannot be honestly proven
until the number means what the screen says it means.

---

### ✅ LOC-1: Two concurrent location moves could leave two locations inside each other

**Files:** `src/server/trpc/routers/location.ts` (`update`, `getTree`),
`src/components/inventory/LocationPicker.tsx`
**Severity:** MEDIUM — availability of the shared server, and a household's
own locations made invisible
**Status:** RESOLVED 2026-10-12 — found by the 2026-10-12 security review,
confirmed by both verifiers against the real router with a stubbed client

`location.update` refused a move into the moved location's own subtree by
walking up from the new parent with plain reads, and wrote `parentId`
afterwards in a separate statement: no transaction, no lock, no constraint.
Two moves sent together — A into B and B into A — each checked the tree as it
was before either wrote, both passed, and left A and B each other's parent. A
tRPC batch runs its calls concurrently, so one request was enough, and any
self-registered account owns a household and so holds `adminProcedure`.

What a loop then did:

- **A move into it never finished.** The walk (`checkIsDescendant`) recursed on
  `parentId` with no visited set and no depth limit, so moving any other
  location under A went A → B → A → … one query per step for as long as the
  process lived. The review's reproduction counted about 2 600 queries in three
  seconds, still going. In the review's scenario, fifty such moves in one
  batch are fifty endless query streams on the pool every household shares,
  and the loop survives a restart because it is in the data.
- **The loop disappeared.** `getTree` and `LocationPicker` attached every row
  whose parent was present and treated only a parentless row as a root. In a
  loop every member has a parent present, so neither member — nor anything
  stored under them — appeared on any screen, and `location.delete` refuses a
  location with sub-locations. The comment above `getTree` said an orphan
  "cannot happen through this router"; a loop could.

**Resolution.**

- `update` runs its reads and its write in one transaction that starts with
  `SELECT id FROM "Household" WHERE id = ${householdId} FOR NO KEY UPDATE`. A
  second move in the same household waits for the first to commit and then
  reads the tree the first one left, so it is refused rather than raced. `FOR
  NO KEY UPDATE` rather than `FOR UPDATE` because the latter also blocks the
  `FOR KEY SHARE` lock every foreign-key check on the household takes, so
  creating a product or a location would have queued behind a rename
  (measured: an insert into `StorageLocation` hit a 1 s `lock_timeout` under
  `FOR UPDATE` and went straight through under `FOR NO KEY UPDATE`).
  The final `update` is scoped to the household as well.
- The walk is iterative and bounded twice: a visited set refuses at the first
  repeated row ("The destination is inside a loop of locations"), and a cap of
  64 reads refuses anything longer. The cap counts reads, not distinct rows, so
  it ends a loop by itself if the set is ever lost.
- Both trees attach by reachability (`src/lib/inventory/location-tree.ts`,
  shared by the server and the picker): a row keeps its parent only if its
  chain of parents reaches the top level, and an orphan or a loop member is
  drawn at the top level. What hangs below a loop keeps its parent. The result
  is always a forest, so the recursive walks downstream of it still terminate.
  The picker also stops dropping orphans, which `getTree` already surfaced.

**Pinned by** `src/__tests__/integration/location.cycles.test.ts` (real
PostgreSQL), `src/__tests__/unit/location-tree.test.ts` and a `LOC-1` case in
`src/__tests__/components/LocationPicker.test.tsx`. Each was seen to fail:

- lock removed: 19 of 20 concurrent rounds left a loop;
- visited set and cap both removed — the old walk: the move into a loop was
  still running at the 5 s ceiling;
- visited set alone removed: refused by the cap instead, and the test, which
  asserts the loop refusal, went red; cap alone removed: a 71-deep chain was
  accepted;
- `getTree` attaching by `parentId` again: the loop's members missing from the
  roots; the picker likewise lost three of its six options; the helper keeping
  a loop member's parent: three of five unit tests red.

**Data written before the fix is not rewritten.** No migration nulls a loop's
links: a loop is now visible at the top level and can be broken by moving one
of its members under a location outside it. Not by choosing "No está dentro de
ninguna": the settings form sends that as an absent `parentId`, which `update`
reads as "leave it where it is", so no screen can move a nested location back
to the top level. That is a separate defect, found while fixing this one, and
filed as LOC-2.

---

### 🟡 LOC-2: No screen or call can move a nested location back to the top level

**Files:** `src/lib/validations/inventory.ts` (`updateStorageLocationSchema`),
`src/app/(dashboard)/settings/locations/page.tsx` (`handleSubmit`)
**Severity:** LOW — a location put inside another cannot be taken out again,
only moved under a different one
**Status:** OPEN — found 2026-10-12 while fixing LOC-1

`updateStorageLocationSchema` takes `parentId` as an optional string, not a
nullable one, so `null` is refused at validation (checked against the schema:
`safeParse({ id, parentId: null })` fails). The settings form turns "No está
dentro de ninguna" into `parentId: undefined`, which is dropped from the
input, and `location.update` writes only the fields it is given — so the move
to the top level arrives as a rename that leaves the parent where it was, and
the screen reports success. The fix needs `parentId` nullable in the update
schema, `update` writing `null` as "top level", and the form sending `null`
rather than `undefined` when editing.

---

### ✅ HOUSE-2: Two concurrent `household.create` calls from one account left a household with no member

**Files:** `src/server/trpc/routers/household.ts` (`create`)
**Severity:** INFO — data integrity, not a security weakness: only the
caller's own account is involved, and under `STOKY_REGISTRATION=open` (and on
v0.1.0-alpha.3, which has no other mode) registration already lets anyone
create a household with a name of their choosing
**Status:** RESOLVED 2026-10-12 — found by the 2026-10-12 security review,
confirmed by both verifiers, who lowered it from low to info

`household.create` read the caller's `householdId` before its transaction and
refused if it was set. The transaction then created the household and claimed
the account with `user.update({ where: { id } })` — keyed on the id alone. Two
creates sent together (a double tap, two tabs, one batched request) both
passed the read; the second update waited on the first one's row lock and then
overwrote `householdId`, so the first household lost its only member. The
procedure's own comment says what that leaves: a row "unreachable by anyone",
that no screen shows and no procedure deletes.

**Resolution.** The claim is the conditional update, inside the same
transaction as the insert:
`updateMany({ where: { id, householdId: null }, data: { householdId, role: "OWNER" } })`.
Under READ COMMITTED the second of two claims waits for the first to commit,
re-evaluates its `WHERE` against the committed row, and matches nothing; a
count of 0 throws `CONFLICT` ("This account already belongs to a household",
the same answer as the early read), which rolls back that call's household. The
early read stays, for the `UNAUTHORIZED` answer to a deleted account and so a
sequential second create is refused without an insert.

**Pinned by** "lets only one of two concurrent creates claim the account" in
`src/__tests__/integration/household.test.ts` (real PostgreSQL; ten rounds of
two concurrent creates, each round asserting one success, one `CONFLICT`, one
household left with one member). Seen to fail: with the original
`update({ where: { id } })` restored, both calls of the first round succeeded;
with the conditional update kept but the zero-count refusal removed, likewise.

**Not covered here, and since closed separately.** `auth.register` had the same
shape: it created the household and then the user as two statements outside a
transaction, so two concurrent registrations for one email left the loser's
household behind when its `user.create` hit the unique email index. *Closed
2026-10-12* by "feat(auth): close registration after the first account unless
the operator opens it": registration is one transaction under an advisory
lock, and the household is a nested write of the account, so a refused
registration leaves nothing behind. Households already left without a member,
by either path on an earlier release, are still not deleted: there is no
erasure path yet, and a sweep would have to be checked against everything that
cascades from a household first.

---

### 🟡 OFFLINE-1: A queued change resent after its replay record was swept is applied a second time

**Files:** `src/server/trpc/replay.ts` (`REPLAY_RETENTION_DAYS`,
`sweepExpired`), `src/lib/offline/queue.ts` (`drain`, `retry`)
**Severity:** LOW — data integrity in the caller's own household: a stock
consumption, a stock entry, a shopping item or a scan counted twice. No other
household is reachable and nothing is bypassed.
**Status:** OPEN — mitigated 2026-10-12 by a longer window, not fixed. Found by
the 2026-10-12 security review, confirmed by both verifiers by reading the code

`withReplay` remembers a claim for `REPLAY_RETENTION_DAYS` and every
replayable call deletes the caller's expired claims on its way out. The
client queue has no age limit: `createdAt` is read only for the undo hold, a
request that never reached a server is not a strike, a 401 keeps the whole
queue, and the `failed` list persists until a person discards it. So a change
the server applied but whose reply was lost — most simply, the tab closed
mid-flight — stays queued and is resent with the same key whenever the app is
next opened online. If by then the claim has been swept, the resend claims
afresh and applies again.

Narrower than "any resend after the window": on one device the stale change
is the head of the queue and drains first, and an expired claim nobody has
swept yet still answers it (`answerFromRecord` does not read `expiresAt`). A
double apply needs a replayable call from the **same account** after the
window and before the resend — a second device signed in to it, or `retry`
putting a failed change behind newer ones. `retry`'s comment, "a change the
server did in fact apply is recognised rather than applied twice", holds only
inside the window.

**Mitigated:** `REPLAY_RETENTION_DAYS` went from 7 to 90. Seven days was
shorter than a holiday, and the redesign's own kitchen tablet is "possibly
untouched for days" (`docs/REDESIGN_PLAN.md` §4). Rows hold a few ids each and
are swept per account, so the longer window is a slightly larger table and
nothing else. Pinned by "still recognises a change applied thirty days ago" in
`src/__tests__/integration/replay.test.ts` (real PostgreSQL): it ages a claim
by thirty days, lets another call sweep, resends, and asserts one row and the
first call's id. With the retention set back to 7 it goes red — the resend
returned a new id. The window is stamped on a claim when it is written
(`expiresAt`), and the sweep reads that, so on an upgraded install the claims
written before the upgrade keep their seven days; the ninety are in force for
every claim seven days after the upgrade.

**Why that is not the fix.** Any finite retention leaves the same hole at its
edge, and an infinite one is an unbounded table. The fix is on the client,
which alone knows whether a change *may* have been applied: persist the time
of an op's first attempt before sending it, in line with the queue's "persist,
then attempt" rule; at drain time, move an op whose first attempt is older
than the retention less a margin into `failed` with a reason of its own that
asks the person to confirm, rather than sending it; and have `retry` say the
same for such an op. A change that was never attempted cannot have a claim,
so it keeps sending at any age and an offline shop is never lost. A
server-side guard on a client-sent composition time was considered and is the
weaker option: it trusts the device clock, needs an optional envelope field
for queues already persisted in browsers, and would refuse never-sent changes
that are safe to apply.

---

### 🟡 SHOP-2: Two concurrent "Añadir lo que se está acabando" make two automatic lists, or the same product twice on one

**Files:** `src/server/trpc/routers/shopping.ts` (`generateFromLowStock`),
`prisma/schema.prisma` (`ShoppingList`, `ShoppingItem`)
**Severity:** LOW — data integrity in the caller's own household, not a
security weakness: whoever can press the button can already add or remove
any shopping item, so racing it gains nothing, and no other household is
reachable
**Status:** OPEN — found by the 2026-10-12 security review, which disputed it
as a security finding and deferred it here; reproduced against PostgreSQL the
same day

The docblock promises "exactly one automatic list per household". Nothing
holds that but the order of two statements: `findFirst` for the household's
`isAutoGenerated` list, then `create` if there is none, on `ctx.db` with no
transaction and no lock. The schema has nothing to refuse a second one —
`ShoppingList` carries only `@@index([householdId])`, `ShoppingItem` no
unique constraint at all, and the only unique indexes in any migration are
`User_email_key`, `User_email_lower_key` and
`Product_barcode_householdId_key`. The rows it then writes are decided from
the same unlocked reads, so two calls that overlap each add a row for every
product that is not on the automatic list yet.

Measured on 2026-10-12 against real PostgreSQL (the integration database,
Bun 1.4.2), with the router called twice at once through two callers for one
owner, on a product with a minimum of 2 and no stock — one call alone writes
one row of 3:

- a household with no automatic list yet: **two automatic lists in 10 of 10
  rounds**, and two rows totalling 6 in 9 of them;
- a household whose automatic list exists but does not hold the product:
  **one list, two rows, total 6, in 10 of 10 rounds**.

`getBuyList` flattens every list, so the phone screen asks for the product
twice at twice the quantity, and `getAutoList` returns whichever of two lists
`findFirst` meets. The only caller, `/shopping/lists`, disables its button
while the mutation is pending, so a double tap is not the way in; two tabs or
two members pressing it together are. A product already on the list is not
doubled: both calls read the same row and write the same absolute
`row.quantity + shortfall` (read from the code by the review's verifier, not
measured here).

**The fix** is the one LOC-1 took: run the reads and writes in one
transaction that starts by locking the household row
`FOR NO KEY UPDATE`, so a second generate waits and then sees the first one's
rows. Behind it, a partial unique index on `ShoppingList ("householdId")
WHERE "isAutoGenerated"` turns the next forgotten lock into an error rather
than a second list. Prisma cannot express a partial index, so it is raw SQL
in the migration, like `User_email_lower_key`; and like that migration it has
to refuse with a clear message — or merge — on an install that already holds
two automatic lists, because `CREATE UNIQUE INDEX` fails on them otherwise.

---

### 🟡 DB-1: The data model's invariants are held only by application code

**Files:** `prisma/schema.prisma`, `prisma/migrations/`
**Severity:** INFO — defence in depth; no write path is known to break an
invariant today
**Status:** OPEN — deferred by the 2026-10-12 security review: a constraint
migration needs a data audit of existing installs first

`grep -rnw CHECK prisma/migrations/` returns nothing: the database holds no
`CHECK` constraint, and three unique indexes beyond the primary keys (above,
under SHOP-2). Every bound on a quantity, a price or a minimum is a Zod bound
at the API (`src/lib/validations/` — `.positive()` on prices and on purchase,
price-record and shopping quantities, `.min(0)` on `minStock`, a non-zero
refinement on adjustments) or a range check in the receipt parser. The invariants
that need more than a bound are held by locks and claims in the routers:
non-negative stock by `FOR UPDATE` on the product, a receipt applied once by
the `CONFIRMED → APPLIED` claim, at least one owner by `withOwnersLocked`. A
script, a seed or a future procedure that skips them writes whatever it is
given. Four references are plain text with no foreign key —
`StockEntry.receiptItemId`, `StockEntry.createdBy`, `PriceRecord.receiptId`
and `Receipt.uploadedBy` — and nothing unique stops a receipt line from
producing two purchase entries if the claim is ever bypassed.

**What the fix would add**, in one migration with the matching
`schema.prisma` comments saying which invariant the database holds and which
the code does: `CHECK ("minStock" IS NULL OR "minStock" >= 0)` on `Product`;
`price > 0` and `quantity > 0` on `PriceRecord`; `quantity > 0` on
`ShoppingItem`; a partial unique index on `StockEntry ("receiptItemId") WHERE
"receiptItemId" IS NOT NULL AND "operationType" = 'PURCHASE'`; and SHOP-2's
index. **Not** `quantity > 0` on `StockEntry`: it is signed by design —
consumption writes a negative movement and an adjustment may go either way —
so at most `quantity <> 0` holds, and only once it is confirmed that unit
conversion and `transferStock`'s batch split can never write a zero.

**Why it is not done yet.** On a self-hosted install a constraint that meets
an old row aborts `prisma migrate deploy` on upgrade, and the application does
not start. Each constraint needs a check of what existing data can hold and a
migration that refuses with a message naming the rows, as
`20261006120000_normalise_user_email` does, rather than a bare error.

---

### 🟡 UPLOAD-1: Receipt photographs have no per-household storage quota

**Files:** `src/server/trpc/routers/receipt.ts` (`upload`),
`src/lib/rate-limit.ts` (`uploadRateLimit`), `deploy/docker-compose.yml`
(the `uploads` volume)
**Severity:** LOW under the default `STOKY_REGISTRATION=first-user`, where
only people an admin adds can upload; MEDIUM on an instance that sets it to
`open`, where every self-registered account is a household of its own with
its own allowance
**Status:** OPEN — deferred by the 2026-10-12 security review: a quota needs a
schema change, accounting and a screen to explain a refusal

Each upload is bounded: at most 10 MB in, re-encoded to at most 4000 pixels
on the long edge, and refused if the stored JPEG would exceed the same 10 MB
(`SECURITY.md`, "Receipt uploads"). The total is not. `uploadRateLimit` lets
an account make 30 uploads an hour, which is up to 300 MB an hour and about
7 GB a day per account (30 × 10 MB × 24, arithmetic, not measured), and
nothing ever deletes a photograph: there is no `receipt.delete`
(`docs/SECURITY_REVIEW.md` finding 16), and an `upload` whose
`receipt.create` insert fails after `writeFile` leaves its file behind. In the
release bundle `uploads` is a plain named volume beside PostgreSQL's, so
unless the operator moves it, filling one fills the disk the database writes
to, and every household on the instance loses service, not only receipt
scanning.

**The fix** is three parts, none of them small: record the bytes stored per
household (a column on `Household` or a sum over `Receipt`), refuse an upload
past a configurable quota with a message in both catalogues, and finding 16's
retention — `receipt.delete` removing its file, and a sweep for files no row
names. Until then the operator's defence is disk monitoring and, for an open
instance, an `uploads` volume on a filesystem of its own.

---

### 🟡 TEST-9: Nothing pins that the caller's own row has no reset button, and a self-reset would be reported as "too easy"

**Files:** `src/app/(dashboard)/settings/people/page.tsx` (the row's
"Cambiar su contraseña" button), `src/components/household/ResetMemberPasswordDialog.tsx`
(`resetRefusalOf`), `src/__tests__/components/PeopleRoles.test.tsx`
**Severity:** INFO — a test gap, not a live defect: the server refuses a
self-reset and the screen does not offer one today
**Status:** OPEN — deferred by the final review of the 2026-10-12 security
branch, which judged it a coverage gap in the new reset feature rather than
something to hold the branch for

The people page renders "Cambiar su contraseña" only when
`me.data && me.data.id !== member.id`: your own password changes from
Settings, with your current one. `resetRefusalOf` relies on that guard — its
docblock says the screen never offers the caller's own row — and sends every
`BAD_REQUEST` that is not the identity refusal to `"tooEasy"`. The server
refuses a self-reset with `RESET_OWN_PASSWORD_MESSAGE`, which is a
`BAD_REQUEST` (`household.ts`, `resetMemberPassword`). So if the guard ever
regressed, an admin opening the dialog on their own row would be told "Esa
contraseña es demasiado fácil de adivinar" for every password they tried.

Nothing would notice. `PeopleRoles.test.tsx` does not render the page: it
reproduces the row from `ItemRow`, `Badge` and `Button` and tests the dialog
and `resetRefusalOf` directly, so changing the page's condition cannot turn
it red (read, not mutated: the page is not imported). The e2e spec
`member-password-reset.spec.ts` finds the member's row by its button and
never checks that the owner's own row has none. The server half is pinned
(`household.members.test.ts` expects `RESET_OWN_PASSWORD_MESSAGE`).

**The fix** is two small parts: a component or e2e test that the caller's
own row has no "Cambiar su contraseña" while another member's does, shown to
go red with the `me.data.id !== member.id` check removed; and
`resetRefusalOf` matching `RESET_OWN_PASSWORD_MESSAGE`, as it matches the
identity message, and mapping it to `"failed"` or a sentence of its own,
never `"tooEasy"`.

---

### ✅ SEC-2: `consumeStock` guarded one location id and wrote another

**File:** `src/server/trpc/routers/inventory.ts` (`consumeStock`)
**Severity:** MEDIUM — cross-household reference on a written row
**Status:** RESOLVED 2026-08-31 — found by the Phase D read-path sweep of the
2026-08-29 review's "reported, not verified" set

The guard and the write resolved the consumed location with different
operators. The guard checked `input.consumeFromLocationId ?? input.locationId`
(inventory.ts:535); the write stored `input.consumeFromLocationId ||
input.locationId` (inventory.ts:609). Neither field forbids the empty string.

They agree on `undefined`, and disagree on `""`. A caller sending
`{ consumeFromLocationId: "", locationId: <another household's location id> }`:

- guard: `"" ?? locationId` is `""` — `assertOwnLocation` returns early on a
  falsy id and checks nothing;
- availability filter: `"" ? … : undefined` is `undefined` — the draw-down
  reads the whole product, so the quantity guard passes;
- write: `"" || locationId` is `locationId` — the **foreign** id, which no
  code checked, is written onto the `StockEntry`, and the response includes
  `location: true`, so its name comes back.

The row lands in the caller's own household (the *product* is checked), so it
is SEC-1's shape at lower severity — a reference to a stranger's
`StorageLocation`, which `/products/[id]` renders — but it is a caller-chosen
foreign id reaching a written row, which is exactly the class the review's
read-path sweep existed to find. Reachable by a KITCHEN account and through the
offline replay queue; the UI never sends the field
(`inventory/consume/page.tsx`), which is why nothing had exercised it.

**Resolution.** The guard resolves the location with `||`, the same operator as
the write, so it checks precisely the id that can be written. Pinned by
`inventory.location-isolation.test.ts` "consumeStock refuses a foreign
locationId hidden behind an empty consumeFromLocationId", verified failing
first: the call succeeded and wrote the foreign id under the `?? ` guard.

`transferStock` and `adjustStock` were checked in the same pass and do not
share the shape — each guards and writes the same expression. The tenant-scope
tripwire could not have caught this: it asserts only that `assertOwnLocation`
*appears* in the body, which is its stated "cannot tell a correct check from a
careless one" limit.

---

### ✅ SEC-1: `addStock` wrote a price record against any household's store

**File:** `src/server/trpc/routers/inventory.ts` (`addStock`)
**Severity:** HIGH — cross-household write
**Status:** RESOLVED in Phase 4 — found 2026-08-11 while designing the offline
replay queue

`inventory.addStock` optionally writes a `PriceRecord` alongside the stock
entry, and took `storeId` straight from input. The product and the location in
the same procedure were both verified against `ctx.householdId`. The store was
not — and `price.recordPrice` verifies the identical write two files away.

So any MEMBER could attach a price record to another household's `Store`,
polluting a stranger's price history with prices they never paid. There is no
interface that does it, which is exactly why nobody noticed: the control that
was missing is the one a hidden form does not need.

`REDESIGN_PLAN.md` Phase 7 item 2 names this class — "every query is checked
for a `householdId` filter … it would be invisible in single-household
testing". Found in Phase 4 rather than Phase 7 because Phase 4 makes this
procedure replayable from a device-composed queue, so the review of what a
non-page caller can reach happened early.

**Resolution.** The store is verified the same way the location already was,
and *before* anything is written — so a refusal leaves no stock entry behind
either. Pinned by `src/__tests__/integration/inventory.store-isolation.test.ts`,
four tests over two real households. Verified failing first: two go red with
the check removed, and the second of them proves the price record really was
created against the other household's store rather than merely being allowed.

---

### ✅ INV-2: The availability guards are read-then-write, with no transaction

**File:** `src/server/trpc/routers/inventory.ts` (`consumeStock`,
`transferStock`)  
**Severity:** MEDIUM  
**Status:** RESOLVED — `consumeStock` in Phase 4, `transferStock` after it

Both procedures read the stock entries, sum them, compare, and *then* create a
row. Nothing holds between the read and the write. Two calls that arrive
together each see a net of 2, each pass a guard for 2, and both write: net −2.

INV-1 made the guard measure the right number. It did not make the measurement
hold, which is a different defect and a different fix — a transaction with the
product row locked, or a database-level check.

Filed rather than fixed in passing (PROGRESS.md D6): the fix is a transaction
around a procedure that Phase 4 is about to wrap in idempotency handling
anyway, and doing both at once would put two changes in one commit.

**Why it matters more now than it did.** Phase 4's offline queue drains on
reconnect, and the tRPC client batches: a shop composed in aeroplane mode can
arrive as several consumptions of the same product in a single request.
Sequential taps by one person become concurrent calls on the server. This is
the exact shape that turns a latent race into a routine one.

**✅ `consumeStock` is fixed** (Phase 4). It runs inside the transaction
`withReplay` supplies, and takes `SELECT id FROM "Product" … FOR UPDATE` before
reading — the product row rather than the entries, so the lock exists whether or
not there are any entries yet and every consumption of the same product
serialises behind it.

Pinned by "two people consuming the last of something" in
`inventory.net-stock.test.ts`. **The first version of that test could not
fail**: two calls fired under `Promise.all` happen to serialise in this
runtime, and it passed three times in a row with the lock removed. It now
forces the interleaving — the first caller gets a client that pauses between
reading the stock and writing the consumption, which is exactly the window the
lock closes — and goes red without the lock, twice in a row.

**✅ `transferStock` is fixed too.** Its guard sat outside its `$transaction`,
which covered only the two writes — so two transfers could read the same
figure, both pass, and both write, emptying a shelf twice. The whole procedure
is now one interactive transaction that takes the same `FOR UPDATE` on the
product row before reading. Locking the product rather than its entries matters
more here than for a consumption: a transfer touches two locations, and every
movement of that product now serialises whichever way it is going.

Pinned by "cannot be emptied twice by two transfers at once", which forces the
interleaving the same way the consume test does — a client that pauses between
reading the stock and writing the movement. Verified failing twice in a row
with that one lock removed and the consume lock left in place, so the test is
pinned to its own subject.

---

### ✅ UI-2: LocationPicker never renders child locations

**File:** `src/components/inventory/LocationPicker.tsx`  
**Severity:** HIGH  
**Status:** RESOLVED 2026-08-09 — taken together with UI-4, since both were
rewrites of the same component. `flattenTree` now walks depth-first and every
option carries its ancestors, shown twice: as indentation, and as an `sr-only`
prefix so the accessible name is "Cocina → Nevera" rather than a second row
reading "Nevera". Verified in a browser at 390px with the keyboard only — the
picker offered 3 options before and offers 5 now, and a nested option was
reachable and choosable with the arrow keys, which it had never been.

**Description:**
`buildLocationTree` builds a full nested tree, attaching each location to its
parent's `children`. The render then maps over the roots only and never recurses
— `node.children` appears zero times in the JSX. Every non-root location is
invisible and unselectable.

**Evidence** — the seeded household has a two-level tree:

```
Cocina (root)      Trastero (root)
  └ Despensa         (no children)
  └ Nevera
```

The picker offers Cocina and Trastero. Despensa and Nevera — where five of the
six seeded products actually live — cannot be chosen.

**Impact:**
Anyone whose storage is nested, which is the arrangement the schema exists to
support, cannot file stock where it really is. It affects every screen using the
picker, including the new `/inventory/add`.

**Suggested fix:**
Render recursively with indentation, and give each option an accessible name
that includes its parent, so "Nevera" is distinguishable from another "Nevera"
elsewhere in the tree.

---

### ✅ SHOP-1: A shopping item with no name at all is accepted

**Files:** `src/lib/validations/shopping.ts`, `src/server/trpc/routers/shopping.ts`
**Severity:** LOW
**Status:** RESOLVED (Phase 7 slice)

**Resolution:** the suggested `.refine` exists as the `ONE_NAME` rule in
`src/lib/validations/shopping.ts` — exactly one of `productId` and
`customName`, whitespace not counting as a name — applied to the item schema
and re-applied to `addShoppingItemSchema` after its merge, because a
`.refine`d schema cannot be `.merge`d. No existing row was in either state.
The heading said OPEN while the summary table said resolved; fixed 2026-08-18.

**Original report follows.**

A `ShoppingItem` is meant to reference a `Product` **or** carry a `customName`.
`shoppingItemSchema` declares both as plain optionals with no refinement, and
`addItem` checks only that a `productId`, if given, belongs to the household. So
an item with neither is accepted.

It reaches the phone screen as an empty row: `getBuyList` computes the name as
`product?.name ?? item.customName ?? ""`, and that final `""` is the only thing
standing between this and a crash. A row with no name, which can still be
ticked, is not something a person can act on or even identify.

Verified by calling `shopping.addItem` against a real database with neither
field and reading `getBuyList` back — the name came out as `""`.

**Suggested fix:** a `.refine` on `shoppingItemSchema` requiring exactly one of
the two, so it is refused at the edge rather than rendered as nothing. Worth
checking whether any existing row is already in this state before adding it.


**Superseded 2026-08-22.** The rule this filed for — exactly one of
`productId` and `customName` — is now stricter: the product is required and
the free-text field is gone from the schema and the database. Free text reads
like the obvious kindness and costs more than it gives, because an item naming
nothing the household knows about cannot be priced, counted against stock,
matched to a receipt line, or suppressed when it is already covered. The
kindness moved to the add form, which creates the product inline. The defect
this entry describes remains fixed, by a wider rule than the one that fixed
it.

---

### ✅ OCR-2: receipt scanning does not work in the production image

**Files:** `next.config.ts`, `src/server/services/ocr.ts`
**Severity:** HIGH — a headline feature is completely non-functional when deployed
**Status:** OPEN — found 2026-08-11 by scanning a receipt inside the image

Upload a receipt to the production image and it sits at `PROCESSING` for ever.
The server throws an **uncaught exception** each time:

```
Error: Cannot find module '..'
  - /app/node_modules/.pnpm/tesseract.js@6.0.1/node_modules/tesseract.js/src/worker-script/node/index.js
```

`tesseract.js` starts its worker by spawning `src/worker-script/node/index.js`
as a thread, and that file does `require('..')` — which resolves to
`src/worker-script/index.js`. Next's output tracing copies the thread entry
point and not the sibling it immediately asks for, because nothing imports it by
name. The image has `src/worker-script/node/` and nothing else in that
directory.

**Half of it is fixed.** `serverExternalPackages: ["tesseract.js"]` was the
first defect: bundled, the worker path was baked in as `/ROOT/node_modules/...`,
a build-time placeholder that does not exist at runtime. That is committed and
the path is now correct. The missing file is what remains.

**What did not work:** `outputFileTracingIncludes` for
`/api/trpc/[trpc]`, with both `./node_modules/tesseract.js/**` and the resolved
`.pnpm` path. The directory in the image was unchanged after both. Reverted
rather than left in place doing nothing.

**Resolution — the suggested fix, and it was bigger than the missing file.**
The package has ten dependency entries and the traced image carried three;
among the missing was `tesseract.js-core`, the WASM engine itself, loaded by
path at runtime exactly like the worker. The Dockerfile now stages the whole
`.pnpm` directory dereferenced (`cp -rL`) in the builder and lands it where the
standalone output's symlinks already point, removing the traced partial copy
first — it holds symlinks where the staged tree has directories, and COPY
refuses to overwrite one with the other.

Two build-time assertions pin the worker's `require('..')` target and the core
engine, so a wrong path fails `docker build` rather than the first scan of a
deployed household.

**Verified with the recipe below**: air-gapped, read-only, a real upload as the
seeded demo user — UPLOADING → NEEDS_REVIEW in under three seconds, and the
lines read back character-perfect: "LECHE ENTERA 1,19" parsed to name and
price. Which also puts data behind OCR-1's model trade: the 2.3 MB fast model
reads printed receipt text exactly.

## How to reproduce, and why it was not found sooner

```bash
docker build --target production -t stoky-check .
docker network create --internal stoky-airgap
docker network connect stoky-airgap stoky-db-1
docker network connect stoky-airgap stoky-cache-1
docker run -d --name app --network stoky-airgap --read-only \
  --tmpfs /tmp --tmpfs /app/.next/cache -v uploads:/app/uploads \
  -e NODE_ENV=production -e DATABASE_URL=... -e VALKEY_URL=... \
  -e NEXTAUTH_SECRET=<a real one> stoky-check
# then sign in over HTTP and POST a PNG to /api/trpc/receipt.upload
```

An `--internal` network is the point: it proves the model is read from the image
rather than fetched, which is what OCR-1 claimed.

**OCR-1 was closed on a caveat that turned out to matter.** Its entry says "a
receipt has *not* been scanned inside the image — what stays unproven is that
tesseract.js's bundled copy honours these options the same way the source does."
It does not. The model being present and correctly pointed at, which is all
OCR-1 verified, is necessary and not sufficient.

---

### ✅ OCR-3: A restart left a receipt that was being read spinning for ever

**Files:** `src/server/services/receipt-recovery.ts`, `src/instrumentation.ts`
**Severity:** MEDIUM — part of the 2026-10-12 security review's OCR
denial-of-service finding, whose upload could get the app container
OOM-killed: every receipt being read at that moment stayed where it was
**Status:** RESOLVED 2026-10-12

What happens to a receipt after its upload happens inside the process that
took it. `receipt.upload` writes it as UPLOADING and starts
`processReceiptAsync` without waiting for it, which moves it through
PROCESSING (OCR) and PARSED (lines saved, matching under way) to
NEEDS_REVIEW, CONFIRMED or FAILED. FAILED was reached only from that
function's `catch`, so a process that stopped in between — a deploy, a
restart, or the OOM kill the review's measurements point to (OCR on one
upload passed 1.2 GB RSS against the app's 1 GiB limit) — left the receipt
in its state with nothing to move it on. Nothing re-processes a stored receipt, and the
upload screen polls all three states once a second, so it spun there and
never offered the retry it shows for FAILED.

**Resolution.** When the server starts (`register` in `src/instrumentation.ts`,
Node runtime only; `next build` does not call it), every receipt in UPLOADING,
PROCESSING or PARSED that was **created before that moment** becomes FAILED.
The cutoff, not the timing, is what keeps the new process's own receipts out
of it, so the sweep is not awaited: a database that is slow to come up gets
an error in the log and the receipts wait for the next start, instead of the
server waiting for the database. A receipt has no column for why it failed;
the log line says how many were "interrupted by a restart".

PARSED is beyond what the review named. It is as transient as the other two
— `saveParsedItems` sets it and `matchReceiptItems` replaces it in the same
call chain — and a restart between them strands it the same way.

What it leaves: the person re-uploads, as for any FAILED receipt, and the
failed row and its stored photograph stay (nothing deletes a receipt). A
receipt already stuck on an existing installation becomes FAILED on the
first start of a version with this. It assumes one application process per
database, which is what the release bundle runs: a second process started
against the same database would fail the first one's receipts in flight.

Tested in `integration/ocr.pipeline.test.ts` ("Restart recovery") against
receipts back-dated before a cutoff — the three in-flight states fail, the
settled states and a receipt created after the cutoff do not — and in
`unit/receipt-recovery.test.ts`: `register` calls the sweep with a cutoff
taken before it returns, and an unreachable database is logged, not thrown.

---

### 🟡 TEST-5: bun abandons a test body at a rejecting `await`

**File:** `src/__tests__/integration/replay.test.ts`
**Severity:** MEDIUM — a test defect, but an undiagnosed one in the suite that
guards the offline queue
**Status:** OPEN — found 2026-08-11, investigated at length, not solved

`refuses a key reused for a different procedure` — and sometimes its neighbour
`refuses a key reused for a different change, and applies nothing` — fails about
**one run in seven**, with no assertion diff: bun reports the test as *throwing*
`TRPCError: This key was already used for a different change`.

**Reproduction:** run the file in a loop. It fails within about ten runs. A
single run tells you nothing, which is why this went unattributed twice.

## What has been ruled out, with evidence

- **The deterministic key generator.** `freshKey()` was a counter formatted into
  a UUID, producing the same sequence every run against a shared database — the
  obvious suspect. It reproduces with `randomUUID()`. (The keys are random now
  anyway; a fixed sequence against a shared database is a hazard regardless.)
- **Stale rows from an earlier run.** The lookup is scoped by `[userId, key]`
  and the test users are created fresh per run.
- **The lookup returning the wrong row.** Instrumented: `record.key` always
  equals the key asked for.
- **An unhandled rejection.** A `process.on("unhandledRejection")` listener
  installed in the file never fires on a failing run.
- **The mismatch being unexpected.** Instrumented to print the input: both
  mismatches it reports are the ones the tests *intend* to provoke —
  `{name: "Otro sitio"}` against a record written for `WRITTEN_NAME`, and
  `alwaysRefuses` against a `makeLocation` record. The production code is doing
  exactly what it should.
- **`expectCode` taking a promise rather than a thunk.** Changed so the call is
  made inside the `try`, removing any instant where a rejection exists outside
  one: 2 failures in 20 runs afterwards, against ~1 in 7 before. No improvement
  worth the diff, so it was reverted.

## What is known

Markers printed around each statement of the failing test came out as: start →
first call done → **`(fail)` reported** → `expectCode` returned. That ordering
suggests bun observes the in-flight rejection and attributes it to the running
test a moment before the `catch` claims it.

**Treat that with suspicion**, because bun buffers a test's console output and
interleaves it with result lines — the ordering may be an artifact rather than
real time. It is the strongest hint available and it is not proof.

## Diagnosed: bun abandons the test body at a rejecting `await`

Reproduced under load with `withReplay` instrumented, and the data settles it.

**The application is behaving correctly.** At the mismatch, the record found has
the same key, the same user and the same procedure as the call asking for it;
only the `requestHash` differs, which is precisely the condition the procedure
exists to refuse. The hash pair is *identical* on passing and failing runs — so
this is the test's own deliberate second call with a changed body, not a fresh
key being wrongly rejected.

**bun abandons the test.** The failing test wraps that call in `try`/`catch` and
asserts afterwards. On a failing run:

- `COMPLETED: []` — the marker on the test's last line never runs.
- **12 `expect()` calls, against 13 on a passing run.** The failing test contains
  exactly one assertion, and it never executed.

So execution stopped *at the rejecting `await`*: the `catch` did not run, the
assertion did not run, and bun reported the test as failed with the error
rendered at its origin in `replay.ts`. That is a runner defect — reproduced on
bun 1.3.14 and again on 1.4.0 — and it is a race, which is why it is
intermittent and why load brings it out.

## The recipe

Run another suite against the same database while looping the reproduction:

```bash
# in one shell
bunx bun test src/__tests__/integration
# in another
for i in $(seq 1 24); do bunx bun test docs/reproductions/test-5.test.ts; done
```

3 failures in 24 under that load; **0 in 90 on a quiet machine.** A green loop
proves nothing, which cost an hour before the load was added.

Re-measured on 2026-08-25 across two binaries, **alternated inside one
continuous load run** rather than one after the other: 1.3.14 failed 10 times in
40 and 1.4.0 14 times in 40, over three batches that each leaned the same way.
Alternate them. Measured *sequentially* first, the same pair gave 2 in 24
against 11 in 24 — which reads as "1.4.0 is five times worse" and is machine
drift, not signal. That is the same trap this repository already recorded
hitting on the CI container A/B, where three consecutive runs showed a 100s
difference that twin jobs measured as 400s against 405s.

The pooled difference is 25% against 35%, and a 95% interval on it spans −10 to
+30 points: forty runs an arm can establish that 1.4.0 **still reproduces** the
defect, and cannot establish whether its rate is better, equal or worse.
Refuting "1.4.0 doubles it" needs roughly 39 clean runs an arm.

## What this corrects

Two earlier readings in this entry were wrong and are worth keeping visible:

- "A fresh idempotency key is intermittently reported as reused" — **no.** The
  key is the one the test deliberately reuses; the probe shows the identity
  fields all matching and only the hash differing, as designed.
- Before that, "the test passes and bun misreports it" — right about the
  culprit, wrong about the mechanism. The test does not pass; it is *abandoned*
  partway, which is why its assertion count is short.

Each was corrected by an experiment rather than by more reasoning, and each
looked convincing until the next measurement.

## What it costs, which is more than a rerun

**`bun run verify:ci` fails roughly one run in seven because of this**, and that
is the gate `CLAUDE.md` requires to pass before every commit. Getting a clean
full run on 2026-08-11 took three attempts. CI's `test` job will do the same,
and the failure will look like a defect in the replay layer to anybody who has
not read this entry — which is the cost worth counting, rather than the seconds
spent re-running.

No mitigation has been found that does not also hide real failures. Retrying the
job masks everything; the two reshapings of the assertion that seemed likely —
a thunk, and `.catch()` attached synchronously — were measured and did not help;
and **upgrading the runner does not help either**, measured on 2026-08-25 and
recorded under *What to do about it*. So the entry stands as the mitigation:
recognise the signature, re-run, do not investigate.

## What to do about it

Nothing in this repository — `withReplay` is correct and its tests are correct.
It wants an upstream report, and the reproduction plus the load recipe above are
enough to write one. ~~File it against **1.4.0**, the current release, and say it
reproduces on 1.3.14 too.~~ 1.4.3 is the pin since 2026-10-12, and on that date
the reproduction no longer failed under either version — see *Re-measured for
1.4.3* below, which is what any report has to explain first. **A ready-to-file draft is
`docs/reproductions/test-5-upstream-report.md`** (2026-08-31), alongside the
self-contained `test-5.test.ts` — paste it, trim the internal references, and
attach the file. Not yet filed: the issue URL goes here once it is.

**A pin forward is not the workaround, and that is now measured.** bun 1.4.0
shipped on 2026-08-20, after this entry was written, so the "nothing to upgrade
to" that closed this paragraph stopped being true and nobody noticed for five
days. Against the reproduction on 2026-08-25 it still fails, with the identical
signature: `COMPLETED: []`, one `expect()` short, the refusal rendered at its
origin. A fix would be 0.

Everything *else* is unchanged under 1.4.0 — 569 unit, 602 component, 443
integration, 0 fail, plus `check:links`, `check:contrast` and the seed's native
argon2 — so the upgrade is available whenever it is wanted for its own reasons.
It is simply not a remedy for this, which is why ~~the trunk stays on 1.3.14
and~~ the retry stays where it is. *The trunk did not stay on 1.3.14:
`.bun-version` went to 1.4.0 on 2026-08-26 on the owner's instruction (BUILD-1),
and to 1.4.3 on 2026-10-12 for its security fixes.*

The production path is not in doubt: `withReplay` refuses a reused key correctly
and there are passing assertions for every branch of it.

## Re-measured for 1.4.3, 2026-10-12

The pin moved to 1.4.3 for its TLS and HTTP fixes, not for this, and D106 says a
runner change is measured before it is adopted, interleaved. So it was: the
self-contained `docs/reproductions/test-5.test.ts`, the glibc binaries copied out
of `oven/bun:1.4.0-slim` and `oven/bun:1.4.3-slim`, alternated run by run (the
order flipping every pair) against a migrated scratch test database, while
`bun test src/__tests__/integration` looped against the same database.

| Batch | Load | 1.4.0 | 1.4.3 |
|---|---|---|---|
| 1 | one integration loop | 0 / 40 | 0 / 40 |
| 2 | two integration loops, each run logged (562–579 of 598 passing; two suites sharing one database collide) | 0 / 40 | 0 / 40 |

Every run printed `COMPLETED: ["refuses a key reused"]` and 13 `expect()` calls,
the passing signature. **This is not evidence that 1.4.3 fixes TEST-5**: 1.4.0,
which failed 14 in 40 under this recipe on 2026-08-25, failed none either, so
what changed is the tree or the machine, not the binary. Under the same recipe the
rate that used to separate a fix from noise is now 0 on both sides, and this
reproduction can no longer make the comparison it was written for. The entry
stays open: a race that the documented load no longer brings out is not a race
that is gone, and the same day's suites (`verify:ci`, and the three suites in
the 1.4.3 development image) each passed once, which says nothing either way.

---

### ✅ PROD-1: Deleting a used product fails, and says something else

**File:** `src/server/trpc/routers/product.ts`
**Severity:** LOW
**Status:** RESOLVED (Phase 7 slice)

**Resolution:** the suggested fix is implemented. `product.delete` counts what
references the product — stock entries, price records, receipt lines, shopping
items — and refuses with `CONFLICT` naming the counts, before the foreign key
gets a say; `store.delete` got the same treatment. Asserted by integration
tests. The summary table and `STATUS.md` have said so since 2026-08-11 while
this heading still read OPEN — the same drift the top of this file warns
about, only in the opposite direction. Heading fixed 2026-08-18.

**Original report follows.**

No relation in `prisma/schema.prisma` declares `onDelete`, so Prisma's default
applies and PostgreSQL refuses to delete a row anything references. A product
with a single stock entry, price record or receipt line therefore cannot be
deleted — which is a defensible rule and is not the problem.

The problem is what the caller is told. The P2003 reaches `domainErrors`, which
translates it to `BAD_REQUEST` with "That refers to something that does not
exist" — a sentence about a request referring to a missing row, when what
actually happened is the opposite: too many rows refer to *this* one. Somebody
meeting that in the interface has no way to work out that the answer is "use up
or remove its stock first".

Established by probing a real database rather than by reasoning about Prisma's
defaults, because the defaults differ between required and optional relations
and the answer mattered.

**What is not decided:** whether a used product *should* be deletable at all —
cascading would take its price history with it, which is the record the price
screens exist to show. Refusing is probably right; only the wording is
certainly wrong.

**Decided 2026-08-18, with the owner's pass (D90):** refusing is right. A
referenced product is never deletable — its price history is the record the
price screens exist to show. What Phase 8 adds is the missing interface:
delete becomes admin-only, confirmed, and offered only when nothing references
the product at all.

**Suggested fix:** check for references in the procedure and throw `CONFLICT`
with a message naming what is in the way. That leaves the behaviour as it is
and only makes it legible, so it does not pre-empt the product decision.

---

### ✅ UI-3: Validation and accessibility gaps found while building add-stock

**All eight are closed.** 4, 5 and 6 went with UI-4, Phase 2 and the target-size
sweep; 3 and 7 with Phase 4 and I18N-5; 1, 2 and 8 in Phase 7's slice.

This header disagreed with the footer for a while — it listed item 7 as open
while "Closed by" already credited it to Phase 4 — which is what a numbered
list maintained in two places does.

**Files:** `src/server/trpc/routers/inventory.ts`,
`src/components/inventory/LocationPicker.tsx`,
`src/components/dashboard/DashboardNav.tsx`, `src/components/ui/*`  
**Severity:** MEDIUM  
**Status:** OPEN — found 2026-08-09

Collected while building `/inventory/add`. Each is small; together they are the
reason that page avoids the shared primitives.

1. **`addStock` requires `operationType` and then ignores it.** The input
   extends `stockEntrySchema`, so the field is mandatory, but the handler
   hardcodes `"PURCHASE"`. Same in `consumeStock` and `adjustStock`. These want
   per-procedure inputs rather than a shared entity schema.
2. **Quantity has no sign constraint.** `z.number()` with `Math.abs()` in the
   handler, so posting `-5` silently books `+5`. Rejected client-side today;
   the server still accepts it.
3. **`LocationPicker` hardcodes Spanish** — "Cargando ubicaciones..." and "Sin
   ubicación específica" are baked in, so the English UI shows Spanish there.
4. ~~**`LocationPicker` accessibility**: the trigger has no `aria-expanded` or
   `aria-haspopup`; the click-away layer is a full-viewport `div` with
   `role="button"` and `tabIndex={0}`, putting an invisible tab stop across the
   whole page while open; the trigger is under 44px.~~ **RESOLVED with UI-4**
   (`a6b01c2`). `LocationPicker.tsx:352-353` carries `aria-expanded` and
   `aria-haspopup="listbox"`, `:394` the scrim is `aria-hidden` with no role and
   no tab stop, `:361` the trigger is `min-h-[48px]`. Driven with the keyboard
   in `e2e/location-picker.spec.ts`.
5. ~~**`button.tsx` and `input.tsx` are unsafe to use.** They combine
   `focus-visible:outline-none` with an invisible ring built from tokens that
   resolve to nothing — so they remove the focus outline and replace it with
   nothing.~~ **RESOLVED in Phase 2.** The tokens now exist in
   `src/app/globals.css` under `@theme`, and focus is drawn with a real
   `outline` (`focus-visible:outline-2 outline-offset-2 outline-ring`) with no
   `outline-none` anywhere. `globals.css` also carries a base `:focus-visible`
   rule so the floor cannot be removed by omission. Guarded by
   `src/__tests__/unit/design-tokens.test.ts` and by focus assertions in the
   two component test files.
6. ~~**Touch targets under 44px** in `DashboardNav` (every dashboard page) and on
   the back links of the new routes.~~ **RESOLVED** (`e6aadea`). The floor is 48
   everywhere (PROGRESS D17), measured in CSS pixels by
   `e2e/a11y-structure.spec.ts` rather than asserted as a class name.
7. **`/inventory` has no next-intl at all** — its strings are hardcoded
   Spanish, while the page it links to is bilingual.
8. **`ProductPicker` hardcodes `useTranslations("inventory.add")`.** On
   `/inventory/consume` its hint therefore reads "Elige el producto al que
   quieres **añadir** stock" — the wrong verb. Confirmed in a browser. The
   namespace should be a prop.

**Closed by:** Phase 2 (items 5, 6), Phase 4 (items 4, 7), I18N-5 (item 3),
Phase 7's slice (items 1, 2, 8).

**Items 1 and 2, resolved together**, because they were one defect: a single
`stockEntrySchema` describing a database row rather than what each procedure is
asked to do. It required an `operationType` every handler ignored — two call
sites carried comments saying so — and its `quantity` was a bare `z.number()`
laundered by `Math.abs`, so `-5` on `addStock` booked `+5`. Three schemas now:
`addStock` and `consumeStock` take a magnitude, `adjustStock` takes a signed
delta because `ReconcileDialog` sends `actual - netStock`. `Math.abs` went with
them, or the new guard would never have been exercised.

**Item 8, resolved differently from the suggestion.** A `namespace` prop would
have meant seven duplicate keys per page to vary one of them. The seven shared
labels moved to `inventory.picker`; the one sentence that depends on what the
page is for is a prop the page passes already translated.

---

### ✅ NAV-1: No mobile navigation

**File:** `src/components/dashboard/DashboardNav.tsx`  
**Severity:** HIGH  
**Status:** RESOLVED 2026-08-09 in `fcb3cad`, ahead of the Phase 4 estimate
below, because the design audit made it a blocker for everything else: a
mobile-first sweep cannot be verified on a phone that cannot reach a second
page. `CompactNav` renders a bottom bar with four destinations below `md`, a
rail from `md`, and the existing top bar from `lg`; `NavSheet` holds the rest
behind a focus-trapped "Más". Audited by axe at all three tiers in both themes.

`DashboardNav` renders its links in a `<ul className="hidden … md:flex">`, so
below the `md` breakpoint they are not rendered at all. No replacement exists —
there is no drawer, no menu button, no bottom bar; grepping the components for
any mobile navigation returns nothing.

On a phone, once past login the only reachable page is whichever one you landed
on. Everything else requires typing a URL.

Found because the stock-management E2E tests passed on all three desktop
engines and failed on both phone viewports.

**Originally deferred to** Phase 4, which builds the phone screen proper. What
landed here is navigation, not that screen: Phase 4 still owes the one-handed
shopping journey. The two `test.skip`s left in `e2e/critical-paths.spec.ts` are
scoped to it and name it as the reason.

---

### ✅ HOUSE-1: An account without a household loads a skeleton forever

**Files:** `src/server/trpc/routers/household.ts` (new),
`src/components/household/RouteState.tsx` (new),
`src/app/(dashboard)/products/page.tsx`,
`src/app/(dashboard)/inventory/page.tsx`  
**Severity:** HIGH  
**Status:** RESOLVED 2026-08-10 (Phase 3)

**Resolution.** Of the three fixes suggested below, the third: detect the state
and offer a way out. Requiring a household at registration would break the
invitation flow Phase 3's neighbours need — someone joining an existing
household must be able to register without making a second one — and creating
one implicitly names a household after nothing, which is worse than asking.

Three parts:

- `householdProcedure` raises `PRECONDITION_FAILED`, so the client can tell
  "you have no household yet" from "the server fell over". Only the first has
  a way forward.
- A `household` router on `protectedProcedure` rather than
  `householdProcedure` — deliberately, since requiring a household would make
  the way out of the state unreachable from inside it. `current` returns null
  instead of throwing; `create` makes the household and the membership in one
  transaction, and refuses an account that already has one.
- `RouteState` renders three states where the routes had two. Loading is the
  skeleton as before; `PRECONDITION_FAILED` is a form to create a household;
  anything else is a message and a retry. That third branch closes UI-8.

One thing found while wiring it, and fixed rather than filed because leaving it
would have made the fix pointless: TanStack Query retries a failed query three
times with backoff by default, so the "create your household" screen appeared
about seven seconds after the page did. The query client no longer retries a
4xx — the server has already answered definitively — and 5xx and transport
failures still retry twice.

Verified in a browser with a real household-less account: `/inventory` and
`/products` both offered the form (1.9s and 0.6s, no retry wait), creating
"Casa de Prueba" from `/inventory` recovered the route in place with no reload
and no sign-out, and the counter came back with the household's real empty
state rather than a skeleton.

**Original report follows.**

Registration treats `householdName` as optional, so an account can be created
with no household. Every product, stock, shopping and price procedure then
throws `"User not in a household"`.

The pages do not handle it. `/products` renders on
`if (isLoading || !result)`, and on error `result` is `undefined` — so the
loading skeleton stays on screen indefinitely, with no message and no way
forward. `/inventory` has the same shape.

Someone can therefore complete registration and land in an application that
appears to be permanently loading, with nothing telling them why or what to do.

**Suggested fix:** either require a household at registration, or create one
implicitly, or detect the state and offer to create one. Any of the three is
better than the current silence. The tRPC procedures should also raise a
`TRPCError` with a `PRECONDITION_FAILED` code rather than a bare `Error`
(DEBT-4), so a client can tell this apart from a server fault.

**Closed by:** Phase 3, alongside roles and the `TRPCError` work.

---

### ✅ UI-4: LocationPicker's dropdown is not a real listbox

**File:** `src/components/inventory/LocationPicker.tsx`
**Severity:** MEDIUM
**Status:** RESOLVED 2026-08-09 — a `combobox`/`listbox`/`option` pairing with
`aria-activedescendant`, Up/Down/Home/End/Enter/Space/Escape, and a scrim that
is `aria-hidden` with no role and no tab stop. Measured in a browser: the page
had 26 focusable elements with the picker closed and 26 with it open and again
closed, where before opening it added the invisible "Close dropdown" control;
Escape closes the listbox and leaves focus on the trigger; every option is
356×48. See UI-6 for what this rewrite exposed.

The trigger now reports `aria-expanded`/`aria-haspopup` and every option is a
48px target, but the control underneath is still a set of plain buttons in a
`div`. There is no `listbox`/`option` role pairing, no `aria-activedescendant`,
no arrow-key navigation and no Escape to dismiss — a keyboard user tabs through
every location one at a time and cannot close the panel without choosing one.

The dismissal scrim is a `div` with `role="button"`, `tabIndex={0}` and an
`aria-label`, which puts a second, invisible "Close dropdown" control into the
tab order of every page that renders the picker.

axe does not flag either, because each individual element is technically
labelled; it is the composite that is wrong.

**Suggested fix:** rebuild on the same pattern as `NavSheet` — a real role
pairing, arrow keys, Escape, and a scrim that is `aria-hidden` and out of the
tab order. Related to UI-2, which is about the same component not rendering its
child locations at all.

**Closed by:** unscheduled. Worth taking with UI-2, since both are rewrites of
the same component.

---

### ✅ I18N-1: The receipts routes are hardcoded Spanish

**Files:** `src/app/(dashboard)/receipts/page.tsx`,
`src/app/(dashboard)/receipts/[id]/review/page.tsx`,
`src/app/(dashboard)/receipts/upload/page.tsx`,
`src/components/receipt/*`
**Severity:** LOW
**Status:** RESOLVED 2026-08-09 — all three routes and all five receipt
components now read `receipts.*`, with `useLocale()` + `Intl.*` for dates and
money. 53 keys added to each catalogue, removing none. Verified by switching
language through the app's own control and reading all three pages in English;
product names stay Spanish because they are database rows, not UI. A new unit
test, `src/__tests__/unit/messages.test.ts`, now fails if the two catalogues
ever drift apart again.

Every string on the receipts list, the review page, the upload page and the
receipt components is written into the JSX. Switching the language to English
leaves them in Spanish, and the `receipts.*` catalogue entries that exist
(`title`, `store`, `purchaseDate`, `status.*`, …) are unused by them.

Noticed rather than fixed: the new `/receipts/[id]/applied` route is fully
translated in both catalogues, so the pipeline now switches language half-way
through, which is more visible than it was.

**Closed by:** unscheduled. Mechanical but touches six files.

---

### ✅ UI-5: The receipt review page overflows horizontally at 390px

**File:** `src/app/(dashboard)/receipts/[id]/review/page.tsx`,
`src/components/receipt/ReceiptStatus.tsx`
**Severity:** MEDIUM
**Status:** RESOLVED 2026-08-09 — below `md` the stepper collapses to a numbered
circle and "Paso 5 de 6 · Confirmado"; the six-rung ladder returns from `md` up.
The review page also dropped its own `p-6`, which the dashboard `main` was
already supplying. Measured: the document was 505px wide at a 390px viewport and
is now 390px, and 0px of horizontal overflow at 390, 820 and 1280.

`ReceiptStatusStep` lays six numbered steps and five connectors in a single
non-wrapping row. At 390px the document is about 505px wide, so the page scrolls
sideways and the last step ("Aplicado") — the one a reviewer is heading for — is
off screen. The page also keeps its own `max-w-4xl mx-auto p-6` rather than
using the shell's padding, so it is doubly padded inside the dashboard `main`.

Missed by the A3.3 overflow sweep and by `e2e/accessibility.spec.ts` for the
same reason `/products/[id]` was missed by the dead-link audit: the route is
dynamic, so neither enumerates it.

**Suggested fix:** collapse the stepper to "step 5 of 6 — Confirmado" below
`md`, or wrap it. Take it with I18N-1, which touches the same file.

**Closed by:** unscheduled.

---

### ✅ UI-6: The location picker's options open under the bottom bar

**File:** `src/components/inventory/LocationPicker.tsx`
**Severity:** HIGH
**Status:** RESOLVED 2026-08-09 — the panel measures and flips up when there is
no room, capped by the space on whichever side it lands. The floor is the top of
the bottom bar, found through a `data-fixed-bottom` attribute on the nav:
`window.innerHeight` is the wrong number whenever something is parked across the
bottom of the viewport. Verified at 390px — the last option now ends at 740px
with the bar at 780px — and the mutation that restores the old behaviour
reproduces the numbers below exactly.

The panel is absolutely positioned below the trigger and has no idea what is
underneath it. On `/inventory/add` at 390px the picker is the last field on a
long form, so opening it puts a 240px panel into the 64px that remain: measured,
the last option ends at 892px on an 844px viewport, and the fixed bottom
navigation starts at 780px. The screenshot of the open picker at that scroll
position shows the trigger with its chevron flipped to "open" and **not one
option visible**.

Pre-existing — the panel has always opened downward — but routine rather than
rare now that the picker lists the whole tree instead of only its roots, and it
lands on the phone, which is the tier this product is primarily for.

Nothing catches it: axe does not model occlusion, and the target-size check
measures the rectangle, which is a correct 356×48 whether or not anything is
drawn on top of it.

**Two false starts worth recording**, because each produced a green test over a
broken control. A minimum panel height reintroduced the defect in miniature —
with 100px below and 90px above, neither side clears the minimum, so it stayed
below and hung 20px under the bar. And measuring once, keyed on the open state,
painted the default placement in about one run in three, because the trigger's
final position is settled by a scroll the effect cannot see coming; it is a
`useLayoutEffect` with no dependency array now, and four consecutive runs are
clean.

**Closed by:** `0e74c32`.

---

### ✅ UI-7: The review page's pending count never moves

**File:** `src/app/(dashboard)/receipts/[id]/review/page.tsx`
**Severity:** MEDIUM
**Status:** RESOLVED 2026-08-09 — found while verifying UI-5, closed with A11Y-2,
which was its root cause. The count is derived from the items rather than held in
state, using the predicate `ReviewCard` already drew its own badge from — now
`isItemReviewed` in `src/lib/receipts.ts`, so the two cannot disagree again. That
disagreement is what produced "4 productos pendientes" above four cards all
reading "Confirmado".

Worse than the wrong number, and not noticed when this was filed: "Confirmar
todos" is disabled while anything is pending, and with the count frozen above
zero it was **disabled permanently** — the bulk action could never be used at
all. See I18N-6 for what remains, which is its name.

`const [confirmedCount] = useState(0)` has no setter, so the counter is frozen at
zero for the life of the page. Two consequences a reviewer sees directly: the
heading keeps saying "2 productos pendientes de revisión" when both lines on
screen already read "✓ Confirmado", and "Confirmar todos" stays disabled while
any item is unconfirmed, which is precisely when someone would reach for it.

Confirmed in a browser on the seeded `CONFIRMED` receipt: both items show as
confirmed and the count above them still reads 2.

**Suggested fix:** derive the count from the receipt's items rather than holding
it in state. There is no state here that the query does not already have.

---

### ✅ I18N-2: The catalogue calls the same thing a receipt and a ticket

**Files:** `messages/es.json`
**Severity:** LOW
**Status:** OPEN — found 2026-08-09 while closing I18N-1

`navigation.receipts` and the `receipts.*` keys say "recibo"; the
`receipts.applied.*` subtree and `dashboard.quickUploadReceipt` say "ticket".
The pipeline therefore changes word at its last step, which is the same class of
seam I18N-1 was — a language change mid-journey, only subtler because both words
are Spanish.

Not resolved while fixing I18N-1 because picking the term is an editorial
decision about the product's voice, not a translation fix, and doing it silently
inside a larger change would have buried it.

**Suggested fix:** pick one. "Ticket" is what the paper is called in a Spanish
supermarket; "recibo" is the more formal word and the one the navigation uses.

**Resolution — "ticket" won.** `REDESIGN_PLAN.md` §3 writes for somebody
standing in a supermarket and rules out system vocabulary; a Spanish supermarket
hands you a ticket, and a recibo is what a bank sends. Twenty-three strings
changed rather than nine, which is the direction the argument pointed rather
than the direction the smaller diff did. English needed nothing. The catalogue
test now bans the retired word outright, and carries its own proof that the
pattern still matches.

---

### ✅ I18N-3: `formatDate` is hardcoded to `es-ES`

**File:** `src/lib/utils.ts`
**Severity:** LOW
**Status:** OPEN — found 2026-08-09 while closing I18N-1

The helper pins the locale, so every caller prints a Spanish date under an
English catalogue. The receipts routes stopped calling it as part of I18N-1 and
use `useLocale()` with `Intl.DateTimeFormat` instead; every other caller still
has the old behaviour.

**Suggested fix:** take the locale as an argument, so the pinning has to be
written down at each call site that really wants it.

**Resolution — deleted rather than parameterised.** The helper had no call
sites at all; the only mention of it anywhere was a comment in the receipts route
explaining why that route could not use it. A locale-pinning helper on the shelf
is a trap for whoever reaches for it next. What replaces it is a unit-tier sweep:
no file under `src/` passes a literal language tag to a date, number or collation
formatter.

---

### ✅ I18N-5: The location picker is hardcoded Spanish

**File:** `src/components/inventory/LocationPicker.tsx`
**Severity:** LOW
**Status:** OPEN — found 2026-08-09 while rewriting it for UI-2 and UI-4

Four strings are written into the component: `"Cargando ubicaciones..."`, the
`"Sin ubicación específica"` row, the `"No hay ubicaciones"` empty state and the
`aria-label="Ubicación"` fallback the trigger uses when no caller names it. The
default `placeholder` prop, `"Seleccionar ubicación"`, is the same.

Left alone deliberately during that rewrite: the change was already a rewrite of
the component's semantics, and folding a translation pass into it would have made
the diff unreviewable. Same class as I18N-1, which is closed.

The last one matters more than the rest — an `aria-label` is what a screen reader
announces, so an English-speaking user meets a Spanish control name with no
visible text to fall back on.

**Suggested fix:** take it with I18N-2, since both are catalogue work on the same
area.

**Resolution.** All five strings now come from `inventory.location*`, and the
`placeholder` prop became a fallback rather than a default argument, because a
default argument cannot call a hook — a caller that passes its own wording still
wins, and there is a test for that. The component's tests render through the
provider now, and four of them run in English, because Spanish is the language in
which a hardcoded Spanish string looks correct.

---

### ✅ UI-8: A failed query leaves four routes on a skeleton forever

**Files:** `src/app/(dashboard)/inventory/page.tsx:35`,
`src/app/(dashboard)/products/page.tsx:45`
**Severity:** MEDIUM
**Status:** RESOLVED 2026-08-10 (Phase 3) — found 2026-08-10 while making the
E2E suite run in parallel; **scope corrected 2026-08-10** after an audit checked
the other two files

**Resolution.** Both routes now render three states through
`src/components/household/RouteState.tsx` rather than two: loading, no
household, and any other failure with a message and a retry button. Closed
alongside HOUSE-1 because they are the same four lines — the no-household case
is one specific reason the query fails, and fixing one without the other would
have meant writing the error branch twice.

`/shopping` and `/settings/locations` are **not** changed. They fall through to
an empty state on error, which is wrong but recoverable and is a different
defect; it is filed as UI-9.

**Recurred, fixed 2026-10-06.** Four routes built later hand-rolled their own
states instead of using `RouteState` and had the paused-query form of this
defect: `/products/[id]`, `/products/[id]/adjust`, `/products/[id]/history`
and `/receipts/[id]/applied` drew "Cargando…" for `isPending`, which a query
paused offline also is. All four now render `RouteState`, and
`route-query-states.test.tsx` covers them (DESIGN_AUDIT A5.5).

**Original report follows.**

**Two** routes render `if (isLoading || !result)`. When the query *fails*,
`isLoading` goes false and the data stays undefined, so the condition holds
forever: the skeleton never resolves, no error is shown, and there is no retry
and no way out but a reload. A tRPC error is not a state either page models.

This entry originally named four files and called it HIGH. `/shopping:34` and
`/settings/locations:46` test `if (isLoading)` alone and fall through on error
to an empty state — wrong, but recoverable, and a different defect from a
skeleton that never resolves. I wrote the wider claim from a pattern I had seen
in two files and did not check the other two.

Found under load rather than by reading: with the suite running at six workers,
`/inventory` twice never produced its "Añadir stock" link inside a 15 second
timeout, and `/shopping` was audited with no `h1`, no landmark and no controls
because it was still showing `{t("common.loading")}`.

`/shopping` is the worst of the four — its loading state is a bare `<div>` with
a single string, so a screen-reader user gets a page with no heading at all.

**Suggested fix:** distinguish the three states the query actually has. `error`
needs a message and a retry; `!data` after a successful load is an empty state,
not a loading one. Related to HOUSE-1, which is the same shape: an account with
no household loads a skeleton forever.

---

### ✅ I18N-8: Both auth pages are hardcoded, and in the wrong two languages

**Files:** `src/app/(auth)/login/page.tsx:81,103,88-93`,
`src/app/(auth)/register/page.tsx:89,111,96-101`
**Severity:** MEDIUM-HIGH
**Status:** RESOLVED in Phase 7's slice of the backlog — found 2026-08-10

The first two screens anyone sees get this wrong in both directions at once.

- **The `<h1>` is hardcoded English** — literally `Login` and `Register` — and
  appears twice per page, once in the desktop aside and once as the mobile
  heading. Directly beneath each sits `{t("loginSubtitle")}`, which *is*
  translated. So a Spanish reader gets an English heading over a Spanish
  sentence.
- **The aside panel is hardcoded Spanish** — "Hogar compartido" and "Primer
  hogar", each with a two-line paragraph. So an English reader gets an English
  heading, an English subtitle, and a Spanish promotional block beside it.

`auth.login` and `auth.register` already exist in both catalogues — "Iniciar
sesión"/"Sign in", "Registrarse"/"Sign up" — and are already used for the submit
button on the same page. The heading ignores the key sitting next to it.

Rated above the other I18N items because of where it is: `/login` is the only
page an unauthenticated visitor can reach, and the language control is on it, so
this is the first thing anyone tests when they switch language.

Invisible to `src/__tests__/unit/messages.test.ts`, which compares the two
catalogues against each other and cannot see a string that never reached either.
Same blind spot as I18N-1 and I18N-5.

**Suggested fix:** use `t("login")`/`t("register")` for the headings and move the
four aside strings into `auth.*`. Take it with I18N-5, which is the same kind of
work.

**Resolution.** Exactly that: the four headings — two per page, because each
renders one for the wide panel and one for narrow screens — now read
`t("login")` / `t("register")`, and four new keys carry the aside panels in
both catalogues.

**The test is the part worth recording.** Component tests here render against
the Spanish catalogue, and a string hardcoded in Spanish *looks correct* under
one — which is precisely how the aside panels survived. So the render helper
now takes a locale and `src/__tests__/components/auth-pages.test.tsx` asserts
both pages in both languages: that every `<h1>` is translated, that no known
Spanish string appears under English, and that no raw `auth.` key reaches the
screen, which is what next-intl renders for a typo instead of throwing.

Asserting that *a* heading is translated was the first version and it was
wrong: it passed with one of the two still hardcoded, which is the bug still
shipping to half the viewports. Caught by reintroducing the bug and watching
the test stay green.

---

### ✅ I18N-7: The low-stock badge is hardcoded and disagrees with the catalogue

**File:** `src/app/(dashboard)/inventory/page.tsx`
**Severity:** LOW
**Status:** RESOLVED in Phase 4 — found 2026-08-10 while giving the low-stock
test a real assertion

The badge renders the literal string `"Stock Bajo"`. The catalogue already has
`inventory.lowStock` — "Stock bajo" / "Low stock" — and nothing reads it. So the
key is dead, the badge is Spanish under an English catalogue, and the two
spellings disagree on the capital B.

Same class as I18N-1 and I18N-5. Worth noting that `e2e/critical-paths.spec.ts`
now asserts the literal, so whoever translates this has to update that
assertion — which is the correct coupling, not an obstacle: the test should
break when the visible string changes.

**Resolution (Phase 4).** Fixing only the badge would have left the route half
translated, which needs a second pass and is worse than either end state, so
the whole of `/inventory` moved: title, actions, the four table headers, the
card labels, the category fallback and all three status words. `lowStock` and
`noStock` were already in both catalogues and read by nothing — those are now
read rather than duplicated. Seven keys were genuinely missing and were added
to both catalogues in the same commit.

The E2E assertions now read `es.inventory.lowStock` instead of a literal, which
is the coupling this entry asked for: the catalogue is the single place the
string lives, and a reworded badge fails the test rather than passing it by
accident. (Playwright's `getByText` is case-insensitive by default, so the
capital-B disagreement would have gone on passing indefinitely.)

---

### ✅ I18N-6: "Confirmar todos" is not what that button does

**Files:** `messages/es.json`, `messages/en.json`
**Severity:** LOW
**Status:** OPEN — found 2026-08-09 while closing UI-7

With the pending count fixed the button behaves coherently, and its name is now
the thing that is wrong. It is disabled while any line is unreviewed and enabled
once none are, so it is pressed *after* the work rather than instead of it: it
finalises the receipt and moves it to CONFIRMED. "Confirmar todos" promises a
bulk action that skips the reviewing, which is the one thing it cannot do.

Not renamed here because the wording is a product decision, and because doing it
inside the fix for UI-7 would have buried it in a commit about state derivation.

**Suggested fix:** "Terminar revisión" / "Finish review". Take it with I18N-2,
which is the same catalogue and the same question of what the interface calls
things.

**Resolution.** "Terminar revisión" / "Finish review". Asserted in the browser
suite rather than against the catalogue: the claim is about a button in a
particular state, and the screen-reader receipt journey is already standing in
front of one — it opens a receipt with lines still to decide, so the finalise
button must be visible, named, and disabled.

---

### ✅ I18N-4: "Procesado" and "Procesando" are a letter apart

**File:** `messages/es.json`
**Severity:** LOW
**Status:** OPEN — found 2026-08-09 while closing I18N-1

`receipts.status.parsed` is "Procesado" and `receipts.status.processing` is
"Procesando". As badge labels that alternate while an upload is polled, they are
almost indistinguishable at a glance, and they name two genuinely different
phases: OCR running, and OCR finished and the text parsed.

Pre-existing wording; visible now because the badge reads the catalogue instead
of its own hardcoded strings.

**Suggested fix:** name the phases by what the reader is waiting for — "Leyendo
el ticket" and "Datos extraídos" — rather than by the internal state.

**Resolution.** "Leyendo el ticket" and "Datos extraídos" — what the reader
is waiting for rather than what the state machine is called. The test asserts the
property rather than the strings: the two labels must differ and must not share a
prefix long enough that the difference falls off the end of a glance.

---

### ✅ A11Y-1: A saved stock movement is never announced

**Files:** `src/app/(dashboard)/inventory/add/page.tsx`,
`src/app/(dashboard)/inventory/consume/page.tsx`
**Severity:** MEDIUM
**Status:** RESOLVED in Phase 5 — found 2026-08-09 building
`e2e/screen-reader.spec.ts` (DESIGN_AUDIT A4.6), pinned by that suite

Both stock forms announce their *refusals* well — the error summary is a focused
`role="alert"` and it names the number the household actually has. Success says
nothing. `addStock.onSuccess` invalidates the overview and calls
`router.push("/inventory")`, and the destination has no live region of its own,
so the entire confirmation a screen-reader user receives is Next's route
announcer reading the new page's name: **"Inventario"**.

That is the same word it would read if the person had clicked "Inventario" in
the navigation and saved nothing. It answers "where am I", never "did that
work", and it is silent about what was written, how much, or where it was filed.
A sighted user gets the same non-answer but can scan the table for the row that
changed; a reader would have to walk the whole table to find out whether the
button did anything.

Measured on `/inventory/add`, driving the form as a user does.
`/inventory/consume` is the same code shape — `onSuccess` → invalidate →
`router.push("/inventory")` — but only the add path was exercised end to end, so
treat the consume half as inferred rather than observed.

Nothing else catches this: axe has no rule for "the outcome of an action was
announced", and the tree is otherwise clean on both routes — every interactive
node has a name and the reading order matches the layout.

**Suggested fix:** decide once how these screens confirm work, rather than adding
a live region per route. Two candidates: keep the redirect and have `/inventory`
read a one-shot `role="status"` handed to it by the navigation, or stop
redirecting and let the form report what it wrote, which is what `/products/new`
already does and why D8 exists. The second also answers "how much, where"
without a table scan.

**Resolution (Phase 5).** The second candidate: both forms stop redirecting
and report what they wrote, in a focused `role="status"` — the same shape
`/products/new` uses, which is why PROGRESS.md D8 exists. It answers *how much*
and *of what* without walking the table, and the consume form answers *how much
is left*, which is the question somebody consuming stock has next.

The pinning assertion is flipped, as this entry instructed: it now requires a
new announcement after a save **and** requires it to name the product. Verified
it can fail — restoring the redirect turns it red.

One consequence in the browser suite: a journey that added stock and then
clicked through to `/inventory/consume` was relying on the redirect. The page
object navigates directly when it is not already there, and says why.

**Correction (2026-10-06).** The announcer did not read "Inventario"; it read
nothing. It speaks on a client navigation only when `document.title` changes
(`next/dist/client/components/app-router-announcer.js`), and every route then
wore the same hardcoded English title. The conclusion stands — a route's name
answers "where am I", not "did that work" — and the silence was wider than this
entry knew: it applied to every navigation, not only to saves. Each route now
has its own title (`src/lib/route-titles.ts`, pinned by
`e2e/page-titles.spec.ts`).

---

### ✅ A11Y-2: Confirming a receipt line changes nothing on screen

**File:** `src/app/(dashboard)/receipts/[id]/review/page.tsx`
**Severity:** HIGH
**Status:** RESOLVED 2026-08-09 — found building `e2e/screen-reader.spec.ts`
(DESIGN_AUDIT A4.6) and fixed rather than filed, because a button that writes to
the database and leaves the page untouched is not an accessibility gap with a
workaround; it is a control that lies to everyone. Closed UI-7 with it, as
predicted below. Verified in a browser: the count moves 4 → 3, one "Confirmar"
disappears, the live region changes, and `getReceiptWithItems` is refetched.

`confirmItemMutation` is declared bare — no `onSuccess`, no invalidation of
`receipt.getReceiptWithItems`. Pressing "Confirmar" on a line therefore writes
`USER_CONFIRMED` to the database and then leaves the page exactly as it was: the
card keeps its unconfirmed styling and its buttons, the pending count keeps the
frozen zero of UI-7, and no live region says a word. Measured by diffing every
live region in the accessibility tree before and after the click — the two sets
are identical.

This is worse than A11Y-1 rather than the same class of thing. There the outcome
was under-reported; here the interface actively contradicts the database, and it
does so for everyone, sighted or not. The natural response to a button that
appears to have done nothing is to press it again, which is a second write.
Reloading is the only way to learn that the first one landed.

UI-7 is the visible half of the same root cause and can be read as a symptom of
it: a count derived from the query would move on its own once the query were
invalidated.

**Suggested fix:** give the mutation an `onSuccess` that invalidates
`receipt.getReceiptWithItems`, which makes the card, the count and the
"Confirmar todos" button correct at once, and add a `role="status"` naming the
line that was confirmed. Closing this should close UI-7 with it.

The assertion in `e2e/screen-reader.spec.ts` is no longer a pin: it now requires
confirming to announce something new, and goes red if the invalidation is
removed again.

---

### ✅ UI-10: The auth hero panels are the only large surface painted with the action colour

**Files:** `src/app/(auth)/login/page.tsx:86`, `src/app/(auth)/register/page.tsx:89`  
**Severity:** LOW — the owner's own verdict, from their first pass: "un fondo verde horrible"  
**Status:** RESOLVED (`d7c178d`, Phase 8) — filed and closed 2026-08-18

**Resolution:** one new token, `--hero` — pale cream `#f1eee1` in light, a
deep warm `#201b14` in dark — declared in the four places the gate requires,
with three new audited pairs for the text the panel actually renders (60
checks now, was 54; the guard was broken deliberately and watched to fire).
Both panels carry the ordinary ink, so the wide and narrow renderings of the
same copy finally agree; the aside card went solid `bg-card` instead of the
translucent wash. A component test compares compiled fills through the
Tailwind resolver — red against `bg-primary`, green now. Verified in
Chromium on all four page × theme combinations, and the full browser suite
(117, including axe AAA on both routes) is green.

**Original report follows.**

Both auth pages carry a hero `<section>` at lg+, identical but for four i18n
keys — `bg-primary text-primary-foreground` — so the panel wears `#0e4f42`,
the same token as every primary button, as a full-height surface. It is the
only place in the application where the action colour is a background larger
than a control, which is exactly why it reads as "a green background" rather
than as the palette. Below lg the same copy renders on the card background;
the panel does not exist there, so of axe's three viewport tiers only 1280
exercises it.

Constraints for whoever fixes it: recolor the two sections' *classes*, never
the `--primary` token — every primary button and active-nav state follows
that token, and `--gauge`/`--ring` deliberately carry the same hex as
separate tokens, so a token change misleads in both directions. The nested
aside card's translucent
`bg-primary-foreground/10` goes with it; opacity modifiers at point of use are
the documented way to break contrast invisibly (`DESIGN_AUDIT.md`). A new
token must be declared in `:root`, in both dark blocks and in `@theme inline`,
plus a `PAIRS` entry, or `check:contrast` fails structurally; reusing an
already-checked surface pair (`bg-muted` with its audited foregrounds) needs
no gate change at all. The owner asked for pastel or pale cream; the dark
theme needs its own answer, because pale cream is a light-theme idea.

---

### ✅ UI-11: A run-out product with a minimum is labelled low, not out

**Files:** `src/components/inventory/StockStatus.tsx`  
**Severity:** LOW  
**Status:** RESOLVED — found 2026-08-18, fixed 2026-08-20 in
`fix(inventory): run out beats low, in the one place that now decides it`

`StockStatus` checks `isLowStock` before `totalStock <= 0`, and a product at
zero with a minimum set is both — so the seeded Café molido natural, at 0 of
a minimum of 2, wears "Stock bajo" on `/inventory` while the Panel's restock
row, which checks the other way round, calls the same product "Sin stock".
Two screens, one product, two different words for the same state.

The Panel's order is the right one: run out is the stronger statement and
should win. One `if` swap plus the component assertions that pin the order;
worth checking the card tier and the kitchen screen's vocabulary while there.

**Fixed.** The swap landed in `StockStatus`, which the commit before it had
lifted out of the inventory page into `src/components/inventory/` — so there
is now one place that decides rather than four that each decide again. The
card tier shares that component, so both inventory tiers changed together.
The kitchen was checked and was already right: it asks `left <= 0` first and
says "No queda nada". So was the Panel. `/inventory` was the only dissenter.

`StockStatus.test.tsx` pins the precedence for the screens still to adopt
these atoms; reverting the swap turns the first of them red.

---

### ✅ PRICE-1: No UI path can create a price record

**Files:** `src/app/(dashboard)/inventory/add/page.tsx`,
`src/app/(dashboard)/receipts/upload/page.tsx`,
`src/components/store/StoreSelector.tsx`  
**Severity:** MEDIUM — a headline feature (price intelligence) cannot receive data  
**Status:** RESOLVED (`4bbb82d`, Phase 8) — filed and closed 2026-08-18

**Resolution:** both halves. The add form sends store and price with the
same `addStock` call (refusing a price without a store at the edge, since
the server would accept it and silently record nothing), and the receipt
upload asks which store before the file goes up. The nuance below is closed
server-side too: `price` grew `.positive()`, watched red without it.
`StoreSelector` has its first imports.

**Original report follows.**

Three writers of `PriceRecord` exist server-side and no interface reaches any
of them. `inventory.addStock` has accepted optional `price` + `storeId` and
written the record in the same transaction since SEC-1's fix — the add form
never sends either field. `price.recordPrice` has zero client callers. The
receipt pipeline writes prices only when the receipt has a store — "No store
means no prices", says `receipt.ts` — and `receipt.upload` accepts a `storeId`
the upload page never sends, so no receipt ever has one. `StoreSelector.tsx`
was built for exactly these pickers — `store.list`'s docblock names "the
receipt and add-stock screens" — and has zero imports.

Net effect: `/prices` and `/prices/[productId]` chart a table that nothing in
the product can populate. Seeded demo rows are the only price records that
have ever existed.

One nuance for the fix: `addStock`'s `price` carries no `.positive()` — zero
and negative values pass validation and silently write no record. Once the
form starts sending the field, that silence becomes a user-facing bug; refuse
at the edge instead.

Phase 8's stock-form item owns both halves: store and price on
`/inventory/add`, and a store picker on the receipt upload.

---

## Technical Debt

### ✅ DEBT-1: Minimal password validation rules

**File:** `src/lib/validations/auth.ts`  
**Severity:** MEDIUM  
**Status:** RESOLVED in Phase 7's slice of the backlog

**Current Rule:**

```typescript
password: z.string().min(8)
```

**Issue:**
Only checks for minimum length. No complexity requirements (uppercase, lowercase, numbers, special chars).

**Suggested Enhancement:**

```typescript
password: z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character")
```

**Priority:** Address in Phase 1

**Resolution — and the suggestion above was not followed.** NIST SP 800-63B
§5.1.1.2 advises *against* composition rules: they push people toward
`Password1!`, which is more predictable than a longer passphrase, and they are
why passwords get written down. This project already cites SP 800-63B for rate
limiting, so applying it there and ignoring it here would have been choosing
the easy half.

`src/lib/validations/password.ts` instead sets a **twelve**-character minimum
with no composition rules, refuses the passwords at the top of every leak,
refuses one containing the account's own name or address, and reports every
problem at once rather than one per attempt.

Twelve rather than the standard's floor of eight because that floor assumes the
verifier also checks against breached lists at scale, which a self-hosted box
with no outbound network cannot do.

**A second finding, larger than DEBT-1 itself:** there was no *maximum*
anywhere, so `argon2.hash` and `argon2.verify` took unbounded input on two
endpoints reachable without an account — with Argon2id configured at 64 MB per
call. The rate limiter bounds how often, not how much. Capped at 128, which is
well past the 64 the standard asks a verifier to accept.

The policy governs a password being **set**, never one being checked. A
verifier that refused a stored password because the rule changed would lock
people out of their own household; sign-in keeps only the maximum. Two existing
tests asserted the old behaviour and now assert the new one, including that a
short legacy password still signs in.

**The screens did not follow at the time** (security review, 2026-10-12). The
registration hint still said "Ocho caracteres o más", the add-a-member hint said
8 and promised the person could change it later (nothing changes a password once
it is set), and that field carried `minLength={8}` with a matching `< 8` guard. A
password of nine to eleven characters passed the browser and came back as a
generic refusal. Both hints now take the number as an ICU `{min}` parameter fed
from `MIN_PASSWORD_LENGTH`, both fields use the same constant as `minLength`, and
the change-it-later promise is gone. `unit/messages.test.ts` refuses a hint
without the parameter, a call site that does not pass `MIN_PASSWORD_LENGTH` to
it, and any `.tsx` that writes `minLength` or a `password.length` comparison
with a literal number. `components/auth-pages.test.tsx` checks the rendered
register field and hint. The promise came back the same day, true this time:
`auth.changePassword` lets a signed-in person change their own password from
Settings, the hint says so and names the screen, and `unit/messages.test.ts`
now requires the procedure for as long as the hint makes the promise.

**Nor did the identity refusal** (same review). `passwordProblems` could detect
a password built from the account's name or address, but the only schema
calling it was the field schema, which cannot see either, so it never did:
`registerSchema` and `addMemberSchema` both accepted `noelgarate2026` for
`noelgarate@example.com`, while the paragraph above and `SECURITY.md` said it
was refused. `withIdentityRule` now applies it to both forms, and
`unit/password.test.ts` drives it through the schemas rather than the helper,
which is the level the earlier tests never reached.

---

### ✅ DEBT-2: Barcode scanner component has unused torch state

**File:** `src/components/barcode/Scanner.tsx`  
**Severity:** LOW  
**Status:** RESOLVED in Phase 4

**Issue:**
The `torchEnabled` state is defined but never actually passed to the scanner component to control the torch.

**Note:** `src/__tests__/components/Scanner.test.tsx` contains a test named
*"does not yet drive the camera torch"* which documents the current behaviour.
When this debt is fixed, that test must be updated — it asserts the torch prop
is absent.

**Current Code:**

```typescript
const [torchEnabled, setTorchEnabled] = useState(false);
// ...
<BarcodeScannerComponent
  doScan={isScanning}
  onSuccess={handleSuccess}
  onError={handleError}
  // torchEnabled prop not passed
/>
```

**Resolution (Phase 4).** None of the three suggestions, because the first is
impossible and the third answers no: `@thewirv/react-barcode-scanner@3.4.0` has
no torch prop. It renders `<video ref={...} {...videoProps} />` with the spread
*after* its own ref, so passing a ref through `videoProps` replaces the one
decoding depends on and silently stops the scanner reading barcodes.

The component now finds the live `<video>` through its own wrapper element,
takes the `MediaStreamTrack` off its `srcObject`, and calls
`applyConstraints({ advanced: [{ torch }] })` — the platform API, which
TypeScript's DOM library still does not type, so `TorchConstraints` widens it
rather than casting past it.

**The capability probe was the more interesting half.** It opened a *second*
`getUserMedia` stream at mount purely to read capabilities, and answered from
that. So the button's existence came from one track while its effect was meant
for another, and on a device that allows one camera stream at a time the probe
competed with the scanner's own. Both now come from the same track, which is
what stops the control lying: it cannot be offered on a camera it could not
reach.

A refused torch says so and leaves the label alone, rather than flipping to
"turn it off" over a lamp that never came on. Safari does not implement the
constraint at all, so the control simply does not appear there.

Pinned by 16 tests in `src/__tests__/components/Scanner.test.tsx`, whose mock
had to become a real `<video>` with a real `MediaStream` on its `srcObject` —
happy-dom enforces that type exactly as a browser does, and a bare `<div>`
would have let every torch assertion pass vacuously. Verified failing first:
7 of the 16 go red with the component reverted.

---

### ✅ DEBT-3: OpenFoodFacts service uses in-memory cache

**File:** `src/server/services/openFoodFacts.ts`  
**Severity:** MEDIUM  
**Status:** OPEN

**Issue:**
The service uses an in-memory Map for caching. In a multi-instance deployment (Docker Swarm, Kubernetes), each instance will have its own cache, leading to inconsistent behavior and cache misses.

**Current Code:**

```typescript
const cache = new Map<string, { data: OpenFoodFactsProduct; timestamp: number }>();
```

**Planned solution:**
Use Valkey (Redis-compatible) cache service for production.

**Suggested Fix:**
Replace in-memory cache with Valkey when implementing the service:

```typescript
import { Redis } from "ioredis";
const redis = new Redis(process.env.VALKEY_URL);

async getProductByBarcode(barcode: string) {
  const cacheKey = `off:${barcode}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  // ... fetch and cache ...
}
```

**Priority:** Address in Phase 1 when implementing F5 (Barcode scanning)

**Resolution.** `src/server/services/product-cache.ts`, backed by Valkey through
the shared client in `src/lib/valkey.ts` — extracted from the rate limiter in
its own commit, since two modules calling `new Redis()` would mean two sockets
and two places to get the options wrong.

Three decisions worth keeping:

- **It fails open**, unlike the rate limiter beside it. The fallback for a cache
  it cannot reach is to ask Open Food Facts, which is what a miss already means;
  refusing would break scanning to protect an optimisation. *Since 2026-10-12
  the lookup itself is metered per account (SECURITY.md, rate limiting), and a
  lookup the meter cannot count is not sent: with Valkey down, a code the
  household does not have now lands on the creation form, as in an Open Food
  Facts outage. The cache still fails open; the request behind it does not.*
- **`SCAN` on the prefix, not `KEYS *`.** It shares Valkey with the limiter, and
  clearing the product cache must not drop a sign-in counter.
- **Entries are parsed on the way out.** The cache outlives a deploy, so one
  written by an older schema is a real possibility; it is discarded and
  refetched rather than handed over with fields missing.

The cache is injected rather than imported, so the unit tier still needs no
database.

---

### ✅ DEBT-4: tRPC error handling uses generic messages

**Files:** all routers except `src/server/trpc/routers/receipt.ts`  
**Severity:** LOW  
**Status:** RESOLVED 2026-08-10 (Phase 3)

**Resolution.** All eight routers now throw `TRPCError` and nothing else. 36 of
the throws disappeared rather than being converted: the repeated
`"User not in a household"` guard is now one middleware
(`householdProcedure`), which raises `PRECONDITION_FAILED` — the code HOUSE-1
needs the client to be able to tell apart from a server fault. The remaining
30 were converted in place with their messages left byte-identical, so the
tests that assert on wording still mean what they meant; what changed is the
code the client receives.

Codes were assigned by what the client can do about the condition: `NOT_FOUND`
for a missing row, `CONFLICT` for a request that is well-formed but blocked by
current state (not enough stock, a location with children, a duplicate email),
`BAD_REQUEST` for a request that is structurally wrong (transferring to the
same location, making a location its own parent), `UNAUTHORIZED` for bad
credentials, `FORBIDDEN` for a role that may not.

Pinned in two tiers. `src/__tests__/unit/router-errors.test.ts` fails on any
`throw new Error` reappearing in a router — the structural half, which exists
because a behavioural test only covers the conditions someone thought to
provoke. The integration suite asserts the actual codes; seven assertions that
checked message text were moved to codes at the same time.

The services layer is **not** covered and is filed as DEBT-6.

**DEBT-6 is closed too, in Phase 7's slice.** `src/server/services/errors.ts`
gives the services three domain errors — not found, unusable input, an outside
system failed — and `src/server/trpc/service-errors.ts` turns them into
statuses on the same middleware that translates Prisma's. Domain errors rather
than `TRPCError` in the services because `processReceiptOcr` runs from a
background task with no client attached, where a transport error is a category
mistake.

The stake is the same as the Prisma translator's: the offline queue reads the
status, 500 means transient, and a receipt a service could not find was retried
eight times before being called exhausted.

**Original report follows.**

**Issue:**
Many procedures throw generic errors like `"User not in a household"` or `"Product not found"` without proper TRPCError codes.

**Scope:** `receipt.ts` uses `TRPCError` in 24 places. The other seven routers
(`auth`, `product`, `location`, `inventory`, `store`, `price`, `shopping`) use
none, so every one of their failures reaches the client as
`INTERNAL_SERVER_ERROR`.

**Example:**

```typescript
if (!user?.householdId) {
  throw new Error("User not in a household"); // Should use TRPCError
}
```

**Suggested Fix:**
Use TRPCError with appropriate codes:

```typescript
import { TRPCError } from "@trpc/server";

if (!user?.householdId) {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "User must belong to a household",
  });
}

if (!product) {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Product not found",
  });
}
```

**Priority:** Address during Phase 1 implementation

---

### ✅ TEST-3: An E2E test writes to the seeded household that another one asserts

**Files:** `e2e/screen-reader.spec.ts` (the "add stock" journey),
`e2e/critical-paths.spec.ts:603`  
**Severity:** MEDIUM  
**Status:** RESOLVED 2026-08-10 (Phase 3) — the add-stock journey now names
"Arroz redondo", the seed's well-stocked product, instead of taking whichever
product sorts first. `critical-paths.spec.ts` asserts Arroz is *not* marked low,
and adding to it keeps that true. Named rather than positional so the coupling
is visible: if the seed drops the product, the journey fails there instead of
silently breaking a test in another file. The consume journey still takes the
first product, which is safe for the opposite reason — consuming can only push
a product further below its minimum, and the assertions are that the seed's
three low products are marked.

Filed rather than fixed at first, per D6; fixed in the same phase because a
filed defect that keeps a gate red is not a finding with a workaround, it is a
gate nobody can use (the same reasoning as D22).

**Original report follows.**

`screen-reader.spec.ts › signed in › add stock` submits the add-stock form as
the seeded demo account, choosing `firstProductValue(page)` — the first product
in the select, which is "Aceite de oliva virgen extra" — and adds 2 units.
`critical-paths.spec.ts:603` then asserts that Aceite is *below* its minimum,
which the seed guarantees at 1 of 2.

Whichever runs first decides. Measured directly: after a full run the seeded
Aceite stood at 3 of a minimum of 2 across 3 stock entries where the seed
creates 1, and the low-stock test failed on four of the five browser projects.
Re-seeding and running the low-stock test alone passes.

Not caused by Phase 3 — nothing in it touches stock — but Phase 3's run is
where it surfaced, and it will keep surfacing: the pollution persists in the
database until someone re-seeds, so once it has happened the low-stock test
fails on *every* subsequent run until `bun run db:seed` is run again.

Three fixes worth considering, in ascending order of cost: have the
screen-reader journey create its own product rather than take the first one;
give the low-stock assertions their own household; or re-seed between suites.
The first is the smallest and keeps the journey honest, since what it is
testing is the accessibility tree, not which product it picks.

Related: `e2e/location-picker.spec.ts` asserts `"Cocina → Despensa (5)"`, a
count that the same write moves.

**A third occurrence, 2026-08-11, and a different answer.** The screen-reader
receipt journey confirms a line, which is a write against a fixture holding
three confirmable lines — so a later run failed with "no receipt in the list
still has an item to confirm", which is a suite that works once and then reports
a defect that is not there. It happened twice in one afternoon.

The two previous answers were local: make *this* test create its own state. That
does not work here, because producing a receipt with parsed lines means an
upload and an OCR pass — minutes, and a language download (OCR-1). So the
fixture is restored instead: `e2e/seed.setup.ts` is a project that the sign-in
setup depends on, and it re-seeds before anything reads. The seed deletes the
rows of the household the `demo@stoky.local` account belongs to, so it resets
what the suite owns and nothing else. (Until 2026-10-12 it found that household
by the name *Hogar Demo*, which would have deleted any real household carrying
it; it now goes through the account, in one transaction, and refuses
`NODE_ENV=production`. The production image does not contain it at all.)

Proven by running the journey three times with no manual seeding between, which
is the sequence that used to fail on the third.
---

### ✅ TEST-4: The low-stock badge is unchecked on the card tier

**File:** `e2e/critical-paths.spec.ts` (Low stock, as the seeded household)  
**Severity:** LOW  
**Status:** RESOLVED in Phase 4 — found 2026-08-10 while closing TEST-3

`/inventory` renders the same products twice: a table from `lg`, cards below it,
with only one ever displayed. The low-stock test asserts through
`getByRole("row", …)`, which exists only in the table, and its first assertion
uses `getByText("Stock Bajo").first()` — which on a phone resolves to the
hidden table copy and fails as "hidden" rather than "missing".

`src/app/(dashboard)/inventory/page.tsx` documents this trap in a comment above
the table, which is how it was diagnosed. The test is now pinned to a 1280px
viewport, so it measures the tier its assertions describe.

The consequence is that **the card tier's badge is asserted by nothing**, on the
two viewports where most people will actually read this page. The fix is a
second assertion against the card markup rather than a cleverer selector — a
selector that matches whichever copy is visible would hide the next instance of
this instead of catching it.

**Resolution (Phase 4).** A second `describe` at 390×844 that names the same
three seeded products through `getByRole("listitem")`, asserts the table is
hidden first so it cannot be reading the wrong copy, and keeps the negative
case — Arroz, at 5 of a minimum of 2 — because without it the loop would pass
just as well if every card carried a badge.

It is a browser test and belongs nowhere cheaper: which copy is visible is
decided by a CSS media query, and happy-dom has no layout engine, so both
copies are in its DOM and every rectangle is 0×0 (PROGRESS D34).

Verified it can fail, and precisely: with the badge removed from the card
markup only, the new test goes red and the table test stays green — which is
exactly the gap this entry describes. 90 E2E tests in 3.2 minutes, against 89
before.

---

### ✅ UI-9: Two routes report an empty household when the query failed

**Files:** `src/app/(dashboard)/shopping/page.tsx`,
`src/app/(dashboard)/settings/locations/page.tsx`  
**Severity:** LOW  
**Status:** RESOLVED in Phase 4 — split out of UI-8 on 2026-08-10 when UI-8 was
closed

Both test `if (isLoading)` alone, so on a failed query they fall through and
render the empty state: "no shopping lists", "no locations". That is a lie with
a plausible shape — someone who has ten locations is told they have none, and
the only tell is that adding one appears to do nothing.

Less serious than UI-8, which it was filed with, because it is recoverable by
reloading rather than terminal. Kept separate because the fix is the same
component (`RouteState`) applied to two routes whose loading branch has a
different shape, and folding it into UI-8's commit would have made that commit
touch four routes to fix a defect in two.

**Recurred, fixed 2026-10-06.** `/settings/stores` gated on `isLoading` alone:
a bare "Cargando…" with no title while loading, and a failed or paused query
fell through to a screen with no shops on it. It now renders `RouteState`, and
`route-query-failure.test.tsx` covers it (DESIGN_AUDIT A5.5).

Note that an account with no household now reaches these two routes and sees
the same lie, where before it saw a skeleton. That is not a regression from
this phase — both behaviours are wrong — but it is the most likely way anyone
meets this.

**Resolution.** Both routes now take the same three-state branch as
`/inventory` and `/products`: `isPending || error || !data` hands off to
`RouteState`, which tells a missing household apart from any other failure.

**A third route had it, found 2026-08-11 while designing the offline layer.**
`/shopping/[id]` read `if (isLoading)` and then `if (!list) return
errors.notFound`. TanStack Query's `isLoading` is `isPending && isFetching`,
and a query paused for want of a connection is pending but *not* fetching — so
with no signal the guard was false and the page told someone standing in a
supermarket that the list in their hand does not exist. A genuinely deleted
list must still say so, so the two are now told apart by the error code rather
than by the absence of data.

**And the guard itself was the wrong shape on all five.** `isPending || error
|| !data` replaces a working page with a failure panel the moment a background
refetch fails — the data on screen is still true, only the refresh failed. The
condition is now `!data`: render what is loaded whenever there is anything
loaded, and choose between the four no-data screens only when there is not.

Pinned by `src/__tests__/components/route-query-failure.test.tsx`, six tests
over the two routes. The assertion is deliberately a *pair* — the failure copy
present **and** the empty-state copy absent — because checking only the first
would still pass on a route that rendered both, which is a third wrong screen.
Verified failing before the fix: 4 of the 6 went red with the pages reverted.

---

### ✅ DEBT-6: The services layer still throws bare `Error`

**Files:** `src/server/services/ocr.ts`, `productMatcher.ts`,
`receiptParser.ts`, `openFoodFacts.ts`  
**Severity:** LOW  
**Status:** RESOLVED (Phase 7 slice)

**Resolution:** the decision this entry left open went to typed domain errors
rather than `TRPCError` — `ServiceError` and its `NotFoundError` /
`InvalidInputError` / `UpstreamError` in `src/server/services/errors.ts`,
translated by the same tRPC middleware that handles Prisma's codes, so a
missing row from a service reaches the client as `NOT_FOUND`. The pin in
`src/__tests__/unit/router-errors.test.ts` is flipped: it now asserts no
service throws bare, instead of asserting that one still did. `STATUS.md` and
`REDESIGN_PLAN.md` §10 recorded this while the heading here said OPEN; fixed
2026-08-18.

**Original report follows.**

DEBT-4 was filed and scoped against the routers, and the routers are done. One
layer down, four services still throw bare `Error` — `"Receipt not found"`,
`"Receipt item not found"`, `"Empty image file"`, `"OFF API error: 500"` —
and a procedure that calls one surfaces the whole thing as
`INTERNAL_SERVER_ERROR`. So `receipt.parseReceipt` against a deleted receipt
still reports a server fault for what is a missing row, exactly the symptom
DEBT-4 describes.

Filed rather than fixed in passing (PROGRESS.md D6): the fix is a different
decision from the routers' one. A service is not a tRPC procedure and should
arguably not import `TRPCError` at all — the alternative is typed domain
errors that the routers translate, which keeps the services callable from
somewhere other than tRPC. That choice deserves its own commit.

Pinned by `src/__tests__/unit/router-errors.test.ts`, which asserts that at
least one service still contains a bare throw, so whoever fixes this is sent
back here to close the entry.

---

### ✅ DEBT-5: Missing database indexes

**File:** `prisma/schema.prisma`  
**Severity:** MEDIUM  
**Status:** OPEN

**Issue:**
Several frequently queried fields don't have indexes, which will cause performance issues at scale.

**Missing Indexes:**

1. `StockEntry.productId` - Queried in every stock operation
2. `StockEntry.householdId` (via Product relation) - Queried in inventory overview
3. `PriceRecord.productId` - Queried for price history
4. `Receipt.householdId` - Queried in receipt lists
5. `ReceiptItem.receiptId` - Queried when loading receipt details

**Suggested Additions:**

```prisma
model StockEntry {
  // ... fields ...
  @@index([productId])
}

model PriceRecord {
  // ... fields ...
  @@index([productId])
  @@index([storeId])
}

model Receipt {
  // ... fields ...
  @@index([householdId])
  @@index([status])
}

model ReceiptItem {
  // ... fields ...
  @@index([receiptId])
}
```

**Priority:** Add before Phase 1 if possible, or early in Phase 1

**Resolution.** Sixteen indexes, from a wider criterion than the list above:
every column a resolver filters or joins on, plus every single-column foreign
key — PostgreSQL indexes a primary key and a unique constraint automatically
and a foreign key never, which is the asymmetry this entry is really about.
Two are composite where the query orders as well as filters
(`PriceRecord(productId, recordedAt)`, `Receipt(householdId, createdAt)`), and
`Product.householdId` is added although this entry does not name it — it is the
filter on nearly every resolver in the application.

**Measured at 12,000 stock entries rather than asserted.** One product's
ledger — the hottest read there is, since every consume, transfer and expiry
calculation needs it — went from a 3.6ms sequential scan to a 0.09ms index
scan, about 40×. A screen-sized batch of 200 products went from 6.8ms to
1.9ms.

**And an honest half.** The `householdId` indexes do nothing for reads on a
single-household instance: that household owns the whole table, so the planner
sequentially scans it whatever exists, which the measurement confirmed. They
are there for an instance hosting more than one household and for the
foreign-key checks a delete performs, and `src/__tests__/integration/indexes.test.ts`
says so where it asserts them.

---

## Testing Gaps

### ✅ TEST-1: Database-dependent tests need setup

**Location:** `src/__tests__/integration/`  
**Severity:** MEDIUM  
**Status:** PARTLY ADDRESSED

**Resolution so far:** `scripts/test-integration-local.sh` (run by
`bun run test:integration`) brings up the repo's own `db` and `cache`
services and recreates an isolated `stoky_test` database on every run. See
`docs/TEST_SETUP.md`.

**Closed 2026-08-11, and the "still open" note above was hiding a real defect.**
It said the harness was unverified because Docker was unavailable on this
machine. Docker has been available for some time — the same session that closed
this built a production image and ran containers — and running the harness found
it broken for a different reason entirely: it built its own connection string
from `POSTGRES_PASSWORD`, which `.env` carries alongside a working
`DATABASE_URL` with nothing keeping the two in step. Sourcing `.env`, which the
documented workflow does, made it fail with a bare Prisma `P1000`.

The script now derives from `DATABASE_URL` and swaps only the database name, so
the credentials are whatever already works. 395 integration tests run through
`pnpm test:integration` as documented.

**The lesson is the stale blocker rather than the fix.** "Unverified because the
environment is wrong" is a note that stops anybody looking, and it outlived the
condition it described. A blocker recorded against an environment needs a date
and a way to re-check it, or it becomes a place for defects to hide.

**Original report follows.**

**Issue:**
Integration tests for tRPC routers and services require a test database. Currently, tests are either skipped or will fail without database setup.

**Required Setup:**

1. Create test database schema
2. Add test database URL to environment
3. Set up test fixtures/seeds
4. Add database cleanup between tests

**Suggested Implementation:**

```typescript
// test-setup.ts
import { prisma } from "@/lib/prisma";

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  // Clean database
  await prisma.stockEntry.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.household.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

**Priority:** Complete before writing integration tests for Phase 1 features

---

### 🟡 RUNTIME-1: Serving under Bun raises unhandled rejections Node does not

**Files:** the standalone artefact as served; `playwright.config.ts:267`, `Dockerfile`'s production `CMD`
**Severity:** MEDIUM — the page renders correctly; what is lost is the log, and a Node default is now being relied on
**Status:** PARTLY CLOSED — measured 2026-08-26, re-measured the same day.
**This entry described two causes as one.** The `crypto.getRandomValues()` half
is fixed (`d0e7566`); the `AbortError` half is untouched and is the larger
number. Both measurements are at the end, and one of them contradicts the table
below. The original analysis is left standing — it is right about the chain it
traces, and wrong in its conclusion, and both are worth keeping.

Next interrupts prerendering when a route reaches runtime IO, and signals it
internally with a rejected promise carrying `digest: 'NEXT_PRERENDER_INTERRUPTED'`.
Under Node that signal is caught by Next. Under Bun it escapes to the
process-level handler:

```
⨯ unhandledRejection: Error: Route / needs to bail out of prerendering
  at this point because it used `crypto.getRandomValues()`.
  digest: 'NEXT_PRERENDER_INTERRUPTED'
```

**Isolated to the runtime, one variable.** The same standalone build, the same
generated `NEXTAUTH_SECRET`, three requests to `/login`:

| Runtime | Responses | `unhandledRejection` | Bail-outs logged |
|---|---|---|---|
| `node .next/standalone/server.js` | 200, 200, 200 | **0** | 0 |
| `bun .next/standalone/server.js` | 200, 200, 200 | **3** | 3 |

One per request. A full browser-suite run emitted **1612 of them in 4.4
minutes**, and the suite passed 148/148 — which is the point: every gate is
green, because the pages render.

**Why it is worth an entry rather than a shrug.**

- **It costs the logs.** This project has no error tracking by deliberate
  choice — `STATUS.md` records that every option ships a household's errors to
  somebody else's server — so the container log *is* the monitoring. At one
  rejection per request, a real error is a needle in a flood.
- **It relies on a runtime difference that is not written down anywhere.** An
  unhandled rejection terminates a Node process by default; Bun logs and
  continues. The deployment now depends on Bun keeping that behaviour, and
  nothing in the repository says so.

**What it is not:** a rendering defect. Pages return 200 and the browser suite
is green under Bun.

**The cause, traced rather than guessed.** The stack is minified and names no
application frame, so it was resolved through the chunk's own source map
(`@jridgewell/trace-mapping` over `.next/server/chunks/ssr/*.js.map`). The three
frames are all Auth.js:

```
cx -> @auth/core/lib/utils/web.js:87
cy -> @auth/core/lib/actions/callback/oauth/csrf-token.js:30
cL -> @auth/core/lib/init.js:106
```

**Auth.js mints a CSRF token during initialisation, using
`crypto.getRandomValues()`.** The chain to every page is:

1. the root layout calls `getLocale()`;
2. `src/i18n/request.ts:51` calls `auth()` — this is what makes the language
   follow the account rather than the browser (`265e2f8`);
3. Auth.js initialises, and mints the token;
4. Cache Components sees unrepeatable IO during the prerender attempt and
   raises `NEXT_PRERENDER_INTERRUPTED`;
5. Node's Next catches that signal. Bun's does not.

That also explains the shape of it exactly: **every page route, because every
page uses the root layout, and not `/api/health`, because route handlers do not
prerender.** Confirmed by request — `/offline`, the most minimal page in the
application, raises it too.

~~**So it is not ours to fix by changing the feature.**~~ **That conclusion was
wrong, and it is worth saying why rather than deleting it.** It reasoned from
two options — Bun catching what Next expects to catch, or Auth.js not minting a
token to read a session — and both are upstream, so it stopped. The third
option was in the error message all along: Next asks for the dependency to be
*declared*, with `await connection()`, and then attempts no prerender to
interrupt. The paragraph below weighed `instant = false` and rejected it
correctly; it never asked what else the message offered.

**What this does *not* mean:** that `instant = false` on the root layout is
failing. That marks the segment as allowed to block; it does not stop Next
attempting the prerender and interrupting it, which is the normal path.

---

## Half closed, and the measurements that split it

**`d0e7566` puts `await connection()` in `src/lib/auth.ts`**, so `auth()`
declares that reading a session is request data. Not at the nine call sites: the
error names only the first site that trips it, so fixing them one at a time
reads as no progress — `page.tsx` fixed and the identical message reappears
against `RootLayout`, that fixed and it is nine dashboard routes. That is why an
earlier attempt recorded `connection()` as changing nothing. It had changed
exactly one of two, and only the last line of the stack said so.

It costs no prerendering: the same eight routes are Partial Prerender either
side, because the root layout is already request-bound by the CSP nonce.

**Measured either side of `d0e7566`, on both servers:**

| | dev server, 13 routes | standalone under Bun, 39 requests |
|---|---|---|
| before | 13 — one per route, every request | **50** |
| after | **0** | **0** |

The 50 are the exact error this entry describes, on every page route:
`Route /login needs to bail out of prerendering … because it used
crypto.getRandomValues()`. **So the table at the top of this entry was right,
and production is fixed, not just the developer's console.**

*An earlier revision of this section claimed the standalone artefact raised 0 on
master too, and called the entry's own table unreconciled. That was measured
against a server that had refused to start — the probe used `.env`, whose
`NEXTAUTH_SECRET` is still the example value, and `src/lib/auth/secret.ts`
correctly refuses to boot on it. Every request answered `000` and the log
counted zero of everything. The guard worked; the measurement did not check
whether the thing it was measuring was running. Recorded in `STATUS.md` under
the traps that have made measurements wrong here.*

**What is left is a different error, and it is the larger number.** A full
browser-suite run raises ~1500 of these:

```
⨯ unhandledRejection: Error [AbortError]: The operation was aborted.
    at abort ([native code])   sourceURL: 'node:async_hooks'
```

They arrive when a client abandons an in-flight request, which a browser suite
does constantly and `curl` never does — which is why the standalone measurement
above sees none of them. **They pre-date the fix and are unrelated to it:** the
same 21-test chromium subset raised **250 on master and 253 with `d0e7566`**,
and 0 `crypto` errors in both. Attributing the whole 1612 to the prerender chain
was the error this entry is being corrected for.

So the remaining work is the `AbortError` family, it is Bun/Next interop rather
than application code, and the argument above for why it is worth an entry —
the log is this project's only monitoring — applies to it unchanged.

**What it is not**, measured 2026-08-26 against the standalone artefact under
Bun, **each probe re-run after confirming the server answers 200**. These are
negative results and they are the useful half of the report, because each one is
a hypothesis somebody would otherwise spend an afternoon on:

| Tried | AbortErrors |
|---|---|
| 39 ordinary requests over 13 routes | 0 |
| 10 requests abandoned mid-flight (`curl --max-time 0.05`) | 0 |
| 10 RSC requests (`RSC: 1`) | 0 |
| 10 RSC **prefetch** requests (`Next-Router-Prefetch: 1`) | 0 |

So it is not a client hanging up, and not the router prefetch that
`partialPrefetching` enables — the two obvious candidates. Nothing in `src/`
aborts anything server-side; the one `AbortController`
(`src/lib/offline/sender.ts:48`) is the offline queue's send timeout and runs in
the browser.

What *does* reproduce it is the browser suite, at a steady **~10–12 per test**
across two sample sizes (250 over 21 tests, ~1500 over 148) and from the seed
project onwards. ~~Every one of those tests is signed in and none of the probes
above were, which is the next thing to vary.~~

---

## Reproduced and localised, 2026-08-27

**Being signed in was not the variable.** With a session verified to work —
`/dashboard` answering 200 rather than redirecting — 39 page requests, 13 RSC,
13 prefetch and 5 tRPC calls produced **0**. That hypothesis is dead.

What separates the browser suite from `curl` is that a browser *prefetches*.
Driving a real browser at the same server, instrumented per phase:

| Phase | AbortErrors |
|---|---|
| launch browser, new context, new page | 0 |
| `goto /dashboard` (networkidle) | **+11** |
| `goto /inventory` (networkidle) | **+10** |
| close page, close context, close browser | 0 |

So it is not Playwright's lifecycle and not teardown — it is the page load. And
the correspondence is exact: **11 AbortErrors, 11 requests the browser reports
as `net::ERR_ABORTED`**, one for one.

**They are router prefetches.** Every one is `<route>?_rsc=…` carrying
`next-router-prefetch: 3` — one per navigation link. The count tracks the links
on the page:

| Page | links | prefetches | browser aborts | AbortErrors |
|---|---|---|---|---|
| `/login` (unauthenticated) | 1 | 2 | 1 | **1** |
| `/kitchen` | 15 | 14 | 7 | **7** |
| `/dashboard` | 27 | 25 | 9 | **11** |

`/login` is not signed in and still produces one, which settles the earlier
hypothesis from the other direction.

~~Next prefetches the links, the browser cancels most of them, and each
cancellation leaves an unhandled `AbortError`.~~ **That reading was wrong, and
the table above is why it was believable.** On `/dashboard` the browser
cancelled 9 requests and the server raised 11 rejections, which looked close
enough to be one-for-one. It is not — the two numbers are independent and
happened to be similar.

**What actually produces one is a prefetch that *completes*.** Isolated in
separate runs against the same server:

| Ten `next-router-prefetch: 3` requests | AbortErrors |
|---|---|
| completed, bodies drained | **+10** |
| completed, bodies never read | **+10** |
| aborted mid-flight after 2 ms | **0** |

The abort was never the cause. Cancelling is if anything *protective*: a request
the client drops before the server finishes raises nothing.

**The narrowest shape that reproduces it**, one request at a time:

| Request | AbortErrors |
|---|---|
| plain page | 0 |
| `RSC: 1` alone | 0 |
| `RSC: 1` + `Next-Router-Prefetch: 3` | **1** |
| the same without a state tree | **1** |
| `RSC: 1` + `Next-Router-Prefetch: 1` | 0 — and answers **404** |

That last row explains the earlier probe completely: `1` is not a prefetch kind
this version accepts, so the request it sent never reached the path at all.

**And the runtime is the variable.** The same artefact, the same client, the
same five requests, served by `node .next/standalone/server.js`: **0 on every
row**, and 0 for the ten-request case. So this is a Bun/Next interop defect that
our configuration exposes, not a defect in the configuration.

**And `curl` reproduces it after all** — the reason it did not is the whole
lesson of this entry repeating itself.

`curl` appeared immune while `fetch()` raised one every time, from Bun *and*
Node. The two were compared against an echo server: the only header differences
were `user-agent`, `connection` and `accept-encoding`, and `curl` still raised 0
when given Bun's user-agent, an explicit keep-alive, two requests on one
connection, and each of `gzip`, `br`, `zstd` and all four at once.

Then the status was printed instead of discarded. **`curl` was getting a 307.**
A prefetch to `/inventory` redirects, `fetch()` follows redirects by default and
`curl` without `-L` does not, so every `curl` probe ever run against this — the
four in the original report included — measured a redirect that rendered
nothing. `-o /dev/null` without `-w` is what hid it.

So the reproduction is one line:

```
curl -sL -H 'RSC: 1' -H 'Next-Router-Prefetch: 3' http://127.0.0.1:PORT/inventory
```

One unhandled `AbortError` under `bun .next/standalone/server.js`, none under
`node`. That is the upstream report, and it needs no browser, no session and no
suite. **A ready-to-file draft is
`docs/reproductions/runtime-1-upstream-report.md`** (2026-08-31), alongside the
self-checking `runtime-1-abort.sh` — re-run on 2026-08-31, still 10/0. Not yet
filed against Bun; the issue URL goes here once it is.

The same mistake, three times in three days: a probe that never checked what it
was actually measuring. First a server that had refused to boot, then a port
held by somebody else's server, now a redirect nobody looked at. `STATUS.md`
trap 9 has both earlier ones; this is the third face of it.

### `partialPrefetching` decides what the client asks for, not what the server does

Rebuilt with `experimental.partialPrefetching` removed and measured the same
three pages on a second server:

| Page | prefetches (on → off) | browser aborts | AbortErrors |
|---|---|---|---|
| `/login` | 2 → 2 | 1 → **0** | 1 → **0** |
| `/kitchen` | 14 → 14 | 7 → **1** | 7 → **0** |
| `/dashboard` | 25 → 28 | 9 → **1** | 11 → **0** |

~~The same prefetches are still issued. What changes is that they stop raising
anything server-side.~~ ~~**So this is not a pre-existing interop defect that
happened to be noticed here.**~~ **Both wrong, and the reproduction script
found it.** `docs/reproductions/runtime-1-abort.sh` reproduces on a build with
the option **removed** — 10 of 10 under bun, 0 under node.

The prefetches are not the same. With the option off the router sends a
different *kind*: `next-router-prefetch: 1`, 28 of them on `/dashboard`, and the
server raises nothing. With it on it sends kind `3`, and every completed one
raises. Send kind `3` by hand and it raises whether or not the option is
configured.

So the shape is:

| | client sends | server raises (bun) |
|---|---|---|
| `partialPrefetching: true` | `next-router-prefetch: 3` | one per completed request |
| `partialPrefetching` absent | `next-router-prefetch: 1` | none |
| either, header sent by hand | `3` | one per completed request |

**The option governs the client; the defect is in the server either way.** That
is better news for the report than the earlier reading: a maintainer needs no
configuration to see it, only the header.

What remains true is the dating. `partialPrefetching` landed in `2b6eba5` on
2026-08-25 and this entry was filed on 2026-08-26, so every measurement in it —
including the "250 on master" baseline — was taken with the option on, and the
flood is not older than the option. The *defect* is.

### The decision: `partialPrefetching` stays on

`partialPrefetching` is Next 16.3's instant-navigation half — one reusable shell
prefetched per route rather than one request per link — and it was turned on
deliberately. Against it: the container log is this project's only monitoring by
choice, and ~10 rejections per page load is a flood a real error hides in.

Three answers were put to the owner:

1. **Keep it and accept the log noise.** The pages render, the suite is green,
   and the cost is monitoring nobody can read.
2. **Turn it off.** Clean log, and the feature goes with it.
3. **Keep it and handle the rejection.** A narrow `unhandledRejection` filter
   that drops an `AbortError` from an abandoned request and logs everything
   else. This is the same shape as `d0e7566` — telling the runtime something
   true rather than turning a feature off — but a filter that is one word too
   broad silently eats real errors, which is the failure this entry is about.

**Answered 2026-08-27: keep it.** `next.config.ts:40` is unchanged and has
carried `partialPrefetching: true` since `2b6eba5`; the decision cost no code,
which is the point of having asked before writing any.

What that decides, and what it does not:

- **The feature is not the defect.** Node serves the identical artefact and the
  identical requests with zero rejections, so what our configuration does is
  *expose* a Bun/Next interop bug, not cause one. Turning it off would have hidden
  a real defect and lost a real feature.
- **The log cost is accepted, and it is the live one.** Roughly ten rejections
  per page load, in the only monitoring this project has. Anyone reading a
  container log needs to know these are noise — which is why this entry stays
  open rather than being closed as "decided".
- **Option 3 is deferred, not rejected.** It stops being speculative once the
  upstream report has an answer: a filter written against a confirmed cause can
  be narrow, and one written now would be guessing at what to match.

Still open, and the remaining work is the upstream report.
`docs/reproductions/runtime-1-abort.sh` is what it should be written from: it
serves the same artefact under both runtimes, sends the requests, counts, and
**exits non-zero unless bun raises and node does not** — a check rather than a
printout. It needs no browser, no session and no suite, and no configuration
either.

Four things it does that four earlier probes did not, each of which produced a
confident wrong answer first: it follows redirects, it waits on the HTTP status
rather than on curl's exit code, it confirms the process it started is the one
answering, and it supplies a secret long enough for the server to render.
Filed rather than fixed in passing (D6).

### Re-measured for Bun 1.4.3, 2026-10-12: Next 16.4.0 is the variable, not Bun

Measured because the pin moved to 1.4.3, whose notes include a stricter
`Bun.serve` — a change at exactly this layer could have moved the count either
way. It did not; the framework had already moved it.

`docs/reproductions/runtime-1-abort.sh` on this tree, alternating the glibc
binaries from `oven/bun:1.4.0-slim` and `oven/bun:1.4.3-slim` (1.4.0, 1.4.3,
1.4.0, 1.4.3), each server answering 200 and printing its ready line first:
**bun 0, node 0, every time**, and the script exits 1 — "NOT the shape RUNTIME-1
describes". The prefetches were not failing to render: by hand, the same
`curl -sL` with `Next-Router-Prefetch: 3` answers 200 with a 4 KB RSC body.

So the split was taken at the Next.js move, `d258c6e` (16.3.8 → 16.4.0), with
both sides built by `git archive <sha> | docker build --target builder` and
served from the image's own `.next/standalone` with `bun server.js` — the image's
1.4.0, then a 1.4.3 musl binary mounted over it. Ten kind-3 prefetches to
`/inventory`, all answering 200:

| Build | Next | Bun 1.4.0 | Bun 1.4.3 |
|---|---|---|---|
| `7365252` (the parent) | 16.3.8 | **10** AbortErrors | **10** AbortErrors |
| `d258c6e` | 16.4.0 | 0 | 0 |

The 16.3.8 / 1.4.0 cell was run twice, 10 both times. **1.4.3 neither fixes nor
causes it; 16.4.0 is where the one-line reproduction stops.** The browser suite
agrees as far as one run can: `bun run test:e2e` under 1.4.3 passed 181/181 and
its captured server output — stdout and stderr both, since the security log's
`console.warn` lines are in it — holds no `AbortError` and no
`unhandledRejection`, where the entry above counted ~1500 per run.

Not closed by this. What 16.4.0 changed in the prefetch path has not been read,
so "fixed upstream" is an inference from two builds, not a cause; and
`runtime-1-abort.sh` and `runtime-1-upstream-report.md` still describe 16.3,
where the shape holds. Closing the entry, and retiring or re-pointing the
draft report, is its own change.

### ✅ AUTH-1: An inert adapter picks a session strategy the schema cannot serve

**Files:** `src/lib/auth.ts:71` (the adapter), `:210` (`strategy: "jwt"`), `prisma/schema.prisma`
**Severity:** MEDIUM — nothing is wrong today; the hazard is that the thing holding it together looks removable
**Status:** RESOLVED 2026-08-27, same day — found while answering "why Auth.js rather than NextAuth, and could the JWT be managed server-side". See *How it closed*.

`authConfig` sets `adapter: PrismaAdapter(prisma)`. With credentials sign-in and
a JWT strategy the adapter does **no work**: `@auth/core`'s credentials branch
calls `callbacks.jwt` and `jwt.encode` unconditionally and never reaches it.
Nothing persists a session, and the schema has no `Session`, `Account` or
`VerificationToken` model — it never needed one.

**But `@auth/core/lib/init.js` reads:**

```js
strategy: config.adapter ? "database" : "jwt",
```

The presence of an adapter picks the default strategy. So `session.strategy:
"jwt"` is not restating a default — it is overriding one this configuration
cannot survive, and it reads like documentation.

**Measured rather than reasoned.** With that single line removed and the
standalone artefact rebuilt and served:

| | Result |
|---|---|
| sign-in | **302, and it sets a session cookie** |
| every session read | `AdapterError` / `SessionTokenError`, cause `prisma.session.findUnique is undefined` |
| `/api/auth/session` | `null` |

Not a crash. An application that answers sign-in successfully and then has no
session — the failure mode that is hardest to notice, produced by deleting a
line that looks like a comment about a default.

~~**Cost of closing:** either delete the adapter … Deciding between them is the
same decision, so it is filed rather than fixed in passing (D6).~~

---

## How it closed

**The decision dissolved when it was measured.** The two options were not
alternatives. Adding `Session`, `Account` and `VerificationToken` buys nothing
while sign-in is credentials-only, because credentials can never use a database
session — the branch above mints a JWT unconditionally. They would matter for an
OAuth provider, which can bring them when it arrives.

So the adapter went. Measured on the standalone artefact before touching
anything else:

| | With adapter + explicit `"jwt"` | With adapter, no explicit strategy | **No adapter** |
|---|---|---|---|
| sign-in | 302, cookie set | 302, cookie set | 302, cookie set |
| `/api/auth/session` | the session | **`null`** | the session |
| adapter errors | 0 | one per read | **0** |

With no adapter, `"jwt"` is the *default* rather than an override, so the trap
is gone rather than commented. `@auth/prisma-adapter` left `package.json` with
it — nothing else imported it.

The comment in its place explains why there is no adapter, and that adding one
back is a schema change rather than a config change. That is the half worth
keeping: the hazard was never the adapter, it was that an adapter silently
chooses a strategy.

Verified: typecheck, lint, verify:local, `auth.flow` + `capabilities` +
`session.freshness` at 36 pass, and `bunx playwright test` 148/148.

**What this is not.** It is not an argument for or against JWT sessions. Auth.js
gives no choice here: credentials sign-in always produces a JWT.

### ✅ BUILD-1: The image and CI pin different bun versions, and nothing compares them

**Files:** `Dockerfile:40`, `.bun-version`, `src/__tests__/unit/bun-version.test.ts`
**Severity:** LOW — no gate is wrong today; the hazard is that neither can go red
**Status:** RESOLVED `e2a6a8e` — found 2026-08-25, closed 2026-08-26. **The
direction taken is the one this entry argued against**, and the argument below
is left standing rather than rewritten to agree with what happened. See
*How it was closed* at the end.

`.bun-version` says `1.3.14` and `Dockerfile:40` says `oven/bun:1.4.0-alpine`.
CI's three `setup-bun` steps read the first; `docker compose exec app` runs the
second. So the suites run on a different bun depending on where they are asked,
which is the exact gap `dc06795` moved development into the image to close, open
in the place it most matters.

**Nothing detects it.** There is no check comparing the two — unlike the
Playwright pin, which has a fail-fast step in `ci.yml` that exits 1 when the
container tag and `package.json` disagree. And CI never builds the stage the
Dockerfile pin lives in: both image jobs build `target: production`, which
carries no bun at all. So the image's runner reaches no gate.

**A direction has to be chosen, and the two are not symmetric.**

- *Dockerfile back to `1.3.14-alpine`.* Everything lands on the version the
  suites are written against — `5ec7068`'s charter for `.bun-version` in as many
  words — and on which TEST-5's rate, its reproduction's calibration and the
  pending upstream report are all measured. The tag exists (amd64 and arm64).
  The 1.4.0 in the Dockerfile was never *chosen*: the pre-plan records it as what
  the floating `1-alpine` tag happened to resolve to on the day the stage landed.
- *`.bun-version` forward to `1.4.0`.* Was investigated on 2026-08-25 and is
  **not** recommended as things stand. It fixes nothing — 1.4.0 still reproduces
  TEST-5 (see that entry) — and `.bun-version` governs strictly more than the
  Dockerfile pin does: three CI jobs, the 443-test integration suite where TEST-5
  lives, `check:contrast`, `check:links`, and the seed the whole browser suite
  depends on. The measurements cannot exclude that 1.4.0's failure rate is worse,
  and all three batches leaned that way. Everything was otherwise exercised green
  under it, so the option stays open; it just buys nothing today.

Note that either way the two would match only as *version strings*: the image
takes the musl build and `setup-bun` on the runners takes glibc.

**Cost of closing:** one line, plus building the `development` stage and running
the two suites inside it, since no gate does. Worth pairing with the check that
would have caught this on the push that created it — the Playwright assertion is
the shape to copy. Filed rather than fixed in passing (D6), because choosing the
direction is a judgement, and it sits next to Open decision 1 of the image
pre-plan (whether CI moves into the image at all), which would retire
`.bun-version` entirely and make the question moot.

## How it was closed, and what that leaves

`.bun-version` moved **forward to 1.4.0** — the option this entry investigated
and did not recommend. It was the owner's explicit instruction, given while
deciding the Bun runtime migration, and it is recorded here as a choice rather
than as an oversight so that reversing it is a one-line decision and not an
archaeology exercise.

**What the choice buys.** The two numbers agree, and
`src/__tests__/unit/bun-version.test.ts` asserts it — which is the check this
entry asked for, in the shape it named: the Playwright pin's fail-fast
assertion. It also fails if the tag goes back to something floating. Verified
red by putting `1.3.14` back. And the deployed runtime is now Bun itself
(`b81102d`), so the image's pin governs what serves requests; aligning CI to it
rather than the reverse follows from that.

**What the choice does not answer, and this entry still means.** 1.4.0
reproduces TEST-5, so nothing about the flake is fixed by the move.
`.bun-version` governs strictly more than the Dockerfile pin did — three CI
jobs, the integration suite where TEST-5 lives, `check:contrast`,
`check:links`, and the seed the browser suite depends on — and the measurements
could not exclude that 1.4.0's failure rate is *worse*, with all three batches
leaning that way. If TEST-5's rate rises after this, the first thing to try is
one line back to `1.3.14` in both files.

**One paragraph above is now out of date and is corrected here rather than
edited away.** It said CI never builds the stage the Dockerfile pin lives in,
so the image's runner reaches no gate. `defd147` changed that: `quality` and
`test` build `target: development` and run their suites inside it, so the
image's bun now runs both. Measured before the change landed — `quality` green
in the image, and `test` at 609 unit, 611 component, 486 integration.

### ✅ BUILD-2: Development image cannot run the tests CI mounts into it

**Files:** `Dockerfile`, `scripts/ci-in-image.sh`
**Severity:** HIGH — image publication blocked
**Status:** RESOLVED 2026-09-25

[CI run 34907244706](https://github.com/NGarate/stoky/actions/runs/34907244706)
failed seven unit tests. Five bootstrap tests could not spawn `bash`, which
the Alpine development image did not install. Two tests that inspect the
checkout failed Git's ownership check: the runner owns the bind-mounted
`/app`, while the container runs as root. Neither failure was TEST-5.

The development stage now installs Bash and configures Git's system
`safe.directory` for exactly `/app`. Production gains neither tool nor this
trust setting. The existing tests provide the regression check: in disposable
containers, removing Bash reproduced the five failures, and disabling system
Git configuration reproduced the two ownership failures. With the image
intact, all 24 tests across `dev-local.test.ts`, `service-worker.test.ts` and
`ledger-shas.test.ts` pass against the mounted checkout.

Reproduce the passing check after building the development image:

```bash
docker build --target development -t stoky-dev:ci .
docker run --rm -v "$PWD:/app:ro" -v /app/node_modules stoky-dev:ci \
  bun test src/__tests__/unit/dev-local.test.ts \
  src/__tests__/unit/service-worker.test.ts src/__tests__/unit/ledger-shas.test.ts
```

---

### ✅ TEST-8: `resolveScan` "refuses the same key carrying a different barcode" fails about one full run in four

**Location:** `src/__tests__/integration/resolveScan.test.ts:150`  
**Severity:** LOW (test reliability; the cause was a small product defect)  
**Status:** RESOLVED 2026-10-08 in `395570d` — reproduced on `master`, not introduced by the review branches

**Resolved 2026-10-08.** It was not the test. `withReplay` answered a reused
key with `return answerFromRecord(...)` from a `catch` whose `finally` awaits
`sweepExpired`; an async function adopts a returned promise only once
`finally` completes, so a refusal that settled before the sweep sat rejected
with no handler — an unhandled rejection, which Bun reports against the
running test even though the caller then received it. That is why the trace
had no `refusal()` frame. `return await` fixes it. `replay.refusal.test.ts`
makes the sweep slow so the race always goes the bad way: 3 of 3 failures
before, 3 of 3 passes after, and three full integration runs green. It failed
CI on PR #8 on 2026-10-07, which is what moved it from documented to fixed.
The receipt-processing hypothesis below was wrong.

**Measured 2026-10-06:** the integration tier failed this one test in 1 of 4
full runs on `fix/project-review-2026-10-05` and in 1 of the 3 clean full runs
on `master` (two further master runs were disturbed by a dependency reinstall
and are not counted). Alone, the file passed 3 of 3. CI passed it.

The failure is an uncaught `TRPCError: This key was already used for a
different change` (`replay.ts` `answerFromRecord`) reported against the test
itself, not the `expect(error.code)` inside `refusal()`. That points at the
*first* `resolveScan` call meeting an already-claimed key, although
`envelope()` draws a fresh `crypto.randomUUID()` per test. Not yet explained;
the receipt tests that run just before it alphabetically leave background
processing that logs P2025 after their cleanup, which is the first thing to
rule in or out.

### ✅ TEST-7: ProductRating tests fail in the component suite but pass alone

Found 2026-09-08 while verifying the local dependency setup repair, using Bun
1.4.2 and dependencies restored from `bun.lock`. `bun run verify:ci` reaches
the component tier, which reports 646 pass / 7 fail. All failures are in
`src/__tests__/components/ProductRating.test.tsx`, with an empty rendered div.
Running `bun test --preload ./src/__tests__/setup/register-dom.ts
src/__tests__/components/ProductRating.test.tsx` gives 7 pass / 0 fail.

Resolved 2026-09-12: `ProductDetailStepper.test.tsx` and
`ProductDetailDelete.test.tsx` mocked ProductRating with a null component for
the whole Bun process. Removing those two unnecessary mocks lets the detail
tests render the real component and restores all seven rating assertions.
Measured before removal: 646 pass / 7 fail; after removal: 653 pass / 0 fail
across 60 files. The existing rating tests detect the regression without a new
assertion or a runner workaround.

### ✅ TEST-6: Two inert mobile skips cite a phase that closed

**File:** `e2e/critical-paths.spec.ts:370,422`
**Severity:** LOW — suite hygiene, not a product defect
**Status:** RESOLVED 2026-08-27 — found 2026-08-17 while re-auditing the journeys. See *How it closed* at the end.

Both guards read `test.skip(({ isMobile }) => Boolean(isMobile), "Phone UI is
Phase 4")` and date from D9, when the dashboard had no mobile navigation and
the stock forms were desktop-first. Every fact in that justification has since
changed — the bottom bar landed in Phase 2b, every control was raised to the
AAA floor, Phases 4 and 5 closed — and D9 said removing the skip was part of
the phase that closed without removing it.

They are also **inert**: since D33 stopped the matrix multiplying, no project
with `isMobile` runs `critical-paths.spec.ts` at all (Mobile Safari runs only
the two layout specs), so the guards cannot fire and have not for weeks. The
phone-width *rendering* of these routes is covered — the a11y suites sweep
every route at 390px on chromium — but the interactive flow at a phone
viewport is not, and that scoping decision now lives implicitly in two dead
guards citing a dead reason.

**Cost of closing:** delete the two guards and their comment, and either state
the D33 scoping where the tests are, or run the two describes on a mobile
project once to see whether anything actually fails. Filed rather than fixed
in passing (D6).

---

## Run on a mobile project, 2026-08-27: four of eight fail

The second option, taken. `critical-paths.spec.ts` was temporarily added to the
Mobile Safari project and both guards removed, so the eight tests in those two
describes ran at an iPhone 12 viewport for the first time.

**4 passed, 4 failed.** So deleting the guards on their own would have turned
the suite red, which is the answer this entry needed and could not have been
reasoned to.

**But the failures are the harness, not the product**, and the evidence is a
screenshot rather than an inference. `test-failed-1.png` for "should create
product and verify in list" shows the phone screen rendering exactly what it
should: the "Productos" heading, both actions, the product's own card with its
title link, its `Sin stock` badge, its stock, brand and category, its Ajustar /
Historial / Precios row, and the bottom navigation. Nothing is missing and
nothing is cut off.

What fails is how the tests look for it:

| Test | Why it fails |
|---|---|
| create product and verify in list | `locator('text=' + name).first()` matches **8** elements; the first in DOM order is a hidden `role="status"` region, not the product |
| edit a product | `a:has-text(name)` resolves to 8, clicks the first, times out |
| delete an unused product | same |
| consume stock from product | `page.goto("/inventory/consume")` interrupted by a navigation to `/inventory/add` |

The first three are one defect in the page objects: a text locator that was
unambiguous when these ran only on chromium is not unambiguous now, and
`.first()` picks whichever the DOM happens to order first.

~~**One thing is not explained and is not being written off.** The status region
the locator caught reads *"Ya tienes «E2E Test Product …» con ese nombre"* — a
duplicate-name refusal, which means the create was submitted **twice**.~~
**Wrong, and wrong in a way worth naming.** The captured text was truncated —
`Ya tienes «E2E Test Product …» con es…` — and "con es…" was completed from
assumption as *"con ese nombre"*. The key is `products.new.barcodeTakenBy`:
**"con este código de barras"**. Nothing about a name, and nothing about a
second submit.

What it actually is: `products/new/page.tsx:132` runs a live
`product.getByBarcode` query on the typed barcode, and `takenBy` renders a
warning naming whichever product holds it. After the create succeeds, that query
— still mounted — finds the product just created with that barcode and warns
about it. The control doing its job, one moment after it was useful.

So **all four failures are the harness**, with no real-defect candidate left.

---

## How it closed

All four things it needed, and the measurement either side.

**The locators.** `text=${name}` and `a:has-text(name)` matched the row's three
action links — "Ajustar de «X»", "Historial de «X»", "Precios de «X»" — and a
hidden `aria-live` region, eight elements in all, and `.first()` took whichever
the DOM ordered first. They are `getByRole("link", { name, exact: true })` now,
which is the row's title link and only that. This was a latent fragility on
chromium too: it passed there by luck of DOM order, not by aiming at anything.

**The navigation race.** Dismissing the stock dialog starts a client navigation
back to `/inventory/add`, and a `goto` issued into that window dies. Worth
recording that `waitForLoadState()` does **not** fix it — the app's navigation
begins after the current load has settled, so the wait returns before there is
anything to wait for. Waiting for the URL it is heading to is what lands it.

**The guards** are deleted, and the comment in their place says what is actually
true: no project with `isMobile` matches this file, Mobile Safari runs the two
layout specs, and that is D33's deliberate scoping rather than a phase that
never got cleaned up.

**Re-measured the same way**: 4 failed / 4 passed before, **8 passed / 0 failed**
after. The scoping is unchanged — these still run on chromium only — so what
the fix buys is that the scoping is now a choice rather than a wall. Full suite
148/148 with the mobile project untouched.

*(The mistake is the same shape as the probe traps in `STATUS.md` trap 9:
reading what was expected instead of what was there. A truncated string is not
evidence until the key is looked up.)*

### ✅ TEST-2: Mock external API calls in tests

**Files:**

- `src/__tests__/unit/openFoodFacts.test.ts`
- `src/__tests__/integration/openFoodFacts.comprehensive.test.ts`

**Severity:** MEDIUM  
**Status:** RESOLVED 2026-08-03

**Resolution:** No test makes a real HTTP request. The integration suite
replaces `global.fetch` with a spy; the unit suite's caching tests now stub
`global.fetch`, count calls and restore the original afterwards. The previous
placeholder test — which only asserted that `clearCache` and `clearAllCache`
were functions — was replaced with four tests that actually exercise cache
hits, per-barcode invalidation, full invalidation and key isolation.

**Original report follows.**

**Issue:**
Tests for OpenFoodFacts service will make real HTTP requests. This is slow, flaky, and rate-limited.

**Suggested Fix:**
Mock `global.fetch` in tests:

```typescript
beforeEach(() => {
  global.fetch = mock(() => 
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        code: "123456789",
        status: 1,
        product: {
          product_name: "Test Product",
          // ...
        }
      })
    })
  );
});
```

**Priority:** Fix before running tests in CI

---

## Documentation Gaps

### ✅ DOCS-1: Missing API documentation

**Severity:** LOW  
**Status:** OPEN

**Issue:**
No API documentation exists for the tRPC procedures. This makes it hard for frontend developers to understand available endpoints.

**Suggested Solution:**
Add JSDoc comments to all router procedures:

```typescript
/**
 * Search for products by name using fuzzy matching (pg_trgm)
 * @param input.query - Search query string
 * @param input.limit - Maximum results (default: 10)
 * @returns Array of products with similarity scores
 */
searchByName: protectedProcedure
  .input(productSearchSchema)
  .query(async ({ ctx, input }) => { ... })
```

**Priority:** Low, can be addressed in Phase 2

**Resolution — 58 of 58, and not in the shape suggested above.** "Search for
products by name" over `searchByName` restates the identifier and costs a reader
a line. What each docblock carries instead is what the signature cannot say:
what the procedure refuses, what it writes, which role may call it and why, and
what about it will surprise somebody.

Each router also gets a paragraph, which turned out to be where most of the
value was. `inventory` opens by saying stock is a ledger rather than a number,
because every oddity in that file follows from it. `receipt` opens with the
state machine, because its ten procedures are edges of one and make little sense
read individually. `shopping` says that three of its eleven are not about lists
at all.

**It found four defects in four routers**, which is the argument for doing it at
all — documenting a procedure honestly means establishing what it does, and four
of the assumptions this codebase's own author held were wrong:

- `auth.me` has no callers, so the freshness rationale it would obviously be
  given is fiction.
- `addStock` verifies the store *before* its transaction, not inside it.
- `product.delete` refuses rather than cascades, and blames the caller (PROD-1).
- A shopping item with neither a product nor a name is accepted (SHOP-1).

Each was checked against the code or a live database rather than against memory.
A docblock that is confidently wrong is worse than none.

---

### ✅ DOCS-2: Missing environment setup instructions

**Severity:** MEDIUM  
**Status:** RESOLVED 2026-08-03

**Resolution:** `README.md` now covers prerequisites, setup and the command
ladder; `docs/LOCAL_BOOTSTRAP.md` documents the clone-to-running-app path and
its success checks; `docs/TEST_SETUP.md` covers test database configuration and
troubleshooting. `prisma/seed.ts` makes the seeding step real.

**Original report follows.**

**Issue:**
`.env.example` exists but there's no documentation on how to:

- Generate `NEXTAUTH_SECRET`
- Set up PostgreSQL locally
- Configure Docker for development
- Run migrations
- Seed database

**Suggested Addition:**
Create `docs/setup.md` or expand README with:

1. Prerequisites (Node.js 24, Docker, Bun)
2. Environment variable explanations
3. Step-by-step setup commands
4. Troubleshooting guide

**Priority:** Complete before onboarding new developers

---

### ✅ REV-1: The receipt router's prose promised what its code did not do

**Files:** `src/server/trpc/routers/receipt.ts`, `src/lib/validations/receipt.ts`,
`src/server/services/receiptParser.ts`
**Severity:** HIGH (the CREATE injection was cross-household; the rest
double-booked stock)
**Status:** RESOLVED — the discordance-closure plan
(`docs/superpowers/plans/2026-08-29-discordance-closure.md`)

A full-codebase review found the receipt router a generation behind the
codebase's own conventions: `applyReceipt` claimed "in one transaction" over
sequential unwrapped writes; the state machine was enforced on one edge of
six, so `confirmAll` could drag APPLIED back to CONFIRMED for a double
apply; `action: "CREATE"` with a foreign `productId` and no `customName`
bypassed both the ownership check and the create branch (SEC-1's shape, a
third time); `saveParsedItems` appended, doubling lines on any re-parse; and
its lookups answered foreign ids with FORBIDDEN, confirming they exist. Each
is closed by a commit that made the prose true rather than deleting the
promise, except `parseReceipt`/`matchItems`, which were dead public surface
and are gone. The one window that stayed deliberately open — a `confirmItem`
racing an apply on an individual line could land between the items read and
the entry writes — closed on 2026-08-31 (DEFERRED.md item 1): `confirmItem`
re-checks the status under `FOR UPDATE` on the receipt row inside its own
transaction, pinned by a forced-interleaving test verified red twice without
the lock. The pattern worth keeping: every one of these hid in the
one router whose comments were written before the conventions were, and the
review found them by diffing prose against code — a false docblock is a
defect here, not a nuisance.

---

## What to fix next

This section once ranked a backlog. Everything it ranked is closed, and the
detailed entries above are the authority — so it now just names what is open,
which is short:

- **TEST-5** — upstream (bun). Wants an issue filed against **bun 1.4.0** with
  the reproduction in `docs/reproductions/`, not more work here. Upgrading is
  not the fix: 1.4.0 was measured on 2026-08-25 and still reproduces. On
  2026-10-12 the reproduction failed 0 in 80 on 1.4.0 *and* 1.4.3 under load,
  so before filing, it needs a recipe that reproduces on today's tree. Its
  honest cost: roughly one `verify:ci` or CI `test` job in seven goes red
  spuriously; re-run before investigating.
- **What the 2026-10-12 security review filed rather than fixed** — LOC-2,
  OFFLINE-1, SHOP-2, DB-1, UPLOAD-1 and TEST-9. None lets one household read
  or change another's data, though UPLOAD-1 can cost all of them their service.
  TEST-9 is a missing test, the cheapest of them.
  OFFLINE-1 has the most specified fix (a client-side age gate) and SHOP-2 the
  smallest (LOC-1's lock); DB-1 and UPLOAD-1 each need a schema change, and
  DB-1 a data audit before it.
- Everything else that remains is *unbuilt or human-shaped, not a defect*, and
  lives in `docs/REDESIGN_PLAN.md` §10: the three manual passes, T7, and
  Phase 8's done-when — the owner repeating their pass. The Phase 7 review
  document, the ± stepper, the per-device screen choice and TEST-6, which this
  list once carried, have all closed; the entries above name the commits.

---

## Notes

- The tail of this file once carried a status summary ("the UI component
  library is the largest unstarted body of work", "Docker is unavailable",
  "rate limiting is the notable hole") that had been false for weeks while the
  entries above it were kept true — the same lesson as the summary table, one
  screen lower. Status lives in `docs/STATUS.md`; this file holds defects.

For gate results and overall project state, see `docs/STATUS.md`.
For which phase closed each item, the entries above name it; for what remains,
`docs/REDESIGN_PLAN.md` §10.
