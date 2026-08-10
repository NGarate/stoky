# Redesign plan — two entry screens

Updated: 2026-08-09

A **plan, not an implementation**. It records what gets built, in what order, and
what each decision commits us to.

---

## 1. What survives from the five proposals

| Proposal | Outcome |
|---|---|
| **Horizonte** | Basis of the **kitchen screen**. Its time axis answers "what expires?" directly |
| **Estante** | Basis of the **phone app**. Its minimum-stock notch answers "what's missing?" |
| **Bolsillo** | Not kept as a screen, but its **± stepper** is. It is the simplest way to consume or add without opening a form |
| **Triaje** | Not kept as a screen, but its **hierarchy** is: what needs action takes space, what is fine folds away |
| **Consola** | **Dropped.** It assumes a keyboard and technical vocabulary |

Both screens share one design system. They are not two apps — they are two doors
onto the same data.

---

## 2. Starting point

**Most of the backend already exists with no interface using it.** This is
mainly UI work.

| Already implemented | Used by |
|---|---|
| `inventory.addStock` / `consumeStock` / `adjustStock` / `transferStock` | Both screens |
| `inventory.getExpiringItems` / `getExpiredItems` | Kitchen |
| `shopping.generateFromLowStock` / `getAutoList` | Phone |
| `product.scanBarcode` / `getByBarcode` / `searchByName` | Phone |

What blocks everything (`ISSUES.md` UI-1): four linked routes that 404 —
`/products/new`, `/inventory/add`, `/inventory/consume`, `/settings`. The
scanner already works and already redirects to the first of them.

---

## 3. Screen A — Phone, "day to day"

**Who and when:** one person in the supermarket. Standing, one hand, in a hurry,
possibly poor signal.

**Question it answers:** *what do I need to buy, and is this thing in my hand a
good buy?*

```
┌─────────────────────────────┐
│  Shopping               ⚙   │
├─────────────────────────────┤
│  ┌───────────────────────┐  │
│  │   📷  Scan            │  │  ← primary action, always on top
│  └───────────────────────┘  │
├─────────────────────────────┤
│  TO BUY                 4   │
│  ○ Whole milk        2/6 L  │  ← minimum notch, from Estante
│    ▓▓▓░░░░│░░░              │
│  ○ Ground coffee       0    │
│  ○ Olive oil         1/2 L  │
├─────────────────────────────┤
│  IN THE TROLLEY         2   │  ← folded away, from Triaje
│  ▸ 2 items ticked off       │
└─────────────────────────────┘
```

**Flows**

1. **Tick off** — one tap on the row. No confirmation, with undo.
2. **Scan** → camera → then:
   - Known product → detail with **rating** + "Add to stock" / "Add to list".
   - New product → creation form pre-filled from Open Food Facts; confirm only.
   - No signal or no data → the barcode is queued and resolved later. **Never a
     dead end.**
3. **Add to stock** — the ± stepper. No form.

**Design decisions:** one primary action per screen; no system vocabulary; state
always in words, never colour alone; everything tappable in the lower half.

---

## 4. Screen B — Kitchen, "at home"

**Who and when:** anyone in the house, in passing, reading from a metre away. An
old tablet propped up. Possibly untouched for days.

**Question it answers:** *what should we eat before it goes off?*

```
┌───────────────────────────────────────────────┐
│  Kitchen · Hogar Demo             Thu 9 Aug   │
├───────────────────────────────────────────────┤
│  USE NOW                                      │
│  ┌─────────────┐ ┌─────────────┐              │
│  │ Eggs        │ │ Milk        │              │
│  │ 3 days      │ │ 5 days      │  ← readable at 1 m
│  │ Fridge      │ │ Fridge      │              │
│  │ [ Use one ] │ │ [ Use one ] │              │
│  └─────────────┘ └─────────────┘              │
├───────────────────────────────────────────────┤
│  THIS WEEK            │  RUNNING OUT          │
│  · Yoghurt   9 days   │  · Coffee      0      │
│  · Bread     2 days   │  · Olive oil 1/2 L    │
└───────────────────────────────────────────────┘
```

