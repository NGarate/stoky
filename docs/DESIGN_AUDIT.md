# Design and accessibility audit — plan of action

Date: 2026-08-09 · Actions revised 2026-08-10

**This header said "Plan only. Nothing here has been implemented."** It is kept
here, corrected, because it was false for a month while every action below
carried a done marker — and a reader who believed line 3 would have discarded
all of them. A0 through A4.5 are done and their markers are accurate — A0 and
A1.4 carried no marker until 2026-08-31, though both had long been the CI
gates `check:links` and `check:contrast`. A4.6 is half done: its automated
half is `e2e/screen-reader.spec.ts`, and the human screen-reader pass is
still owed. In §5, A5.1 and A5.2 are done and were never marked; A5.3 closed
2026-08-22 (its entry records the 142 → 13 count and the test that holds it);
and A5.4 closed 2026-09-01 — the entry point is the person's configurable
choice among the main screens (D117). Every numbered action is now closed; what
remains is the human screen-reader pass A4.6's §5 describes, which no marker can
grant.

Scope: every route, mobile-first, WCAG **AAA**, with user-chosen theme and
language.

**AAA is the target for everything, not only contrast.** Decided deliberately:
the product's premise is that anyone in a household can use it, including people
with limited technical confidence, so the bar is a product requirement rather
than a compliance exercise. It has consequences for copy as well as layout —
1.4.8 constrains line length and forbids justified text, 2.4.9 rules out a bare
"Ver" link — and those are accepted.

---

## 0. First question: is any page unused?

Asked before auditing, so effort is not spent on pages that should be deleted.

**Method** (reproducible, and worth keeping — the manual version of this check
has already missed things twice): enumerate every `page.tsx`, extract every
`href`, `router.push` and `router.replace` target including template literals,
normalise dynamic segments on both sides, and compare in both directions.

**Result at the time: 21 routes, no orphans.** (24 today — `check:links` counts the API handlers as destinations too.) Every page is reachable from somewhere. No
page should be deleted on grounds of disuse.

**One broken link, and it was a sixth dead route — now closed:**

| Link | From | Status |
|---|---|---|
| `/receipts/${receiptId}/applied` | `receipts/[id]/review/page.tsx` | ~~404~~ **built** |

This is the end of the receipt pipeline: OCR → parse → match → review → *apply*.
The final step navigated nowhere. It was missed by the earlier audits for the
same reason `/products/[id]` was — the target is a template literal.

`src/app/(dashboard)/receipts/[id]/applied/page.tsx` now reports what the apply
actually did: stock entries written, prices recorded, lines left out, and the
store, date and total from the receipt header. It handles an id that is not in
the household and a receipt that has not been applied with a message rather than
a crash, and the receipts list now sends an applied receipt there instead of to
`/receipts/upload`, so the route is reachable and not only redirected to once.

~~**Action A0.**~~ **Done** — `bun run check:links` gates CI (123 links
against 35 routes at the 2026-08-28 count), so a link to a route that does
not exist fails the build. It has caught two dead routes that three manual
passes missed, and it costs nothing to run.

---

## 1. Themes — there is no way for a user to choose

**Resolved 2026-08-09** (`24a2203`). Original finding: nothing in `src/` let anyone pick a theme. `globals.css` responds
to `prefers-color-scheme`, and that is the whole story: if your operating system
is in dark mode you get dark, and there is no override. The `ThemeControl`
component that did this was part of the design lab and was deleted with it.

**Actions**

- ~~**A1.1**~~ **Done.** Theme control with three states — *System / Light / Dark* —
  not a two-state switch. A binary toggle destroys "follow my system" the first
  time it is touched, and that is the setting most people actually want.
- ~~**A1.2**~~ **Done.** Persisted per device and re-applied **before first paint** via an inline
  script on `<html>`, or the chosen theme flashes the wrong one on every load.
  The pattern is already proven — it existed in the deleted lab layout and can
  be recovered from git history rather than reinvented.
- ~~**A1.3**~~ **Done.** Reachable from every screen, including **before
  sign-in**. Someone whose system is set to light but who needs dark for a visual
  reason must not have to log in first.
