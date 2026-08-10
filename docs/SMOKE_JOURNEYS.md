# Stoky Smoke Journeys

Updated: 2026-08-10

These are the minimum user-visible journeys that should be proven before closing
Stoky product work. They are rewritten around the two entry screens defined in
`docs/REDESIGN_PLAN.md`, which is the source of truth for what is being built.
The previous four journeys described an information architecture that has been
replaced.

**Journey 1 passes; the rest do not yet.** Each journey is tagged with the phase
from `REDESIGN_PLAN.md` §9 that makes it passable. Read the tag as a promise
about when it can be measured, not as a claim that it works now. A journey that
cannot yet be run is still useful: it is what the phase is aiming at.

| # | Journey | Passable from | State |
|---|---|---|---|
| 1 | Stock changes through the interface | Phase 1 | ✅ passes |
| 2 | A kitchen account is refused a write by the server | Phase 3 | not yet |
| 3 | The phone screen answers "what do I need to buy" | Phase 4 | not yet |
| 4 | Stock changes without a form | Phase 4 | not yet |
| 5 | Scanning never dead-ends | Phase 4 | not yet |
| 6 | A whole shop with no signal | Phase 4 | not yet |
| 7 | The kitchen screen answers "what should we eat first" | Phase 5 | not yet |
| 8 | The screen choice is remembered per person and per device | Phase 5 | not yet |
| 9 | Both languages, everywhere | Phase 1 onwards, then every phase | partial |

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

- **role**: `admin`, `user` or `kitchen` (§5.2). A kitchen account can do exactly
  two things — look, and use one up. Least privilege, enforced on the server.
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

**Passes as of 2026-08-09** (Phase 1, closed by `249fb8d`). It was blocked by
`ISSUES.md` UI-1 — `/products/new`, `/inventory/add`, `/inventory/consume` and
`/settings` were linked from the interface and all four 404'd. All of them now
exist and are driven by `e2e/critical-paths.spec.ts`, whose four `test.fixme`
tests were removed rather than left as a promise. Two `test.skip`s remain, both
scoped to phone viewports with Phase 4 named as the reason.

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

Proven by: `e2e/critical-paths.spec.ts`, 13 tests, green. The location picker on both
routes was rebuilt on the way (`ISSUES.md` UI-2, UI-4, UI-6) — until then the
nested locations five of the six seeded products live in could not be chosen at
all, so the journey's "where it is stored" half was passing on the roots only.

## Journey 2. A kitchen account is refused a write by the server

**Passable from Phase 3.** Not runnable today: `HouseholdRole` exists in the
schema but is never checked, the role does not reach the JWT or session, there is
no `KITCHEN` value, and `protectedProcedure` is the only procedure type
(`REDESIGN_PLAN.md` §5.2).

A hidden button is not a control. This journey exists specifically to prove the
restriction holds when the interface is bypassed.

Trigger:
Call a write procedure directly, as a kitchen-role account, without going through
any screen.

Visible outcome:

- `inventory.consumeStock` succeeds — this is the one write a kitchen account has
- `inventory.addStock`, `shopping.updateItem`, `shopping.generateFromLowStock`,
  `product.create` and `product.scanBarcode` are each refused with an
  authorisation error, not an internal error
- the refusal comes from the procedure, not from the router being unreachable

Proof required:

- before: a household with one admin, one user and one kitchen account
- action: build a caller with the kitchen session (`appRouter.createCaller`, as
  the integration suite already does) and invoke each procedure above
- after: exactly one call succeeded; every other call raised an authorisation
  error and left no row behind — check that no `StockEntry` and no
  `ShoppingItem` change resulted

Note: this journey has to be repeated per procedure rather than sampled. The
capability matrix in §5.2 is the checklist, and Phase 7 §1 verifies it against
every procedure in the router.

## Journey 3. The phone screen answers "what do I need to buy"

**Passable from Phase 4.**

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

**Passable from Phase 4.** The ± stepper is lifted out of the Bolsillo prototype
into a shared component in Phase 0.

Trigger:
Open a product from the phone screen and change its quantity with the stepper.

Visible outcome:

- plus and minus adjust the quantity in place; no form, no page navigation
- each press is a delta against the current stock, not a new absolute value
- the result is confirmed in plain words, with undo rather than a confirmation
  prompt
- targets are at least 48px and sit in the lower half of the screen

Proof required:

- before: Aceite at 1 L of a minimum 2
- action: press plus twice
- after: the product reads 3 L, no longer counts as missing, and
  `inventory.getStockHistory` shows two `PURCHASE` entries of +1 rather than one
  entry that set the total to 3 — the delta is what makes Journey 6 possible

## Journey 5. Scanning never dead-ends

**Passable from Phase 4.** The scanner component already works and already
redirects to `/products/new`, which does not exist — so today this journey ends
in a 404 (`ISSUES.md` UI-1).

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

**Passable from Phase 4.** This is the largest single technical item in the plan
(§5.5) and must be built into the phone screen from the start, not retrofitted.

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

**Passable from Phase 5.**

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
- the only control anywhere on the screen is **Use one**, once per card. There is
  no create, no edit, no delete and no navigation into either — that is the
  phone's job
- a tap on **Use one** consumes a single unit and offers a 10-second undo

Proof required:

- before: the seed state, which produces exactly this shape — Huevos frescos
  expiring in 3 days and Leche entera in 5, both in the fridge; Café at 0 and
  Aceite at 1 of 2. `inventory.getExpiringItems` returns the first two.
- action: tap **Use one** on Huevos frescos, let the undo window pass; then tap
  again and use the undo
- after: `inventory.getStockHistory` shows exactly one `CONSUME` entry of −1, not
  two. The card's quantity drops by one and the card disappears when the entry
  reaches zero.
- also after: a sweep of the rendered screen finds one interactive control per
  card and no link that leads to creating or editing anything

Honest note for whoever builds this: `getExpiringItems` returns *stock entries*
with a positive quantity, not net product stock. In the seed, Leche entera's
expiring entry holds 6 L while the product's net total is 2 L, because the
consumption entry carries no expiry date. The kitchen screen must be explicit
about which number it is showing, or it will contradict the phone screen.

## Journey 8. The screen choice is remembered per person and per device

**Passable from Phase 5**, which is when both screens exist to choose between.
The role-based default arrives with Phase 3.

Trigger:
Log in on a device for the first time.

Visible outcome:

- an `admin` or `user` account is asked once which screen it wants, and is not
  asked again on that device
- a `kitchen` account lands on the kitchen screen without being asked
- the choice is changeable from settings

Proof required:

- before: two accounts and two devices, no stored preference
- action: on the house tablet, account A chooses kitchen. Account B then logs in
  on the same tablet.
- after: account B is asked, and is not silently placed in kitchen mode. Account
  A opening its own phone is also asked, and is not forced into kitchen mode
  there. The stored preference is keyed on `(userId, deviceId)`, so neither
  inherits the other's choice.

## Journey 9. Both languages, everywhere

**Partly passing, and re-run at the end of every subsequent phase.** The
switcher exists: `/settings` was built in Phase 1 and `LocaleSwitcher` is in the
preferences cluster on every surface including `/login`, writing the `locale`
cookie that `src/i18n/request.ts` reads, with Spanish still the default.

What is not yet true is "everywhere". The receipt routes were hardcoded Spanish
until `621185d` (`ISSUES.md` I18N-1) and `LocationPicker` still is (I18N-5).
`src/__tests__/unit/messages.test.ts` now fails if the two catalogues stop
matching, which covers the "no key is missing" half of the proof below without
anyone having to walk the app — but a string that never reached a catalogue at
all is invisible to it, which is exactly what I18N-1 and I18N-5 are.

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

---

## What is deliberately not here

- **The product rating.** Confirmed out of the MVP and scheduled last, as Phase 6
  (§5.3). It is the most eye-catching part and the least connected to knowing
  what is in the house. It gets a journey when it is built, and that journey will
  have to cover a product with no data and a non-food product, not the happy path.
- **Receipts and price history.** The routers and routes exist
  (`receipt.upload` through `applyReceipt`, `/prices/[productId]`), but neither
  belongs to the phone screen or the kitchen screen as designed. They keep no
  journey until they are given a home in one of the two doors. `ISSUES.md` OCR-1
  is a separate reason not to claim the receipt path works: the production image
  fetches its Tesseract language data from a CDN at first use, so the first scan
  on a fresh container needs outbound internet and will fail on an air-gapped or
  read-only install.
- **Installing the app.** Deferred on iOS grounds (§5.4). Note that the service
  worker and request queue Journey 6 depends on are supported by iOS Safari and
  do not wait for this decision.

## Closure rule

A Stoky slice is only done when it names which journey it changes and which
before/after evidence proves the new state. A journey that cannot yet be run
does not excuse the slice — it means the slice belongs to a later phase, or the
journey is wrong and this document is what needs changing first.
