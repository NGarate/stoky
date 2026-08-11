# Stoky - Issues & Technical Debt

## Overview

This document tracks open issues and technical debt. It started as the Phase 0
(Foundation) code review and is kept current as items are fixed.

**Last Updated:** 2026-08-10  
**Status:** 3 critical issues resolved, 1 open; 5 debt items open.
The interface findings opened during the Phase 2b design audit are closed except
A11Y-1 and the wording items.

For overall project state and gate results, see `docs/STATUS.md`.

### Summary

| ID | Title | Status |
|---|---|---|
| CRITICAL-1 | `deleted_at` in product search | ✅ Resolved 2026-08-03 |
| CRITICAL-2 | Auth pages were placeholders | ✅ Resolved (commit `7f393ac`) |
| CRITICAL-3 | Missing database migrations | ✅ Resolved (`20260213234844`) |
| CRITICAL-4 | No rate limiting on auth | ✅ Resolved (Phase 3) |
| DEBT-1 | Minimal password validation | 🟡 Open |
| DEBT-2 | Barcode scanner torch is inert | 🟡 Open (pinned by test) |
| DEBT-3 | OpenFoodFacts in-memory cache | 🟡 Open |
| DEBT-4 | Bare `Error` instead of `TRPCError` | ✅ Resolved (Phase 3) |
| DEBT-6 | The services layer still throws bare `Error` | 🟡 Open (pinned by test) |
| DEBT-5 | Missing database indexes | 🟡 Open |
| TEST-1 | Integration tests need a database | 🟡 Partly addressed |
| TEST-2 | Mock external API calls | ✅ Resolved |
| DOCS-1 | No API documentation | 🟡 Open |
| DOCS-2 | No environment setup instructions | ✅ Resolved |
| UI-1 | Four linked routes do not exist (404) | ✅ Resolved (Phase 1) |
| OCR-1 | OCR downloads language data at runtime in production | 🟡 Open |
| INV-1 | Expiring items report entry quantity, not net stock | 🔴 **OPEN** |
| UI-2 | LocationPicker never renders child locations | ✅ Resolved (`a6b01c2`) |
| UI-3 | Assorted validation and a11y gaps found building the add-stock route | 🟡 Open |
| NAV-1 | No mobile navigation — the dashboard is unusable on a phone | ✅ Resolved (`fcb3cad`) |
| HOUSE-1 | An account without a household loads a skeleton forever | ✅ Resolved (Phase 3) |
| UI-4 | LocationPicker's dropdown is not a real listbox | ✅ Resolved (`a6b01c2`) |
| I18N-1 | The receipts routes are hardcoded Spanish | ✅ Resolved (`621185d`) |
| UI-5 | The receipt review page overflows at 390px | ✅ Resolved (`621185d`) |
| A11Y-1 | A saved stock movement is never announced | 🟡 Open (pinned by test) |
| A11Y-2 | Confirming a receipt line changes nothing on screen | ✅ Resolved |
| UI-6 | The picker's options open under the bottom bar | ✅ Resolved (`0e74c32`) |
| UI-7 | The review page's pending count never moves | ✅ Resolved |
| I18N-2..7 | Wording and untranslated strings | 🟡 Open |
| I18N-8 | Both auth pages hardcoded, in the wrong two languages | 🔴 **OPEN** |
| UI-8 | A failed query leaves two routes on a skeleton forever | ✅ Resolved (Phase 3) |
| UI-9 | Two routes show an empty state when the query failed | ✅ Resolved (Phase 4) |
| TEST-3 | A seeded-session E2E test writes stock the low-stock test asserts | ✅ Resolved (Phase 3) |
| TEST-4 | The low-stock badge is unchecked on the card tier | 🟡 Open |

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
`corepack pnpm db:seed` through the `prisma.seed` key in `package.json`.

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
literals. `corepack pnpm check:links` now gates CI: 74 links against 24 routes,
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

### 🟡 OCR-1: OCR downloads its language data at runtime in production

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

---

### 🔴 INV-1: Expiring items report entry quantity, not net stock

**File:** `src/server/trpc/routers/inventory.ts` (`getExpiringItems`)  
**Severity:** HIGH  
**Status:** OPEN — found 2026-08-09

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

**Suggested fix:**
Report net stock per product alongside the soonest expiry date, rather than
per-entry quantities, and make `consumeStock` guard against net rather than
gross. If per-batch detail is wanted later, consumption has to be
attributed to a batch, which is a larger modelling change and should be a
deliberate decision rather than a side effect.