- ~~**A1.4**~~ **Done** — `check:contrast` is the gate (96 checks over 37
  tokens × 2 themes, all AAA at the 2026-10-06 measurement; 78 until A6.1
  added the state inks off their fills), asserting both themes on the tokens.
  No colour is hand-checked.

---

## 2. Language — exists, but not where it is needed

**Resolved 2026-08-09** (`24a2203`). Original finding: `LocaleSwitcher` was rendered in `DashboardNav` and on `/settings` only.
It is **absent from `/login` and `/register`**, so the language cannot be changed
until after signing in. It is also a native `<select>` whose `onChange` calls
`window.location.reload()`, and it hardcodes `id="locale-switcher"`, so a second
instance on one page duplicates the id (this already blocked putting it on
`/settings` inline).

**Actions**

- ~~**A2.1**~~ **Done.** Id made unique with `useId()`, so the control can appear more than
  once without breaking its label association.
- ~~**A2.2**~~ **Done.** Rendered on the auth pages, beside the theme control.
- ~~**A2.3**~~ **Done.** Replaced the full page reload with a router refresh, so the choice does
  not throw away form state — someone half-way through registering should not
  lose what they typed because they switched language.
- ~~**A2.4**~~ **Done.** Paired with the theme control as one "preferences" cluster, so the
  two settings that change how the app looks live together rather than in two
  unrelated places.

---

## 3. Mobile-first — the app is desktop-only today

This is the largest finding and it is structural, not cosmetic.

**Evidence — the baseline as it stood on 2026-08-09, before any of this landed.**
Kept in the present tense it was written in, because the actions below are only
legible against it. Today 17 files use a breakpoint, `md:` appears 96 times, and
`CompactNav`/`NavSheet` exist.

- **Only five files in the entire codebase use a responsive breakpoint**, and two
  of them are the auth pages. The rest of the app has had no responsive work.
- `DashboardNav` puts its links in `hidden … md:flex`, and **no replacement
  exists** — no drawer, no menu button, no bottom bar. Below `md`, once past
  login, the only reachable page is the one you landed on (`ISSUES.md` NAV-1).
- **Five files render a `<table>`** with no small-screen alternative:
  `inventory`, `products`, `products/[id]`, `prices/[productId]`,
  `StoreComparison`. A table is the single worst thing to put on a 390px screen.
- The E2E suite already demonstrates this: the stock-management journeys pass on
  three desktop engines and fail on both phone viewports, which is why they are
  currently scoped to desktop (decision D9).

**Actions**

- ~~**A3.1**~~ **Done.** Mobile navigation — see A3.6 for the shape. This closes
  NAV-1 and is a precondition for everything else here: an audit finding you
  cannot navigate to is academic.
- ~~**A3.2**~~ **Done.** Converted the five tables to a responsive pattern: cards on narrow
  screens, table from `lg` up — `md` in this sentence was wrong when written; the
  code uses `lg`, which is what A3.5 and PROGRESS D14 both specify. Cards, not horizontal scrolling — a scrolling
  table hides the columns that carry the status.
- ~~**A3.3**~~ **Done** — 0 overflow across 19 routes at 390/820/1280px. Re-audit every route at 390px for horizontal overflow, which is the
  clearest single signal of a broken mobile layout, and treat any overflow as a
  defect rather than a cosmetic nit.

  **Correction, from doing it:** overflow alone was a weak signal here. The
  baseline also measured zero, because `inventory` and `products` wrapped their
  tables in `overflow-hidden` — the status column was clipped rather than
  scrolling, which loses the information just as completely. The check now also
  counts elements that clip or scroll internally.
- **A3.4** Adopt mobile-first authoring as the convention: unprefixed classes
  describe the phone, `md:`/`lg:` add to it. The codebase currently does the
  reverse where it does anything at all, which is how `hidden md:flex` came to
  delete the navigation on phones.

### A3.5 Three sizes, two breakpoints — and tablet is not "small desktop"

Exactly two breakpoints, giving three targets. Tailwind's defaults are used as
they are; no custom values.

| Target | Range | Who is using it |
|---|---|---|
| **Phone** | base, up to `md` (768px) | One hand, in a shop, standing. The Phase 4 screen. |
| **Tablet** | `md` → `lg` (768–1024px) | **The kitchen tablet.** The Phase 5 screen. |
| **Desktop** | `lg` and up (1024px+) | Sitting down, planning, managing the household. |

