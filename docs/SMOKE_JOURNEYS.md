# Stoky Smoke Journeys

Updated: 2026-09-12

These are the minimum user-visible journeys that should be proven before closing
Stoky product work. They are rewritten around the two entry screens defined in
`docs/REDESIGN_PLAN.md`, which is the source of truth for what is being built.
The previous four journeys described an information architecture that has been
replaced.

Each journey is tagged with the phase from `REDESIGN_PLAN.md` §9 that makes it
passable, and carries a state **re-audited against the code and the suites on
2026-08-17** — which found that this table had drifted a long way from the
bodies below it (the table said Journey 2 "not yet" while its own body said
"passes since Phase 3"), and that two journeys' features were never built at
all despite the phases that owned them closing. Both went into §10 of the
plan rather than being silently absorbed; the stepper half (Journey 4) landed
2026-08-25.

| # | Journey | Passable from | State |
|---|---|---|---|
| 1 | Stock changes through the interface | Phase 1 | ✅ passes |
| 2 | A kitchen account is refused a write by the server | Phase 3 | ✅ passes, including the 2026-08-18 widening (D88, `941d1ed`): the two list writes changed sides and the suite asserts the rows they leave behind |
| 3 | The phone screen answers "what do I need to buy" | Phase 4–5 | ✅ passes |
| 4 | Stock changes without a form | Phase 4–5 | ✅ passes since 2026-08-25 (`74cff4b`) — the stepper is mounted on the product detail and the browser proves two presses arrive as two deltas |
| 5 | Scanning never dead-ends | Phase 4–6 | ✅ passes — T7 landed 2026-09-01, so the offline barcode is queued and resolved later |
| 6 | A whole shop with no signal | Phase 4 | ✅ passes, T7 bullet included since 2026-09-01 |
| 7 | The kitchen screen answers "what should we eat first" | Phase 5 | ✅ at the tiers a suite can answer, including the 2026-08-18 widening (add-to-list, `941d1ed`); the week on a real tablet is unowned |
| 8 | The screen choice is remembered per person and per device | Phase 5 | ✅ passes since 2026-08-26 (`300f665`) — a device cookie, a `(userId, deviceId)` row, and a server-side redirect |
| 9 | Both languages, everywhere | Phase 1 onwards, then every phase | ✅ against everything measured |
| 10 | The rating answers "is this a good buy" — honestly | Phase 6 | ✅ passes |

---

## Canonical nouns

**The two screens**

- **phone screen**, "day to day": one person in a supermarket. Standing, one
  hand, in a hurry, possibly no signal. Answers *what do I need to buy, and is
  this a good buy?* (`REDESIGN_PLAN.md` §3)
- **kitchen screen**, "at home": a tablet propped up, read from a metre away,
  possibly untouched for days. Answers *what should we eat before it goes off?*
  (§4)

They are two doors onto the same data, not two applications.

**Data**

- **product**: the household item record. Has an optional **barcode** and an
  optional **minimum**, the level below which it counts as missing.
- **stock movement**: an add, consume, adjust or transfer event. Always a
  *delta*, never an absolute quantity — this is what lets two people change the
  same stock offline without a conflict (§5.5).
- **location**: the storage node where stock lives (fridge, pantry, cellar).
- **shopping list**: what is to be bought. The **auto list** is the one
  regenerated from products below their minimum; `shopping.generateFromLowStock`
  creates or reuses exactly one auto list per household.
- **to buy** / **in the trolley**: the two sections of the phone list. An item
  moves from one to the other when it is **ticked off**
  (`shopping.updateItem` with `isChecked`, which also stamps `checkedAt`).
- **expiry**: a date on a stock entry. `inventory.getExpiringItems` returns
  entries expiring within *n* days; `getExpiredItems` returns those already past.

**People and devices**

- **role**: `admin`, `user` or `kitchen` (§5.2). A kitchen account can look,
  use one up — and, since the 2026-08-18 amendment (D88) landed at `941d1ed`,
  write down what is needed: start a list, add an item. Least privilege,
  enforced on the server; Journey 2 carries the widened shape and its mirror
  check.
- **device**: the screen choice is stored per `(userId, deviceId)`, with the
  `deviceId` generated on first run and kept locally (§5.1).
- **pending change**: a mutation composed offline and waiting to replay. Pending
  is a state, not an error (§5.5).

