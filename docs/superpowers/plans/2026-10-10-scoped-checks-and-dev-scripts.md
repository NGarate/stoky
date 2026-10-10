# Scoped checks and developer scripts — plan

Date: 2026-10-10. Status: **steps 1–7 implemented on 2026-10-11**; *Other
scripts worth adding* remain candidates. `docs/VERIFICATION_SEQUENCE.md` owns
how to use what exists. The plan is kept as written below; *As implemented* at
the end records where the implementation departed from it, and why.

## Why

Two of the project's static checks only know one scope, *everything*:

| Check | Today | Where |
|---|---|---|
| React Doctor | `bun run check:react` — whole project | `package.json`, `verify-local.sh` step 3 |
| actionlint + shellcheck | `bash scripts/check-ci.sh` — every workflow, every `scripts/*.sh` | first step of the CI `quality` job |

That is right for CI on `master` and wrong for the two moments a developer
actually wants feedback: *before a commit* (only what is staged) and *before a
PR or a push* (only what differs from the base). A whole-project scan that
reports old findings in files nobody touched teaches people to stop reading
it.

Three facts measured while writing this, which shape the plan:

1. **React Doctor already scopes; nobody asks it to.** `react-doctor@0.9.17
   --help` offers `--staged` (exits 0 when nothing is staged), `--scope
   files|changed|lines` and `--base <ref>`. `changed` reports only *new* issues
   compared with the base, which is the PR question.
2. **`check:react` leaks the dependency list to a third party.** The supply
   chain scan is on by default (`--supply-chain`, "default" in the help) and
   posts package identifiers to `https://firewall-api.socket.dev/purl`
   (`node_modules/react-doctor/dist/constants-*.js`). `--no-telemetry` only
   turns off the score API, the share URL and crash reporting. A
   privacy-first project's gate should not phone home, and a gate that needs
   the network fails offline. **Step 1 adds `--no-supply-chain`.**
3. **`check-ci.sh` cannot run on this machine.** It requires `shellcheck` from
   the host (`command -v shellcheck` → nothing here), which is the
   host-tooling dependency the project has otherwise moved away from: tests use
   browsers from the Playwright image, gates run in the dev image.

## Shape

**One entry point, three scopes, every check.** Not `check:react:staged`,
`check:react:changed`, `check:ci:staged`… — six scripts nobody remembers.

```
bash scripts/check-scope.sh all                 # what CI runs on master
bash scripts/check-scope.sh staged              # pre-commit
bash scripts/check-scope.sh changed [--base R]  # PR, or a branch before pushing
```

with `package.json` aliases `check:all`, `check:staged`, `check:changed`.

`--base` defaults to `$(git merge-base origin/master HEAD)`; `origin/master` is
fetched first if it is missing. In GitHub Actions it is
`github.event.pull_request.base.sha` on a pull request and
`github.event.before` on a push.

### What each scope runs

| Check | `all` | `staged` | `changed` |
|---|---|---|---|
| oxlint | `oxlint` | `oxlint <staged .ts/.tsx/.js>` | `oxlint <changed files>` |
| React Doctor | `react-doctor . --scope full` | `react-doctor . --staged` | `react-doctor . --scope changed --base $BASE` |
| actionlint | every workflow | staged `.github/workflows/*.yml` only; skip if none | changed workflows only; skip if none |
| shellcheck | `scripts/*.sh` | staged `*.sh` | changed `*.sh` |
| dependency audit | `bun audit --audit-level moderate` | only if `bun.lock`/`package.json` staged | only if `bun.lock`/`package.json` changed |
| typecheck | `tsc --noEmit` | **whole project** — types do not scope by file | whole project |

Every React Doctor call carries `--no-telemetry --no-supply-chain
--no-warnings --blocking error`; the shared flags live in one place in the
script, so a fourth scope cannot forget one.

File lists come from git with `--diff-filter=ACMR` (no deleted files) and `-z`
so a path with a space survives. An empty list means **skipped and reported as
skipped**, never a silent pass that looks like a check ran.

### actionlint and shellcheck from an image, not the host

Run both through the official `rhysd/actionlint:1.7.12` image, pinned **by
digest**, which bundles shellcheck. That removes the host `shellcheck`
dependency and keeps the version pin `check-ci.sh` already enforces with a
SHA-256. The current download-and-checksum path stays as the fallback for CI
runners where pulling another image costs more than the binary.