**Flows:** one button per card; a tap consumes one unit (`consumeStock`) with a
10-second undo. **Nothing else.** No creating, no editing — that is the phone's
job.

**Design decisions:** 20–24px body, 40px+ headings; nothing urgent below the
fold; refreshes itself on a timer; dark theme automatically at night.

---

## 5. Decisions taken

### 5.1 Choosing a screen — remembered per device *and* per user

Asked once, then remembered for that combination. A shared tablet must not
inherit the choice of whoever logged in last, and a person must not be forced
into kitchen mode because they picked up the house tablet once.

Stored per `(userId, deviceId)`, with a `deviceId` generated on first run and
kept locally. Changeable from settings. The role (below) sets the default:
a kitchen account lands on the kitchen screen without being asked.

### 5.2 Roles instead of a "kitchen mode"

Least privilege, enforced on the server.

| Capability | Admin | User | Kitchen |
|---|:--:|:--:|:--:|
| View stock, expiries | ✅ | ✅ | ✅ |
| Consume stock | ✅ | ✅ | ✅ |
| Add stock, tick off shopping | ✅ | ✅ | — |
| Create and edit products | ✅ | ✅ | — |
| Scan | ✅ | ✅ | — |
| Manage lists | ✅ | ✅ | — |
| Invite people, change roles | ✅ | — | — |
| Household settings, stores, locations | ✅ | — | — |
| See account data and emails | ✅ | — | — |

A kitchen account can therefore do exactly two things: look, and use one up. If
the tablet walks out of the house, that is all it can do.

**What this actually costs — the current state is thinner than it looks:**

- `HouseholdRole` exists (`OWNER`, `ADMIN`, `MEMBER`) and is assigned at
  registration, but **is never checked anywhere**. Roles today are decorative.
- The role **does not reach the session** — the JWT and session carry only `id`
  and `householdId`.
- There is only `protectedProcedure` (authenticated). There is no role-aware
  middleware.

So the work is: add `KITCHEN` to the enum (migration), carry `role` through the
JWT and session callbacks and `next-auth.d.ts`, add `adminProcedure` and a
capability check to tRPC, and apply it per procedure. **Hiding buttons is not
enough** — every restriction has to hold on the server.

### 5.3 Rating — not in the MVP, last phase

Confirmed. It is the most eye-catching part and the least connected to the
original problem, which is knowing what is in the house. Full research on the
data source is in §6 so nothing has to be rediscovered later. It is Phase 6.

### 5.4 Installable PWA — deferred

Deferred on iOS grounds. **One caveat worth separating**, because it changes what
5.5 costs:

- *Installability, push notifications, background sync* — genuinely limited on
  iOS. Rightly deferred.
- *Service worker, offline cache, request queue* — **supported by iOS Safari**
  and is the machinery offline actually needs.

So offline does not have to wait for the PWA decision. We can ship the service
worker without ever prompting anyone to "install the app".

### 5.5 Offline — everything works without signal, syncs afterwards

The most demanding decision here, and the one that shapes the architecture. It
is the right call: a supermarket basement has no signal, and that is exactly
where the phone screen is used.

What it implies:

1. **Local reads.** Products, stock and lists cached on the device, so opening
   the app without signal shows real data instead of a spinner.
2. **A write queue.** Ticking off, consuming and adding go into a local queue and
   replay when the connection returns. The interface confirms immediately —
   pending is a state, not an error.
3. **Conflict resolution.** Two people shopping at once, one offline. Stock
   movements are *deltas*, not absolute values, so they merge without a fight —
   this is why `addStock`/`consumeStock` are the right primitives and setting a
   quantity directly is not.
4. **Honest state.** A visible, calm indicator: "3 changes waiting to sync". Not
   an error, not hidden.
5. **Scanning offline.** The barcode is stored and enriched later from Open Food
   Facts. The user is never blocked.

The pieces: a service worker for assets and reads, IndexedDB for the queue,
TanStack Query persistence (already a dependency), and idempotency keys on
mutations so a replay cannot double-count.

