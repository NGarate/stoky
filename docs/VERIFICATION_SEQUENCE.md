# Stoky Verification Sequence

Updated: 2026-10-16

Use this as the source of truth for local and CI-style validation.

**Every command here needs bun, at or above the version `.bun-version` pins.**
`scripts/verify-local.sh` and `scripts/test-integration-local.sh` refuse at once
when it is missing, and there is no fallback to another package manager to catch
them. The pin matters even when an install appears to succeed: `bun.lock` is
written by the pinned version, and an older bun reports `Unknown lockfile
version`, ignores it and resolves an unpinned tree rather than stopping — only
`--frozen-lockfile` turns that into an error. `STATUS.md` owns the version
table.

All application Docker stages and project JavaScript commands now run on Bun.
Run the browser suite with `bun run test:e2e`, which brings its own browsers
(see "Playwright browsers come from the project" below); inside it, the driver
is `bunx --bun playwright test`, and the E2E directory declares ES modules so
Bun retains its TypeScript loader (see `TEST_SETUP.md`).
The `node` command in the Bun image is a compatibility symlink to Bun itself.

## When to run what

**Each commit is checked narrowly; each push is checked fully.** Running every
suite to learn whether one case broke costs minutes per commit and tells you
nothing the affected files would not — the browser suite alone takes about ten.
The full run still happens, once, where it decides something: before the work
leaves the machine.

Before a commit:

```bash
bun run lint
bun run typecheck                    # whole project: a changed signature breaks callers you did not touch
bun test <unit files>
bun test --preload ./src/__tests__/setup/register-dom.ts <component files>
bash scripts/test-integration-local.sh <integration files>
```

- **Only the test files the change affects** — the ones next to what changed,
  and the ones a search finds using the changed modules, procedures, routes or
  message keys.
- `bun run build`, `check:react`, `check:links` and `check:contrast` only when
  the change touches what each one checks: the route tree, configuration or
  dependencies; components; links; colour tokens.
- **No browser suite**, even for a change that renders. A spec the change
  makes wrong (a string, a label, a route) is updated in the same commit, and
  is run before the push with all the others.
- A mutation check runs the one test file that should go red, not a suite.

Before a push:

```bash
bun run verify:ci
bun run test:e2e
```

Both whole, both once. A failure is fixed in the commit that introduced it,
while the branch is still unpushed (`git commit --fixup=<sha>`, then
`GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>`), and the two are run
again on the result. Something that fails once and passes three isolated
reruns is reported as flaky, never retried until it happens to pass.

## Command ladder

### 1. Fast local gate

Runs the checks that should stay cheap enough for most iteration loops:

```bash
bun run verify:local
```

Nine steps:

- `bun run lint`
- `bun run check:format` — `bun fmt --check`: every file Bun's Prettier port
  has a parser for is formatted as `bunfig.toml`'s `[fmt]` says, Markdown and
  what else `.prettierignore` names excepted. `bun fmt` fixes it
- `bun run typecheck`
- `bun run check:react` — react-doctor, gating on errors, not the score
- `bun run check:links` — every internal link points at a route that exists
- `bun run check:contrast` — every theme token pair meets WCAG AAA
- `bun run check:audit` — `bun audit --audit-level moderate`. The one step
  that needs the network: it sends package names and versions to the npm
  advisory endpoint. Offline it reports **skipped**, not failed, because
  offline is not a finding; CI's `audit` job calls `bun audit` directly and
  stays a hard gate.
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

### 3. Browser suite

Before a push, whole (see "When to run what"):

```bash
bun run test:e2e
```

One spec at a time, when diagnosing a failure the whole run found:

```bash
bun run test:e2e -- e2e/critical-paths.spec.ts
```

## Scoped checks — feedback, not a gate

The static checks in three scopes, through one script:

```bash
bun run check:all                    # everything: what CI runs on master
bun run check:staged                 # what is staged: before a commit
bun run check:changed                # what differs from origin/master: before a push
bun run check:changed --base <ref>   # ...or from another base
```

| Check | `all` | `staged` / `changed` |
|---|---|---|
| oxlint | the project | the listed `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs` files |
| format | the project | every listed file; `bun fmt` skips what it has no parser for, lockfiles, and `.prettierignore` |
| React Doctor | `--scope full` | `--staged` / `--scope changed --base <merge base>` — only issues the change introduced |
| actionlint | every workflow | listed `.github/workflows/*.yml` |
| shellcheck | `scripts/*.sh` | listed `scripts/*.sh` |
| zizmor | `.github/` — every workflow and `dependabot.yml` | listed workflows and `.github/dependabot.yml` |
| dependency audit | always | only when `bun.lock` or `package.json` is listed |
| typecheck | the project | the project — a changed signature breaks callers that are not listed |