**The tablet tier is not an interpolation between the other two, and treating it
as one would be the mistake.** The usual assumption is that density rises with
width: phone sparse, tablet middling, desktop dense. The kitchen tablet inverts
it. It is read **from a metre away**, propped on a worktop, often by someone
walking past — so it needs the **largest** type of the three and the **fewest**
things on screen, at a width where a naive layout would start adding columns.
`REDESIGN_PLAN.md` §4 already specifies 20–24px body and 40px+ headings for it,
which is bigger than the desktop tier.

So the rule is *distance*, not width:

- **Phone** — arm's length, one thumb. Dense enough to scan, targets ≥48px.
- **Tablet** — a metre away, glanceable, possibly untouched for days. Largest
  type, biggest targets, least content. Not a two-column phone.
- **Desktop** — half a metre, mouse and keyboard. Densest tier; tables are
  legitimate here and only here.

Current usage is the opposite of this and confirms nothing has been designed:
**17 uses of `lg:`, 5 of `sm:`, 2 of `md:`** across the whole codebase.
Whatever exists was written desktop-down.

**Consequence for A3.2.** The tables become cards on phone *and* tablet, and
stay tables only from `lg`. A table at 800px on a screen read from a metre away
is unreadable even though it fits — fitting is not the test.

### A3.6 The mobile menu — reviewed

The plan was one line ("build the mobile navigation"), which is not enough to
build from. What it has to satisfy:

**A bottom bar on phone, not a drawer.** The phone screen is used one-handed,
standing, in a shop. A hamburger in the top corner is the furthest point from a
thumb on a modern phone; a bottom bar is the nearest. It also keeps the
destinations visible instead of hiding them behind a control someone has to know
to press.

**Four destinations, not seven.** The current nav has seven — Panel, Inventario,
Productos, Recibos, Lista de compras, Precios, Configuración. Seven does not fit
a bottom bar at 48px targets on a 390px screen, and it should not: Phase 4 says
the phone answers *what do I need to buy*. Proposed: **Compra · Inventario ·
Escanear · Más**, with "Más" opening a sheet holding the rest. Scan earns its
place because it is the phone's primary action.

**The tablet keeps a rail, not a bottom bar.** A kitchen tablet is propped up and
touched rarely; a bottom bar wastes the most valuable strip of a screen read from
a metre away. Between `md` and `lg`, use a compact side rail with large targets.

**It has to survive Phase 4 and 5, not fight them.** Those phases introduce the
real phone and kitchen screens. The navigation built here should be the one they
keep, which is the argument for deciding the destinations now rather than
shipping a hamburger that gets thrown away.

**Accessibility requirements**, since this is the control every route depends on:
a real `<nav>` with an accessible name, `aria-current="page"`, ≥48px targets,
keyboard reachable and operable in DOM order, the "Más" sheet focus-trapped and
dismissible with Escape, and no reliance on colour alone to show the active
destination.

---

## 4. Accessibility to AAA

**Where it stands — now measured.** `e2e/accessibility.spec.ts` runs axe-core
against every route in both themes with the full AAA rule set. **30 checks, all
passing** across 15 routes × 2 themes.

Getting there found three things in the first run:

| Finding | Impact | Origin |
|---|---|---|
| 6 × `color-contrast-enhanced` on `/login`, `/register` | serious | Opacity modifiers (`text-primary-foreground/80`) added hours earlier during the token conversion |
| 1 × `label` on `/receipts/upload` | **critical** | react-dropzone's file input has no accessible name — predates all recent work |

Both are fixed. The contrast one is worth keeping in mind: `check-contrast.ts`
passed the whole time, because it measures token *pairs* and these were the
correct tokens — the failure was created at the point of use by a modifier the
token system cannot see. Structural checking and rendered-page checking catch
different things, which is the argument for running both.

**Still unverified.** Automated tooling catches roughly a third of real
accessibility problems. No screen-reader pass has happened, and the AAA criteria
below cannot be machine-checked at all.

**Actions**