**Blocks:** Journey 7 in `docs/SMOKE_JOURNEYS.md` cannot be honestly proven
until the number means what the screen says it means.

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

### 🟡 UI-3: Validation and accessibility gaps found while building add-stock

**Items 4, 5 and 6 are closed; 1, 2, 3, 7 and 8 remain open.** The three closed
ones went with UI-4, Phase 2 and the target-size sweep respectively. What is left
is validation shape and hardcoded Spanish, not accessibility.

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

**Closed by:** Phase 2 (items 5, 6), Phase 3 (items 1, 2), Phase 4 (3, 4, 7).

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

### 🟡 I18N-2: The catalogue calls the same thing a receipt and a ticket

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

---

### 🟡 I18N-3: `formatDate` is hardcoded to `es-ES`

**File:** `src/lib/utils.ts`
**Severity:** LOW
**Status:** OPEN — found 2026-08-09 while closing I18N-1

The helper pins the locale, so every caller prints a Spanish date under an
English catalogue. The receipts routes stopped calling it as part of I18N-1 and
use `useLocale()` with `Intl.DateTimeFormat` instead; every other caller still
has the old behaviour.

**Suggested fix:** take the locale as an argument, so the pinning has to be
written down at each call site that really wants it.

---

### 🟡 I18N-5: The location picker is hardcoded Spanish

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

### 🔴 I18N-8: Both auth pages are hardcoded, and in the wrong two languages

**Files:** `src/app/(auth)/login/page.tsx:81,103,88-93`,
`src/app/(auth)/register/page.tsx:89,111,96-101`
**Severity:** MEDIUM-HIGH
**Status:** OPEN — found 2026-08-10

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

---

### 🟡 I18N-7: The low-stock badge is hardcoded and disagrees with the catalogue

**File:** `src/app/(dashboard)/inventory/page.tsx`
**Severity:** LOW
**Status:** OPEN — found 2026-08-10 while giving the low-stock test a real assertion

The badge renders the literal string `"Stock Bajo"`. The catalogue already has
`inventory.lowStock` — "Stock bajo" / "Low stock" — and nothing reads it. So the
key is dead, the badge is Spanish under an English catalogue, and the two
spellings disagree on the capital B.

Same class as I18N-1 and I18N-5. Worth noting that `e2e/critical-paths.spec.ts`
now asserts the literal, so whoever translates this has to update that
assertion — which is the correct coupling, not an obstacle: the test should
break when the visible string changes.

---

### 🟡 I18N-6: "Confirmar todos" is not what that button does

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

---

### 🟡 I18N-4: "Procesado" and "Procesando" are a letter apart

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

---

### 🟡 A11Y-1: A saved stock movement is never announced

**Files:** `src/app/(dashboard)/inventory/add/page.tsx`,
`src/app/(dashboard)/inventory/consume/page.tsx`
**Severity:** MEDIUM
**Status:** OPEN — found 2026-08-09 building `e2e/screen-reader.spec.ts`
(DESIGN_AUDIT A4.6), pinned by that suite

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

`e2e/screen-reader.spec.ts` pins the current behaviour with
`expect(spoken(saved)).toEqual([])`. It goes red the moment the outcome is
announced — flip the assertion then.

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

## Technical Debt

### 🟡 DEBT-1: Minimal password validation rules

**File:** `src/lib/validations/auth.ts`  
**Severity:** MEDIUM  
**Status:** OPEN

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

---

### 🟡 DEBT-2: Barcode scanner component has unused torch state

**File:** `src/components/barcode/Scanner.tsx`  
**Severity:** LOW  
**Status:** OPEN — behaviour pinned by test

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

**Suggested Fix:**
Either:

1. Pass `torchEnabled` to the scanner component if supported
2. Remove torch functionality if not supported by `@thewirv/react-barcode-scanner`
3. Check library documentation for correct torch API

**Priority:** Fix before barcode scanning feature (F5)

---

### 🟡 DEBT-3: OpenFoodFacts service uses in-memory cache

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

### 🟡 TEST-3: An E2E test writes to the seeded household that another one asserts

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
fails on *every* subsequent run until `pnpm db:seed` is run again.

Three fixes worth considering, in ascending order of cost: have the
screen-reader journey create its own product rather than take the first one;
give the low-stock assertions their own household; or re-seed between suites.
The first is the smallest and keeps the journey honest, since what it is
testing is the accessibility tree, not which product it picks.

Related: `e2e/location-picker.spec.ts` asserts `"Cocina → Despensa (5)"`, a
count that the same write moves.

---

### 🟡 TEST-4: The low-stock badge is unchecked on the card tier

