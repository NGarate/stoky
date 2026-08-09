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

**One broken link, and it is a sixth dead route:**

| Link | From | Status |
|---|---|---|
| `/receipts/${receiptId}/applied` | `receipts/[id]/review/page.tsx` | **404 — route does not exist** |

This is the end of the receipt pipeline: OCR → parse → match → review → *apply*.
The final step navigates nowhere. It was missed by the earlier audits for the
same reason `/products/[id]` was — the target is a template literal.

**Action A0.** Add the check above to CI as a script, so a link to a route that
does not exist fails the build. It has caught two dead routes that three manual
passes missed, and it costs nothing to run.

---

## 1. Themes — there is no way for a user to choose

**Finding.** Nothing in `src/` lets anyone pick a theme. `globals.css` responds
to `prefers-color-scheme`, and that is the whole story: if your operating system
is in dark mode you get dark, and there is no override. The `ThemeControl`
component that did this was part of the design lab and was deleted with it.

**Actions**

- **A1.1** Build a theme control with three states — *System / Light / Dark* —
  not a two-state switch. A binary toggle destroys "follow my system" the first
  time it is touched, and that is the setting most people actually want.
- **A1.2** Persist per device and re-apply **before first paint** via an inline
  script on `<html>`, or the chosen theme flashes the wrong one on every load.
  The pattern is already proven — it existed in the deleted lab layout and can
  be recovered from git history rather than reinvented.
- **A1.3** Put it where it is reachable from every screen, including **before
  sign-in**. Someone whose system is set to light but who needs dark for a visual
  reason must not have to log in first.
- **A1.4** Extend `scripts/check-contrast.ts` to assert AAA for both themes on
  the tokens actually used per route, which it already does, and keep it as the
  gate. Do not hand-check colours.

---

## 2. Language — exists, but not where it is needed

**Finding.** `LocaleSwitcher` is rendered in `DashboardNav` and on `/settings`.
It is **absent from `/login` and `/register`**, so the language cannot be changed
until after signing in. It is also a native `<select>` whose `onChange` calls
`window.location.reload()`, and it hardcodes `id="locale-switcher"`, so a second
instance on one page duplicates the id (this already blocked putting it on
`/settings` inline).

**Actions**

- **A2.1** Make the id unique with `useId()`, so the control can appear more than
  once without breaking its label association.
- **A2.2** Render it on the auth pages, beside the theme control.
- **A2.3** Replace the full page reload with a router refresh, so the choice does
  not throw away form state — someone half-way through registering should not
  lose what they typed because they switched language.
- **A2.4** Pair it with the theme control as one "preferences" cluster, so the
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

- **A3.1** Build the mobile navigation. This closes NAV-1 and is a precondition
  for everything else on this list — an audit finding you cannot navigate to is
  academic.
- **A3.2** Convert the five tables to a responsive pattern: cards on narrow
  screens, table from `md` up. Cards, not horizontal scrolling — a scrolling
  table hides the columns that carry the status.
- **A3.3** Re-audit every route at 390px for horizontal overflow, which is the
  clearest single signal of a broken mobile layout, and treat any overflow as a
  defect rather than a cosmetic nit.
- **A3.4** Adopt mobile-first authoring as the convention: unprefixed classes
  describe the phone, `sm:`/`md:` add to it. The codebase currently does the
  reverse where it does anything at all, which is how `hidden md:flex` came to
  delete the navigation on phones.

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
  `e2e/accessibility.spec.ts`, 30 checks passing. A floor, not a certificate.
- **A4.2** Target size (2.5.5, AAA): **44×44px minimum**, and 48px where a thumb
  is expected. Known offenders: `DashboardNav` links, the back links on the new
  routes, `LocationPicker`'s trigger.
- **A4.3** Headings and landmarks: exactly one `h1` per route, no skipped levels,
  and a real `main`/`nav`/`header`. Verified per route, not assumed.
- **A4.4** Every control programmatically labelled; state never conveyed by
  colour alone (already the convention, now enforced by test).
- **A4.5** AAA-specific criteria that have never been considered: **1.4.8 visual
  presentation** (line length, spacing, no justified text), **2.4.9 link purpose
  from the link alone** — "Ver" and "→" fail this — **3.3.5 context-sensitive
  help**, and **2.3.3 animation from interactions** (respect
  `prefers-reduced-motion`, which is currently honoured only in the deleted lab's
  stylesheet).
- **A4.6** One manual screen-reader pass per primary journey. Not automatable,
  not optional.

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