- ~~**A4.1** Add automated axe checks per route, in both themes.~~ **Done** —
  `e2e/accessibility.spec.ts`, **90 checks** across 15 routes × 2 themes × 3
  viewport tiers, all passing. It began as desktop-only, which left two of the
  three navigation renderers unchecked; the tiers were added once that was
  noticed. A floor, not a certificate.
- ~~**A4.2**~~ **Done.** Target size (2.5.5, AAA): 44×44px minimum, 48px at the
  phone tier where a thumb is expected. Measured in a browser rather than
  asserted from class names — `e2e/a11y-structure.spec.ts`, 16 routes × 3 tiers.
  The known offenders were all real and all fixed, and the check found more than
  the list had: `button.tsx` and `input.tsx` were 40px, so **every** form control
  in the app was under the minimum; the `Stoky` wordmark was 54×28 on every
  signed-in route; `<Link><Button/></Link>` on `/receipts` produced an anchor
  with no box at all; the `Ver` link in the products table was 21px wide.
- ~~**A4.3**~~ **Done.** Headings and landmarks, in the same suite: exactly one
  *visible* `h1`, no skipped levels, exactly one non-empty `main`, every `nav`
  named. Visible rather than present, because `/login` and `/register` render two
  `h1`s and hide one per tier. It caught `ExpiringItems` and the shopping list
  cards jumping `h1` → `h3`.
- ~~**A4.4**~~ **Done.** Every control programmatically labelled, and no state by
  colour alone — an element carrying `aria-current`/`aria-selected`/
  `aria-pressed` must differ from its unselected peers in something other than
  colour, and anything painted with a status token must carry words. Both were
  already clean, which is the result worth having from a test like this.
- ~~**A4.5**~~ **Done.** The AAA criteria no tool checks, now in
  `e2e/a11y-aaa.spec.ts` — 16 routes, measured rather than reviewed, because the
  reviewed version of this list has been walked three times in this project and
  missed something each time.

  - **1.4.8 visual presentation.** Five prose blocks were over the 80-character
    limit, at 84 to 116, and two were set at 1.43 line spacing. Both causes were
    systemic and both are fixed once, in `globals.css`: Tailwind's own `text-sm`
    and `text-xs` sit below 1.5 by default and a utility beats anything the base
    layer says, so the scale itself was raised; and `p` now has `max-width:
    72ch`. Scoped to `p` — `li` and `dd` are held to the same rule by the test,
    but constraining them in CSS would reshape card grids that are not blocks of
    text in 1.4.8's sense.
  - **2.4.9 link purpose.** No findings, and the check is not vacuous: injecting
    `<a href="/inventory">Ver</a>` into `/settings/stores` reproduced it. The
    audit's guess that "Ver" and "→" fail here was wrong — both sit inside links
    whose name is the whole row, so the product name is already in it.
  - **3.3.5 help.** Six form fields had no help attached: both on `/login`, all
    four on `/register`, and the note on each stock route. `/register`'s
    household hint was the instructive one — it was written, visible, and
    invisible to a screen reader, which is why the test demands attachment
    rather than presence. Scoped to fields inside a `<form>`: a language
    selector and a filter box are controls that change the view, not information
    someone is being asked to supply, and demanding a sentence of help for
    "Buscar" is padding dressed as accessibility.
  - **2.3.3 animation from interactions.** `prefers-reduced-motion` was honoured
    nowhere. Every animation in the application is a loading affordance sitting
    beside text that says the same thing, so all of them can stop; the rule is
    blanket rather than per-component because the per-component version fails
    silently when someone adds the next animation.

  Two things the check caught that were not on this list: a field named only by
  its placeholder on `/prices`, which axe accepts and which loses its name the
  moment anyone types; and an accessible name that was a raw translation key.
