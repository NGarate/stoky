# Cache Components and instant navigation — a measured plan

Created: 2026-08-25
Status: **measured, not landed.** The working patch is not committed.

Next 16.3 ships *Instant Navigations*
(<https://nextjs.org/blog/next-16-3-instant-navigations>): a route either
**streams** with `<Suspense>`, **caches** with `use cache`, or explicitly
**blocks** with `export const instant = false`. Streaming or caching makes a
navigation feel like a single-page app; blocking opts that route out. Two flags
gate it, and they are not the same thing:

| Flag | What it buys |
|---|---|
| `cacheComponents: true` | dynamic by default, `use cache` / `cacheLife` / `cacheTag`, and Partial Prerendering as the default — a static shell served immediately while dynamic content streams |
| `partialPrefetching: true` | one reusable shell prefetched **per route** rather than one request **per link**, cached client-side for the session |

The second is the one that answers "instant preload". Before 16.3, Next
prefetched every link in the viewport separately; now a sidebar of twenty chat
links costs one `/chat/[id]` shell.

Everything below was **run**, not read. The patch it describes is saved at
`/tmp/stoky-backfill/cache-components-wip.patch` and is four files.

---

## What it costs this repository to turn on

Smaller than expected, and it is worth saying so plainly: **the whole app
builds green on two edits.**

| # | Finding | Evidence |
|---|---|---|
| 1 | Only one file carries route segment configs, and both of its exports are refused outright | `api/health/route.ts` — `dynamic = "force-dynamic"` and `revalidate = 0`. Both are simply *the default* now, so deleting them preserves the guarantee; the comment stays as the record of intent |
| 2 | No `runtime = "edge"`, no `dynamicParams`, no `experimental_ppr`, no `generateStaticParams` returning `[]` | grep across `src/` — the four other things the migration guide says break |
| 3 | The only `Date.now()` in a rendered path is a client component's lazy `useState` initialiser | `products/[id]/page.tsx:208`. Sync IO in a *server* prerender is a build error `instant = false` cannot clear; this one is not in one |
| 4 | With those two exports removed the build fails on exactly one route: `/_not-found` | `blocking-prerender-dynamic` |
| 5 | With `instant = false` on the root layout the build passes, and **9 of 35 routes become Partial Prerender** | the `[id]` routes: prices, products ×4, receipts ×2, shopping |
| 6 | `pnpm verify:ci` is green under both flags | 569 unit / 602 component / 443 integration / build, 107s |
| 7 | Next 16 also wants `middleware.ts` renamed to `proxy.ts` | build warning, `middleware-to-proxy` codemod — unrelated to this, worth its own commit |

## Finding 4 is the interesting one: the CSP nonce and the static shell are in tension

`/_not-found` is not special. It fails because **the root layout is
request-bound**, and everything inherits that. `src/app/layout.tsx` reads two
runtime values:

- `await getLocale()` — next-intl, which reads the `locale` cookie *and* queries
  `User.locale`;
- `(await headers()).get("x-nonce")` — the per-request CSP nonce minted in
  `src/middleware.ts`.

Both drive things with no child to wrap in `<Suspense>`: `<html lang>` and a
`<script nonce>` in `<head>`. The migration guide names this case exactly, and
recommends an inline script that sets the attribute before paint.

That works for the locale. **It does not work for the nonce, and the conflict is
structural rather than incidental: a nonce that survives prerendering is not a
nonce.** The whole value of `strict-dynamic` with a nonce is that the number is
unguessable and changes per request; a prerendered shell has one baked in. So
the choice is real:

- **Keep the nonce, block at the root.** `instant = false` on the root layout.
  What this repository does today, and what the measured patch does. Routes
  below can still prerender — 9 do — but the root shell is request-bound.
- **Give up the per-request nonce.** Move the CSP to hashes, or to
  `strict-dynamic` without a nonce. This weakens a posture `SECURITY.md`
  documents and that `e2e/auth.prod.spec.ts` guards, and it should not be traded
  for a navigation feel without the owner saying so.

**This is the decision this plan exists to surface.** It is not an
implementation detail and an agent should not settle it.

---

## The browser suite is where the real work is

Enabling the flags took the browser suite from 135 pass to **7 failures**, then
to **4** after one small locator change. None of the four is a product defect;
all of them are the suite's assumptions meeting `<Activity>`.

With Cache Components, Next keeps the previous route mounted in `"hidden"` mode
instead of unmounting it, so state survives navigation. The docs have a whole
guide for it (*Preserving UI state across navigations*) and warn about exactly
three shapes: dropdowns, dialogs with initialisation logic, and forms after
submission.

**Fixed, and cheap (3 locators).** An `a[href="…"]` selector now matches the
hidden copy as well as the live one, and `page.click` takes the first — which is
the hidden one, so it waits 15s for something that will never be clickable:

```
locator resolved to 2 elements. Proceeding with the first one: <a href="/inventory/add" …>
```

`:visible` on the three href selectors in `critical-paths.spec.ts` fixes it and
is arguably more correct anyway.

**Not fixed, and the reason matters more than the fix.** The three
`offline-shop` failures and `consume stock` share a root cause, and
`e2e/settle.ts` predicted it in its own docstring before any of this existed:

> There is a quiet window between the document finishing and hydration issuing
> the first tRPC query, and under load it grows past the half second Playwright
> calls idle — so `settle` returned on a skeleton, the audits passed on a page
> with no content in it.

`settle` races a sleep against network idle, then waits for the DOM to stand
still. **Partial Prerendering turns that rare window into the normal case**: the
static shell arrives immediately, the network goes idle immediately, the DOM is
quiet immediately — and all of it happens before hydration has issued the first
tRPC query. Playwright's own capture of the failure shows the page rendering
"Lista vacía" on a list that has two items.

So the fix is not to the four tests. It is to `settle`, the primitive every spec
in the suite waits on, which needs to know the difference between "the shell has
arrived" and "the data has arrived". That is a change worth making carefully,
because getting it wrong makes every spec flaky rather than four.

---

## Build order

Each step is independently committable and each has the gate that proves it.

1. **`settle` learns to wait for data, not for quiet.** No flags changed. The
   suite must stay green at 135 before and after — that is the whole point: the
   fix has to be correct under today's blocking renders *and* tomorrow's
   streamed ones. Prove it by running the suite with the flags on in a scratch
   tree and watching the four failures go green without the flags on regressing.
2. **The three `:visible` locators**, with the comment saying why. Green at 135.
3. **`cacheComponents: true`**, the `api/health` exports removed, `instant =
   false` on the root layout with the nonce trade written down beside it.
   `verify:ci` plus the full browser suite.
4. **`partialPrefetching: true`**, separately, because it changes what the
   client fetches and deserves its own revert.
5. **Then, and only then**, decide the nonce question above. If the answer is
   "keep the nonce", step 3's `instant = false` is the permanent answer and
   should say so rather than reading as a TODO.

## What is not known

- **Whether the four failures are only `settle`.** The mechanism is established
  and the captured DOM supports it, but the fix has not been written, so the
  claim that nothing else is wrong is unproven.
- **Whether `<Activity>` changes behaviour a person would notice**, as opposed
  to a test. Dialogs that keep state, a scanner that stays mounted, the nav
  sheet's focus trap — all plausible, none observed. `/kitchen` on a tablet
  nobody touches for days is the case with the least prior art.
- **What the flags are worth here.** 9 routes gained PPR in a build; nobody has
  measured a navigation. The 16.3 release ships a Navigation Inspector and an
  `instant()` Playwright helper from `@next/playwright` (not installed) for
  exactly this, and a number belongs in `STATUS.md` before the flags are called
  a win.
- **Whether the offline story survives.** The service worker precaches a shell;
  Partial Prefetching now caches a shell per route client-side. Two shell caches
  with different lifetimes is a question, and the release notes say offline
  navigation from prefetched routes is something they are "exploring".

## Reference

- <https://nextjs.org/blog/next-16-3-instant-navigations>
- <https://nextjs.org/docs/app/guides/migrating-to-cache-components>
- <https://nextjs.org/docs/app/guides/preserving-ui-state>
- <https://nextjs.org/docs/app/guides/authentication-with-cache-components> — not
  yet read, and directly relevant: the dashboard layout awaits `auth()` on every
  render
- The official adoption skill, which drives this migration one feature at a
  time: `npx skills add vercel/next.js --skill next-cache-components-adoption`
