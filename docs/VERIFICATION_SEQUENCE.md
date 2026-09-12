# Stoky Verification Sequence

Updated: 2026-08-28

Use this as the source of truth for local and CI-style validation.

**Every command here needs bun, at or above the version `.bun-version` pins.**
`scripts/verify-local.sh` and `scripts/test-integration-local.sh` refuse at once
when it is missing, and there is no fallback to another package manager to catch
them. The pin matters even when an install appears to succeed: `bun.lock` is
written by the pinned version, and an older bun reports `Unknown lockfile
version`, ignores it and resolves an unpinned tree rather than stopping — only
`--frozen-lockfile` turns that into an error. `STATUS.md` owns the version
table.

## Command ladder

### 1. Fast local gate

Runs the checks that should stay cheap enough for most iteration loops:

```bash
bun run verify:local
```

Seven steps:

- `bun run lint`
- `bun run typecheck`
- `bun run check:react` — react-doctor, gating on errors, not the score
- `bun run check:links` — every internal link points at a route that exists
- `bun run check:contrast` — every theme token pair meets WCAG AAA
- `bun run test:unit`
- `bun run test:components`

**It is held to a budget.** The whole ladder has ten minutes and every step its
own ceiling. An exit status of **124** means a step was stopped for exceeding
its ceiling — it is not slow, it is stuck, and the thing to look at is what it
was waiting for. `VERIFY_BUDGET_SECONDS` overrides the total if you genuinely
need to.

The budget is a product decision, not a runner constraint: verification that
takes longer stops being run, and a suite nobody runs still has to be maintained
while telling nobody anything.

### 2. CI-parity gate

Runs the heavier checks that prove the repo is closer to mergeable state:

```bash
bun run verify:ci
```

This runs the fast gate plus `bun run test:integration` (which brings up its own
database and cache) and `bun run build`.

### 3. Critical-path browser smoke

Run when a slice changes visible flows in auth, inventory, receipts, shopping,
or prices:

```bash
bunx playwright test e2e/critical-paths.spec.ts
```

## Environment assumptions

- `verify:local` does not require Docker
- `verify:ci` requires Docker (the integration harness runs its own services)
- **The browser suite is self-contained.** `playwright.config.ts` builds the
  standalone production artefact, serves it on port 3100 (`PLAYWRIGHT_PORT`
  overrides), and runs against the suite's **own database and cache** —
  `stoky_e2e` and Valkey db 1, derived in `e2e/db-url.ts`. Do not start a
  server for it, and do not stop your own `bun run dev`: they coexist by
  construction. `reuseExistingServer` is off, so a taken port fails loudly
  rather than adopting a foreign server.
- **Export the environment first**: `set -a; . ./.env; set +a`. The suite
  derives its database URL from `DATABASE_URL` and refuses to run without it,
  with a message naming the variables.
- **The suite seeds itself**, into its own database — a `seed` project runs
  `prisma migrate deploy` (creating `stoky_e2e` on first contact) and
  `bun run db:seed` on every invocation, because the suite *spends* the fixture:
  confirming a receipt line is a write, and there are three of them.

## Evidence to capture

- command names and exit status
- for UI-affecting work, route-level proof for the changed journey in
  `docs/SMOKE_JOURNEYS.md`
- if a gate is skipped, the reason must be explicit: missing Docker, missing
  browser deps, missing fixture data, or time constraints

## Current validation notes

Last measured 2026-08-19 at `70386ea`, before the move to bun, so each gate is
recorded under the command that ran it at the time. See `docs/STATUS.md` for the
full table; if the two disagree, STATUS is the one that gets re-measured.

- `pnpm lint` — 0 warnings, 0 errors across ~270 files
- `pnpm typecheck` — green
- `pnpm check:react` — 0 errors
- `pnpm check:links` — 108 links against 33 routes, none broken
- `pnpm check:contrast` — 60 checks over 27 tokens × 2 themes, all AAA
- `pnpm test:unit` — 486 pass across 46 files
- `pnpm test:components` — 385 pass across 39 files
- `pnpm test:integration` — 402 pass across 25 files
- `pnpm build` — 34 routes
- `bunx playwright test` — **132 pass, 0 fail in 3.5 minutes** against the
  standalone production build, including the build itself inside the untouched
  five-minute `globalTimeout`
