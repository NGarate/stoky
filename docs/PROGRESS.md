# Progress log

Working memory for the iterative execution of `docs/REDESIGN_PLAN.md`.

This file exists so that work can resume from a cold start. It records what is
done, what is in flight, and — most importantly — **decisions taken without
asking**, so a reader is never left wondering why something is the way it is.

Rules for this log:

- One line per completed unit, newest last, with its commit.
- Every autonomous decision gets an entry in *Decisions*, with the reasoning.
- Anything discovered that is not in the plan gets filed in `ISSUES.md` and
  linked here, rather than being fixed silently.
- Nothing is marked done on the strength of it having been written. It is done
  when a command says so.

---

## Status

| Phase | State |
|---|---|
| 0 — Clean slate | ✅ Complete |
| 1 — Close the dead routes | ✅ Complete |
| 2 — One design system | ✅ Complete |
| 2b — Foundations of use (audit) | ✅ Complete except the human screen-reader pass |
| — Test infrastructure (unplanned) | ✅ Complete |
| 3 — Roles, and CRITICAL-4 | ✅ Complete |
| 4 — Offline, and a shop that survives it | ✅ Complete against its done-when |
| 4b — Client state, the compiler, a React gate | ✅ Complete |
| 5 — Kitchen screen, and Screen A's layout | ▶ Next |
| 6 — Rating | Not started |
| 7 — Security review | Not started |

---

## Done

### Phase 4 — Phone screen, offline from the start

**Groundwork.** Three defects were closed before the offline layer was written
rather than after, because each one is load-bearing for it.

**Groundwork** — three defects closed before the offline layer, because each
one is load-bearing for it.

| Unit | Commit |
|---|---|
| UI-9 closed — a failed query no longer claims the household is empty | `6214efe` |
| The availability guards measure net stock, not gross purchases | `a6f1d49` |
| INV-1 closed — the expiry views report what is left of a batch | `8961376` |

**Paid down while the offline design was being pressure-tested.** A workflow of
eleven agents read the repository and produced the build order the units below
follow; it found SEC-1 and three stale claims in this plan on the way.

| Unit | Commit |
|---|---|
| The scan flow speaks from the catalogue | `a3dbfa6` |
| DEBT-2 closed — the torch toggle reaches the camera | `9af0345` |
| I18N-7 closed — the stock overview speaks from the catalogue | `faec173` |
| TEST-4 closed — the low-stock badge checked where a phone sees it | `1a6561b` |

**The server half of offline.**

| Unit | Commit |
|---|---|
| SEC-1 closed — a price record can no longer name another household's store | `7c0190c` |
| The database client comes from the context | `ed7bb0f` |
| A purchase writes its entry and its price together, or neither | `33246a4` |
| Data first: a failed refetch no longer replaces a working page | `b28a9a5` |
| `withReplay` — a queued mutation applies once, however often it arrives | `eb401be` |
| An identifier mintable without a secure context | `ecdd8e1` |
| The five writes a shop composes are replay-safe | `5e31c5c` |
| INV-2's consume half closed — the product is held while the guard decides | `910e941` |

**Asked for mid-phase**, and two of the three reverse recorded decisions, so the
plan was amended before anything was built (`017eea3`).

| Unit | Commit |
|---|---|
| The React Compiler, measured before and after | `d4a6d13` |
| The locale is validated before it reaches a dynamic import | `22a768c` |
| One instant per render on the product page | `27452bf` |
| `react-doctor` gates on errors, not on its score | `f75f321` |

**The client half of offline.**

| Unit | Commit |
|---|---|
| A refusal, a retry and a disagreement told apart | `5bca67f` |
| The queue, in a `zustand` store | `0e84c91` |
| The query client starts knowing whether there is a signal | `6292ce5` |
| A queued change shows as done before it is sent | `d7a6f40` |
| The drain, its triggers, and the shell that mounts them | `9994d40` |

Filed in passing: INV-2's `transferStock` half, still open — its guard sits
outside its transaction, and it is deliberately not replayable, so it never
reaches the queue.

**The interface, and the proof.**

| Unit | Commit |
|---|---|
| The sync indicator, and the reconciliation prompt | `2d3c42c` |
| Ticking an item off without a signal | `928ae8c` |
| The service worker, its CSP, and the gitignore that hid it | `8363f17` |
| Registering it, and `/offline` to fall back to | `f7ca71c` |
| A shop composed in aeroplane mode, applied once | `079d097` |

**Phase 4 is complete against its done-when.** `e2e/offline-shop.spec.ts`
composes a shop with the network off, shows it as done, reconnects, and proves
the server applied it exactly once — including across a lost reply, where both
attempts carry the same key.

**Screen A's layout is not built**, and that is stated rather than counted.
Phase 4's title said "phone screen"; its done-when said "a full shop in
aeroplane mode". The second is met and the first is not: a shop today is the
existing `/shopping/[id]`, which now works offline. The design that preceded
the phase marked the layout as its droppable tail — a UX change riding on a
correctness phase — and it moves to Phase 5, next to the kitchen screen it
shares vocabulary with.

Also moved to Phase 5, and uncomfortably: **a sign-out control**. There is none
anywhere in this application, so `queue.purgeAll` and the shell-cache purge are
security controls nothing can fire. The cache is purged on reaching `/login`,
which is the only end-of-session signal that exists today.

