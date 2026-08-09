# Design proposals — decision record

Updated: 2026-08-09

Five designs for the inventory screen were built during 2026-08 so that one
could be chosen. The choice has been made. This document records what was tried,
what was chosen, what was rejected and why.

It is a record, not a menu. Three of the five are being deleted from
`src/app/design/` as part of Phase 0 of `docs/REDESIGN_PLAN.md`, so this is the
only remaining account of what they were. It is written to be readable without
the code.

The decision itself is stated in `docs/REDESIGN_PLAN.md` §1; this document gives
the reasoning behind it.

---

## 1. What was being decided

Not a palette. Which question the inventory screen should answer *first*.

`/inventory` is the densest screen in the product — a heading with actions, an
alert region, tabular data, three status states, units, categories and
locations. Whatever ordering principle works there transfers to products,
receipts and shopping. Solving one screen five times was cheaper and more
comparable than sketching five whole applications.

Each proposal therefore committed to one question and let the structure follow
from it. They were not five skins over the same markup: each had its own tokens,
typefaces, components and CSS, and shared nothing but the data.

## 2. What was built

| | Question it answers first | Structure | Signature element |
|---|---|---|---|
| **Estante** | Where is it? | Grouped by storage location — Nevera, Despensa, Trastero | A fill gauge per item with a notch at the minimum stock |
| **Horizonte** | What do I use first? | A time rail; position on the axis encodes days to expiry | The rail itself — distance is the data |
| **Bolsillo** | How much is there, and change it | Card grid, stock adjusted in place | A 48px −/+ stepper on each card |
| **Triaje** | What needs me? | A worklist; healthy stock collapses into one line | The "todo en orden" strip — page space is proportional to how much an item needs you |
| **Consola** | Everything, fast | Command field, dense tabular rows, keyboard shortcuts | Visible shortcut hints and tabular figures that align down the column |

All five shipped light and dark themes, real landmarks and headings, visible
focus, and status conveyed in words rather than by colour alone.

## 3. The decision

| Proposal | Outcome |
|---|---|
| **Horizonte** | **Chosen** — basis of the kitchen screen |
| **Estante** | **Chosen** — basis of the phone app |
| **Bolsillo** | Rejected as a screen; its stepper is kept |
| **Triaje** | Rejected as a screen; its hierarchy is kept |
| **Consola** | Rejected outright |

**Horizonte** became the kitchen screen because its time axis answers "what
expires?" directly, and that is the question someone in a kitchen actually has.
Ordering by time rather than by name makes waste the thing the screen is about.

**Estante** became the phone app because its minimum-stock notch answers "what's
missing?" without arithmetic. In a supermarket the useful fact is not "2 litres"
but "2 of the 6 we keep", and the notch shows that at a glance.

**Bolsillo** was rejected as a screen because a card grid is a poor way to read
an inventory: it spends most of its area on chrome and shows fewer items per
screen than any of the others. The interaction it was built around was the good
part, not the layout.

**Triaje** was rejected as a screen because a pure worklist hides the inventory.
It answers "what needs me?" well and "what do we have?" not at all, and the
second question is the one the product exists to answer. Its ordering principle,
however, is right and is kept.

**Consola** was rejected outright, with nothing carried forward. It assumes a
keyboard and a tolerance for technical vocabulary. The product has to work for
people with limited technical confidence, on a phone in a supermarket and on a
tablet in a kitchen — neither of which has a keyboard, and neither of whose
users should have to learn shortcuts. It was the most satisfying of the five to
build and the least defensible to ship.

## 4. What was carried forward from the rejected ones

Two ideas outlived their screens.

**Bolsillo's ± stepper.** Adjusting stock happens on the item, not on a separate
page. It is the simplest way to consume or add a unit without opening a form,
the targets are 48px so it works with a thumb, and it announces the new value to
a screen reader, which a bare number change does not. It is lifted into a shared
component *before* Bolsillo is deleted (`REDESIGN_PLAN.md`, Phase 0), and both
screens use it.