**Honest assessment:** this is the single largest technical item in the plan,
larger than either screen. It should be built into the phone screen from the
start — retrofitting offline is far more expensive than designing for it.

### 5.6 Both languages

The app ships in **Spanish and English**. `messages/es.json` and
`messages/en.json` already have matching keys and next-intl is wired up. The
rule for this work: **no string lands in a component**. Every new screen adds
both languages in the same commit, and the language switcher stays reachable
from settings on both screens.

Project documentation stays in English.

---

## 6. Rating — research for Phase 6

Reference point: Yuka. **The brand and algorithm are not copied** — we compute
our own from open data and explain it.

**Source: Open Food Facts**, which the project already integrates
(`src/server/services/openFoodFacts.ts`), with an in-memory cache and a
`Product.openFoodFactsData` column ready to store it.

Verified against the live API (barcode 3017620422003, Nutella):

| Field | Returned |
|---|---|
| `nutriscore_grade` | `e` |
| `nova_group` | `4` (ultra-processed) |
| `additives_n` / `additives_tags` | `2` · `en:e322`, `en:e322i` |
| `nutrient_levels` | fat high, salt low, sugars high |
| `ecoscore_grade` | `unknown` (not always present) |
| `labels_tags` | where organic certification comes from |

**The current service requests none of these.** It asks only for name, brand,
categories, image and macronutrients. Phase 6 must extend the `fields` list and
the Zod schema — small and localised.

**Proposed formula**, following Yuka's published methodology: 60% nutritional
(from Nutri-Score), 30% additives (weighted by risk), 10% organic. Result 0–100
plus a word — Excellent / Good / Poor / Bad. **The word leads; colour follows.**

**Honesty rules, which matter more than the formula:**

- No data → **no invented number.** "We don't have information on this product",
  with a link to contribute to Open Food Facts.
- Non-food (toilet paper, cleaning) → **not scored.** "Not applicable". Open
  Food Facts does not cover these; Open Beauty Facts and Open Products Facts
  exist if it ever matters.
- Tapping the score always **shows what lowered it.** A score without a reason
  helps nobody decide.

**Licensing:** Open Food Facts is ODbL. Commercial use is fine, **attribution is
required**, and database improvements must be shared back. A visible source
credit is part of the work. The Yuka name appears nowhere in the interface.

---

## 7. Usability rules for both screens

1. **One task per screen.** Two primary actions means two screens.
2. **No system vocabulary.** "Ran out", not "stock 0". "Saved", not "mutation succeeded".
3. **Undo instead of confirm.** "Are you sure?" wears people down; undo forgives.
4. **Errors say what to do next.** "No camera available. Type the barcode instead", with the field already focused.
5. **Never an empty, silent screen.** Empty is an invitation with a button.
6. **Everything works with a thumb.** 48px targets, no nested menus, no gestures to discover.

---

## 8. Accessibility

Keeps the level the proposals reached: **WCAG AAA contrast**, enforced by
`pnpm check:contrast` (54 checks against the tokens in `globals.css` since
Phase 2; 140 while it measured the five prototypes). Extended with 48px targets, state never by
colour alone, a real one-metre readability test for the kitchen screen, and
visible focus throughout. Still outstanding: an axe pass and a screen-reader
run, both belonging to the chosen design rather than to five prototypes.

---

## 9. Phases

Each phase leaves the app usable and verifiable.

| Phase | State |
|---|---|
| 0 — Clean slate | ✅ Complete |
| 1 — Close the dead routes | ✅ Complete |
| 2 — One design system | ✅ Complete |
| 2b — Foundations of use | ✅ Complete except the manual screen-reader pass |
| — Test infrastructure | ✅ Complete, and it was not in this plan |
| 3 — Roles, and CRITICAL-4 | ▶ Next |
| 4 — Phone screen, offline | Not started |
| 5 — Kitchen screen | Not started |
| 6 — Rating | Not started |
| 7 — Security review | Not started |

