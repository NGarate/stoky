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

Last measured 2026-08-03. See `docs/STATUS.md` for the full table.

- `corepack pnpm lint` is clean: 0 warnings, 0 errors
- `corepack pnpm typecheck` is green
- `corepack pnpm test:unit` — 72 pass across 8 files
- `corepack pnpm test:components` — 94 pass across 10 files
- `corepack pnpm build` succeeds — 16 routes, all server-rendered on demand
- `corepack pnpm test:integration` is **unverified**: the Docker daemon is
  unreachable on this machine, so `verify:ci` fails at that step
- Playwright coverage still depends on local infra and fixture setup rather
  than a one-command disposable harness

`test:components` must be run through the pnpm script. It passes
`--preload ./src/__tests__/setup/register-dom.ts`, which installs the happy-dom
globals; invoking `bun test src/__tests__/components` directly fails with no
`document`.