**Triaje's hierarchy.** What needs action takes space; what is fine folds away
into a single line that can be opened. The amount of page a product occupies is
proportional to how much it needs you. This is a rule that both screens follow
rather than a component either of them imports.

## 5. What the exercise revealed

Four things came out of building the five that would not have come out of
choosing on paper.

**Comparing on identical content worked.** All five read
`src/app/design/_lib/fixture.ts`, which mirrors the shape of
`api.inventory.getStockOverview` and the values `prisma/seed.ts` produces. The
proposals therefore differed only in structure, and screenshots were
reproducible. Because the field names already matched the live query, adopting a
proposal is a change of import rather than a rewrite.

**Contrast was enforced rather than asserted.** `scripts/check-contrast.ts`
read the same token module the pages rendered from and failed the process if any
declared pair missed 7:1 for body text or 4.5:1 for large text, with 3:1 for
borders and gauge fills under 1.4.11. It reported **140 checks across 5 designs ×
2 themes, all passing**. The gate outlived the prototypes: Phase 2 repointed it
at `src/app/globals.css`, where it now runs 54 checks over the one shipped
palette. It runs in the quality job of `.github/workflows/ci.yml` as
`pnpm check:contrast`, and the same standard carries into the two real screens.

**A real defect surfaced that the test suite could not see.** Building against
`src/app/globals.css` exposed that it defines only `--background` and
`--foreground`, with no `@theme` block. Meanwhile `button.tsx` and `input.tsx`
between them reference **14 distinct theme-colour utilities** — `bg-primary`,
`border-input`, `ring-ring`, `text-muted-foreground` and others — resolving to
12 token names, **none of which exists**. Compiling `globals.css` through
`@tailwindcss/postcss` confirms it: structural utilities such as `flex` and
`rounded-md` are generated, and every one of the 14 colour utilities is absent
from the output. The login button (`src/app/(auth)/login/page.tsx`) therefore
renders with layout but no colour.

The component tests did not catch it because
`src/__tests__/components/button.test.tsx` asserts
`expect(button).toHaveClass("bg-primary")`, which passes whether or not any CSS
backs the class. This is fixed in Phase 2, when the Estante and Horizonte tokens
merge into `globals.css`.

**Looking at the rendered pages caught a design error that no test could.**
Horizonte originally filed an out-of-stock product under "Sin caducidad" — the
band for things that do not expire — because it has no expiry date to sort by.
Read on screen, that says "keeps forever" when the truth is "there is none". It
is correct by the data and wrong by the meaning, and no assertion about sorting
would have flagged it. Out-of-stock items now have their own band, "Se ha
agotado", above the time rail. The lesson generalises: the two screens need
their output looked at, not only asserted about.

**Not done, deliberately.** No axe run and no screen-reader pass. Both belong to
the chosen design rather than being done five times over; they are carried in
`REDESIGN_PLAN.md` §8 as still outstanding.

## 6. Where the work lives now

`src/app/design/` remains until Phase 2 consumes it, then goes entirely.

| Path | Status |
|---|---|
| `src/app/design/estante/` | Kept until Phase 2 folds it into the phone screen |
| `src/app/design/horizonte/` | Kept until Phase 2 folds it into the kitchen screen |
| `src/app/design/bolsillo/` | Deleted in Phase 0, after `Stepper.tsx` is lifted out |
| `src/app/design/triaje/` | Deleted in Phase 0 |
| `src/app/design/consola/` | Deleted in Phase 0 |
| `src/app/design/_lib/tokens.ts` | The palettes; the surviving two merge into `globals.css` in Phase 2 |
| `src/app/design/_lib/fixture.ts` | Replaced by the live `getStockOverview` query |
| `scripts/check-contrast.ts` | **Kept.** Runs in CI as `pnpm check:contrast` |

The two chosen designs are not two applications. They are two doors onto the
same data, sharing one design system. What each looks like, who uses it and in
what order it gets built are in `docs/REDESIGN_PLAN.md` §3, §4 and §9.
