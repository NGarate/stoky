# Stoky Verification Sequence

Updated: 2026-08-10

Use this as the source of truth for local and CI-style validation.

## Command ladder

### 1. Fast local gate

Runs the checks that should stay cheap enough for most iteration loops:

```bash
corepack pnpm verify:local
```

This runs six steps, not four:

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm check:links` — every internal link points at a route that exists
- `corepack pnpm check:contrast` — every theme token pair meets WCAG AAA
- `corepack pnpm test:unit`
- `corepack pnpm test:components`

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
corepack pnpm verify:ci
```

This runs:

- fast local gate
- `corepack pnpm test:integration`
- `corepack pnpm build`

### 3. Critical-path browser smoke

Run when a slice changes visible flows in auth, inventory, receipts, shopping,
or prices:

```bash
bunx playwright test e2e/critical-paths.spec.ts
```

## Environment assumptions

- `verify:local` does not require Docker
- `verify:ci` requires healthy services from `docker-compose.dev.yml`
- **Playwright starts its own server** — `playwright.config.ts` declares a
  `webServer`, so do not start one for it. It adopts an existing one when the
  port is already in use, which is the trap: port 3000 is occupied on this
  machine by an unrelated application, and running the suite against that is a
  wall of meaningless failures rather than a port conflict. Pass
  `PLAYWRIGHT_PORT` and confirm the port is free.
- **The E2E suite seeds itself.** A `seed` project runs `pnpm db:seed`, a
  `setup` project signs in as the demo account, and every browser project
  depends on both — so seeding by hand first is no longer needed and no longer
  helps. It runs on every invocation because the suite *spends* the fixture:
  confirming a receipt line is a write, and there are three of them.

## Evidence to capture

- command names and exit status
- for UI-affecting work, route-level proof for the changed journey in
  `docs/SMOKE_JOURNEYS.md`
- if a gate is skipped, the reason must be explicit: missing Docker, missing
  browser deps, missing fixture data, or time constraints

## Current validation notes

Last measured 2026-08-10. See `docs/STATUS.md` for the full table; if the two
disagree, STATUS is the one that gets re-measured.

- `corepack pnpm lint` is clean: 0 warnings, 0 errors
- `corepack pnpm typecheck` is green
- `corepack pnpm check:links` — 74 links against 24 routes, none broken
- `corepack pnpm check:contrast` — 54 checks over 26 tokens × 2 themes, all AAA
- `corepack pnpm test:unit` — 134 pass across 12 files
- `corepack pnpm test:components` — 164 pass across 13 files
- `corepack pnpm test:integration` — 281 pass across 8 files
- `corepack pnpm build` succeeds — 25 routes, all server-rendered on demand
- `bunx playwright test` — 89 pass, 10 skipped, 0 fail in **6.0 minutes**
- `bash scripts/verify-local.sh` — 17s of its 600s budget

The browser matrix is no longer symmetric, and the old "12 pass + 4 skipped per
project" no longer describes it. There is a sixth `setup` project that signs in
once, and the four suites that sweep viewports and themes internally run on
chromium only — running them on five engines asks the same question five times.
`screen-reader.spec.ts` is chromium-only for a harder reason: it reads the
accessibility tree over the Chrome DevTools Protocol, which does not exist
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
- Port 3000 is occupied. Playwright's `reuseExistingServer` will otherwise run
  the whole suite against whatever else is listening, so pass a free port:
  `PLAYWRIGHT_PORT=3177 bunx playwright test ...`

`test:components` must be run through the pnpm script. It passes
`--preload ./src/__tests__/setup/register-dom.ts`, which installs the happy-dom
globals; invoking `bun test src/__tests__/components` directly fails with no
`document`.