### Phase 3 — Roles, and the security gap that outlived every phase

| Unit | Commit |
|---|---|
| `KITCHEN` added to `HouseholdRole` | `05be1e9` |
| The role reaches the JWT and the session | `cd23d3c` |
| The capability matrix enforced per procedure, all 45 | `7dcea39` |
| DEBT-4 closed — every router throws `TRPCError` | `8cbf641` |
| CRITICAL-4 closed — sign-in and registration limited per IP | `93cb97d` |
| HOUSE-1 and UI-8 closed — a way out of the no-household state | `039d911` |
| The second, unmetered credential endpoint removed | `422803c` |
| TEST-3 fixed and TEST-4 filed; the browser suite green again | `2f8552a` |

**Phase 3 complete.** Journey 2 passes. Filed in passing: DEBT-6 (the services
layer still throws bare `Error`), UI-9 (`/shopping` and `/settings/locations`
show an empty state on a failed query) and TEST-4 (the card tier's low-stock
badge is asserted by nothing).

### Phase 2b — Foundations of use

| Unit | Commit |
|---|---|
| Every page on the tokens; real dashboard | `4eafd1c` |
| Auth pages on the tokens; opacity contrast fixed | `0158b1b`, `c839cde` |
| axe-core AAA audit, 30 checks over 15 routes × 2 themes | `1c6b2d6` |
| Theme and language controls | `24a2203`, `c6d02d2` |
| Mobile-first: bottom bar, tablet rail, tables to cards | `fcb3cad` |
| axe extended to all three viewport tiers — 90 checks | `fcb3cad`+ |
| `/receipts/[id]/applied` built and driven; sixth dead route closed | `364528b` |
| Every interactive element raised to the AAA target size | `e6aadea` |
| A4.2–A4.4 measured in a browser — `e2e/a11y-structure.spec.ts`, 16 routes × 3 tiers | `225bc19` |
| `check:links` gating CI and `verify:local` | `a0b388a` |
| UI-5 and I18N-1 closed: the receipts pipeline fits a phone and speaks both languages | `621185d` |
| UI-2 and UI-4 closed: the location picker is a real listbox and offers the whole tree | `a6b01c2` |
| A4.5 — the AAA criteria no tool checks, in `e2e/a11y-aaa.spec.ts` | `7c7206f` |
| Catalogue drift caught by a unit test | `14164d3` |
| UI-6 closed: the picker opens where it can be seen | `0e74c32` |
| Two receipts in the seed; the dynamic routes audited by following links | `fe8bbcf`, `ad6cc6b` |
| Journey states corrected; I18N-5 filed | `e93428b` |
| A4.6 automatable half — `e2e/screen-reader.spec.ts`; A11Y-2 and UI-7 fixed | `31d5358`, `7139359` |

**Phase 2b is complete except the human screen-reader pass**, which is the one
piece of this phase that cannot be delegated to a machine or to an agent. Four
journeys are audited against the accessibility tree; what is left is whether the
result sounds right to a person using it.

### Test infrastructure — unplanned, and it had become the bottleneck

| Unit | Commit |
|---|---|
| Target size decided from CSS instead of from a browser | `f775436` |
| Every CI test job held to ten minutes, and the guard made to fire | `08a2153` |
| E2E from 27 minutes to 6; two tests that asserted nothing deleted | `b64eae1` |
| UI-8 and I18N-7 filed | `4ea3a25` |

Not in the plan, and it should have been: the suite had reached 27 minutes for a
full matrix, which is long enough that a healthy run and a hung one look
identical from outside, and long enough that people stop running it. Writing a
feature took minutes; verifying it took half an hour.

### Phase 2 — One design system

| Unit | Commit |
|---|---|
| 26 tokens in `globals.css`; primitives fixed; audit reads the CSS | `86c2149` |
| Token existence and focus indicators enforced by tests | `4eec006` |
| Contrast figures corrected; UI-3 item 5 closed | `2da0bb5` |
| Design lab retired; stepper rehomed and retargeted | `3612a36` |

**Phase 2 complete.** `.bg-primary` went from zero occurrences in the built CSS
to a real rule; the login button has colour for the first time, measured at
`#0e4f42` on white with a solid 2px focus outline in both themes.

### Phase 1 — Close the dead routes

| Unit | Commit |
|---|---|
| `/inventory/add` built and driven in a browser; filed UI-2, UI-3 | `fb26255`, `1ce42e1` |
| `/inventory/consume` built and driven, incl. the over-consume path | `b7f06bb` |
| `/products/new` built and driven; found a fifth dead route | `21e9cf5` |
| `/settings` and `/products/[id]` built and driven | `d09dd94` |
| Four `test.fixme` tests enabled and green; filed NAV-1, HOUSE-1 | `249fb8d` |

**Phase 1 complete.** All five dead routes exist and the E2E suite runs 70
passed / 10 skipped / 0 failed across all five browser projects. The ten skips
are the stock flows on phone viewports, scoped with a reason and a pointer to
Phase 4.

### Phase 0 — Clean slate