- **A4.6** ~~One manual screen-reader pass per primary journey. Not automatable,
  not optional.~~ **Half done, and the wording above was half wrong.** A screen
  reader reads the *accessibility tree* — the roles, names, states and order the
  browser computes — and that tree is machine-readable through the DevTools
  protocol. What needs a person is whether the result *sounds* sensible: whether
  "Cantidad consumida" is the right words, whether four announcements in a row
  are three too many. What does not need a person is whether the information is
  in the tree at all.

  `e2e/screen-reader.spec.ts` covers the second half across the four primary
  journeys, driving the real controls rather than navigating between steps that
  have a button. Every interactive node named, no name a raw translation key,
  outcomes announced, tree order against bounding boxes.

  What it found: the tree is in good shape — zero unnamed controls, zero leaked
  keys, zero reading-order findings over seven routes, and every *refusal*
  already announces properly, including an over-consume rejection that names the
  quantity the household actually has. What it found missing was on the success
  side. Confirming a receipt line wrote to the database and changed nothing at
  all on screen, for everyone, which was fixed rather than filed (ISSUES A11Y-2,
  and UI-7 with it). Saving a stock movement still announces nothing beyond the
  route name, which is filed as A11Y-1 and pinned by an assertion that goes red
  when someone fixes it.

  **Still owed:** the human pass. This shrinks it; it does not close it. Also
  desktop-only and Chromium-only — `getFullAXTree` is CDP — and the consume
  journey's success path is inferred from identical code rather than observed,
  because its refusal never reaches the server.

---

## 5. The manual pass — pa11y and Accessibility Insights

Automated testing decides roughly a third of real accessibility problems. This
project measures what a machine can (`accessibility`, `a11y-structure`,
`a11y-aaa`, `screen-reader`, and the reading-level gate on the catalogues), and
what remains is a human pass that no tool replaces. These two tools do not
replace it either — they make it repeatable.

### Why neither is in CI

Both were evaluated on 2026-08-11 rather than assumed.

`pa11y` run against `/login` at its `WCAG2AAA` standard returns **0 errors, 1
warning and 60 notices**, and every AAA item begins "Check that…". HTML
CodeSniffer, which pa11y wraps, does implement a full AAA standard — but what
it delivers for AAA is a checklist for a person, not a verdict. That is a good
checklist and a bad gate: put it in CI and it either passes vacuously or floods
the log.

Accessibility Insights is a guided assessment, which is a person's task by
construction.

### pa11y — generating the checklist

Needs a running server. Nothing to install permanently; `npx` is enough.

```bash
# One route, everything HTML CodeSniffer knows about AAA
npx pa11y@8 --standard WCAG2AAA --include-notices --include-warnings \
  --reporter json --timeout 60000 http://localhost:3000/login > pa11y-login.json

# Several routes at once, human-readable
npx pa11y-ci@3 --config .pa11yci.json
```

Read it as three separate things:

- **errors** — real defects. There should be none; if there are, the axe suites
  missed something and that is worth understanding before fixing it.
- **warnings** — conditional ("If this selection list contains groups…").
  Answer the condition, then move on.
- **notices** — the AAA checklist. This is the value. Work through it once per
  route that has changed shape, not every sprint.

The notices that matter most here, because the automated suites cannot reach
them at all: 3.1.3 unusual words, 3.1.4 abbreviations, 1.3.2 meaningful
sequence when linearised, 3.3.6 error prevention, and 1.4.1 information
conveyed by colour alone.

**Do not add pa11y to `verify:local` or CI.** It duplicates axe for A and AA,
it is slower, and its AAA half cannot pass or fail.

### Accessibility Insights for Web — the guided assessment

A free Chrome and Edge extension from Microsoft. Two modes, and only the second
is worth the time here:

- *FastPass* — axe underneath. It finds what `accessibility.spec.ts` already
  finds on every run; use it only to check a page mid-development.
- **Assessment** — the one to use. It walks a person through the checks no tool
  makes: keyboard traps, focus order against visual order, whether a live
  region says something *useful* rather than merely something, contrast on
  states a test never enters, and whether an error message tells someone what
  to do rather than that something is wrong.

Suggested order for a pass, which is the same order as `SMOKE_JOURNEYS.md`
rather than a route list — the journeys are where the defects have been:

1. `/login` and `/register` — the only surfaces a signed-out person meets
2. `/inventory` → `/inventory/add` → back — the picker, and the announcement
   after a save (A11Y-1 closed in Phase 5; Assessment is how a person confirms
   the announcement *sounds* right, which no suite decided)
3. `/receipts/[id]/review` → applied — the longest interaction in the product
4. `/kitchen` — at a metre, on the tablet, which is a condition no emulated
   viewport reproduces. The screen exists since Phase 5; this pass and the
   week-long run are its outstanding human halves

