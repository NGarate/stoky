# Stoky Verification Sequence

Updated: 2026-03-23

Use this as the source of truth for local and CI-style validation.

## Command ladder

### 1. Fast local gate

Runs the checks that should stay cheap enough for most iteration loops:

```bash
corepack pnpm verify:local
```

This runs:

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test:unit`
- `corepack pnpm test:components`

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
- Playwright smoke requires the app to be reachable on `http://localhost:3000`

## Evidence to capture

- command names and exit status
- for UI-affecting work, route-level proof for the changed journey in
  `docs/SMOKE_JOURNEYS.md`
- if a gate is skipped, the reason must be explicit: missing Docker, missing
  browser deps, missing fixture data, or time constraints

## Current validation notes

Last measured 2026-08-04. See `docs/STATUS.md` for the full table.

- `corepack pnpm lint` is clean: 0 warnings, 0 errors
- `corepack pnpm typecheck` is green
- `corepack pnpm test:unit` — 72 pass across 8 files
- `corepack pnpm test:components` — 94 pass across 10 files
- `corepack pnpm test:integration` — 218 pass across 8 files
- `corepack pnpm build` succeeds — 16 routes, all server-rendered on demand
- `bunx playwright test` — 60 pass, 20 skipped (`test.fixme`), 0 fail across all
  five browser projects: chromium, firefox, webkit, Mobile Chrome, Mobile
  Safari. That is 12 pass + 4 skipped per project.

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
chromium 1208, firefox 1509, webkit 2248. Do not install with `bunx playwright`;
that resolves a newer Playwright and fetches revisions this project cannot use.

WebKit additionally needs system libraries, installed once with root:

```bash
sudo ./node_modules/.bin/playwright install-deps webkit
```

After that, `webkit` and `Mobile Safari` both run. `ldd` still reports
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