| Unit | Commit |
|---|---|
| Removed `zustand`, `@biomejs/biome`, `@types/react-test-renderer` | `3be8b2e` |
| Untracked `spa.traineddata` (3.3 MB); filed OCR-1 | `b3bd432` |
| Removed vestigial `tailwind.config.ts` | `a3b3efe` |
| Moved the Prisma seed config to `prisma.config.ts` | `436cfea` |
| Folded `INFRASTRUCTURE_SOLUTIONS.md` into `LOCAL_BOOTSTRAP.md` | `bcc8b1b` |
| Corrected the stack claims in CLAUDE/AGENTS/README | `7aa6c7f` |
| Corrected the theme-token count | `b4097c8` |
| Filed INV-1 (expiring items report entry quantity) | `8bdc2a8` |
| Rewrote `SMOKE_JOURNEYS.md` around the two screens | `f780623` |
| Rewrote `DESIGN_PROPOSALS.md` as a decision record | `8a95dcf` |
| Pruned the design lab to Estante and Horizonte | `f501ec0` |
| Retired `DETAILED_PLAN.md` and the dead branch references | `43476e1` |

---

## Decisions taken without asking

Recorded so they can be overruled on sight rather than archaeologically.

**D1 — Phase 1 routes are built plain, not on the new design system.**
The four dead routes are needed before Phase 2 merges the design tokens. Waiting
would serialise two phases for no reason. They are built with accessible,
semantic markup and the existing primitives; Phase 2 restyles them. The risk is
one restyle pass, which is cheap. The alternative is leaving the scanner
pointing at a 404 for another phase, which is not.

**D2 — Order within Phase 1: `/settings` last, stock movement first.**
`/inventory/add` and `/inventory/consume` unblock three of the four `test.fixme`
tests and Journey 1, and their procedures already exist. `/products/new`
unblocks the scanner, which currently dead-ends. `/settings` is a navigation
link on every dashboard page but reaching it is not blocking anything, so it
goes last.

**D3 — Each route ships with its own E2E proof.**
The plan's acceptance for Phase 1 is the four `test.fixme` tests passing without
`fixme`. A route is not counted done until its test is un-skipped and green, so
the phase cannot drift into "written but unproven".

**D5 — Product selection uses `product.list`, not `searchByName`.**
`searchByName` is a raw pg_trgm query; under the default 0.3 similarity
threshold a short prefix matches nothing, and an empty query returns nothing at
all, so it cannot back a picker. `product.list` does substring matching and
returns `defaultUnit` for prefilling. Trigram similarity stays where it belongs,
matching OCR'd receipt lines.

**D6 — Defects found while building are filed, never fixed in passing.**
Building `/inventory/add` surfaced UI-2 and seven smaller issues. Fixing them
inside a feature commit would have hidden them; each is now tagged with the
phase that closes it. The exception is anything that would make the new work
untrue — none did.

**D7 — Verification is a browser, not a green typecheck.**
The delivered route passed lint and typecheck while I could still not tell
whether it worked. Driving it as a user found the truth in one run: stock went
from 0 to 3 and the status badge changed. Every route in this phase gets the
same treatment before it counts as done.

**D8 — `/products/new` reports the outcome instead of redirecting.**
Its siblings redirect on success. This one cannot: the natural destination,
`/products/{id}`, is a 404. Rather than redirect to `/products`, which says
nothing about which of three outcomes occurred, the page keeps the result on
screen with onward links. Revisit once the detail route exists.

**D9 — Stock flows are scoped to desktop until Phase 4.**
They failed on both phone viewports because the dashboard has no mobile
navigation at all (NAV-1) and the forms were built desktop-first under D1.
Running them on a phone today measures an absence rather than a regression. The
skip carries its reason inline, and removing it is part of Phase 4's definition
of done.

**D10 — E2E selectors target hrefs, not link text.**
The app ships in two languages, so a selector matching "Añadir" passes in
Spanish and fails in English. Href-based selectors are stable across both and
survive copy changes.

**D11 — Estante's palette becomes the application's, not a merge of two.**
Phase 2 was written as "merge the Estante and Horizonte tokens". Averaging two
AAA-verified palettes would produce a third that is verified as neither, and the
contrast headroom is what makes them safe. Estante wins because it is the phone
app's basis and therefore the everyday surface; the token set is checked against
the kitchen screen's needs — large type, calm dark theme — rather than blended
with Horizonte's.

**D12 — The CSS is the single source of truth for tokens, not a TypeScript module.**
Tailwind 4 is CSS-first and the JS config was removed as vestigial, so tokens
live in `globals.css` under `@theme`. The contrast audit is reworked to parse
that file instead of importing the design-lab module. An audit that measures a
different copy of the palette than the one shipped is how a green check comes to
mean nothing — which this repository has already experienced once with the
component tests.

**D13 — The lab goes, the stepper stays.**
Retiring `src/app/design` nearly took the ± stepper with it, which is exactly
what lifting it out of Bolsillo in Phase 0 was meant to prevent. It now lives at
`src/components/inventory/QuantityStepper.tsx` with its stylesheet retargeted
from the lab's tokens to the application's. Caught only because the deletion was
checked afterwards rather than assumed complete.