Record findings in `ISSUES.md` with the criterion number, the same as anything
else. A finding from a manual pass is not a lesser finding.

### What still is not covered by either

The screen-reader pass with a real screen reader — NVDA, VoiceOver or Orca —
driven by someone who uses one. `screen-reader.spec.ts` audits the accessibility
tree across four journeys and can tell you the tree is well formed. Whether the
result *sounds* sensible is the question neither a tool nor an agent can
answer, and it is the one item of Phase 2b still open.

**The step-by-step runbook for that pass — what to check on each screen, how to
drive the screen reader, and the todo list — is
[`SCREEN_READER_PASS.md`](SCREEN_READER_PASS.md).** This section owns the *why*
and the tool rationale; that file owns the *how*.

## 6. Design consistency across routes

**Landed in Phase 2b** (`4eafd1c`, `0158b1b`). Converting the dashboard pages
from hardcoded palette classes to the tokens is done. It exists because Phase 2 made the primitives
theme-aware while leaving the pages hardcoded, which made dark mode actively
worse — the login form rendered as black inputs inside a white card. Until it
lands, per-route colour findings would be stale, so this audit deliberately does
not enumerate them.

**Actions once it lands**

- ~~**A5.1**~~ **Done.** The runtime audit is `e2e/accessibility.spec.ts`, every
  route in both themes at three viewport tiers, gating CI.
- ~~**A5.2**~~ **Done.** `/dashboard` is a real household overview with 35
  translated strings. Verified rather than assumed, which is what this action
  asked for.
- ~~**A5.3**~~ **Done, 2026-08-22.** Closed by the design-system phase. The
  count went from **142** hardcoded `min-h-[48px]` declarations outside
  `src/components/ui/` to **13**, and the remainder is held by
  `src/__tests__/unit/target-floor.test.ts`: a floor written outside the
  design system now needs an entry in that file's allow-list *with a reason*,
  and an entry that outlives its floor fails too. So the number can only fall
  by deletion, and it can only rise by somebody writing down why.

  What actually did the work was building the primitives the screens were
  missing. `Select`, `Textarea` and `RadioOption` each came out of the same
  question — "why is this floor here?" — answered honestly. `Button`, `Input`
  and `ItemRow` absorbed the rest. Two defects surfaced on the way that no
  screenshot would have shown: `ItemRow`'s title guaranteed 48px of height and
  none of width, so a short product name was a 25×48 target; and the stretched
  radio, copied by hand in three places, is a technique whose obvious
  alternative looks identical and is 13px.

  The original text of this action, for the record:

- **A5.3 — was still open, and it had a measurable cost.** None of the five
  Phase 1 routes imports `button.tsx` or `input.tsx`; they use plain elements
  because the primitives were unsafe, and that reason went away in Phase 2.

  What has changed is the price of leaving it, and it keeps rising: the routes
  carried **74 hardcoded `min-h-[48px]` declarations** when this was written
  and carry **100** after the Phase 5 pages (re-counted 2026-08-17), each
  restating a floor the primitives already guarantee. `src/__tests__/components/target-size.test.tsx`
  resolves that floor through Tailwind's own compiler — but only for `Button`
  and `Input`, so the guard covers the two places that do not need it and none
  of the 74 that do. Change the floor and 74 call sites keep the old value,
  which is precisely the shape of the `h-10` defect that guard exists to
  prevent.
