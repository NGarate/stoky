# Decisions that govern the application

Updated: 2026-11-14

Why the application is built the way it is: the product decisions every screen
and every procedure is held to. `PROGRESS.md` records the judgement calls taken
unit by unit (D1–D154); this file holds the few that bind all of them.

Each decision keeps the wording and the date it was taken with, and an
amendment is dated where it was made. Cite one by its name — `DECISIONS.md`
OFFLINE, `DECISIONS.md` USABILITY rule 4, `DECISIONS.md` OFFLINE.3 for the third
point of a numbered list. The names are the stable part: a heading may be
reworded, a name is not reused.

**Where these came from.** Until 2026-11-14 they were sections of
`docs/REDESIGN_PLAN.md`, the plan the redesign was executed against. The plan
is retired — its phases are recorded in `PROGRESS.md`, and what is still owed
is `STATUS.md`'s *What remains* — and its last version is
`git show 7638a4fe:docs/REDESIGN_PLAN.md`. Older documents and comments cite
it by section; this is where each section went:

| Cited as | Now |
|---|---|
| §1, §3, §4 | SCREENS |
| §5.1 | SCREEN-CHOICE |
| §5.2 | ROLES |
| §5.3 | Retired: the rating landed (RATING) |
| §5.4 | PWA |
| §5.5, §5.5.n | OFFLINE, OFFLINE.n |
| §5.6 | LANGUAGES |
| §5.7 | CLIENT-STATE |
| §5.8 | COMPILER |
| §6 | RATING |
| §7, §7 rule n | USABILITY, USABILITY rule n |
| §8 | ACCESSIBILITY |
| §2, §9 (the phases) | Retired: `PROGRESS.md` is the record of what was done |
| §10 | Retired: what is still owed is `STATUS.md`'s *What remains*; the error-tracking row is ERROR-TRACKING |

---

## SCREENS: Two entry screens, two doors onto the same data

Taken 2026-08-09; Screen B amended 2026-08-18.

| Proposal | Outcome |
|---|---|
| **Horizonte** | Basis of the **kitchen screen**. Its time axis answers "what expires?" directly |
| **Estante** | Basis of the **phone app**. Its minimum-stock notch answers "what's missing?" |
| **Bolsillo** | Not kept as a screen, but its **± stepper** is. It is the simplest way to consume or add without opening a form |
| **Triaje** | Not kept as a screen, but its **hierarchy** is: what needs action takes space, what is fine folds away |
| **Consola** | **Dropped.** It assumes a keyboard and technical vocabulary |

Both screens share one design system. They are not two apps — they are two doors
onto the same data.

### Screen A — Phone, "day to day"

**Who and when:** one person in the supermarket. Standing, one hand, in a hurry,
possibly poor signal.

**Question it answers:** *what do I need to buy, and is this thing in my hand a
good buy?*

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

### Screen B — Kitchen, "at home"

**Who and when:** anyone in the house, in passing, reading from a metre away. An
old tablet propped up. Possibly untouched for days.

**Question it answers:** *what should we eat before it goes off?*

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
down in ROLES, the work is Phase 8's.

**Design decisions:** 20–24px body, 40px+ headings; nothing urgent below the
fold; refreshes itself on a timer; dark theme automatically at night.

---

## SCREEN-CHOICE: Choosing a screen — remembered per device *and* per user

Taken 2026-08-09.

Asked once, then remembered for that combination. A shared tablet must not
inherit the choice of whoever logged in last, and a person must not be forced
into kitchen mode because they picked up the house tablet once.

Stored per `(userId, deviceId)`, with a `deviceId` generated on first run and
kept locally. Changeable from settings. The role (below) sets the default:
a kitchen account lands on the kitchen screen without being asked.

---

## ROLES: Roles instead of a "kitchen mode"

Taken 2026-08-09; amended 2026-08-18.

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

**Hiding buttons is not enough** — every restriction has to hold on the server.

---

## PWA: Installable PWA — manifest done, prompt and push deferred

Taken 2026-08-09; the manifest half done 2026-10-10.

Deferred on iOS grounds. **One caveat worth separating**, because it changes what
OFFLINE costs:

- *Installability, push notifications, background sync* — genuinely limited on
  iOS. Rightly deferred.
