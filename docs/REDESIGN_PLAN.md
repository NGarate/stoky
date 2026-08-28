# Redesign plan — two entry screens

Updated: 2026-08-18

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

~~What blocks everything (`ISSUES.md` UI-1): four linked routes that 404~~ —
**closed in Phase 1, and it turned out to be six routes, not four** —
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
10-second undo.

**Amended 2026-08-18 (owner's pass, D88).** This section used to end "Nothing
else. No creating, no editing — that is the phone's job", and the owner's
first real use overruled it: standing at the tablet is exactly when a
household notices something needs buying, and sending that person off to find
a phone is a dead end of our own making. The kitchen screen therefore also
lets anyone at it **put a product on a shopping list** — "Se está acabando" is
the natural place — and **start a list when none exists**. Still no editing of
products or stock, still nothing that needs a form or two hands: a control
here is one tap and legible at a metre, or it belongs on the phone. The
KITCHEN role's server-side capabilities widen to match; the trade is written
down in §5.2, the work is Phase 8's.

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
| Start a shopping list, add an item to one | ✅ | ✅ | ✅ |
| Add stock, tick off shopping | ✅ | ✅ | — |
| Create and edit products | ✅ | ✅ | — |
| Scan | ✅ | ✅ | — |
| Manage lists (rename, delete, generate) | ✅ | ✅ | — |
| Invite people, change roles | ✅ | — | — |
| Household settings, stores, locations | ✅ | — | — |
| See account data and emails | ✅ | — | — |

A kitchen account could originally do exactly two things: look, and use one
up. **Amended 2026-08-18 (owner's pass, D88):** it can also write down what is
needed — start a list, add an item to one. That is the whole widening;
`shopping.create` and `shopping.addItem` change tiers and nothing else moves:
a kitchen account still cannot tick off, rename, delete or generate a list,
change stock upward, or see account data. The trade, taken knowingly: a tablet
that walks out of the house can now also scribble on the shopping list. What
it writes is visible to everyone and reversible by anyone with a phone —
unlike reading emails or deleting history, which stay where they were. The
row landed in the enforced matrix with `941d1ed`; the capability tests hold
the widening to exactly these two, and Journey 2 asserts the rows a kitchen
account may now leave behind.

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
3. **Conflict resolution — allow and reconcile, never discard.** Two people
   shopping at once, one offline. Deltas merge without a fight *in one
   direction only*: adding always merges, because there is no ceiling on how
   much a household can own. **Consuming has a floor.** Stock may never go
   negative, so two people who each use the last unit cannot both be right, and
   the second one to reach the server is refused.

   The refusal is where the design was wrong, and this corrects it. Telling
   someone "that did not save" and dropping the change discards a real event —
   they *did* take the milk. So a refused consumption is not a failure to
   report, it is **a question only a person can answer**: the count and the
   house disagree, and only someone who can see the shelf knows which is right.

   The interface therefore names it and offers the fix — how much is actually
   there — and writes that as an `adjustStock`, which is exactly the primitive
   for "the count is wrong and here is the truth". Nothing is applied behind
   anyone's back and nothing is thrown away.

   **Not a modal at the moment it happens.** A conflict is discovered on
   *reconnect*, which may be minutes after the shop with the phone in a pocket
   — a dialog thrown at that moment interrupts someone who is not looking at
   the item and cannot answer. §7 rule 3 says undo rather than confirm for the
   same reason: interruptions wear people down. Instead the sync indicator
   carries it as something needing attention, in words, and opens the
   reconciliation when the person chooses to deal with it. That also makes it
   survive being ignored for an hour, which is the realistic case.

   **A kitchen account cannot reconcile.** `adjustStock` is a `writeProcedure`
   and the capability matrix (§5.2) gives KITCHEN looking and consuming only.
   So on the tablet the conflict is reported and says who can fix it, rather
   than offering a control that would be refused by the server. Hiding a button
   is not a control, and offering one that cannot work is worse.
4. **Honest state.** A visible, calm indicator: "3 changes waiting to sync". Not
   an error, not hidden.
5. **Scanning offline.** The barcode is stored and enriched later from Open Food
   Facts. The user is never blocked.

The pieces: a service worker for assets and reads, `localStorage` for the queue
(§5.7 says why it is not IndexedDB, and states what would reverse that), a
`zustand` store as the queue's home in the client, and idempotency keys on
mutations so a replay cannot double-count.

Two claims in the original of this section were wrong and are corrected here
rather than quietly dropped. TanStack Query persistence was described as
"already a dependency" — it is not; `@tanstack/react-query` is installed and
the persist packages are separate, and read persistence has been moved to the
droppable tail because a shop that *starts* online works without it.

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

### 5.7 Client state — a store, now that there is state React cannot hold

**This reverses a Phase 0 decision, and the reason it changed is Phase 4.**

`zustand` was removed in Phase 0 (`3be8b2e`) and `CLAUDE.md` recorded the rule:
server state is TanStack Query's, local UI state is React's, and nothing else
until there is a case React cannot serve. That was right at the time — every
piece of state in the application was one of those two.

The offline write queue is the third kind, and it has all three properties that
make component state the wrong home:

- **It is read from everywhere and owned by nowhere.** The sync indicator, the
  shopping rows, the stepper and the failed-changes list all read the same
  queue. Lifting it to a common ancestor means lifting it to the dashboard
  layout and threading it down, or a context whose every consumer re-renders on
  every change to any entry.
- **It is written from outside React.** The drain is triggered by the `online`
  event, by `visibilitychange`, by a backoff timer and by another tab through
  `storage`. None of those are React events, and each one has to reach in.
- **It is persisted and it survives the tree.** The queue outlives every
  component that reads it, including a full unmount on navigation.

That is the case `CLAUDE.md` asked for, so the rule stays and the exception is
taken deliberately rather than the rule being deleted.

**Scope, stated so it does not creep.** The store holds the offline queue and
what is derived from it. It does **not** hold server data — that stays in
TanStack Query, which already does caching, invalidation and request
deduplication that a store would have to reimplement badly — and it does not
hold form state, which stays local. A second store is a decision, not a
convenience.

`zustand@5`, with `useShallow` for multi-field selectors so a component
re-renders when the fields it reads change and not when the queue does.

### 5.8 The compiler, and a second opinion on the React we write

Two tooling decisions that apply to every remaining phase.

**The React Compiler is on.** `next@16.3` takes `reactCompiler: true` as a
top-level config key — no longer experimental — and applies
`babel-plugin-react-compiler` only to files that contain JSX or hooks, chosen
by an SWC pass, so the build cost is small and localised. It memoises what we
would otherwise have to remember to memoise. The measured build time is
recorded in `STATUS.md` before and after, because "small" is a claim and the
budget is ten minutes.

It is enabled in **full** mode rather than `annotation`. Opt-in memoisation has
the same failure as manual memoisation: the components that need it are the
ones nobody thought about.

**`react-doctor` runs as a gate.** It scans for security, correctness,
performance and accessibility problems that neither `oxlint` nor `tsc` looks
for. Measured before deciding: 176 files in 90ms, so it costs nothing against
the ten-minute budget, and on the first run it found a real defect — an
unauthenticated `"use server"` action writing an unvalidated string into a
cookie that `src/i18n/request.ts` interpolates into a dynamic `import()` path.

**The gate is on errors, not on the score.** The score is 59 with 54 warnings,
and a gate that demands a number nobody has agreed to either blocks every
commit or gets raised until it means nothing. Errors are specific and few.
Warnings are read, and the ones worth acting on become their own commits.

Noted honestly: `react-doctor` is at `0.9.x`. A pre-1.0 gate can change its
mind about what an error is, so it is pinned exactly, like every other gate
this project depends on.

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
`bun run check:contrast` (60 checks against the tokens in `globals.css` — 54
from Phase 2 until UI-10 added the hero surface; 140 while it measured the
five prototypes). Extended with 48px targets, state never by
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
| 3 — Roles, and CRITICAL-4 | ✅ Complete |
| 4 — Offline, and a shop that survives it | ✅ Complete against its done-when |
| 4b — Client state, the compiler, a React gate | ✅ Complete |
| 5 — Kitchen screen, and Screen A's layout | ✅ Complete against its done-when, except a week on a real tablet |
| 6 — Rating | ✅ Complete against its done-when: no-data and non-food both behave well, both tested |
| 7 — Security review | ✅ Complete. The backlog it owned is closed and the review is written — `docs/SECURITY_REVIEW.md`, which found and closed four household-isolation defects |
| 8 — The owner's first pass | ✅ All six items closed 2026-08-18/19; the *done-when* — the owner repeats the pass — is the owner's to run |

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

*Done when:* `bun run verify:ci` is green; no dependency is declared without being
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

### Phase 3 — Roles, and the security gap that has outlived every phase ✅

Enum, session, middleware, capability matrix. Before the screens, because both
depend on who is looking. *Done when:* a kitchen account is refused a write **by
the server**, proven by a test, not by a hidden button — Journey 2 of
`SMOKE_JOURNEYS.md`, repeated per procedure rather than sampled.

**Complete 2026-08-10.** Journey 2 passes, and the per-procedure requirement is
met in two tiers: a unit test compares how all 45 procedures are declared
against the matrix, and an integration test calls the router as each role. All
three riders closed — CRITICAL-4, HOUSE-1 and DEBT-4.

Where the plan turned out to be wrong or short:

- **The middleware reads the database, not the JWT.** The plan says "carry
  `role` through the JWT and session callbacks", and that is done — but the
  session copy is for the interface. Authorisation reads membership and role
  per request, which the plan did not call for and which HOUSE-1 needs: an
  account that has just created a household would otherwise wait up to fifteen
  minutes for a token that knows about it.
- **Closing CRITICAL-4 took two commits, not one.** The limiter went into
  Auth.js's `authorize` — and `auth.login`, a second credential-verification
  procedure on the public tRPC router that nothing in the interface called, was
  left unmetered beside it. An adversarial review of the finished phase found
  it. It is removed.
- **UI-8 was closed with HOUSE-1**, because they are the same four lines.
- **Nothing creates a KITCHEN account.** The enum, the middleware and the tests
  exist; no screen makes one. That belongs with the kitchen screen in Phase 5,
  and Journey 2 says so rather than implying the feature is reachable.
- **The browser suite was red for reasons that predate the phase** — one
  journey wrote the stock another asserted, and a `.first()` selector resolved
  to the hidden copy of a two-tier layout. Both fixed; TEST-4 filed for the card
  tier the suite still does not check.

#### What Phase 3 does *not* cover, and which phase owns it

Recorded here rather than in a commit message because each one reads as done
from a distance, and because a later phase has to pick it up. Measured against
**OWASP ASVS 4.0.3**, **OWASP Top 10 A07:2021 (Identification and
Authentication Failures)** and **NIST SP 800-63B**, which are the references
Phase 7 will be audited with.

| Gap | Standard it falls short of | Owner |
|---|---|---|
| No interface creates a KITCHEN account | ASVS **V4.1.1** — access control enforced on a trusted service layer. The enforcement is there; the *provisioning* is not, so the role cannot be exercised by anyone who is not writing SQL | Phase 5 |
| Throttling is per IP only, never per account | NIST SP 800-63B **§5.2.2** asks for a limit on consecutive failed attempts *against an account*. A per-IP limit alone is defeated by a distributed guess and punishes a shared NAT | Phase 7 §3 |
| Only the two auth endpoints are throttled | ASVS **V11.1.4** — anti-automation on any resource-intensive operation. `receipt.upload` runs OCR and Sharp on an authenticated request and has no limit at all | Phase 7 §3 |
| No `Retry-After` on a refusal | RFC 9110 **§10.2.3** and RFC 6585 **§4**. tRPC's `TOO_MANY_REQUESTS` maps to HTTP 429, and the seconds remaining are computed and put in the message — but not in the header a client is meant to read | Phase 7 §3 |
| Failing closed makes Valkey a hard dependency of signing in | Not a standards gap but an availability trade-off, taken deliberately: ASVS **V2.2.1** wants anti-automation to actually hold, and an attempt that cannot be counted is one that is not being limited. Stated in `SECURITY.md` | — |
| The card tier's low-stock badge is asserted by nothing | The tier a phone and the kitchen tablet actually render (`ISSUES.md` TEST-4) | Phase 4 |
| No audit trail on an authorisation refusal | ASVS **V7.1.3** — log access-control failures. A FORBIDDEN is returned and nothing records that it happened, so a kitchen tablet probing writes leaves no trace | Phase 7 |

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

### Phase 4 — Offline, and a shop that survives it ✅

Shopping list, tick off, scan, plus the service worker and write queue.
*Done when:* a full shop can be done in aeroplane mode and syncs correctly on
reconnect. **Met**, and proven by `e2e/offline-shop.spec.ts`.

**Screen A's layout moved to Phase 5.** This phase's title said "phone screen";
its done-when said "a full shop in aeroplane mode". The second is what was
built: a shop today is the existing `/shopping/[id]`, offline-capable. The
layout — Scan on top, TO BUY, IN THE TROLLEY, the ± stepper — is a UX change
that would have ridden on a correctness phase, and it belongs next to the
kitchen screen it shares vocabulary with. Named here rather than counted as
done.

### Phase 4b — Client state, the compiler, and a React gate

Three pieces of engineering hygiene that apply to every phase after this one.
Deliberately *after* Phase 4's queue rather than before it: the queue is the
state that justifies a store (§5.7), so building the store first would be
choosing a tool before the problem exists.

1. **The React Compiler.** `babel-plugin-react-compiler` as a dev dependency
   and `reactCompiler: true` in `next.config.ts`. *Done when:* the build passes
   with it on, every suite is still green, and `STATUS.md` records the build
   time before and after rather than asserting the cost is small.
2. **`react-doctor` as a gate** — `bun run check:react`, in `verify:local`,
   `verify:ci` and the `quality` CI job. Not `pnpm doctor`: pnpm, the installer
   at the time, had a built-in command of that name, and it won, so the script
   never ran and the gate passed on everything. *Done when:* it fails on an error and passes on warnings,
   the baseline is recorded, and the error it already found is closed.
3. **The write queue moves into a `zustand` store.** *Done when:* the queue's
   consumers subscribe to what they read rather than to the whole queue, the
   drain writes to the store from outside React without a ref dance, and the
   queue's existing tests pass unchanged — the store is a change of home, not
   of behaviour.

**Not in scope:** moving server data out of TanStack Query, or a second store.
§5.7 says why.

### Phase 5 — Kitchen screen, and Screen A's layout

Expiries, one-tap use, useful data. *Done when:* it runs for a week on a tablet
untouched except for using things up.

**Screen B is built** — `/kitchen`, §4's three sections, one button per card,
type sized for a metre. **The done-when is not met and cannot be met by a
test:** a week on a real tablet is a week on a real tablet. What exists is the
screen and its refresh; what is owed is the week, and it is listed as unowned
below alongside the iOS pass for the same reason.

**Inherited from Phase 4:**

- **Screen A's layout** (§3), which Phase 4 deferred. The two screens share
  vocabulary, so building them together is cheaper than building them apart.
- **A sign-out control**, which does not exist anywhere in this application.
  `queue.purgeAll` and the shell-cache purge are security controls nothing can
  currently fire. This phase's premise is a *shared kitchen tablet*, which is
  precisely where that matters.
- **Read persistence** (the three `@tanstack/*` packages), so opening the app
  with no signal shows the last data seen rather than "nothing saved yet".

**Inherited from Phase 3:** the KITCHEN role is enforced but unprovisionable —
nothing in the interface creates such an account. This phase owns that, and the
week-long run is not a real test of it until the tablet is running under a real
KITCHEN account rather than an owner's.

### Phase 6 — Rating

Extend the Open Food Facts fields, compute, display. *Done when:* a product with
no data and a non-food product both behave well — not just the happy path.

**Done, 2026-08-12, in three commits** — the fields (with a versioned cache so
month-old entries are not served as complete), the pure module (honesty rules
before arithmetic, worst additive dominates, absence of a verdict is not a
clean bill), and the display on the detail screen the scan lands on. Journey
10 is its measure. T7 — an offline scan resolved later — stays in §10.

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
   (`ISSUES.md` CRITICAL-4). It landed in Phase 3, so this verifies it — and
   closes the four gaps Phase 3 left, listed in its table above: throttling is
   per IP and never per account (NIST SP 800-63B §5.2.2), only the two auth
   endpoints are covered while `receipt.upload` runs OCR unthrottled (ASVS
   V11.1.4), a refusal carries no `Retry-After` header (RFC 9110 §10.2.3), and
   an authorisation failure is logged nowhere (ASVS V7.1.3).
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
7. **Dependency and image posture.** `bun audit` clean, Trivy clean, base image
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

### Phase 8 — The owner's first pass

The owner used the product and came back with six observations, dated
2026-08-18 — the first feedback this plan has had from its actual user. Each
was verified against the code the same day before being planned, and the
pattern §2 predicted still holds: *most of the backend already exists with no
interface using it.* Five of the six need no new procedure at all.

*Done when:* the owner repeats the pass that produced these observations and
none of them reproduces — the Panel's cards and the forms on a phone, the
kitchen items on the tablet.

**All six items closed, 2026-08-18/19** — `d7c178d`, `8114501`, `cf18b52`,
`4bbb82d`, `941d1ed`, `70386ea`, each with its docs commit beside it. What a
suite can answer, answers green: 486 unit / 385 component / 402 integration /
132 browser tests at the closing commit. **The done-when above is not a
suite's to grant**: it is the owner sitting down with the phone and the
tablet and failing to reproduce their own six observations. Until that pass
happens, this phase is closed the way Phase 5 was — against everything
measurable, with the human check named rather than implied.

**1. Product editing.** `product.update` has been implemented, Zod-validated,
household-scoped and role-guarded since before this plan, and its only callers
are two integration tests. No screen mounts it: `/products/[id]`'s Acciones
section offers add-stock and consume and nothing else (the page also links to
the price history), and `messages/es.json` has carried a dead `products.edit`
("Editar producto") key the whole time. The
owner asked whether this was a permissions problem — it is not; the detail
page reads no role and hides nothing. The work is an edit screen reusing the
`/products/new` field set, which matches `updateProductSchema` exactly;
extracting that inline form is the natural move, and the duplicate-barcode
check must learn to exempt the product's own barcode. Entry points: the detail
page's Acciones section and item 5's menu.

**2. The Panel's cards become doors.** The three stat cards on `/dashboard`
("Productos en el catálogo", "Necesitan reposición", "Caducados o que
caducan") are inert `<li>`s. Each becomes a link to a list already filtered to
what the card counts. That needs what no list page has: URL-driven filters —
`/products` and `/inventory` fire hardcoded queries and read no params, and
the only `searchParams` use in the application is `/products/new?barcode=`.
The procedures are ahead of the pages (`product.list` takes `search`,
`getStockOverview` takes `lowStock`/`category`/`locationId`), but two honesty
rules bind the work. **The card's number and the destination's rows must be
the same set** — today they would not be: the dashboard's restock definition
(`totalStock <= 0 || isLowStock`) is deliberately broader than the server's
`lowStock` filter, which skips zero-stock products with no minimum, so the
filter widens to match the card rather than the card quietly narrowing to
match the filter. And the catalogue card counts the first page (≤100), not the
catalogue; a real count replaces the page length before that number becomes a
door people trust.

**3. The stock form, in two layers.** `/inventory/add` shows seven controls
for what is usually a three-answer question. The owner's essentials — product,
quantity, expiry, **store and price** — stay visible; the rest folds behind a
disclosure (native `<details>`, the pattern `ProductRating` already uses):
unit, already prefilled from `defaultUnit`; location, which must learn to
default to the product's usual one — derivable from the entries
`product.getById` already returns, or a `defaultLocationId` migration; note.
Store and price are the striking half: `inventory.addStock` has accepted
optional `price` + `storeId` and written the `PriceRecord` in the same
transaction since SEC-1's fix, the store router is ready, and
`StoreSelector.tsx` exists with zero imports — the form simply never sends any
of it. The consume form gets the same two layers (product and quantity above
the fold; it has no expiry, store or price — D89). This item also owns
**PRICE-1**: no UI path in the application can create a price record today —
the receipt upload never asks which store either, and "no store means no
prices" — so the price screens chart a table nothing can populate. The same
`StoreSelector` on the upload screen closes the other half.

**4. The kitchen screen becomes actionable.** The §4 amendment, made real:
"Se está acabando" rows gain a one-tap *add to the list*, with a way to start
a list when none exists. The server moves first — `shopping.create` and
`shopping.addItem` join `consumeStock` on the tier a KITCHEN account may call
(§5.2, D88), which means the capability test that asserts every procedure
against the matrix changes with it, deliberately in the same commit.
`addItem` is already offline-queueable; `create` is not replayable — either it
becomes so, or starting a list from the tablet is online-only and says so
rather than failing quietly. Journeys 2 and 7 both change shape; their
amendments are in `SMOKE_JOURNEYS.md`. One metre and one tap remain the bar:
anything that needs a form still lives on the phone.

**5. The products list grows real actions.** The product name is already the
link on every breakpoint, so "Ver" — a second link to the same URL, which the
mobile cards already drop on WCAG 2.4.9 grounds — retires, and the column
becomes a menu: **edit** (item 1's screen), **adjust stock**
(`inventory.adjustStock`, today called only by the offline ReconcileDialog),
**stock history**, **price history** (`/prices/[productId]` already exists),
**delete**. Stock history is the one genuinely new screen:
`inventory.getStockHistory` is a cursor-paginated signed ledger with zero
client usage — "the only screen that shows why the number is what it is", per
its own docblock — and the chart is a running sum over it (recharts is
installed; `PriceChart` is the template). Delete is owner-directed: admin-only
(`adminProcedure`, the one-word swap `location.delete` already models) and
confirmed before it fires — §7's "undo, not confirm" rule meets its exception
here, because a hard delete has no undo. The guard stays *stricter* than
asked: the owner named stock and shopping-list references, but no relation
declares `onDelete`, so the database refuses while **anything** references the
product — price records and receipt lines included — and PROD-1's open
question is decided by D90: a referenced product is never deletable, because
its price history is the record the price screens exist to show. The menu
also needs what no component has had: the signed-in user's own role,
client-side — the layout hands down only `userId`/`householdId` — while the
doctrine stands that hiding the button is courtesy and the middleware is the
control.

**6. The auth panels leave `bg-primary`.** The login and register hero panels
(lg+ only, identical but for their i18n keys) are the only large surfaces
painted with the action colour — `--primary` #0e4f42, the same token as every
primary button — and the owner's verdict was "un fondo verde horrible". Filed
as UI-10. The recolor swaps the two sections' classes, never the token (which
would restyle every button and active-nav state; `--gauge` and `--ring` share
the hex as separate tokens): either an already-audited
surface pair — `bg-muted` and its checked foregrounds pass the contrast gate
with zero changes — or a new pale-cream token, which `check:contrast`
structurally requires in four places plus a `PAIRS` entry. The nested aside
card's translucent `bg-primary-foreground/10` goes with it, and the dark theme
needs its own answer, since pale cream is a light-theme idea.

---

## 10. Carried forward

Everything known to be unfinished, in one place, each with the phase that owns
it. Compiled when Phase 4 closed, because "it is in ISSUES.md somewhere" is not
a plan and a backlog spread across four files is a backlog nobody reads.

The rule for this list: **an item leaves it by being done or by being
deliberately dropped, and a drop is written down.** Nothing leaves by being
forgotten.

### Phase 5 — actionable work complete, with a correction

**Everything Phase 5 could do without a human and a device is done** — except
two §3/§5.1 promises that the 2026-08-17 journey re-audit found were never
built, and which this section previously counted into "Screen A (§3)" without
checking: the **± stepper** (§3 flow 3 — the component exists, unmounted since
Phase 0 lifted it out of Bolsillo for exactly this) and the **screen choice
remembered per `(userId, deviceId)`** (§5.1 — no deviceId is minted, no
preference stored, no role-based landing). Both went into the unowned table
below, because the rule of this list is that nothing leaves it by being
forgotten — and both had. Journeys 4 and 8 are their measures. **Both have now
landed**: the stepper 2026-08-25 (`74cff4b`), the screen choice 2026-08-26
(`300f665`), which closes the pair the re-audit found.

What also remains is the week-long tablet run and the iOS pass, both listed as
unowned below, and both things no suite can answer.

**Done since this list was compiled:** the database's own complaints are
translated into codes a caller can act on (`P2025` → `NOT_FOUND`, `P2002` →
`CONFLICT`, `P2003` → `BAD_REQUEST`, pool and transaction failures → `TIMEOUT`),
as one middleware on every procedure. It was the highest-value item the Phase 4
design left, because it is what makes `classify.ts`'s table *true*.

**Also done:** `/settings/unsaved` — what did not save, found deliberately
rather than caught on a banner, and the only place that says *when* each
change was made.

**Also done:** read persistence. Six allowlisted queries are kept per account
for 24 hours, so opening with no signal shows what was last seen instead of
"nothing saved yet". Mutations are never persisted — see D59.

**Also done:** A11Y-1. Both stock forms report what they wrote instead of
redirecting into silence, and the pinned assertion is flipped.

**Also done:** Screen A (§3). `/shopping` is the shop screen — Scan on top, TO
BUY with the minimum notch, IN THE TROLLEY folded away — and the list manager
moved to `/shopping/lists`. Undo is the trolley rather than a timed toast; the
reasoning is in `PROGRESS.md` D54.

**Also done:** provisioning. `/settings/people` lists the household and creates
an account with a role, which is what makes `KITCHEN` reachable at all — it has
been enforced on the server since Phase 3 and creatable only by a database
write ever since. Three defects on `/shopping` came out of testing it: a
newly-created list was hidden by a filter meant for completed ones, creating a
list did not refresh the page, and adding an item did not either.

**Also done:** a sign-out control, on `/settings`. There was none anywhere, so
`queue.purgeAll` and the cached shell's purge were security controls nothing
could fire. It asks before discarding unsent changes and offers to send them
first.

**Also built, and not on this list when it was compiled:** Screen B, the
kitchen (§4) at `/kitchen`. Its *done-when* — a week on a real tablet — is
unowned below, for the same reason as the iOS pass.

### Phase 6 — rating

| Item | Why it is here |
|---|---|
| ~~The rating itself (§6)~~ | **Done**, three commits: the fields (with a versioned cache so month-old entries are not served as complete), the pure module (honesty rules before arithmetic, worst additive dominates, absence of a verdict is not a clean bill), and the display on the detail screen the scan already lands on. §6's worked example scores 25 — the bottom edge of poor, which is what harmless additives on a grade-e product are worth |
| ~~DEBT-3~~ | **Done.** Valkey-backed and shared across replicas, failing open — a cache it cannot reach means asking Open Food Facts, which is what a miss already means |
| ~~OCR-1~~ | **Done.** The model is baked into the image, pinned and checksummed, and `TESSDATA_PATH` points the worker at it — so a scan needs no network. A smaller model than the CDN's default, which is a reasoned trade rather than a measured one: nothing here measures OCR accuracy |
| T7 — an offline scan resolved later | Journey 5's "never a dead end". Needs local-id resolution, which leaks `local:` ids into the cache and into components |

### Phase 7 — security review

| Item | Why it is here |
|---|---|
| ~~INV-2~~ | **Done.** `transferStock`'s guard is inside its transaction with the product row held, matching what `consumeStock` got in Phase 4 |
| ~~DEBT-1~~ | **Done.** Twelve characters, no composition rules, common-password and identity checks — NIST SP 800-63B §5.1.1.2 rather than the four regexes ISSUES.md proposed. And a maximum, which was missing entirely: Argon2id at 64 MB per call was taking unbounded input on two unauthenticated endpoints |
| ~~The review itself (§ below)~~ | **Done** (`docs/SECURITY_REVIEW.md`, 2026-08-26). All eight areas, each with the tests that prove its controls and the findings that remain with an owner. It found four instances of one isolation defect — three of them new — fixed them, and left a test that fails on the shape of them |
| ~~DEBT-5~~ | **Done.** Sixteen indexes, on a wider criterion than the four ISSUES.md named: every column a resolver filters or joins on, plus every single-column foreign key. Measured at 12,000 stock entries — one product's ledger, the hottest read in the application, went from a 3.6ms sequential scan to a 0.09ms index scan. The `householdId` ones are honestly labelled: on a single-household instance the planner scans the table anyway, and they are there for a shared instance and for the foreign-key checks a delete performs |
| ~~Rate limiting's four gaps~~ | **Done**, one commit each. Sign-in is counted per account as well as per address, at 10/15min on a hashed key (NIST SP 800-63B §5.2.2); `receipt.upload` is metered at 30/hour per account, counted before the file is decoded (ASVS V11.1.4); a 429 carries `Retry-After`, read off the refusal so it cannot drift from the message (RFC 9110 §10.2.3); and refusals are logged as JSON from a tRPC middleware, so a resolver cannot forget to be audited (ASVS V7.1.3). Two things deliberately carry no `Retry-After`: the 503 from a dead Valkey, and sign-in, which answers with a redirect rather than a status |

### Phase 8 — the owner's first pass (2026-08-18)

Six observations from the owner using the product — this plan's first contact
with its actual user. Each was verified against the code before being planned;
the detail lives in the phase itself (§9), the judgement calls in D87–D99.

| Item | Why it is here |
|---|---|
| ~~Product editing~~ | **Done** (`8114501`). `/products/[id]/edit`, its own inline form rather than an extraction (D92); blanks clear via `null` (D93, schema change); the duplicate-barcode check exempts the product's own code. En route it caught dynamic-routes auditing `/products/scan` under the name "product detail" |
| ~~The Panel's three cards become doors~~ | **Done** (`cf18b52`). `product.count` counts instead of paging; `needsRestock` is one question the card and `/inventory?filter=restock` both ask, so they cannot disagree (D94); the filter is loud and reversible. The expiry card opens `/inventory`, whose alert block shows the same two queries |
| ~~The stock form in two layers~~ | **Done** (`4bbb82d`). Essentials visible, the rest behind an uncontrolled `<details>` (D95); location defaults to the product's usual one (`usualLocationId`, D96); price is refused without a store and refused at zero; the receipt upload asks the store. Closes PRICE-1 |
| ~~The kitchen screen acts~~ | **Done** (`941d1ed`). `shopping.create`/`addItem` on the kitchen tier, held there by both capability suites; one-tap Apuntar per running-out row, queued offline with undo-by-cancel; the first tap creates the list, online-only and honest about it (D97). Journeys 2 and 7 rewritten to the landed shape |
| ~~The auth panels leave `bg-primary`~~ | **Done** (`d7c178d`), the phase's first unit. One token, `--hero` — cream in light, deep warm in dark — the ordinary ink on top, the aside card solid. The gate grew three pairs (60 checks) and was watched to fire; 117 browser tests green |
| ~~The products list grows real actions~~ | **Done** (`70386ea`), the phase's last unit. "Ver" retired; the column holds edit/adjust/history/prices, each named with its row's product; `/products/[id]/history` charts exact backwards-derived totals and `/adjust` computes the signed delta; delete is admin-only, two-step, on the product's own page (D98), with `auth.me`'s first caller carrying the role (D99). The list page stops being the last hardcoded-Spanish one |

### Unowned, and honest about it

These have no phase yet. They are here so that stays visible.

| Item | Note |
|---|---|
| ~~**The ± stepper — stock changes without a form (§3 flow 3)**~~ | **Done** (`74cff4b`, 2026-08-25). Mounted on the product detail for the roles `writeProcedure` admits: each press a delta through the offline queue (plus a purchase of one at the product's usual location, minus a consumption of one), the shown number the projection, the confirmation the snackbar sentence with the shared ten-second undo (D100/D105). Journey 4 passes, proven in the browser by two presses arriving as two `PURCHASE` rows of +1 |
| ~~**The screen choice per `(userId, deviceId)` (§5.1)**~~ | **Done** (`f3957c8`, `300f665`, 2026-08-26). A device id in a cookie rather than `localStorage` — which is what lets `/` decide on the server and redirect, with no client island and nothing to flash — a `ScreenChoice` row keyed on the pair, and `/start` asking once with three submit buttons and no JavaScript. A KITCHEN account lands on `/kitchen` unasked. Journey 8 passes complete, including *changeable from settings* at `/settings/screen` (`295fadc`) |
| **The manual screen-reader pass** | Phase 2b's one incomplete item. Four journeys are audited against the tree; whether it *sounds* sensible is what no tool answers |
| **A week on a real tablet** | Phase 5's own done-when for the kitchen screen. The screen and its five-minute refresh exist; whether it is still useful and still correct after seven untouched days is not something a suite can answer |
| **iOS Safari on a real device** | Playwright's WebKit is not iOS Safari, and §5.4 defers installability on iOS grounds specifically. The queue, `localStorage` and the worker all need a pass, dated in `STATUS.md` |
| ~~**The service worker under a production build**~~ | **Done.** It builds, serves the standalone artefact the image runs, and drives five assertions through a real worker: it registers and claims, `install` precaches `/offline`, the static cache holds real hashed chunks, an offline navigation is served from cache, and an uncached route falls back to the offline document. It had its own config at the time, because a `next build` was a minute the five-minute suite budget could not absorb; that config was folded into the main one on 2026-08-17, when the whole suite moved to serving the standalone build |
| `public/sw.js`'s 2,500 ms navigation timeout | **Half measured.** A shell navigation on the production build answers in 14–37 ms warm and 368 ms on the first cold hit, so 2,500 ms is ~70× a healthy navigation and ~7× the worst first load — it cannot be firing on an unremarkable connection, and a unit test now drives the fallback through the timeout at the constant the file declares. Whether 2,500 ms is the right moment to give up on a connection that is present but hopeless is still a judgement about how long somebody will stare at a blank screen, and no local measurement produces it |
| Cross-tab drain locking | Absent on purpose: two tabs draining at once is *safe*, because the same key applies once. An efficiency question, not a correctness one |
| ~~DEBT-6~~ | **Done.** Three domain errors in the services and a translator on the same middleware that handles Prisma's. The decision this was waiting on went to domain errors rather than `TRPCError`, because `processReceiptOcr` runs from a background task with no client to give a status to |
| ~~I18N-2..6~~ | **Done**, one commit each. The picker's five strings (the `aria-label` was the one that mattered — only ever announced, with no visible text behind it); `formatDate` deleted rather than parameterised, since nothing called it; "recibo" and "ticket" unified on the word a Spanish supermarket uses; two status labels that were one letter apart renamed to what the reader is waiting for; and the button that ends a review no longer promises a bulk action it cannot do |
| ~~I18N-8~~ | **Done.** Four headings and four aside strings, and a render helper that takes a locale — a component test in Spanish alone cannot see a string hardcoded in Spanish, which is how the aside panels survived. Both pages are now asserted in both languages |
| ~~UI-3~~ | **Done.** The last three: the stock procedures' inputs described a database row rather than what each one does — a required `operationType` every handler ignored, and a `quantity` whose sign `Math.abs` laundered, so `-5` booked `+5`. And `ProductPicker` read one page's namespace on both, telling `/inventory/consume` to pick the product it wanted to *add* stock to |
| ~~DOCS-1~~ | **Done**, 58 of 58, one commit per router. Not in the shape the entry suggested — restating the identifier costs a reader a line; each docblock says what the signature cannot. It found four defects in four routers, two of them filed as PROD-1 and SHOP-1 |
| ~~TEST-1~~ | **Done.** The harness was not merely unverified — it was broken: it built its connection from `POSTGRES_PASSWORD` while `.env` carries a working `DATABASE_URL` that nothing keeps in step with it. It derives from `DATABASE_URL` now, and 395 integration tests run through `pnpm test:integration` as documented |
| ~~Error boundaries~~ | **Done.** `(dashboard)/error.tsx` inside the intl provider, `global-error.tsx` outside every provider — hardcoded bilingual and inline-styled, because it replaces the root layout that would have supplied both |
| ~~A health endpoint~~ | **Done.** `/api/health` checks Postgres and Valkey, and `docker-compose.prod.yml` now gives the app the healthcheck its two dependencies already had. Verified by stopping the cache container |
| ~~Data export~~ | **Done.** `/settings` downloads the whole household as JSON — products, stock, receipts, prices, lists, members. Named `select` clauses rather than `include`, so a column added later cannot land in the file by default; the test that guards that was verified by breaking it |
| **A household admin panel — members and roles** | **Asked for 2026-08-27**, after `SECURITY_REVIEW.md` finding 8 was verified. `householdRouter` is `current`, `create`, `members`, `addMember`: a household can add a member and can never remove one or change a role. So "I have lost the kitchen tablet" has no answer from inside the application, and neither does "this person left". **The mechanism already exists and is proven** — `householdProcedure` re-reads `householdId` and `role` from the database on every call and ignores the token, so a demotion or removal bites on the very next request (`integration/session.freshness.test.ts`). What is missing is only the way to trigger it. Scope: list the members with their roles, change a role, remove a member — `adminProcedure`, `ItemRow` and a `Badge` for the role, no new primitives. ~~**The design question to settle first**~~ **— settled 2026-08-27 by building the server half.** `household.updateRole` and `household.removeMember` exist, with three guards and ten tests: the member must be *this* household's, only an owner may grant or revoke ownership (an admin demoting every owner is escalation dressed as member management), and the household must keep an owner — refused as `CONFLICT`, whose message names the escape, because promoting somebody first is what makes the invariant a guard rather than a trap. Each guard was removed in turn and turns exactly its own tests red. Removal sets `householdId` to null rather than deleting the account: leaving a household is not ceasing to exist. ~~**What is left is the screen**~~ **Done 2026-08-27.** `/settings/people` already listed the members with the role as a neutral `Badge`; what it lacked was the `actions` slot. Each row now carries a `Select` labelled *with the member's name* — four rows of "Rol" tell a screen reader which control it is and not whose — plus a save button that is **disabled until something changes and never fires on the select's own `onChange`**, because a mis-tap that demotes an owner is not something the server's last-owner guard can catch. Removal asks twice in the audited danger pair, the shape `product.delete` uses. The server's two refusals are translated into sentences that name the way out. Seven component tests, all confirmed to fail against a select that saves on change and a removal that skips the question |
| ~~**Session revocation — by the account itself, and by an admin from that panel**~~ | **Done, both halves.** The fork below was taken at its first branch: one `sessionsValidFrom` column, no new table, no per-session list. The check lives in the `jwt` callback for reason (2). **Asked for 2026-08-27**, which answers `SECURITY_REVIEW.md` finding 8's open question with *yes*. Two halves: anyone can end their own sessions, and an admin can end anyone's from the members panel above. **Unlike the panel itself, this one does need new machinery** — the session is a JWT with no server-side record, so there is nothing to revoke and nothing to list. Three things a scoper should know before starting. **(1) The 15 minutes is not a bound on a session in use.** `maxAge` is 15 minutes of *inactivity* and `updateAge` slides it every 5, so an active tablet renews indefinitely; the expiry only bites on a device that is put down, which is exactly the device nobody is worried about. **(2) The check cannot live only in the procedure tier.** `/api/auth/session` re-issues the token through Auth.js's own route, nowhere near tRPC — so a revocation enforced only where `householdProcedure` enforces role would leave a revoked session sliding forever. It belongs in the `jwt` callback, where re-issue happens. **(3) The fork:** coarse revocation ("end all my sessions") needs one timestamp column on `User` and no new table, and answers both halves; per-session revocation needs a record per session to list and end individually — and the `stoky_device` cookie from `src/lib/device.ts` already gives each browser a stable 365-day identifier, so labelling sessions by device would not mean inventing identity, only carrying it into the token at sign-in |
| Error tracking, PWA install | Still absent. The PWA half is deferred deliberately on iOS grounds (§5.4). Error tracking is the one worth a decision rather than a ticket: every option ships a household's errors to somebody else's server, which is the opposite of this product's premise, so "absent" may be the right permanent answer and should be written down as one |