`check-ci.sh` becomes `check-scope.sh all`'s CI half; CI keeps calling it by
its old name until the next workflow edit, so that the rename is its own
commit.

## Steps — one commit each

1. **`fix(ci): stop react-doctor sending the dependency list to Socket.dev`**:
   add `--no-supply-chain` to `check:react`. Verify by running it with the
   network off (`unshare -n` or a container `--network none`): today it should
   fail or stall, and after the change it should pass.
2. **`build: run actionlint and shellcheck from a pinned image`**: change
   `check-ci.sh` as above. Verify it runs on a host with no shellcheck.
3. **`build: add scripts/check-scope.sh with all, staged and changed`**: the
   script plus the three `package.json` aliases, and a
   `src/__tests__/unit/check-scope.test.ts` using command stubs, the way
   `dev-local.test.ts` does. It asserts the file list each tool receives per
   scope, that an empty list is reported as skipped, and that the shared React
   Doctor flags are present in every scope. **Break each assertion once to
   watch it go red.**
4. **`ci: scope the pull-request lint to the PR's own changes`**: on
   `pull_request`, run `check-scope.sh changed --base <base sha>` as an extra,
   fast step that fails before the full gates. `actions/checkout` needs
   `fetch-depth: 0`, or at least the base commit, for `merge-base`. The full
   `all` scope keeps running, because a change can break a file it did not
   touch.
5. **`build: run the dependency audit locally, and when dependencies change`**:
   `check:audit`, its `verify-local.sh` step, and the `bun.lock` trigger in
   `check-scope.sh` (see *The dependency audit* below). Verify the trigger
   both ways: stage a `bun.lock` edit and see it run, stage only a `.tsx` and
   see it skipped.
6. **`build: offer an opt-in pre-commit hook`**: `scripts/install-hooks.sh`
   writes `.git/hooks/pre-commit` → `bash scripts/check-scope.sh staged`.
   Opt-in, not automatic, because a hook installed behind someone's back is a
   hook they will delete. Use git's own hooks, not husky: one fewer
   dependency.
7. **`docs: …`**: `VERIFICATION_SEQUENCE.md` owns "which command, and what does
   it prove". It gets the three scopes, and a statement that `staged` and
   `changed` are **feedback, not a gate**: only `verify:ci` and the CI run
   prove anything.

## Other scripts worth adding

Ranked by how often their absence costs time. Each is a candidate, not a
commitment.

| Script | What it does | Why |
|---|---|---|
| `preview` | `build`, copy `.next/static` and `public/` into `.next/standalone`, then `bun .next/standalone/server.js` with `NODE_ENV=production` | **`bun run start` runs the wrong artefact.** Measured 2026-10-10: it serves (`/login` 200) but warns `"next start" does not work with "output: standalone" configuration`, and it serves `.next/`, not the traced standalone bundle the image ships. A tracing defect such as OCR-2's missing worker file cannot show there. (`playwright.config.ts` says `next start` "refuses" standalone output. That is stronger than what happens: it warns and serves.) `preview` is how to see the service worker, the production CSP and the PWA manifest locally without Docker. The e2e `webServer.command` already has these exact steps, so extract them into the script rather than copying them, and point `start` at the same server or remove it. |
| `dev:https` | `next dev --experimental-https` | A secure context on `https://localhost:3000` for the camera, without Tailscale. Next fetches `mkcert` and installs a local CA the first time, so it is opt-in and documented as such. |
| `dev:tailscale` | `tailscale serve --bg 3000`, print the `https://<host>.ts.net` URL and the `DEV_ALLOWED_ORIGIN` line to add; `--off` runs `tailscale serve --https=443 off` | The phone-on-a-real-network path (PROGRESS, "the owner's second pass") is currently tribal knowledge. **Never `tailscale serve reset`**: it wipes every other serve config on the machine. |
| `generate:icons` | `bun scripts/generate-icons.ts` | Added with the PWA manifest. The PNGs are committed output from the SVGs. |
| `check:pwa` | Lighthouse's PWA and installability audits against `preview` | Only if the unit test (`pwa-manifest.test.ts`) and the e2e prove not to be enough. Lighthouse is heavy, and it needs a browser, which must come from the Playwright image and not the host. |