**File:** `e2e/critical-paths.spec.ts` (Low stock, as the seeded household)  
**Severity:** LOW  
**Status:** OPEN — found 2026-08-10 while closing TEST-3

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

Note that an account with no household now reaches these two routes and sees
the same lie, where before it saw a skeleton. That is not a regression from
this phase — both behaviours are wrong — but it is the most likely way anyone
meets this.

**Resolution.** Both routes now take the same three-state branch as
`/inventory` and `/products`: `isPending || error || !data` hands off to
`RouteState`, which tells a missing household apart from any other failure.

Pinned by `src/__tests__/components/route-query-failure.test.tsx`, six tests
over the two routes. The assertion is deliberately a *pair* — the failure copy
present **and** the empty-state copy absent — because checking only the first
would still pass on a route that rendered both, which is a third wrong screen.
Verified failing before the fix: 4 of the 6 went red with the pages reverted.

---

### 🟡 DEBT-6: The services layer still throws bare `Error`

**Files:** `src/server/services/ocr.ts`, `productMatcher.ts`,
`receiptParser.ts`, `openFoodFacts.ts`  
**Severity:** LOW  
**Status:** OPEN — found 2026-08-10 while closing DEBT-4

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

### 🟡 DEBT-5: Missing database indexes

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

---

## Testing Gaps

### 🟡 TEST-1: Database-dependent tests need setup

**Location:** `src/__tests__/integration/`  
**Severity:** MEDIUM  
**Status:** PARTLY ADDRESSED

**Resolution so far:** `scripts/test-integration-local.sh` (run by
`corepack pnpm test:integration`) brings up the repo's own `db` and `cache`
services and recreates an isolated `stoky_test` database on every run. See
`docs/TEST_SETUP.md`.

**Still open:** the harness depends on a working Docker daemon, which is
currently unavailable on this machine, so the integration suite is unverified.

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

### 🟡 DOCS-1: Missing API documentation

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

1. Prerequisites (Node.js 24, Docker, pnpm)
2. Environment variable explanations
3. Step-by-step setup commands
4. Troubleshooting guide

**Priority:** Complete before onboarding new developers

---

## What to fix next

### Blocking everything else

Nothing. Docker access — which headed this list and blocked the integration
suite, the E2E suite and the seed — has been working since 2026-08-04. All three
run: 218 integration, 187 E2E, and a seed that is idempotent.

### Before public deployment

2. **DEBT-1:** Strengthen the password policy beyond `min(8)`. With CRITICAL-4
   closed, this is the largest remaining gap in the auth surface.

### Correctness and scale

4. **DEBT-6:** Decide how the services layer reports failure — typed domain
   errors the routers translate, most likely — and convert it. The routers are
   done (DEBT-4); a service error still reaches the client as
   `INTERNAL_SERVER_ERROR`.
5. **DEBT-5:** Add the missing indexes on `StockEntry.productId`,
   `PriceRecord.productId`/`storeId`, `Receipt.householdId`/`status` and
   `ReceiptItem.receiptId`.
6. **DEBT-3:** Move the OpenFoodFacts cache from the process-local `Map` to
   Valkey.

### Polish

7. **DEBT-2:** Wire the barcode torch toggle to the camera, and update the test
   that currently pins the inert behaviour.
8. **DOCS-1:** Add JSDoc to the tRPC procedures.

---

## Notes

- Backend, auth, schema and migrations are in place; the UI component library
  (Phase 2) is the largest unstarted body of work.
- Unit and component suites run without a database and are green. The
  integration suite is genuine but unverified here — Docker is unavailable.
- TypeScript strict mode is on and both lint and typecheck are clean.
- Security foundation is good (Argon2id, JWT, httpOnly cookies) with rate
  limiting as the notable hole.

For gate results and overall project state, see `docs/STATUS.md`.
For which phase closes each item, see `docs/REDESIGN_PLAN.md` §9, and
`docs/PROGRESS.md` for what is currently in flight.

| Item | Closed by |
|---|---|
| UI-1 dead routes | Phase 1 |
| INV-1 expiring quantity | Phase 5 (kitchen screen depends on it) |
| CRITICAL-4 rate limiting | Phase 3, verified in Phase 7 |
| DEBT-1 password policy | Phase 3 |
| DEBT-4 bare `Error` in routers | Phase 3 |
| DEBT-2 scanner torch | Phase 4 |
| DEBT-3 OpenFoodFacts cache | Phase 6 |
| OCR-1 runtime language download | Phase 6 |
| DEBT-5 missing indexes | Phase 7 |
