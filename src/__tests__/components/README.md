# Component Test Suite

Behavioural tests for the UI components: every test renders the real component
into a DOM and asserts on what a user would see or do.

## Running

```bash
corepack pnpm test:components
```

The script preloads `src/__tests__/setup/register-dom.ts`, which registers the
happy-dom globals. Running `bun test src/__tests__/components` without that
preload fails — there is no `document`.

## How the suite is wired

| Piece | Purpose |
|---|---|
| `src/__tests__/setup/register-dom.ts` | Registers happy-dom globals (+ a `ResizeObserver` stub). Preloaded. |
| `src/__tests__/setup/matchers.ts` | Adds the jest-dom assertions to Bun's `expect`. Imported first by each test file. |
| `src/__tests__/utils/render.tsx` | `renderWithIntl` — wraps a component in the Spanish next-intl provider. |
| `src/types/bun-test-dom.d.ts` | Types the jest-dom matchers onto `bun:test`. |

`matchers.ts` is imported per test file rather than preloaded on purpose:
importing `@testing-library/*` from inside a preload evaluates it before
happy-dom has a `document.body`, and its `screen` helper then binds permanently
to a broken world.

## Conventions

- **Translations are real.** `renderWithIntl` loads `messages/es.json`, so tests
  assert on actual Spanish strings ("Inventario", "Eliminar artículo"). A
  renamed or deleted translation key fails the test instead of silently
  rendering a placeholder.
- **Query by role and accessible name** wherever possible. Falling back to a
  class selector is a hint the component needs a better accessible name.
- **Mock at the module boundary,** not the component: `mock.module(...)` for
  `@/lib/trpc/client`, `next/navigation`, `next/link`, server actions, and the
  barcode-scanner library, then `await import(...)` the component afterwards.
- **No tautologies.** An assertion that cannot fail is not a test. Every test
  here was verified to fail against a deliberately broken component.

## Coverage

| File | Component | What it covers |
|---|---|---|
| `button.test.tsx` | `ui/Button` | Variants, sizes, `asChild`, disabled, keyboard activation, ref |
| `input.test.tsx` | `ui/Input` | Typing, `onChange`, disabled, labelling, native form attributes |
| `LocaleSwitcher.test.tsx` | `ui/LocaleSwitcher` | Options, active locale, cookie persistence + router refresh, unique ids |
| `ThemeControl.test.tsx` | `ui/ThemeControl` | Three states, group name, stored choice, `data-theme`, shared store, cross-tab |
| `DashboardNav.test.tsx` | `dashboard/DashboardNav` | Section hrefs, active-route and nested-route highlighting |
| `LocationPicker.test.tsx` | `inventory/LocationPicker` | Loading, tree roots, stock counts, selection, clearing, closing |
| `ShoppingItem.test.tsx` | `shopping/ShoppingItem` | Name fallbacks, checked state, toggle/remove mutations, cache invalidation |
| `ReceiptStatus.test.tsx` | `receipt/ReceiptStatus` | Every `ReceiptStatus` label, spinners, progress counter, step ladder |
| `UploadZone.test.tsx` | `receipt/UploadZone` | Accepted types, upload callback, preview, clearing, uploading state |
| `PriceChart.test.tsx` | `price/PriceChart` | Row reshaping, per-store series, colours, legend, euro axis |
| `Scanner.test.tsx` | `barcode/Scanner` | Scan and error callbacks, torch capability probe, torch toggle |

## Known gaps

- `MatchSelector`, `CreateProductInline`, `ReviewCard`, `AutoListPreview`,
  `StoreSelector`, `ExpiringItems`, `BestPriceIndicator` and `StoreComparison`
  have no component tests yet.
- No accessibility assertions beyond role/name queries — there is no axe run.
- No visual regression coverage. The previous `src/__tests__/visual/` suite was
  removed: it pointed at a `/test/components` route that does not exist and sat
  outside Playwright's `testDir`, so it never ran.