### The dependency audit (asked for as "pnpm audit as a CI check")

**It is already a CI check, under its Bun name.** The `audit` job in
`.github/workflows/ci.yml` runs `bun audit --audit-level moderate`, and the
release and image jobs list it in `needs:`. It replaced `pnpm audit` when the
package manager moved to Bun on 2026-08-28. `pnpm audit` would now be the wrong
tool: `pnpm-lock.yaml` is gitignored and stale, so it would audit a tree nobody
installs. Measured 2026-10-10: `bun audit` → *No vulnerabilities found (checked
564 packages)* in 211 ms.

Two things are missing, and both belong in this plan:

| Gap | Change |
|---|---|
| No local entry point, so the audit is only seen after a push | `"check:audit": "bun audit --audit-level moderate"` in `package.json`, as a step in `verify-local.sh` (it costs under a second) and in `check-scope.sh all` |
| Nothing ties the audit to the change that introduced the risk | `check-scope.sh staged` and `changed` run `check:audit` **only when `bun.lock` or `package.json` is in the file list**, and say "skipped: no dependency change" otherwise |

What runs where then: CI's `audit` job stays the gate. Locally, `verify:ci`
and `check:all` always audit, and `check:staged`/`check:changed` audit when
dependencies moved.

One trade to record rather than hide: unlike every other check here, the audit
must reach the network, because it sends package names and versions to the
npm advisory endpoint. Those are the public names of public packages, which is
why it is acceptable where step 1's Socket.dev call was not quietly so. But it
means the audit is the one gate that fails offline, and `verify-local.sh` should
report that as "skipped: offline", not as a failure.

Housekeeping found on the way: the working copy still holds a root
`pnpm-lock.yaml` and `pnpm-workspace.yaml`. Both are gitignored leftovers from
before the migration. Deleting them locally removes the temptation to run
`pnpm` against them.

## As implemented (2026-10-11)

Where the implementation departed from the plan above, and why. Each commit
message has the evidence.

- **Step 1's predicted verification was wrong.** Offline, the old
  `check:react` neither failed nor stalled: React Doctor wraps the Socket.dev
  fetch in `orElseSucceed`, so it passed with "No issues found". The leak was
  silent. The evidence used instead is React Doctor's own cache: with a fresh
  `REACT_DOCTOR_CACHE_DIR`, the old command left 51 Socket.dev responses under
  `supply-chain/`, and the new one leaves none.
- **React Doctor's shared flags live in `package.json`'s `check:react`**, not
  in `check-scope.sh`. `verify-local.sh` and the development image already run
  `check:react`, so putting the flags in the script would have made two copies.
  Every scope calls `bun run check:react` and adds only the scope.
- **`check-ci.sh` was not renamed.** It takes `actionlint|shellcheck
  [FILE...]`, owns the pinned image, and `check-scope.sh` only picks the files.
  The image path is the default everywhere, CI included, so the runner and the
  developer run the same shellcheck; the checksummed binary is the fallback
  when no Docker daemon answers, or with `CHECK_CI_TOOLS=binary`.
- **`changed` compares the working tree with the merge base**, not
  `HEAD`. React Doctor's `--scope changed` does that (measured: it scanned an
  uncommitted edit), and the file lists have to agree with it.
- **Scoped shellcheck takes `scripts/*.sh` only**, not every `*.sh`: a narrow
  scope never checks what `all` does not, so it cannot fail on something CI
  accepts.
- **CI scopes pull requests only.** The step runs inside the development image
  like every other gate, through `ci-in-image.sh changed`. That image has no
  Docker, so `check-scope.sh --no-pipeline-lint` skips actionlint and
  shellcheck; the job's first step has already run them over everything. A push
  to master runs only the `all` gates, so `github.event.before` is not used.
- **`check:audit` is `scripts/check-audit.sh`, not the bare command.** Offline,
  `bun audit` exits 1, the same status as a vulnerable tree. The script tells
  the two apart and exits 75 when offline; `verify-local.sh` and
  `check-scope.sh` report 75 as skipped. CI's `audit` job still calls `bun
  audit` directly, so there an unreachable endpoint fails the gate.
- **The housekeeping was left to the owner**: the gitignored `pnpm-lock.yaml`
  and `pnpm-workspace.yaml` in the working copy were not deleted.