**D14 — Three sizes, two breakpoints, and tablet is the least dense.**
Density normally rises with width. The kitchen tablet inverts it: read from a
metre away, it needs the largest type and the fewest elements of the three tiers,
at a width where a naive layout starts adding columns. So the rule is viewing
distance, not screen width — phone at arm's length, tablet at a metre, desktop
at half a metre. Tables therefore become cards on phone *and* tablet and survive
only from `lg`.

**D15 — The phone navigation is a bottom bar with four destinations.**
Not a hamburger: on a phone used one-handed in a shop, the top corner is the
furthest point from a thumb and a drawer hides the destinations behind a control
you have to know about. Seven destinations do not fit at 48px targets, and they
should not — the phone answers "what do I need to buy". Compra · Inventario ·
Escanear · Más. The tablet keeps a side rail instead, because a bottom bar wastes
the most valuable strip of a screen read from a metre away.

**D16 — The structural a11y checks are an E2E suite, and a separate one.**
A4.2 is a measurement in CSS pixels, A4.3 assembles a layout and a page, and
A4.4's colour rule compares an element with its peers' computed styles. The
component suite runs on happy-dom, which has no layout engine — every rect there
is 0×0 — so it can only assert that a class name is present, which is what
`DashboardNav.test.tsx` does and which is a proxy for the property rather than
the property. They live in `e2e/a11y-structure.spec.ts` rather than inside
`accessibility.spec.ts` so that suite's 90 axe checks keep meaning one thing.

**D17 — The target-size floor is 48px everywhere, not 44 with a phone exception.**
WCAG 2.5.5 asks for 44 and A4.2 asks for 48 "where a thumb is expected". Written
mobile-first (A3.4), unprefixed describes the phone, so the floor is simply 48
and no call site has to reason about which tier it is visible at. The test still
keeps the tiers honest — 48 at 390px, the AAA 44 above it — so a desktop-only
control is not held to a phone rule it can never be used under.

**D18 — `getAppliedSummary` counts what `applyReceipt` applied, not a list of
match statuses.** It filtered items to `USER_CONFIRMED | USER_CREATED`, which is
narrower than the condition `applyReceipt` writes stock under: `confirmAll`
accepts a subset of the lines, so a partly-reviewed receipt can reach CONFIRMED
with lines still AUTO_MATCHED and those get stock too. The filter now mirrors
`applyReceipt`'s own condition, and the procedure also returns the store and the
count of lines that produced nothing. Fixed rather than filed under D6, because a
confirmation screen that under-reports what it just did is the one defect that
would make the new page untrue.

**D19 — 3.3.5's help must be attached, and only fields inside a `<form>` owe it.**
The criterion says help must be *available* and stops short of requiring it to be
programmatically associated. This project requires the association anyway: its
premise is that anyone in a household can use it, and a hint that exists only as
text under an input is help for sighted mouse users and nobody else. The evidence
is `/register`, whose household hint was written, visible, and unreachable by a
screen reader. The other half of the decision is the boundary: a language
selector and a filter box change the view rather than collect information, so
demanding a sentence of help for "Buscar" would be padding dressed as
accessibility. `<form>` membership is where "requires user input" actually lands.

**D20 — Two defects found while verifying a fix are filed, not folded in.**
Verifying the receipts and picker work turned up UI-6 (the picker's panel opens
under the fixed bottom bar) and UI-7 (the review page's pending count is frozen
at zero). Both are real and both are in files that were open at the time, which
is exactly when D6 is tempting to skip. They are filed. UI-6 is then taken as
its own next unit rather than silently — because a picker whose options a phone
user cannot see is not a working control, and closing UI-2 and UI-4 while
leaving it would make those two closures read as more than they are.

**D21 — The seed owns the fixtures the dynamic routes need.**
`/receipts/[id]/review` was unreachable through the interface on a fresh install
and in CI, because the seeder deleted receipts and created none. Every suite here
works from a list of static paths, so a route with an id in it was audited by
nobody — which is how a 505px-wide page survived three responsive sweeps, and
how a dead `/products/[id]` survived three link audits before that. The fixtures
go in the seed rather than into a test's setup, so that one dataset serves the
suite, CI and anyone opening the app for the first time. `e2e/dynamic-routes.spec.ts`
then discovers ids by following links rather than by reading the database: a
route reachable by clicking is a route that gets checked, and an index that stops
linking to its own detail pages fails the discovery step, which is worth knowing
on its own.

**D22 — A11Y-2 was fixed, not filed, and that is the exception D6 needs.**
D6 says defects found in passing get filed rather than fixed, and it has held all
phase. This one broke it deliberately. "Confirmar" wrote `USER_CONFIRMED` to the
database and left the page byte-identical — no refetch, no count change, no
announcement — so the only reasonable response to it was to press it again, and
that was a second write. A defect whose symptom is "the control lies to
everyone" is not a finding with a workaround; it is the control not working. The
rule stays: file when the fix is a separate piece of work, fix when leaving it
would mean shipping something that does not do what its label says.

Fixing it closed UI-7, which was the same root cause seen from the outside, and
exposed a third thing neither entry had noticed: "Confirmar todos" is disabled
while anything is pending, so with the count frozen above zero the bulk action
was disabled *permanently*. Its name is now the only thing wrong with it, which
is filed as I18N-6 rather than renamed, because wording is a product decision.

