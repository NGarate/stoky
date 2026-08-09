# Design and accessibility audit — plan of action

Date: 2026-08-09 · **Plan only. Nothing here has been implemented.**

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

**Result: 21 routes, no orphans.** Every page is reachable from somewhere. No
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

**Action A0.** Add the check above to CI as a script, so a link to a route that
does not exist fails the build. It has caught two dead routes that three manual
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
- **A1.4** Extend `scripts/check-contrast.ts` to assert AAA for both themes on
  the tokens actually used per route, which it already does, and keep it as the
  gate. Do not hand-check colours.

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

**Evidence**

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
  screens, table from `md` up. Cards, not horizontal scrolling — a scrolling
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

## 5. Design consistency across routes

**In flight.** Converting the dashboard pages from hardcoded palette classes to
the tokens is running now. It exists because Phase 2 made the primitives
theme-aware while leaving the pages hardcoded, which made dark mode actively
worse — the login form rendered as black inputs inside a white card. Until it
lands, per-route colour findings would be stale, so this audit deliberately does
not enumerate them.

**Actions once it lands**

- **A5.1** Re-run the runtime audit across all 21 routes in both themes and
  record the result, replacing this section with measurements.
- **A5.2** `/dashboard` is where every login lands and is an untranslated English
  placeholder. Being replaced as part of the in-flight work; verify it, do not
  assume.
- **A5.3** Adopt `button.tsx` and `input.tsx` in the five Phase 1 routes. They
  use plain elements because the primitives were unsafe; that reason is now
  gone.
- **A5.4** Decide what `/dashboard` becomes once the phone and kitchen screens
  exist (Phases 4 and 5). Three entry points competing for the same job is a
  worse outcome than the placeholder.

---

## 6. Suggested order

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

## 7. What this plan does not cover

- The **phone and kitchen screens** themselves (`REDESIGN_PLAN.md` Phases 4
  and 5). This audit fixes the app as it exists; those replace how it is
  organised. A3.1's mobile navigation should be built so the phone screen can
  supersede it rather than fight it.
- **Offline** (Phase 4) and **roles** (Phase 3).
- The **product rating** (Phase 6).

---

## 8. Decisions needed

1. **Does the audit fix the current pages, or wait for the two-screen model?**
   Recommendation: fix now. Phases 3–5 are a long way off, the app is used
   today, and "unusable on a phone" is not a reasonable state to hold.
2. **Theme control: three states or two?** Recommendation: three, per A1.1.
3. **Tables on mobile: cards or horizontal scroll?** Recommendation: cards.
   Scrolling hides the status column, which is the one people came for.
4. **Is AAA the target for everything, or AA with AAA for contrast?** Full AAA is
   demanding — 1.4.8 constrains line length and justification, 2.4.9 rules out
   bare "Ver" links. Worth confirming, because it shapes copy as well as layout.