- *Service worker, offline cache, request queue* — **supported by iOS Safari**
  and is the machinery offline actually needs.

So offline does not have to wait for the PWA decision. We can ship the service
worker without ever prompting anyone to "install the app".

**2026-10-10 — the manifest half is done, the prompt half still is not.** The
application is installable through the browser's own action (Chrome's
*Install app*, Safari's *Add to Home Screen*), because a manifest and icons were
missing, not because a decision changed. Nothing prompts anyone, and push and
background sync remain deferred on the grounds above.

---

## OFFLINE: Everything works without signal, syncs afterwards

Taken 2026-08-09; point 3 corrected 2026-08-11.

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
   the item and cannot answer. USABILITY rule 3 says undo rather than confirm
   for the same reason: interruptions wear people down. Instead the sync
   indicator carries it as something needing attention, in words, and opens the
   reconciliation when the person chooses to deal with it. That also makes it
   survive being ignored for an hour, which is the realistic case.

   **A kitchen account cannot reconcile.** `adjustStock` is a `writeProcedure`
   and the capability matrix (ROLES) gives KITCHEN looking and consuming only.
   So on the tablet the conflict is reported and says who can fix it, rather
   than offering a control that would be refused by the server. Hiding a button
   is not a control, and offering one that cannot work is worse.
4. **Honest state.** A visible, calm indicator: "3 changes waiting to sync". Not
   an error, not hidden.
5. **Scanning offline.** The barcode is stored and enriched later from Open Food
   Facts. The user is never blocked.

The pieces: a service worker for assets and reads, `localStorage` for the queue
(CLIENT-STATE says why it is not IndexedDB, and states what would reverse that),
a `zustand` store as the queue's home in the client, and idempotency keys on
mutations so a replay cannot double-count.

---

## LANGUAGES: Both languages

Taken 2026-08-09.

The app ships in **Spanish and English**. `messages/es.json` and
`messages/en.json` already have matching keys and next-intl is wired up. The
rule for this work: **no string lands in a component**. Every new screen adds
both languages in the same commit, and the language switcher stays reachable
from settings on both screens.

Project documentation stays in English.

---

## CLIENT-STATE: A store, now that there is state React cannot hold

Taken 2026-08-11.

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

---

## COMPILER: The compiler, and a second opinion on the React we write

Taken 2026-08-11.

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

## RATING: A score of our own, from open data, explained

Taken 2026-08-09; built 2026-08-12.

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

## USABILITY: Rules for both screens

Taken 2026-08-09.

1. **One task per screen.** Two primary actions means two screens.
2. **No system vocabulary.** "Ran out", not "stock 0". "Saved", not "mutation succeeded".
3. **Undo instead of confirm.** "Are you sure?" wears people down; undo forgives.
4. **Errors say what to do next.** "No camera available. Type the barcode instead", with the field already focused.
5. **Never an empty, silent screen.** Empty is an invitation with a button.
6. **Everything works with a thumb.** 48px targets, no nested menus, no gestures to discover.

---

## ACCESSIBILITY

Taken 2026-08-09.

Keeps the level the proposals reached: **WCAG AAA contrast**, enforced by
`bun run check:contrast` (60 checks against the tokens in `globals.css` — 54
from Phase 2 until UI-10 added the hero surface; 140 while it measured the
five prototypes). Extended with 48px targets, state never by
colour alone, a real one-metre readability test for the kitchen screen, and
visible focus throughout. Still outstanding: an axe pass and a screen-reader
run, both belonging to the chosen design rather than to five prototypes.

*(Corrected 2026-11-14: the gate ran 98 checks over 39 tokens that day, and
`STATUS.md` keeps the current count. The axe pass exists, as component audits
(`PROGRESS.md` D154); the screen-reader run is still outstanding —
`SCREEN_READER_PASS.md` is its runbook.)*

---

## ERROR-TRACKING: Absent by default

Taken 2026-08-31.

Error tracking got its decision on 2026-08-31, and it is a direction rather
than a drop: **absent by default stays the answer** — every hosted option ships
a household's errors to somebody else's server, the opposite of this product's
premise — and the next investigation is a **plug-and-play opt-in**: what it
would take for an operator who wants error tracking to add a self-hosted
collector (a compose service and an env var, nothing baked in) without this
repository choosing one for them. Unowned until someone picks the investigation
up.