**Retired nouns.** *Stock movement* replaces the old "add/consume flow" wording;
*to buy* and *in the trolley* replace the old shopping-list card vocabulary.
Receipts and price history keep their meaning but no longer have a journey — see
*What is deliberately not here*.

---

## Journey 1. Stock changes through the interface

**Entry regression checked 2026-09-08:** signing in to `/dashboard` under
`bun run dev` reached the page but raised an Instant validation error. The
authenticated layout reads the session and account preferences; it now declares
`instant = false` at its own boundary, as the root already does for the nonce
and locale. Its child pages remain subject to navigation validation.
`e2e/auth.prod.spec.ts` now checks visible dashboard content and rejects the
uncached-data console error, in addition to CSP violations. The sign-in test
passes against the live dev server, where Next enables this validation, and
fails with the reported error when the authenticated layout is deliberately
changed to `instant = true`. A Chromium probe also navigated dashboard →
inventory → products → dashboard and reloaded the dashboard with no errors.
Rechecked 2026-09-12: the Instant diagnostic can arrive over HMR after
`networkidle`, so the login test now observes errors for five seconds after
the dashboard renders. Setting `instant = true` makes its diagnostic
assertion fail; the layout is restored after this mutation check.

**Passes as of 2026-08-09** (Phase 1, closed by `249fb8d`). It was blocked by
`ISSUES.md` UI-1 — `/products/new`, `/inventory/add`, `/inventory/consume` and
`/settings` were linked from the interface and all four 404'd. All of them now
exist and are driven by `e2e/critical-paths.spec.ts`, whose four `test.fixme`
tests were removed rather than left as a promise. The two `test.skip`s that
remained in that file, citing "Phase 4", were filed as TEST-6 and closed on
2026-08-27 (`bcd1e74`): run at a phone viewport the failures were all
locators, nothing the product does, and the spec passes 8 of 8 there now.

This is the bridge journey. It proves the existing routers are reachable by a
person before either new screen is built, and it is the journey Phase 1 is
measured against.

Trigger:
Open `/inventory` as the seeded demo user and change the quantity of a product.

Visible outcome:

- the inventory list shows each product with its current total and whether it is
  below its minimum
- an add and a consume control both lead somewhere that exists
- after the change, the same list shows the new total without a manual reload

Proof required:

- before: the seed state, which is reproducible — Leche entera 2 of a minimum 6,
  Aceite 1 of 2, Café 0 of 2 (`prisma/seed.ts`, login `demo@stoky.local`)
- action: add 4 L of Leche entera through `/inventory/add`, then consume 1 L
  through `/inventory/consume`
- after: Leche entera reads 5 and is still marked as below its minimum; a second
  add of 1 L takes it to 6 and the marking clears

Proven by: `e2e/critical-paths.spec.ts`, 16 tests, green on the standalone production build. The location picker on both
routes was rebuilt on the way (`ISSUES.md` UI-2, UI-4, UI-6) — until then the
nested locations five of the six seeded products live in could not be chosen at
all, so the journey's "where it is stored" half was passing on the roots only.

## Journey 2. A kitchen account is refused a write by the server

**✅ Passes since Phase 3**, proved by
`src/__tests__/integration/capabilities.test.ts`, which builds a caller per role
and calls the router directly — no screen involved. `consumeStock` succeeds for
a kitchen account; `addStock`, `shopping.updateItem`,
`shopping.generateFromLowStock`, `product.create` and `product.scanBarcode` are
each refused with FORBIDDEN, and the suite asserts afterwards that no
`StockEntry`, no `ShoppingItem` and no `Product` was left behind.

The per-procedure half the plan asks for is
`src/__tests__/unit/capabilities.test.ts`: it reads how each of the 45
procedures is declared and compares it against the matrix, so a procedure added
later cannot quietly take the wrong tier. Sampling six would have missed that.

**The limit this journey used to carry is closed.** Since Phase 5,
`/settings/people` creates an account with a role, so a KITCHEN account is
reachable through the interface rather than only through the database write
the test uses. The per-procedure count in the paragraph above has also grown
with the routers — `capabilities.test.ts` asserts all 60 as declared today.

A hidden button is not a control. This journey exists specifically to prove the
restriction holds when the interface is bypassed.