Gate results for each claim above are in `docs/STATUS.md`; the unit-by-unit
record, with commits, is in `docs/PROGRESS.md`.

### Phase 0 — Clean slate ✅

Nothing new is built. The repository is made to describe the thing we have
actually decided to build, so later phases start from an honest baseline instead
of carrying the old one along. The items below are an audit of the current tree,
not a wish list.

**Code**

| What | Why |
|---|---|
| Drop `zustand` | Declared as a core part of the stack and documented as holding client state. **Zero imports.** |
| Drop `@biomejs/biome` | No config file, zero references. Linting is oxlint. |
| Drop `@types/react-test-renderer` | Added during the DOM test setup and never used. My own leftover. |
| Decide on `spa.traineddata` | A **3.3 MB binary tracked in git**, while `ocr.ts` calls `createWorker("spa")`, which fetches its own data. Verify it is genuinely unused before deleting; if it is needed offline, it belongs in the image, not the history. |
| Remove `tailwind.config.ts` | Referenced by nothing. Tailwind 4 is CSS-first, and the file only redeclares two colours. |
| Move the Prisma seed config | `package.json#prisma` is deprecated and disappears in Prisma 7; it already warns on every install. Move to `prisma.config.ts`. |
| Prune the design lab | Consola, Triaje and Bolsillo are decided against as screens. Lift the ± stepper out of Bolsillo into a shared component **first**, then delete the three. Estante and Horizonte stay until Phase 2 consumes them. |

**Documentation** — the rule is *one owner per subject*. Six overlapping status
files is what let a fake test suite survive five months; that must not grow back.

| Document | Action |
|---|---|
| `DETAILED_PLAN.md` | **Superseded.** 48 KB describing three parallel work streams and an information architecture we have just replaced. Delete it; this plan is the successor. |
| `docs/DESIGN_PROPOSALS.md` | Rewrite as a **decision record**: what was tried, what was chosen, what was rejected and why. It currently reads as a menu, and the choice has been made. |
| `docs/SMOKE_JOURNEYS.md` | Rewrite around the two screens. The four journeys describe the old navigation, and journeys are what "done" is measured against — stale ones are worse than none. |
| `CLAUDE.md` / `AGENTS.md` | Fix claims that are simply false: tooling says "dprint/biome" (it is oxlint), the stack lists Zustand for client state (unused), pnpm is 11 not 10. Add the two screens, roles, offline and bilingual rules. |
| `README.md` | Lead with the two screens and the roles, not a flat feature list. |
| `INFRASTRUCTURE_SOLUTIONS.md` | Fold the part that still matters into `docs/LOCAL_BOOTSTRAP.md` and delete the rest — the Docker problem it documents is solved. |
| `ISSUES.md` | Point each open item at the phase that closes it, so the two documents cannot drift. |
| `docs/STATUS.md` | Keep — it is the gate record. Re-point "what to do next" at these phases. |

*Done when:* `pnpm verify:ci` is green; no dependency is declared without being
imported; no document contradicts this plan or another document; and every
claim in `docs/STATUS.md` is still reproducible by running the command next to
it.

### Phase 1 — Close the dead routes ✅

`/products/new`, `/inventory/add`, `/inventory/consume`, `/settings`.
*Done when:* the four `test.fixme` tests in `e2e/critical-paths.spec.ts` pass
without `fixme`, and Journey 1 of the rewritten `SMOKE_JOURNEYS.md` completes.

**Done.** The four `test.fixme`s were removed rather than left as a promise, and
Journey 1 passes. Two more dead routes surfaced while building these —
`/products/[id]`, linked from every row of two tables, and
`/receipts/[id]/applied`, the final step of the receipt pipeline — so the count
was six, not four. All three manual audits had missed them for the same reason:
the call sites use template literals and the audits compared string literals.
`scripts/check-links.ts` now does the comparison properly and gates CI.

### Phase 2 — One design system ✅