**D23 — The predicate for "reviewed" lives in one module.**
`ReviewCard` computed it correctly from `matchStatus` while the review page kept
a `useState(0)` that never moved, so the heading said "4 productos pendientes"
above four cards all reading "Confirmado". Two definitions of one word, one of
them wrong — the same shape as D18. It is `isItemReviewed` in
`src/lib/receipts.ts` now, imported by both.

**D24 — Ten minutes is the budget for all verification, and it is enforced in
three places.** Not a runner constraint — a product decision. Verification that
takes longer stops being run, and a suite nobody runs still has to be maintained
while telling nobody anything. `verify-local.sh` holds the whole ladder to 600
seconds and every step to its own ceiling; each CI test job is capped at ten
minutes; Playwright's `globalTimeout` is nine, so it fails first and names the
test rather than the runner killing the job with no report. The first attempt
set it at seven, which would have failed CI runs that still met the contract —
a ceiling that cries wolf only teaches people to raise it.

**D25 — A check belongs in the cheapest tier that can answer it honestly.**
Three tiers: static facts about source and CSS in Bun; DOM facts in Bun with
happy-dom; layout and interaction in a browser. The line is not a preference —
axe itself draws it, running under happy-dom for `button-name`, `heading-order`,
`label` and `link-name` while returning `color-contrast` as *incomplete*. The
target-size floor moved to the middle tier via Tailwind's own compiler, which
resolves a component's class string to the CSS a browser would apply. What
cannot move is anything about composition: a parent that clips, a sibling that
shrinks, a fixed bar drawn on top.

**D26 — A test that cannot fail is deleted, not maintained.** Four went: three
asserted that `page.viewportSize()?.width` equalled the width just passed to
`setViewportSize`, and one ran a registration, a product creation and a stock
movement before ending on `// Assertion omitted`. This is the same rule that
retired 352 tautological component tests in Phase 0, applied to the suite that
replaced them — the rule does not stop applying once the tests are ours.

**D27 — Authorisation reads the database, not the JWT.**
The plan says to carry `role` through the session callbacks, and it is carried —
but the session copy exists for the interface, which uses it to hide what an
account cannot do. `householdProcedure` reads membership and role per request.
Two things follow that are worth one indexed lookup: a demotion or a removal
takes effect on the next request rather than whenever the 15-minute token
happens to expire, and an account that has just created its household can use it
immediately instead of signing out and in again to mint a token that knows about
it. The second is not a nicety — without it the HOUSE-1 fix appears to do
nothing for fifteen minutes. In five routers the lookup is free: those
procedures were already making exactly that query, one copy each, to find the
household id. 36 copies are gone.

**D28 — The per-procedure check is a static test, and the behavioural one is
separate.** The phase's *done when* says "repeated per procedure rather than
sampled", and calling all 45 procedures with valid input as three roles is 135
calls of scaffolding whose failure modes are mostly its own. So the coverage is
split by what each tier can answer honestly (D25): a unit test reads how every
procedure is *declared* and compares it against the matrix, and an integration
test proves the middleware actually refuses. The static half earns its place
independently — when a `TRPCError` was reverted to a bare `Error` in `price.ts`
to check the tests could fail, only the static test went red. No behavioural
test provokes that path, and none would have noticed.

**D29 — The rate limiter fails closed, and the limits are configurable.**
An attempt that cannot be counted is refused. Failing open hands an unlimited
auth endpoint to anyone who can take the cache down, which is the state
CRITICAL-4 describes; the cost is that Valkey becomes a hard dependency of
signing in, which is stated in `SECURITY.md` and named in the server log rather
than left for an operator to discover through a login form that rejects a
correct password. The limits are read from the environment because the browser
suite registers dozens of accounts per run against a server with no proxy in
front of it, so the whole matrix shares one bucket; `playwright.config.ts`
raises them rather than switching the limiter off, so it still runs on every
request the suite makes, and a unit test asserts the shipped defaults with the
environment unset so the override cannot become the product's behaviour.

**D30 — A successful sign-in clears its counter.**
`CLAUDE.md` says 5 login *attempts* per 15 minutes. Taken literally that locks
out a household signing in from a phone, a tablet and a laptop before anyone has
mistyped anything. Clearing on success leaves the ceiling exactly where the
specification puts it for someone who cannot sign in, which is the only case the
limit defends against.

**D31 — The second credential endpoint was removed, not limited.**
An adversarial review of the finished phase found `auth.login`: a public tRPC
procedure doing its own `argon2.verify` and returning the account's identity,
which the interface has never called and which the new limiter did not cover. So
five wrong passwords on the Auth.js door locked an address out while the same
guesses through `/api/trpc/auth.login` were unlimited. Deleting it beat limiting
it — Auth.js already owns credential verification, and a second path nothing
calls is a liability whether or not it is metered. Its four tests were repointed
at `authorize`, which had no coverage below the browser until then; that
immediately caught a second thing, which is that
`authConfig.providers[0].authorize` is Auth.js's placeholder `() => null` and the
configured function lives in `options`. Three sign-in tests passed against a stub
for one run.

