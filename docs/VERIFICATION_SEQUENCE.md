# Stoky Verification Sequence

Updated: 2026-08-18

Use this as the source of truth for local and CI-style validation.

**Use `pnpm`, not `corepack pnpm`.** On this machine corepack resolves 11.20.0
against the `packageManager` pin of 11.19.0 and refuses to run; the plain
binary is the pinned one. Earlier versions of this file said the opposite and
were the reason the wrong command kept being copied.

## Command ladder

### 1. Fast local gate

Runs the checks that should stay cheap enough for most iteration loops:

```bash
pnpm verify:local
```

Seven steps:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm check:react` — react-doctor, gating on errors, not the score
- `pnpm check:links` — every internal link points at a route that exists
- `pnpm check:contrast` — every theme token pair meets WCAG AAA
- `pnpm test:unit`
- `pnpm test:components`

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
pnpm verify:ci
```

This runs the fast gate plus `pnpm test:integration` (which brings up its own
database and cache) and `pnpm build`.

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
  server for it, and do not stop your own `pnpm dev`: they coexist by
  construction. `reuseExistingServer` is off, so a taken port fails loudly
  rather than adopting a foreign server.
- **Export the environment first**: `set -a; . ./.env; set +a`. The suite
  derives its database URL from `DATABASE_URL` and refuses to run without it,
  with a message naming the variables.
- **The suite seeds itself**, into its own database — a `seed` project runs
  `prisma migrate deploy` (creating `stoky_e2e` on first contact) and
  `pnpm db:seed` on every invocation, because the suite *spends* the fixture:
  confirming a receipt line is a write, and there are three of them.

## Evidence to capture

- command names and exit status
- for UI-affecting work, route-level proof for the changed journey in
  `docs/SMOKE_JOURNEYS.md`
- if a gate is skipped, the reason must be explicit: missing Docker, missing
  browser deps, missing fixture data, or time constraints

## Current validation notes

Last measured 2026-08-18 at `8114501`. See `docs/STATUS.md` for the full
table; if the two disagree, STATUS is the one that gets re-measured.

- `pnpm lint` — 0 warnings, 0 errors across ~270 files
- `pnpm typecheck` — green
- `pnpm check:react` — 0 errors
- `pnpm check:links` — 93 links against 31 routes, none broken
- `pnpm check:contrast` — 60 checks over 27 tokens × 2 themes, all AAA
- `pnpm test:unit` — 479 pass across 44 files
- `pnpm test:components` — 358 pass across 32 files
- `pnpm test:integration` — 396 pass across 25 files
- `pnpm build` — 32 routes
- `bunx playwright test` — **122 pass, 0 fail in 3.1 minutes** against the
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
`node_modules/.pnpm/playwright-core@<version>/.../browsers.json` — currently
chromium 1234, firefox 1538, webkit 2336 for Playwright 1.62.1. These change on
every Playwright bump, so re-check after one. Do not install with
`bunx playwright`; that resolves a newer Playwright and fetches revisions this
project cannot use.

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
  project's own `pnpm dev`. The suite's default of 3100 avoids both; pass
  `PLAYWRIGHT_PORT` if something has taken that too.

`test:components` must be run through the pnpm script. It passes
`--preload ./src/__tests__/setup/register-dom.ts`, which installs the happy-dom
globals; invoking `bun test src/__tests__/components` directly fails with no
`document`.