**`staged` and `changed` prove nothing.** They answer "is what I did clean", not
"is the tree mergeable": a change can break a file it did not touch, and only
`verify:ci` and the CI run show that. What they are for is attention — a
whole-project scan that reports old findings in untouched files teaches people
to stop reading it.

How to read the output:

- **The summary says `ok`, `FAILED` or `skipped` for every check.** Every check
  runs even after one fails. An empty file list is `skipped`, never `ok`.
- **`changed` compares the working tree** with the merge base of the base and
  `HEAD`, so uncommitted work counts. That is what React Doctor's own
  `--scope changed` compares. `origin/master` is fetched if the clone has never
  seen it.
- **A narrow scope never checks what `all` does not**: `docs/reproductions/*.sh`
  is not shellchecked by any of them.
- **React Doctor's `--staged` refuses while `package.json` has unstaged
  edits** ("configuration differs between the index and worktree"). Stage or
  stash the edit; it is a guard, not a finding.
- actionlint and shellcheck come from the pinned `rhysd/actionlint` image, and
  zizmor from the pinned `ghcr.io/zizmorcore/zizmor` image
  (`scripts/check-ci.sh`), so they need Docker but nothing installed. zizmor
  runs offline with its `regular` persona and fails on a finding of any
  severity; an inline `# zizmor: ignore[<audit>]` needs a comment saying why,
  and is the last resort after changing the workflow.

React Doctor's flags (no telemetry, **no supply-chain upload to Socket.dev**,
errors only) live once, in `check:react`; every scope calls it and only adds
the scope.

**On a pull request, CI runs `changed`** against the PR's base inside the
development image, before the whole-project `quality` step, which still runs.

**Before every commit, if you want it:** `bash scripts/install-hooks.sh`
installs a git pre-commit hook that runs `check:staged`; `--uninstall` removes
it, and `git commit --no-verify` skips it once. Opt-in, and it will not replace
a pre-commit hook it did not write.

## Environment assumptions

- `verify:local` does not require Docker. It does use the network, for the
  dependency audit only, and reports that step skipped when offline
- `check:all`, `check:staged` and `check:changed` require Docker for
  actionlint, shellcheck and zizmor
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

**2026-10-15, a long agent branch: the browser suite once, before the push.**
On `feat/better-auth-2026-10-15` the owner decided that the browser suite is
too slow to run for every commit that changes something visible. From its
28th commit on, each commit ran `bun run lint`, `bun run typecheck`, the
unit, component and integration tests its change touched, and `bun run
build` when it touched dependencies, the route tree, the proxy or start-up;
`bun run verify:ci` and the whole `bun run test:e2e` run once, on the
finished branch, before it is pushed. A commit that changes something a
spec asserts still changes the spec in the same commit; it just does not
run it. The price is that a commit in the middle of such a branch is not
proven to pass the browser suite on its own, only the branch's head is, so
a revert of one of those commits wants the suite run again. `STATUS.md`
says what was measured that way and what was not.

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

## Playwright browsers come from the project

`bun run test:e2e` runs the browser suite inside Playwright's own image,
`mcr.microsoft.com/playwright:v<version>-noble` — the image CI's `e2e` job runs
in — with Bun from `.bun-version` layered on (`scripts/e2e-in-image.sh`). The
image carries Chromium, Firefox and WebKit *and* the system libraries they link
against, and its tag is the installed `@playwright/test`, so the browsers always
match the driver. Nothing is installed on the machine; Docker is the only
requirement, as it already is for `verify:ci`. Arguments pass through to
`playwright test`:

```bash
bun run test:e2e
bun run test:e2e -- e2e/critical-paths.spec.ts
bun run test:e2e -- --project=webkit
```

A bare `bunx --bun playwright test` still works where the browsers happen to be
installed, but a failure reading `Executable doesn't exist` is the machine, not
the application. It replaced a recorded procedure — browsers unpacked under
`/tmp`, WebKit's libraries extracted from `.deb`s and linked into its bundle,
`LD_LIBRARY_PATH` — that had to be recreated after every cleanup and every
Playwright bump.

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