**Amended 2026-08-18 (owner's pass, Phase 8, D88) — and landed the same day
(`941d1ed`).** `shopping.create` and `shopping.addItem` moved to the tier a
kitchen account may call — those two and no others. The refused set keeps
`addStock`, `shopping.updateItem`, `shopping.generateFromLowStock`,
`product.create`, `product.scanBarcode` and the rest of the write tier, and
the suite carries the mirror check: the `ShoppingList` and `ShoppingItem`
rows a kitchen account may now leave behind are asserted *present*, because
"it was not refused" and "it worked" are different claims.

Trigger:
Call a write procedure directly, as a kitchen-role account, without going through
any screen.

Visible outcome:

- `inventory.consumeStock`, `shopping.create` and `shopping.addItem` succeed —
  the three writes a kitchen account has: look, use one up, write down what is
  needed (§5.2 as amended)
- `inventory.addStock`, `shopping.updateItem`, `shopping.generateFromLowStock`,
  `product.create` and `product.scanBarcode` are each refused with an
  authorisation error, not an internal error
- the refusal comes from the procedure, not from the router being unreachable

Proof required:

- before: a household with one admin, one user and one kitchen account
- action: build a caller with the kitchen session (`appRouter.createCaller`, as
  the integration suite already does) and invoke each procedure above
- after: the three permitted calls succeeded and their rows exist — the
  consumption entry, the list, the item; every other call raised an
  authorisation error and left no row behind

Note: this journey has to be repeated per procedure rather than sampled. The
capability matrix in §5.2 is the checklist, and Phase 7 §1 verifies it against
every procedure in the router.

## Journey 3. The phone screen answers "what do I need to buy"

**✅ Passes since Phase 5**, when `/shopping` became Screen A — Scan on top,
TO BUY with the minimum notch, IN THE TROLLEY folded away, undo as the trolley
itself rather than a timed toast (D54). Proven by
`src/__tests__/components/ShopPage.test.tsx` for the layout contract and by
`e2e/offline-shop.spec.ts` — "ticks something off from the shop screen and
applies it once" — in a real browser. `getBuyList` returns one flat list with
stock and minimum attached (D56).

Trigger:
Open the phone screen while at least one product is below its minimum.

Visible outcome:

- **TO BUY** lists the missing products with a count, each showing how much there
  is against the minimum (2/6 L, 1/2 L, 0)
- **IN THE TROLLEY** is folded away and shows only how many items are ticked off
- one tap on a row ticks it off, with no confirmation dialogue and a visible undo
- the state of every row is readable in words, not by colour alone

Proof required:

- before: the seed state — three products below their minimum (Leche entera,
  Aceite, Café); `shopping.getAutoList` returns the auto list containing them
- action: tap Café to tick it off, then tap undo
- after: Café moves to **IN THE TROLLEY** and the TO BUY count drops by one; undo
  returns it, and `shopping.getAutoList` shows `isChecked` false and `checkedAt`
  null again

## Journey 4. Stock changes without a form

**✅ Passes since 2026-08-25 (`74cff4b`).** The ± stepper — lifted out of the
Bolsillo prototype in Phase 0 precisely so this journey could exist, then left
unmounted through two phases that claimed it — sits where the stock number was
on `/products/[id]`, for the roles the server would admit. The 2026-08-17
re-audit is what noticed the gap; §10 of the plan carried it until now.

Trigger:
Open a product from the phone screen and change its quantity with the stepper.

Visible outcome:

- plus and minus adjust the quantity in place; no form, no page navigation
- each press is a delta against the current stock, not a new absolute value
- the result is confirmed in plain words, with undo rather than a confirmation
  prompt
- targets are at least 48px (the stepper's buttons are the `Button` primitive,
  whose floor they inherit)

Evidence:

- `e2e/critical-paths.spec.ts` "Journey 4 — stock changes without a form": a
  fresh product at zero has minus disabled and "no queda nada" said in words;
  two plus presses move the number to 2 in place with the URL unmoved, each
  confirmed by the snackbar sentence with its Deshacer; and after the queue's
  ten-second hold drains, the history table shows **two `PURCHASE` rows of +1**
  rather than one write that set the total — the delta is what makes Journey 6
  possible
- `src/__tests__/components/ProductDetailStepper.test.tsx`: the deltas' exact
  inputs (a purchase of one with no inferred location or expiry, a consumption
  of one with none), the projection folding unsent presses onto the shown total
  and the below-minimum sentence, undo cancelling the queued change and never
  writing a compensating one, and a KITCHEN account reading a number instead of
  a control the server would refuse
- the proof's original "Aceite at 1 L of a minimum 2" shape runs against a
  test-owned product instead of the seed: the browser suite's tests bring the
  state they mutate (TEST-3's lesson), and the below-minimum half is asserted
  in the component tier, where the projection can be posed directly

## Journey 5. Scanning never dead-ends

**Passes as of 2026-09-01** — T7 landed, so the no-signal case this journey's
title promises is built. The connected cases already passed: a known product
opens its detail with the Phase 6 rating, and an unknown barcode reaches a
creation form prefilled from Open Food Facts, or empty with the barcode filled
in when OFF has nothing (the scan flow speaks from the catalogue since
`a3dbfa6`). The offline case now works as a queued *scan* rather than a queued
product — the `local:`-id leak that deferred it from Phase 6 is avoided
structurally, because the queue carries only the barcode and the real product
is minted server-side at drain time (`product.resolveScan`, an offline-queue
op). An unknown barcode scanned offline is queued, and on reconnect either
resolves silently (OFF knows it, or the household already does) or surfaces as
a review question — a form prefilled with the barcode — never a dead end.
Proven by `e2e/offline-shop.spec.ts` "An offline scan, resolved later (T7)".

Trigger:
Tap Scan on the phone screen and read a barcode.

Visible outcome, in all four cases:

- **known product**: its detail opens, with "add to stock" and "add to list"
- **unknown barcode, network available**: a creation form pre-filled from Open
  Food Facts; the person confirms rather than types
- **unknown barcode, no Open Food Facts data**: the same form, empty, with the
  barcode already filled in — never a refusal
- **no camera**: an error that says what to do instead, with a barcode field
  already focused
- **a lookup the server refuses**: said beside the field, with the code
  already in it, rather than the camera silently starting again

The focus half of "no camera" and the refused lookup were only built on
2026-10-06; until then the camera error left focus where it was and a refused
lookup restarted the scanner without a word. `ScanPage.test.tsx` pins both.

Proof required:

- before: a seeded product with barcode `8410000678901` (Café molido), and a
  barcode that is not in the household
- action: scan each in turn
- after: the first opens the existing product; the second reaches a creation form
  that is reachable and submits successfully. `product.scanBarcode` returns
  `source: "local"` for the first and falls through to Open Food Facts for the
  second — the test must stub that call rather than reach the network, as the
  integration suite already does.

## Journey 6. A whole shop with no signal

**✅ Passes since Phase 4** — it was the phase's done-when, and
`e2e/offline-shop.spec.ts` proves it end to end: a shop composed in aeroplane
mode, shown as done, applied exactly once on reconnect, including across a
lost reply where both attempts carry the same idempotency key, and unsent
changes surviving a reload. **The last bullet — "a scanned barcode is queued
and enriched later" — is met as of 2026-09-01**, when T7 landed: the same spec
scans an unknown barcode offline and watches it become a review question on
reconnect, and scans a known one and watches it resolve silently. The service
worker half runs under a real production build in
`e2e/service-worker.prod.spec.ts`, part of the ordinary suite since 2026-08-17.

Trigger:
Put the device in aeroplane mode, then do a full shop.

Visible outcome:

- opening the app shows real cached data, not a spinner and not an error
- ticking off, consuming and adding all confirm immediately
- a calm indicator states how many changes are waiting — "3 changes waiting to
  sync" — presented as a state, not a failure
- a scanned barcode is queued and enriched later; the person is never blocked

Proof required:

- before: the app has been opened once with a connection, so products, stock and
  lists are cached
- action: with the network disabled, tick off two items, add stock to one product
  and scan one unknown barcode; then restore the network
- after: every change has applied server-side exactly once. Replaying the queue a
  second time must not double-count — the idempotency keys are what this proves,
  and re-running the replay is part of the journey, not an optional extra.

Second half, which is the part that actually fails if the design is wrong: two
people shop at once, one of them offline. Both consume the same product. After
reconnection the total reflects both deltas. Nothing is silently overwritten.

## Journey 7. The kitchen screen answers "what should we eat first"

**✅ Passes at the tiers a suite can answer, since Phase 5.** `/kitchen` is
§4's three sections with one control per card, driven by
`src/__tests__/components/KitchenPage.test.tsx` (including the undo that
cancels the queued consumption rather than writing a compensating one, D57)
and swept by the axe and structural suites at all three tiers. **What no
suite answers is the phase's own done-when** — a week on a real tablet,
untouched except for using things up — and that is listed as unowned in §10
rather than implied by the green.

**Amended 2026-08-18 (owner's pass, Phase 8, D88) — and landed the same day
(`941d1ed`).** "The only control anywhere on the screen is Use one" was the
design, and the owner's first real use overruled it: standing at this screen
is exactly when a household notices something needs buying. Every running-out
row now carries a one-tap *Apuntar a la compra* — queued offline like the
cards' consume, undone by cancelling the queued add — and when no list exists
the first tap creates one, online-only and saying so when it cannot (D97).
The `KitchenPage` assertions moved with the feature, as this file's closure
rule requires: one action per row, and still nothing that opens a form.

Trigger:
Look at the kitchen tablet from a metre away, without touching it.

Visible outcome:

- **USE NOW** shows what expires soonest, as cards with the product, the days
  left in words, and the location
- **THIS WEEK** and **RUNNING OUT** sit below, and nothing urgent is below the
  fold
- body text is 20–24px, headings 40px and up; the day and household name are
  visible
- the screen refreshes itself on a timer, so it stays correct after days
  untouched
- every control on the screen is a single tap: **Use one**, once per urgent
  card, and **Apuntar a la compra**, once per running-out row. There is no
  editing or deleting of products or stock, no form, and no navigation into
  either — that is still the phone's job
- a tap on **Use one** consumes a single unit; a tap on **Apuntar** writes the
  product on the newest open list; both offer undo exactly while the queued
  change can still be cancelled

Proof required:

- before: the seed state, which produces exactly this shape — Huevos frescos
  expiring in 3 days and Leche entera in 5, both in the fridge; Café at 0 and
  Aceite at 1 of 2. `inventory.getExpiringItems` returns the first two.
- action: tap **Use one** on Huevos frescos, let the undo window pass; then tap
  again and use the undo
- after: `inventory.getStockHistory` shows exactly one `CONSUME` entry of −1, not
  two. The card's quantity drops by one and the card disappears when the entry
  reaches zero.
- also after: a sweep of the rendered screen finds one action per urgent card,
  one per running-out row, and no form — `KitchenPage.test.tsx` holds exactly
  that shape

**2026-09-12 stock integrity correction:** a kitchen tap now names its batch.
Two separate taps produce exactly two consumption rows, including after a
retry. The card shows the remaining amount, including queued uses. Product
detail and both expiry queries use the same calculation. A withdrawal without
a source cannot select a batch by expiry: ambiguous amounts show “Cantidad sin
confirmar” and the kitchen refuses another quick use of such a batch.

The recount page starts with a blank actual count. It records no unprovided
location or expiry and refuses a stale balance under the product lock. The
browser regression in `e2e/critical-paths.spec.ts` follows the product list's
“Ajustar” link and verifies the extra counted egg gets no expiry from the
previous purchase. Dozens convert exactly to individual units (3 → 36);
this conversion does not reconstruct physical stock or earlier intent.

## Journey 8. The screen choice is remembered per person and per device

**✅ Passes since 2026-08-26 (`300f665`).** It had gone unbuilt through two
phases, and landing everybody on `/dashboard` was part of why: nobody is
inconvenienced by a reasonable default, so nobody builds the question.

Trigger:
Log in on a device for the first time.

Visible outcome:

- an `admin` or `user` account is asked once which screen it wants, and is not
  asked again on that device
- a `kitchen` account lands on the kitchen screen without being asked
- the choice is changeable from settings

Evidence:

- `e2e/screen-choice.spec.ts`, four tests. Playwright browser **contexts** are
  the devices: each has its own cookie jar, so each gets its own device id,
  which is what production keys on — a truer model of two devices than two tabs
  and cheaper than two browsers.
- *Asked once, then not again*: a fresh account at `/` gets `/start`, chooses
  the kitchen, and every arrival afterwards goes straight to `/kitchen`.
- *The shared tablet*: account A chooses the kitchen on it, signs out, account B
  registers on the same context and is **asked** rather than placed in kitchen
  mode.
- *The same person's own phone*: a second context signs in as A and is asked
  again, chooses the shop, and the two devices then keep separate answers.
- *No JavaScript*: a context with scripting disabled drives `/start` to a
  choice, because it is three submit buttons and a server action.
- The pair is pinned by two tests that fail **differently**: keying on the
  account alone passes the shared-tablet test and fails the tablet-to-phone one.
  Checked by breaking it.
- `src/__tests__/unit/landing.test.ts` covers the precedence, including the
  omission that matters — no quiet fallback to the Panel for the unasked.

- *Signing in goes through the decision*: until 2026-10-06 the login and
  registration forms replaced straight to `/dashboard`, so the question was
  only ever asked of someone who later typed `/` — the kitchen tablet signed in
  to the panel, and a new account never met `/start`. Both now replace to `/`;
  `auth-pages.test.tsx` pins it, and every browser sign-in (`session.setup.ts`,
  `auth.prod.spec.ts`, `critical-paths`) now arrives at `/start`.
- *Changeable from settings*: `/settings/screen` shows which screen is current,
  changes it without walking you out of settings, and announces the new answer
  in a live region — and a second device is unaffected by the change.

**Journey 8 is complete.** All three of its stated outcomes are covered, on the
tiers that can answer them.

## Journey 9. Both languages, everywhere

**✅ Passes against everything measured.** The switcher is in the preferences
cluster on every surface including `/login`, writing the `locale` cookie that
`src/i18n/request.ts` reads, Spanish default. Every filed hardcoded string is
closed — I18N-1 through I18N-8 — and the class itself is now guarded twice:
`messages.test.ts` fails when the catalogues diverge, and
`message-usage.test.ts` scans every `t("…")` in the source for keys no
catalogue holds, which is the gap the old note here said nothing could see.
A unit-tier sweep also refuses a literal language tag anywhere under `src/`
(D68).

The honest limit: "everywhere" is proven by construction (no string lands
outside the catalogues, the catalogues match, both auth pages are asserted in
both languages at the component tier) plus Spanish rendering driven in the
browser — not by a human walking every screen in English. That walk shares the
manual pass's fate in §10.

Trigger:
Switch the language from settings, on either screen.

Visible outcome:

- every string on both screens changes; nothing stays in the other language
- the switcher is reachable from settings on both screens
- Spanish is the default

Proof required:

- before: `messages/es.json` and `messages/en.json` have matching keys
- action: switch to English, walk both screens, switch back
- after: no untranslated string is visible, and no key is missing from either
  file. Any screen added in a phase adds both languages in the same commit — no
  string lands in a component (§5.6).

## Journey 10. The rating answers "is this a good buy" — honestly

**✅ Passes since Phase 6.** This document promised the rating a journey when
it was built, and said it would have to cover a product with no data and a
non-food product, not the happy path. Both are the phase's done-when, and both
are structural in `src/lib/rating.ts`: the honesty rules run *before* the
arithmetic (D77), the worst additive decides its component and an absent
additive list is not a clean bill (D78).

Trigger:
Open a product's detail — the screen the scan journey lands on.

Visible outcome:

- a product with Nutri-Score data shows a 0–100 score with a word leading and
  colour following, and tapping it shows what lowered it
- a product with no data says "no information", with a link to contribute to
  Open Food Facts — never an invented number
- a non-food product says "not applicable" — not a low score
- the Open Food Facts attribution is visible (ODbL requires it)

Proven by: `src/__tests__/unit/rating.test.ts` (the formula and the honesty
inversions — breaking the ordering fails four tests) and
`src/__tests__/components/ProductRating.test.tsx` (all three states rendered,
both languages). §6's worked example scores 25 — the bottom edge of poor,
which is what harmless additives on a grade-e product are worth.

---

## What is deliberately not here

- **Receipts and price history.** The routers and routes exist
  (`receipt.upload` through `applyReceipt`, `/prices/[productId]`), and the
  pipeline is exercised — the review flow by `screen-reader.spec.ts` and the
  dynamic-route audits, scanning in the production image verified air-gapped
  when OCR-2 closed — but neither belongs to the phone screen or the kitchen
  screen as designed, so they keep no journey until they are given a home in
  one of the two doors. (An earlier version of this bullet cited OCR-1 — the
  CDN fetch at first scan — as a reason the receipt path could not be trusted;
  OCR-1 and OCR-2 are both closed, and the model is baked into the image.)
- **Installing the app.** Deferred on iOS grounds (§5.4). Note that the service
  worker and request queue Journey 6 depends on are supported by iOS Safari and
  do not wait for this decision.

## Closure rule

A Stoky slice is only done when it names which journey it changes and which
before/after evidence proves the new state. A journey that cannot yet be run
does not excuse the slice — it means the slice belongs to a later phase, or the
journey is wrong and this document is what needs changing first.
