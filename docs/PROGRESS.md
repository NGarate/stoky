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
| 2b — Foundations of use (audit) | ▶ In progress |
| 3 — Roles | Not started |
| 4 — Phone screen, offline | Not started |
| 5 — Kitchen screen | Not started |
| 6 — Rating | Not started |
| 7 — Security review | Not started |

---

## Done

### Phase 2b — Foundations of use

| Unit | Commit |
|---|---|
| Every page on the tokens; real dashboard | `4eafd1c` |
| Auth pages on the tokens; opacity contrast fixed | `0158b1b`, `c839cde` |
| axe-core AAA audit, 30 checks over 15 routes × 2 themes | `1c6b2d6` |
| Theme and language controls | `24a2203`, `c6d02d2` |
| Mobile-first: bottom bar, tablet rail, tables to cards | `fcb3cad` |
| axe extended to all three viewport tiers — 90 checks | (this commit) |

Remaining: A0 dead-link check in CI, A4.2–A4.4 target sizes, headings and
landmarks, then A4.5–A4.6 (the AAA criteria no tool can check, and a
screen-reader pass).

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

**D4 — Strings go into both catalogues in the same commit.**
`REDESIGN_PLAN.md` §5.6 requires Spanish and English. Enforced per commit rather
than swept up later, because a translation backlog never gets paid off.
