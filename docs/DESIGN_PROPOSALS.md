# Stoky — five design proposals

Updated: 2026-08-04 · branch `design/ui-proposals`

Five refactors of the inventory page, built to be compared and one of them
chosen. Run the app and open **`/design`**.

```bash
corepack pnpm dev --port 3100     # port 3000 is taken on this machine
```

Then `/design/estante`, `/design/triaje`, `/design/bolsillo`,
`/design/horizonte`, `/design/consola`. The bar at the top switches proposal
and theme.

## Why one page

`/inventory` is the densest screen in the product: a heading with actions, an
alert region, tabular data, three status states, units, categories and
locations. Anything that works here transfers to products, receipts and
shopping. Solving it five times is cheaper and more comparable than sketching
five whole apps.

## What "refactor" means here

These are not five palettes over the same markup. Each proposal answers a
different question first, and the structure follows from that:

| | Answers first | Structure | Best when |
|---|---|---|---|
| **Estante** | Where is it? | Grouped by storage location; fill gauge per item | You shop from the shelf and think in places |
| **Triaje** | What needs me? | Worklist; healthy stock collapses to one line | The page is a to-do list, not a ledger |
| **Bolsillo** | How much is there — change it | Card grid with inline steppers | Phone in hand at the kitchen counter |
| **Horizonte** | What do I use first? | Time rail; position encodes days to expiry | Waste is the problem you care about |
| **Consola** | Everything, fast | Command field, dense tabular rows, shortcuts | You live in the keyboard |

Each has its own tokens, typefaces, components and CSS. Nothing is shared
between them except the data.

## Accessibility

Every proposal targets **WCAG 2.1 AAA** for contrast and is built to the same
floor:

- **Contrast is enforced, not asserted.** `corepack pnpm check:contrast` reads
  the same token module the pages render from and fails the build if any pair
  misses 7:1 for body text or 4.5:1 for large text. Interactive borders and the
  gauge fill are checked against 3:1 for non-text contrast (1.4.11). Currently
  **140 checks, all passing**, with the tightest margin at 7.38:1.
- **Status is never colour alone.** Every state carries a written label
  ("Stock bajo", "Sin stock", "Suficiente") plus a glyph or a positional cue —
  the notch on Estante's gauge, the left rule on Triaje's cards, the inset rule
  on Consola's flagged rows.
- **Targets are at least 44×44px**, and 48px on Bolsillo where the interaction
  is a thumb.
- **Keyboard focus is always visible.** No proposal removes an outline.
- **Landmarks and headings** are real: one `<main>`, labelled `<section>`s, a
  skip link, `<table>` with `<caption>` and scoped headers where the content is
  genuinely tabular.
- **`prefers-reduced-motion`** is respected globally.
- **`prefers-color-scheme`** is the default, with an explicit override that
  persists. A pre-paint script applies the stored choice so a chosen theme
  never flashes the other one.

Not yet done: no axe run, and no screen-reader pass. Those belong with whichever
proposal is chosen rather than being done five times.

## Data

`src/app/design/_lib/fixture.ts` mirrors the shape of
`api.inventory.getStockOverview` and the values the seeder produces, so the five
are compared against identical content and screenshots stay reproducible.

**Adopting a proposal** means swapping that import for the live query — the
field names already match — and moving the page from `src/app/design/<slug>/`
to `src/app/(dashboard)/inventory/`. The tokens move into `globals.css`.

## A defect this exposed

The current app defines only `--background` and `--foreground`, while
`button.tsx` and `input.tsx` reference thirteen theme tokens — `bg-primary`,
`border-input`, `ring-ring` and others. None exist, so those utilities produce
nothing and the login button renders as unstyled text. Whichever proposal wins,
its token block replaces that gap. The component tests did not catch it because
asserting `toHaveClass("bg-primary")` passes whether or not any CSS backs the
class.

## Files

```
src/app/design/
  page.tsx                  index of the five
  layout.tsx                pre-paint theme script
  lab.css                   comparison chrome (not part of any proposal)
  _lib/tokens.ts            every palette + the CSS generator
  _lib/fixture.ts           demo data
  _components/              DesignFrame, ThemeControl
  estante/ triaje/ bolsillo/ horizonte/ consola/
scripts/check-contrast.ts   the AAA audit
```
