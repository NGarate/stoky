# Redesign plan — two entry screens

Updated: 2026-08-09 · branch `design/ui-proposals`

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
`pnpm check:contrast` (140 checks). Extended with 48px targets, state never by
colour alone, a real one-metre readability test for the kitchen screen, and
visible focus throughout. Still outstanding: an axe pass and a screen-reader
run, both belonging to the chosen design rather than to five prototypes.

---

## 9. Phases

Each phase leaves the app usable and verifiable.

### Phase 0 — Clean slate

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

### Phase 1 — Close the dead routes

`/products/new`, `/inventory/add`, `/inventory/consume`, `/settings`.
*Done when:* the four `test.fixme` tests in `e2e/critical-paths.spec.ts` pass
without `fixme`, and Journey 1 of the rewritten `SMOKE_JOURNEYS.md` completes.

### Phase 2 — One design system

Merge the Estante and Horizonte tokens, move them into `globals.css`, and fix
the existing defect: `button.tsx` and `input.tsx` reference thirteen tokens that
do not exist, which is why the login button renders unstyled.
*Done when:* `check:contrast` stays green and no component references a missing
token.

### Phase 3 — Roles

Enum, session, middleware, capability matrix. Before the screens, because both
depend on who is looking. *Done when:* a kitchen account is refused a write **by
the server**, proven by a test, not by a hidden button.

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

**Cross-cutting:** login rate limiting (`ISSUES.md` CRITICAL-4) stays open and is
the only critical security gap before anything faces the internet. It should
land with Phase 3, since both touch auth.