- ~~**A5.4 — decidable now.**~~ **Closed 2026-09-01.** Both screens exist
  (Phases 4–5 closed): `/shopping` is Screen A and `/kitchen` is Screen B, and
  `/dashboard` sits beside them. The open half — *whether three entry points is
  the right number* — was settled by the owner: **the entry point is the
  user's, configurable among the main screens.** That is not new work — it is
  what the per-device screen choice already does (Journey 8, §5.1): `landingPath`
  (`src/lib/landing.ts`) sends a person to whatever they chose on this device,
  all three of `SHOPPING` / `KITCHEN` / `DASHBOARD` are pickable at `/start` and
  changeable at `/settings/screen`, and nobody lands on `/dashboard` unless they
  chose it. So the answer to "three doors, or two?" is "as many as the person
  wants — they pick the one they land on." The three stay; none is imposed. The
  Panel's own shape settled in the three passes below is unchanged (PROGRESS
  D117).

  **Owner input, 2026-08-18.** The owner's first pass answered half of this:
  the Panel stays, and its stat cards become doors — each links to a list
  pre-filtered to what it counts. **Built the same day** (`cf18b52`,
  `REDESIGN_PLAN.md` Phase 8 item 2): `/dashboard` is the overview made
  actionable. Whether three entry points remain the right number is the half
  still open.

  **Third pass, 2026-08-22.** The summary sentence went too, for the reason
  that killed the cards: "3 productos por reponer" above a section headed
  "Necesita reposición" listing three products is the same count twice. What
  is left is the sections, which were always the doors. The invariant behind
  item 2 survives a third time: the Panel's rows and the rows
  /inventory?filter=restock shows come from one `needsRestock` question.

  **Superseded 2026-08-19, second pass.** The doors turned out to restate the
  lists rendered directly below them, and the owner struck the duplication:
  what needs attention is now one plain-text sentence, and the sections
  underneath — which were always pre-filtered links — are the doors. The
  invariant behind item 2 survives: the summary's restock count comes from
  the same `needsRestock` question the inventory filter asks. The same review
  set a general rule: no cards except where a card is concretely justified.

---

## 7. Suggested order

Sequenced by what unblocks what, not by severity.

| # | Work | Why here |
|---|---|---|
| 1 | A0 dead-link check in CI | Cheap, and stops the class of bug that keeps recurring |
| 2 | A3.1 mobile navigation | Everything else on mobile is unreachable without it |
| 3 | A1 theme control + A2 language control | Small, visible, and explicitly asked for |
| 4 | A3.2 responsive tables | The largest remaining layout defect |
| 5 | A4.1–A4.4 automated a11y floor | Cannot regress what is measured |
| 6 | A5.1–A5.3 consistency sweep | Needs the in-flight work landed first |
| 7 | A4.5–A4.6 AAA specifics + screen reader | Slowest, needs the rest stable |

---

## 8. What this plan does not cover

- The **phone and kitchen screens** themselves (`REDESIGN_PLAN.md` Phases 4
  and 5). This audit fixes the app as it exists; those replace how it is
  organised. A3.1's mobile navigation should be built so the phone screen can
  supersede it rather than fight it.
- **Offline** (Phase 4) and **roles** (Phase 3).
- The **product rating** (Phase 6).

---

## 9. Decisions needed

1. **Does the audit fix the current pages, or wait for the two-screen model?**
   Recommendation: fix now. Phases 3–5 are a long way off, the app is used
   today, and "unusable on a phone" is not a reasonable state to hold.
2. **Theme control: three states or two?** Recommendation: three, per A1.1.
3. **Tables on mobile: cards or horizontal scroll?** Recommendation: cards.
   Scrolling hides the status column, which is the one people came for.
4. **Is AAA the target for everything, or AA with AAA for contrast?** Full AAA is
   demanding — 1.4.8 constrains line length and justification, 2.4.9 rules out
   bare "Ver" links. Worth confirming, because it shapes copy as well as layout.

---

## 10. Vocabulary, primitives and formatting — the 2026-10-06 alignment pass

Found by a screenshot audit of every route (light and dark, 390 and 1280)
and by reading the primitives against the rules CLAUDE.md states for them.
Nothing here is a new design: each item aligns a screen with the system the
owner already picked, and each closed item names the test that holds it.

- ~~**A6.1 — the contrast audit missed the inks where they land.**~~ **Done.**
  `ok`/`warn`/`danger-foreground` were measured only on their own pill fills,
  but some thirty call sites (stock amounts, field errors, every outline
  badge) put them on the page or a card, and `destructive` was measured only
  as a 3:1 fill though rows write it as ink. Eighteen pairs added:
  **96 checks over 37 tokens × 2 themes**, lowest 8.00:1.
- ~~**A6.2 — the price chart wrote store names in series colours.**~~ **Done.**
  2.17–4.42:1 on the light card. The legend is ours (name in `foreground`,
  hue in an `aria-hidden` swatch); every Recharts tooltip spreads
  `CHART_TOOLTIP` (`src/lib/chart-tooltip.ts`) — the stock history's was mint
  on white at night, 1.59:1 — and the price tooltip names each store instead
  of labelling every row "Precio por unidad". `chart-tooltip.test.ts`.