**D32 — TEST-3 was fixed rather than left filed, on D22's reasoning.**
D6 says file, do not fix in passing. TEST-3 — one E2E journey writing the stock
another journey asserts — was filed and then fixed inside the same phase,
because a filed defect that keeps a gate red is not a finding with a workaround;
it is a gate nobody can use, and the next person to run the suite would have had
to rediscover it. The rule stands: file when the fix is separate work, fix when
leaving it means the project cannot tell whether it is broken.

**D33 — Cross-engine coverage is a separate axis from test coverage, and the
matrix stopped multiplying them.** The browser suite ran every spec on five
projects: 182 tests and 1,098 seconds of processor time for 26 distinct
behaviours. Duplicating a sign-in across five engines does not test five
things — the flow is tRPC, Prisma and Argon2id, none of it rendered, none of it
different because the engine is. What does vary by engine is layout. So
chromium runs everything as the reference, Mobile Safari runs the two layout
specs because WebKit at a phone width is where this project's layout defects
have actually appeared (UI-5, UI-6), and Firefox and desktop WebKit run a
four-test `@smoke` set. Mobile Chrome is gone: Blink at 393px, a width chromium
already visits on every route through `setViewportSize`. 89 tests, 2.9 minutes.

**D34 — A browser test must name the thing only a browser can answer.**
The corollary of D25, applied as a rule for adding tests rather than a
description of the tiers. Five picker tests failed it — keyboard navigation,
Escape with focus returned, and tab order are facts about the DOM, and
`LocationPicker.test.tsx` already asserted every one against the real component
in milliseconds. They cost five tests on five projects and twenty-five page
loads to re-answer a question that was already answered. The two that stayed
name their reason: composed target size and whether a fixed bar is painted over
an option, neither of which happy-dom can decide, because every rectangle in it
is 0×0.

**D35 — The E2E ceiling is the contract, not a safety net.**
`globalTimeout` was nine minutes everywhere while the suite measured 5.6. A
ceiling three times the measurement cannot fail before the suite has already
become something nobody runs. It is five minutes locally, where the suite takes
2.9, and nine in CI — not a weaker contract but a different machine: two
workers on four cores that also run the dev server, with two retries on
failure.

**D36 — The two AAA criteria a machine can decide are decided here, and the
rest are a documented manual pass.** pa11y's `WCAG2AAA` standard was run before
deciding anything: 0 errors, 1 warning, 60 notices on `/login`, every AAA item
beginning "Check that…". So no tool automates the AAA half, and the project
measures the two that are mechanically decidable and were missing — 3.1.5
reading level, on the catalogues, with Fernández-Huerta for Spanish because
Flesch reports Spanish as harder than it is; and 2.2.6 timeouts, by sliding the
session on activity and warning before an idle one ends. pa11y and
Accessibility Insights are documented as the manual procedure in
`DESIGN_AUDIT.md` §5 and deliberately kept out of CI: a check that can only say
"ask a person" either passes vacuously or floods the log.

**D4 — Strings go into both catalogues in the same commit.**
`REDESIGN_PLAN.md` §5.6 requires Spanish and English. Enforced per commit rather
than swept up later, because a translation backlog never gets paid off.

**D37 — Phase 4's prerequisites were fixed first, not filed and worked around.**
Three defects stood directly under the offline layer. `ISSUES.md` INV-1 said so
in as many words — "Phase 4 must not build replay on top of this" — because the
availability guards measured gross purchases and would have let a replayed
consumption drive stock negative. UI-9 sat on `/shopping`, the route the phone
screen is built on, and `REDESIGN_PLAN.md` §7 rule 5 is "never an empty, silent
screen": a new screen standing on a route that lies about being empty inherits
the lie. This is D32's rule, not an exception to D6 — file when the fix is
separate work, fix when leaving it means the next thing built is wrong.

**D38 — The drawdown rule is stated in a module, not assumed in a router.**
Stock is an append-only ledger with no link between a purchase and the
consumption that drew it down, so "how much of this batch is left" has to be
derived, and the derivation needs a rule for which batch a consumption came out
of. Soonest-expiry-first, with undated batches last. It is an assumption and it
is written down as one, in `src/lib/inventory/batches.ts`, because the
alternative — attributing each consumption to a batch at write time — is a
schema change `ISSUES.md` has twice declined to make as a side effect. Putting
it in a named module also put it at the tier that can test it: 19 tests in
35ms, against a browser or a database for the same arithmetic.

**D39 — Commits are unsigned, because every commit in this repository is.**
`commit.gpgsign` is `true` and `user.signingkey` points at
`~/.ssh/git-signing-key`, but the key is passphrase-protected with no agent
running, so signing fails. Checked before assuming: `git log --format=%G?` says
`N` for every commit in the history, so unsigned matches what this repository
actually does rather than departing from it. The configuration is left alone —
it is the operator's to fix, by loading the key into an agent.