Merge the Estante and Horizonte tokens, move them into `globals.css`, and fix
the existing defect: `button.tsx` and `input.tsx` use fourteen theme colour
utilities resolving to twelve token names, none of which exist — so the login
button renders with layout but no colour.
*Done when:* `check:contrast` stays green and no component references a missing
token.

**Done.** `.bg-primary` went from zero occurrences in the built CSS to a real
rule. What the phase did not anticipate: making the primitives theme-aware while
14 pages stayed hardcoded made dark mode actively worse — the login form rendered
as black inputs inside a white card — so converting every page became part of it.

### Phase 2b — Foundations of use ✅

Comes out of `docs/DESIGN_AUDIT.md` and sits here because every later phase is
harder without it, and because two of its items — choosing a theme, choosing a
language — are things a person can see and use immediately.

- **A0** dead-link check in CI. It has already caught two dead routes that three
  manual passes missed, including `/receipts/[id]/applied`.
- **A1** theme control: System / Light / Dark, persisted, applied before paint,
  reachable before sign-in.
- **A2** language control: unique id, on the auth pages, no full page reload.
- **A3** mobile-first at three sizes with two breakpoints, the bottom-bar
  navigation, and the tables converted to cards below `lg`.
- **A4.2–A4.4** the automated accessibility floor beyond axe: target sizes,
  heading order, landmarks.

*Done when:* axe stays green across every route in both themes at all three
sizes, no route overflows horizontally at 390px, and every destination is
reachable on a phone.

**Done, and it grew.** The phase as scoped stopped at A4.4; A4.5 and half of
A4.6 landed with it because the audit's own wording turned out to be wrong in
both directions.

- **A4.5** — the criteria the audit listed as unchecked. Two were systemic and
  fixed once in CSS: Tailwind's `text-sm` and `text-xs` are below the 1.5 line
  spacing 1.4.8 requires, and no prose had a maximum measure. `prefers-reduced-
  motion` was honoured nowhere. Six form fields had help that was written,
  visible and unattached — so `e2e/a11y-aaa.spec.ts` requires attachment, going
  beyond the criterion's wording, because a hint only a sighted mouse user
  receives is not help.
- **A4.6** — the audit said "not automatable, not optional". Half right. A
  screen reader reads the accessibility tree, and that tree is machine-readable;
  `e2e/screen-reader.spec.ts` walks four journeys against it. What is still owed
  is a person deciding whether the result *sounds* sensible, which is the only
  item of this phase still open.

Two findings were fixed rather than filed, both because the control did not do
what its label said: the location picker offered no nested locations and opened
its panel underneath the fixed bottom bar, and confirming a receipt line wrote
to the database while leaving the page byte-identical.

**A note on scope.** NAV-1 was scheduled for Phase 4 and landed here, because a
mobile-first sweep cannot be verified on a phone that cannot reach a second
page. What landed is navigation, not the phone screen.

### Test infrastructure — the phase this plan did not have ✅

Unplanned, and in hindsight it belonged here from the start. The suite reached
27 minutes for a full matrix, which is long enough that a healthy run and a hung
one look identical from outside, and long enough that people stop running it.
Writing a feature took minutes and verifying it took half an hour.

What changed, and the principle behind each:

- **Ten minutes is the budget for all verification**, enforced in three places
  rather than documented in one: the local ladder holds itself to 600 seconds
  with a ceiling per step, every CI test job is capped at ten minutes, and
  Playwright's own `globalTimeout` sits at nine so it fails first and names the
  test rather than the runner killing the job with no report.
- **A check belongs in the cheapest tier that can answer it honestly.** Static
  facts about source and CSS in Bun; DOM facts in Bun with happy-dom; layout and
  interaction in a browser. axe draws that line itself — it runs under happy-dom
  and returns `color-contrast` as *incomplete*. The target-size floor moved to
  the middle tier through Tailwind's own compiler.
- **A test that cannot fail is deleted, not maintained.** Four went, including
  three that asserted a viewport width equalled the width just set.

The measured result: 27 minutes to 6, 187 passed, same routes, themes, tiers and
browser projects. The non-browser gates total 17 seconds.