- ~~**A6.3 — the link button was underlined only on hover.**~~ **Done.**
  `primary` against body ink is 1.78:1 light, 1.36:1 dark — under 1.4.1's 3:1
  for a colour-only cue, and touch has no hover. `variant="link"` is
  underlined at rest, like `ItemRow`'s title and `BackLink`.
- ~~**A6.4 — StockStatus fixed its pill variant per state.**~~ **Done.**
  "Sin stock" filled on a `bg-danger` row (invisible), "Stock bajo" outlined
  on untinted rows. The variant now follows the row: `onTintedRow`.
- ~~**A6.5 — four vocabularies for "when does it go off".**~~ **Done.**
  `ExpiryStatus` (`src/components/inventory/ExpiryStatus.tsx`): one tone rule
  (past = danger, within `EXPIRING_SOON_DAYS` = warn, later = neutral) and one
  ICU-plural vocabulary ("Caduca hoy / mañana / en # días", "Caducó ayer /
  hace # días"). "Caducó hace 1 días" is gone; the two `ExpiryRow` copies are
  one. The threshold is shared with the server's `isExpiringSoon`.
- ~~**A6.6 — the kitchen's rows.**~~ **Done.** Running-out rows wear
  `StockStatus`; "Añadir a la lista" sits in `actions` at touch size; each
  button's accessible name starts with its visible words (2.5.3); the
  unused "Actualizado a las {time}" is shown.
- ~~**A6.7 — a plain `ItemRow` kept a card's inset.**~~ **Done.** Titles sat
  12–20px right of their section heading.
- ~~**A6.8 — the count unit printed as its stored token.**~~ **Done.**
  "24 unidad", "He usado 1 unit". `useQuantityFormat()`
  (`src/lib/inventory/quantity.ts`) writes count units as the ICU-plural
  `common.unitCount` everywhere a quantity is shown, including queued labels;
  stored data is unchanged.
- ~~**A6.9 — state tones on things that are not states.**~~ **Done.** "Mejor
  precio", the drafted list and "Auto-detectado" are neutral; the review
  card's status is a `Badge`, and a skipped line no longer says "Confirmado".
- ~~**A6.10 — one rule for destruction.**~~ **Done.** A row trigger is
  `Button variant="destructive-ghost"`; the confirming button is
  `destructive`. The product page drew trigger, confirmation and cancel in
  the primary fill. The shopping row's bin says "Quitar" and names its item.
- ~~**A6.11 — controls outside the primitives.**~~ **Done.** `StoreSelector`
  wears `Select`; `Disclosure` (`src/components/ui/disclosure.tsx`) replaces
  three hand-written `<details>`; the upload camera action is a `Button`; the
  review card's icon-only X is "No añadir esta línea"; the reconcile scrim is
  `bg-foreground/60`. `target-floor.test.ts`'s allow-list is down from 11 to
  7 entries.
- ~~**A6.12 — money and dates formatted in place.**~~ **Done.**
  `money-formatting.test.ts` bans `style: "currency"` outside
  `src/lib/money.ts`. `src/lib/dates.ts` (`formatDate(locale, value,
  "long" | "short")`, `formatDateTime`, `formatTime`) replaces nine call sites
  in six shapes, and pins date-only values (expiry, stored at UTC midnight)
  to UTC: west of UTC the product page listed a batch good until the 6th as
  the 5th. `dates.test.ts` bans a formatter built anywhere else.
- ~~**A6.13 — three icon conventions.**~~ **Done.** lucide only, 20px in a
  control and 16px inline, always `aria-hidden`: no "✕" characters, no
  hand-drawn paths for glyphs lucide ships (the scanner's torch, which
  carries `<title>`s, is the one allow-listed exception). `icons.test.ts`.
  The preferences cluster aligns its labels (`items-start`).

**Still open from this pass.** The new-product form prefills the unit field
with the stored token `unit`, so a Spanish reader still sees the English
word *inside the input* (the hint beside it no longer repeats it); changing
the prefill changes stored data and is a decision, not an alignment. The
kitchen's warn cards and the error/empty-state illustrations were left to
the pass restructuring page headers and states.