- `pnpm verify:ci` — 83–92s of its 600s budget

The browser matrix is asymmetric on purpose: chromium runs everything; Mobile
Safari runs the two layout specs; firefox and webkit run a four-test `@smoke`
set; the two artefact suites (`auth.prod`, `service-worker.prod`) run on
chromium only. The suites that sweep viewports and themes internally run on
chromium alone — running them on five engines asks the same question five
times. `screen-reader.spec.ts` is chromium-only for a harder reason: it reads
the accessibility tree over the Chrome DevTools Protocol, which does not exist
elsewhere.

## Playwright browsers on this machine

**2026-09-12, Ubuntu 26.04:** the download/extraction failure below did not
reproduce. Chromium was present, but Firefox 1538 and WebKit 2336 were missing.
`PLAYWRIGHT_BROWSERS_PATH=/tmp/stoky-playwright-browsers bunx playwright install firefox webkit`
downloaded both. WebKit needed `libharfbuzz-icu0`, `libmanette-0.2-0`,
`libenchant-2-2`, `libhyphen0` and `libhidapi-hidraw0`; these were downloaded with
`apt-get download` and extracted with `dpkg-deb -x` under
`/tmp/stoky-webkit-deps`, without changing system packages. Their shared-library
files were linked into both WebKit bundles' `sys/lib` directories because the
bundled MiniBrowser launcher replaces `LD_LIBRARY_PATH`. The existing Chromium
directories were linked into the temporary browser root. With that root and
`LD_LIBRARY_PATH=/tmp/stoky-webkit-deps/usr/lib/x86_64-linux-gnu`, the full suite
passes (154 tests). These paths are temporary; recreate them after cleanup.

The following notes record the older environment:


`playwright install` hangs. The download completes, then extraction stalls
indefinitely on a single file — reproducible across attempts, and the reason
the tool warns *"your OS is not officially supported"*. Plain `unzip` on the
very same archive finishes in seconds, so it is the bundled extractor, not the
network or the filesystem.

Workaround, if a browser needs reinstalling: let `playwright install` download
(the zip lands in `/tmp/playwright-download-*/`), kill it once the download
reports 100%, then extract by hand into
`~/.cache/ms-playwright/<browser>-<revision>/` and `touch` the
`INSTALLATION_COMPLETE` marker beside it. Revisions must match the ones in
`node_modules/playwright-core/browsers.json` — currently chromium 1234, firefox
1538, webkit 2336 for Playwright 1.62.1. These change on every Playwright bump,
so re-check after one. Do not install with `bunx playwright`; that resolves a
newer Playwright and fetches revisions this project cannot use.

WebKit additionally needs system libraries, installed once with root:

```bash
sudo ./node_modules/.bin/playwright install-deps webkit
```

After that, `webkit` and `Mobile Safari` both run. The libraries are installed
system-wide, so a browser-revision bump does not need it repeating. `ldd` still
reports
`libjxl.so.0.8`, `libwpe-1.0.so.1` and `libWPEWebKit-2.0.so.1` as unresolved,
but only against the bundled `minibrowser-wpe` binary and optional codecs.
Playwright drives `minibrowser-gtk` on Linux, so this is harmless — do not
chase those three.

Two environment traps on this machine:

- The `docker` group exists and includes this user, but a session started
  before the group was granted will not have it. Re-login, or prefix with
  `sg docker -c "..."`.
- Port 3000 is occupied by an unrelated application, and 3001 is routinely this
  project's own `bun run dev`. The suite's default of 3100 avoids both; pass
  `PLAYWRIGHT_PORT` if something has taken that too.

`test:components` must be run through the package.json script,
`bun run test:components`. It passes
`--preload ./src/__tests__/setup/register-dom.ts`, which installs the happy-dom
globals; invoking `bun test src/__tests__/components` directly fails with no
`document`.
