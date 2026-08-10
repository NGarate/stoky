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
| 4 — Phone screen, offline | ▶ Next |
| 5 — Kitchen screen | Not started |
| 6 — Rating | Not started |
| 7 — Security review | Not started |

---

## Done

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