*Done when:* the whole matrix finishes inside the budget with no failures, and
the budget fails the run when it does not. Both are true, and both were checked
by watching the guard fire rather than by reading the config.

### Phase 3 — Roles, and the security gap that has outlived every phase ▶

Enum, session, middleware, capability matrix. Before the screens, because both
depend on who is looking. *Done when:* a kitchen account is refused a write **by
the server**, proven by a test, not by a hidden button — Journey 2 of
`SMOKE_JOURNEYS.md`, repeated per procedure rather than sampled.

Three things ride with it, because they are the same layer and the first is the
most serious defect in the repository:

- **CRITICAL-4 — no rate limiting anywhere.** `CLAUDE.md` specifies 5 login
  attempts/15min and 3 registrations/hour per IP. There is no implementation and
  no Valkey client in `src/`, although `cache` has been in compose since the
  beginning. It has been open since Phase 0 and every phase since has had a
  better reason to do something else first. It is a login form on the public
  internet with unlimited password attempts.
- **HOUSE-1** — an account with no household loads a skeleton forever. Roles and
  household membership are decided in the same place.
- **DEBT-4** — 7 of 8 routers throw bare `Error`, so an authorisation refusal
  arrives at the client as `INTERNAL_SERVER_ERROR`. Phase 3 is the phase that
  makes authorisation refusals routine, so it is the phase where this stops
  being cosmetic.

### Phase 4 — Phone screen, offline from the start

Shopping list, tick off, ± stepper, scan, plus the service worker and write
queue. *Done when:* a full shop can be done in aeroplane mode and syncs
correctly on reconnect.

### Phase 5 — Kitchen screen

Expiries, one-tap use, useful data. *Done when:* it runs for a week on a tablet
untouched except for using things up.

### Phase 6 — Rating

Extend the Open Food Facts fields, compute, display. *Done when:* a product with
no data and a non-food product both behave well — not just the happy path.

### Phase 7 — Security review

The last phase, and a gate rather than a feature: nothing ships to a public
address until this passes. The infrastructure was hardened before the product
existed, so this reviews what the product itself ended up doing — which is where
the interesting holes are.

Scope, in order of how much damage a mistake would do:

1. **Authorisation, per procedure.** The capability matrix from Phase 3 is
   verified against every tRPC procedure, not sampled. Every restriction is
   proven by a test that calls the procedure directly as the wrong role — a
   hidden button is not a control.
2. **Household isolation.** Every query is checked for a `householdId` filter.
   The failure mode here is one household reading another's inventory,
   receipts and prices, and it would be invisible in single-household testing.
3. **Rate limiting**, verified as working rather than merely present
   (`ISSUES.md` CRITICAL-4). If it has not landed by now, it lands here.
4. **The offline queue as an attack surface.** Phase 4 introduces mutations
   that are composed on a device and replayed later. Replay must be
   idempotent, a queued mutation must not be able to act on another household,
   and a stale queue from a revoked account must not apply.
5. **Uploads.** Receipt images are the one place untrusted bytes enter: MIME and
   magic-byte checks, Sharp re-encoding actually stripping EXIF, UUID
   filenames, and no path traversal into the volume.
6. **Session handling.** Kitchen tablets hold a long-lived session by design;
   check what that session can reach if the device is stolen, and that a role
   change or removal takes effect without waiting for expiry.
7. **Dependency and image posture.** `pnpm audit` clean, Trivy clean, base image
   current, no secret ever committed.
8. **Headers in production.** The CSP is verified against a production build,
   not just dev — the nonce path differs.

*Done when:* each item above has either a passing test or a written finding with
an owner, and `SECURITY.md` "known gaps" reflects reality rather than intent.

Where possible the checks become tests, so the review is repeatable instead of a
one-off audit that decays the moment it is finished.

**Cross-cutting:** login rate limiting (`ISSUES.md` CRITICAL-4) is the only
critical security gap today and should not wait for Phase 7. It lands with
Phase 3, since both touch auth; Phase 7 verifies it rather than introduces it.