**D40 — Zustand comes back, and Phase 0's reason for removing it is why.**
Phase 0 removed `zustand` (`3be8b2e`) and `CLAUDE.md` recorded the rule: server
state is TanStack Query's, local UI state is React's, and nothing else *without
a case React cannot serve*. Asked to reintroduce it, the honest move was not to
delete the rule but to find the case — and Phase 4 had produced one. The
offline write queue is read by four unrelated surfaces, written from outside
React by the `online` event, a backoff timer and another tab's `storage` event,
and it outlives every component that reads it. A context would re-render every
consumer on every change to any entry; lifting it means threading it from the
dashboard layout. So the rule stands and the exception is taken deliberately.
Scope is stated in `REDESIGN_PLAN.md` §5.7 so it does not creep: the store
holds the queue and what derives from it, never server data and never form
state. A second store is a decision, not a convenience.

**D41 — The React Compiler is on in full mode, not annotation mode.**
`next@16.3` takes `reactCompiler: true` as a top-level key and applies the
Babel plugin only to files with JSX or hooks, chosen by an SWC pass. Full
rather than opt-in because opt-in memoisation fails the same way manual
memoisation does: the components that need it are the ones nobody thought
about. The build time is measured into `STATUS.md` before and after rather than
described as small, because the ten-minute budget is a contract.

**D42 — `react-doctor` gates on errors, not on the score.**
Run before deciding anything: 176 files in 90ms, so it costs nothing against
the budget, and the first run found a real defect rather than a style
complaint — an unauthenticated `"use server"` action writing an unvalidated
string into a cookie that `src/i18n/request.ts` interpolates into a dynamic
`import()` path. The score is 59 with 54 warnings, and a gate on a number
either blocks every commit or gets raised until it means nothing; errors are
few and specific. Warnings are read, and the ones worth acting on become their
own commits. Pinned exactly, because a pre-1.0 gate can change its mind about
what counts as an error.

**D43 — Stock has a floor, and a refused consumption becomes a question.**
Decided by the plan's owner, against the open question the Phase 4 design
raised. Stock may never go negative, so two people who each use the last unit
cannot both be right and the second is refused — that part was already built
and stays.

What changes is what happens next. Discarding the refused change would throw
away a real event: they *did* take the milk. So the refusal is surfaced as the
question only a person can answer — the count and the house disagree, and only
someone who can see the shelf knows which is true — and the answer is written
as an `adjustStock`, which is precisely the primitive for "the count is wrong
and here is the truth". Allow and reconcile, never discard.

`REDESIGN_PLAN.md` §5.5.3 also corrects the claim that made this a surprise:
deltas merge "without a fight" in one direction only. Adding always merges,
because a household has no ceiling. Consuming has a floor.

**D44 — The reconciliation is not a modal at the moment of conflict.**
The owner asked for "a modal that asks for it, or other best suited for UX", so
this is the second half. A conflict is discovered on *reconnect*, which may be
minutes after the shop with the phone in a pocket: a dialog thrown then
interrupts someone who is not looking at the item and cannot answer it. §7 rule
3 rejects interruptions for the same reason. So the sync indicator carries it
as something needing attention, in words, and opens the reconciliation when the
person chooses to deal with it — which also makes it survive being ignored for
an hour, the realistic case.

A KITCHEN account cannot reconcile: `adjustStock` is a `writeProcedure` and the
matrix gives that role looking and consuming only. On the tablet the conflict
is reported and names who can fix it, rather than offering a control the server
would refuse. Offering a control that cannot work is worse than hiding one.

**D45 — Two guards for one property is one guard too many.**
The drain had a single-flight check in the queue *and* in the provider that
mounts it. Breaking the provider's changed nothing, because the queue already
owned the property — so it was a second thing to keep in step, and the copy is
what rots. Removed, and the test that covers it now names where the guard
actually lives rather than implying it is in the component. Recorded because
the tell was a test that would not go red, which is the same signal as D42's
gate that would not fire.

**D46 — The React gate caught the commit that added it, twice over.**
`react-doctor` landed four commits before the drain, and the drain's first
version failed it: a ref assigned during render, which is wrong under a
re-render React throws away and stops the compiler optimising the component.
The same rule then caught the test file capturing a handle out of render.
Both were mine, both were invisible to `tsc` and `oxlint`, and neither would
have failed a test. That is the argument for the gate, made by the gate.

**D47 — The browser found four defects every cheaper tier had passed, and that
is the argument for keeping it.**
A hydration mismatch (the queue read storage while its store was being built);
a stored queue destroyed by enqueueing before hydrating; a retry timer keyed on
a count that a failure does not change, so it fired once and never again; and
`t("shopping.items")` against a catalogue with no such key. None of them could
be seen by the 906 tests below the browser tier — the first three because they
need a real page lifecycle, the fourth because `messages.test.ts` compares the
two catalogues only with each other. The fourth is now caught in milliseconds
by `message-usage.test.ts`, which scans every `t("…")` in the source. The first
three are why five browser tests exist.

**D48 — A locator that filters on state stops matching when the state changes.**
`getByRole("checkbox").and(locator(":not(:checked)"))` resolves to nothing the
instant it is clicked, so the assertion after the click fails on *correct*
code. Read the state once, then address elements by position. Recorded because
it is indistinguishable from a real failure and cost a full run to diagnose.

**D49 — Phase 4 is closed against its done-when, not its title.**
The title said "phone screen, offline from the start". The done-when said "a
full shop can be done in aeroplane mode and syncs correctly on reconnect". The
second is proven; Screen A's layout is not built and moves to Phase 5. Closing
against the done-when and naming the gap is honest; closing against the title
would require either building the layout or quietly redefining what was
promised, and the second is how a plan stops being worth reading.

**D50 — A `mock.module` replaces that module for every suite in the process.**
Bun's module mocks are not file-scoped. Three consequences bit in one commit:
a mock that omitted an export turned that export into `undefined` elsewhere; a
*complete* mock of `@/lib/sw/register` then replaced the real module in the
suite that tests it; and mocking `queue-context` made
`WriteQueueProvider.test.tsx` read a stubbed hook instead of the provider's own
value. All three passed until a new test file changed the load order, which is
the worst way to find it.

Two rules, in order:

1. **Never mock a module another suite tests for real.** Stub the browser
   instead — `SignOutButton.test.tsx` now asserts the `postMessage` the worker
   receives rather than that `forgetCachedShell` was called, which is both
   safer and a stronger claim.
2. **A suite that renders a real component must not read a hook other suites
   mock.** `WriteQueueProvider.test.tsx` drives the queue directly; everything
   it asks about is observable there.

The structural half: `useWriteQueue` moved out of `WriteQueueProvider.tsx` into
`queue-context.ts`, so mocking the hook cannot reach the provider. That is the
shape it should have had anyway — a consumer needing the hook has no business
importing the provider.

**D51 — Sign-out asks only when there is something to lose.**
A queue with unsent changes is somebody's shopping, and signing out silently
would delete it — so the control offers three answers: send them first, discard
them, or stay. With nothing pending it says so and gets on with it, which keeps
§7 rule 3 (undo rather than confirm) for the case that is actually routine.
"Send first" is offered even with no signal, where it will not succeed; the
attempt is what tells the person the changes are still there rather than gone.

**D52 — "Not completed" is not "has something unticked".**
`/shopping` filtered on `items: { some: { isChecked: false } }`, which also hid
every list with **no items at all** — so creating one made it vanish. Combined
with two missing cache invalidations (creating a list, and adding an item), the
whole flow looked broken in three independent ways at once, and none of them
had a test. All three were found by writing a browser test that needed to
create its own list, which is the second time this phase that making a test
independent of the seed found real defects.

**D53 — A test that shares seeded state is a test that will fail later.**
`offline-shop.spec.ts` opened the seeded list. It passed alone and failed in a
full run, because another journey ticks that list's items and `/shopping` hides
a completed one. It creates its own list now — four extra actions, and
independence from the seed, from the order specs run in, and from each other.
`ISSUES.md` TEST-3 is the same lesson; this is its third appearance, so the
rule is worth stating plainly: **a browser test that reads seeded state must
either create what it reads or assert nothing about its shape.**

**D54 — The trolley is the undo, not a toast.**
§7 rule 3 asks for undo instead of confirm, and the obvious reading is a
ten-second "Deshacer" toast after each tick. Rejected: an undo that expires is
one you miss while reaching for the next shelf, and the mistake it exists for —
ticking the wrong row — is usually noticed at the till, not within ten seconds.
The trolley section holds everything ticked and unticks with one tap, so the
undo is permanent and in a place someone would look for it anyway. It also
costs no timer, no live region and no state machine.

**D55 — Screen A's row is a button, not a checkbox with a label.**
A checkbox beside a label is two targets and one of them is thirteen pixels
(the same defect `a11y-structure` caught on `/settings/people` this week). The
whole row is one `button` with `aria-pressed`, so the target is 64px tall, the
accessible name can say what the tap will *do* — "Marcar «Leche entera» como
comprado" rather than just the product name — and there is nothing to miss with
a thumb.

**D56 — `getBuyList` is one flat list, not a list of lists.**
§3's question is "what do I need to buy", and which list something is filed
under is not part of the answer. The procedure returns every item across the
household with the product's stock and minimum already attached, because
standing in an aisle "how much is at home" is the question and a round trip per
row to answer it is not available on a supermarket connection. Filing stays on
`/shopping/lists`.

**D57 — Undo on the kitchen screen cancels the queued change; it never writes a
compensating one.**
§4 asks for a ten-second undo after "he usado uno". Implemented as removing the
still-queued `consumeStock`, not as an `addStock` that reverses it. A
compensating write would record that the household *acquired* something it
never did, and every downstream reader — the expiry view, the price history, a
future report — would see a fabricated event indistinguishable from a real one.

The affordance is therefore offered exactly while the change is still in the
queue and disappears when it can no longer work, which is *more* honest than a
countdown: a ten-second timer offers undo for ten seconds whether or not
pressing it would do anything. `queue.cancel` refuses the operation currently
in flight for the same reason — taking one back after it left would keep the
server's copy and lose ours, the one outcome worse than not offering undo.

**D58 — A failing component test can look exactly like a hung one.**
Proving a kitchen test could fail timed out at 120s: the assertion failed
quickly, and the *reporting* did not. `DEBUG_PRINT_LIMIT` is now capped, which
did not fix it — so the cost is elsewhere, most likely `getAllByRole`
computing accessible names across a larger tree. Recorded with what was
measured rather than what was assumed, and worked around by proving the same
property through a mock-call assertion instead of a DOM query. STATUS.md trap 3
is the same shape one tier up.
