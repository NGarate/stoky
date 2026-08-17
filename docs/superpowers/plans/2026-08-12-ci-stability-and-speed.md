# CI Stability and Speed Implementation Plan

> **EXECUTED — historical record.** All five tasks landed on 2026-08-12
> (`9bb4b20`, `3f37688`, `5ec7068`, `dc68b21`, `bf14d97`, plus the fixes and
> the e2e-container work that followed the same day, through `0850942`). The
> checkboxes below were never ticked during execution; the commit history is
> the record. Measured results live in `docs/STATUS.md` §The pipeline, which
> supersedes every estimate here. Do not execute this plan again.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut a green push-to-published-image run from ~15 minutes to ~9–10, remove the known sources of CI-only breakage (unpinned Bun, unlinted workflow/scripts), and stop paying ~7 billed minutes of image build for pushes that cannot change the image.

**Architecture:** The workflow keeps its shape — five SHA-pinned, least-privilege jobs on a trunk-only repo — but the image job splits into a build+scan job that runs *alongside* the tests and a small publish job that waits for green and rebuilds from warm cache. A new `changes` job skips the image pair for docs-only pushes. A new `scripts/check-ci.sh` lints the pipeline itself (actionlint + shellcheck) so workflow bugs fail locally instead of as red runs on master.

**Tech Stack:** GitHub Actions (all actions pinned by commit SHA), bash, actionlint v1.7.12, shellcheck, Docker Buildx with `type=gha` layer cache, pnpm 11.19.0, Bun 1.3.14.

## Global Constraints

Copied from CLAUDE.md and the workflow's own contracts — every task inherits these:

- `master` is the only branch. No feature branches, no PRs. Commit directly to master; push only when the working tree is green.
- Conventional Commits. One commit, one change; each commit stands alone, passes its gates checked out in isolation, and is revertable alone. Stage with `git add <path>`, never `git add -A`.
- Every commit message explains **why**, not what.
- All GitHub Actions are pinned by commit SHA with the human-readable version in a trailing comment. New actions follow the same rule. This plan adds **no** new third-party actions.
- Test jobs are held to `timeout-minutes: 10`; a tool with its own ceiling gets the job ceiling set just above it so the tool fails first and names what it was doing.
- Never commit secrets. `NEXTAUTH_SECRET: ci-only-not-a-real-secret` in the workflow is deliberate and stays.
- Versions in play: Node 24 (workflow `env.NODE_VERSION`), pnpm 11.19.0 (`packageManager` field), Bun 1.3.14 (local, being pinned by Task 3).
- The repository is **private** today. The workflow's `github.event.repository.private == false` conditions (SARIF upload, provenance attestation) are correct and must survive every task untouched in meaning.

---

## What the review found (context for every task)

Measured from the two green runs on 2026-08-11 (`gh run view 31547219063` / `31546092780`):

| Job | Duration | Notes |
|---|---|---|
| Lint, types, contrast | ~54–61s | fine |
| Dependency audit | ~26–38s | fine |
| Unit, component, integration | ~84–92s | fine |
| End-to-end | ~7m38s | longest test job, inside its 10m ceiling |
| Build, scan and publish image | ~7m14s | **starts only after all four above finish** |
| **Wall clock total** | **~15m06s** | e2e ends ~7m49, image runs serially after |

Of the last 40 completed runs: 2 success, 15 failure, 23 cancelled. The cancellations are the concurrency group doing its job on rapid trunk pushes. The failures were dominated by **workflow-config mistakes that only surface after push** (SARIF upload 403 on a private repo, provenance 403, npm CVEs in the image) plus one flaky offline E2E test that has since been given a scoped retry.

**Already sound — do not re-fix:** every action SHA-pinned with version comments; least-privilege `permissions` per job; concurrency cancellation; service containers with health checks instead of compose-in-runner; Playwright browsers cached keyed on version; scan-before-push ordering; migrations applied to a fresh database as a test; per-step ceilings in `verify-local.sh` with the honest `code=0; cmd || code=$?` pattern; Trivy's DB is already cached (`cache: 'true'` is the default of the pinned trivy-action, verified in its `action.yaml`) and Trivy v0.69.3 already falls back to `mirror.gcr.io` before `ghcr.io` for its DB, so no rate-limit hardening task is needed.

**The problems, ranked:**

1. The image job serializes ~7 minutes behind ~8 minutes of tests (speed).
2. Workflow and script bugs have no gate before push — the dominant historical failure class (stability).
3. `setup-bun` floats to the latest Bun release; a Bun release can break trunk overnight with no commit to blame or revert (stability).
4. Docs-only pushes pay the full image build for a byte-identical image (billed minutes; the repo is private).
5. `actions/checkout` persists the workflow token into `.git/config` for the whole job; nothing in any job pushes (hardening).
6. `pnpm audit` can hold master red for days on an advisory with no fixed release, and the escape hatch is undocumented (stability).

---

## File Structure

- **Create** `scripts/check-ci.sh` — pipeline self-lint: pinned+checksummed actionlint over `.github/workflows/`, shellcheck over `scripts/*.sh`. (Task 1)
- **Create** `.bun-version` — single source of truth for the Bun version, read by CI. (Task 3)
- **Modify** `.github/workflows/ci.yml` — add self-lint step (Task 1); `persist-credentials: false` on all checkouts (Task 2); `bun-version-file` on all setup-bun steps (Task 3); split `image` into `image-build` + `image-publish` (Task 4); add `changes` job and gate the image pair on it (Task 5).
- **Modify** `pnpm-workspace.yaml` — commented `auditConfig` escape hatch. (Task 6)
- **Modify** `docs/STATUS.md` — one paragraph recording the new pipeline shape; doubles as the docs-only-skip verification push. (Task 5 verification)

No application code changes. Per-commit gate for workflow/script-only commits is `bash scripts/check-ci.sh`; `pnpm verify:ci` runs at each push checkpoint (the app code is untouched, but the checkpoint proves it).

---

### Task 1: Pipeline self-lint (`scripts/check-ci.sh` + quality step)

**Files:**
- Create: `scripts/check-ci.sh`
- Modify: `.github/workflows/ci.yml` (quality job, one step after checkout)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `bash scripts/check-ci.sh` — exit 0 on clean, non-zero on any actionlint or shellcheck finding. Every later task uses this as its per-commit gate.

- [ ] **Step 1: Install shellcheck locally if missing**

Run: `command -v shellcheck || sudo apt-get install -y shellcheck`

Expected: `shellcheck --version` prints a version. (GitHub's ubuntu-latest runners preinstall it; this is for the dev machine.)

- [ ] **Step 2: Write the script**

Create `scripts/check-ci.sh` with exactly:

```bash
#!/bin/bash

# Lints the CI pipeline itself: the workflow with actionlint, the scripts in
# scripts/ with shellcheck.
#
# Exists because a workflow bug has no test suite to fail: it surfaces as a red
# run after the push, on a trunk with no PR gate — so master is already wearing
# it. Most of the red runs in this repository's history were exactly that class
# of mistake, not failing tests.
#
# actionlint is fetched pinned and checksummed, same reasoning as the tessdata
# model in the Dockerfile: executable content entering the build from the
# internet does not get to float. shellcheck comes from the system because the
# GitHub runner images preinstall it; locally, install it once
# (apt-get install shellcheck / brew install shellcheck). A missing tool fails
# this script rather than skipping the check — a guard nobody runs is not a
# guard.

set -euo pipefail

ACTIONLINT_VERSION="1.7.12"
# From actionlint_1.7.12_checksums.txt on the GitHub release, linux_amd64.
ACTIONLINT_SHA256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "Error: shellcheck not found. Install it (apt-get install shellcheck / brew install shellcheck)." >&2
  exit 1
fi

# The checksum above is for the linux/amd64 build — the GitHub runners and the
# machines this project is developed on. Another platform needs its own
# checksum from the same release added here, not a bypass.
if [ "$(uname -s)/$(uname -m)" != "Linux/x86_64" ]; then
  echo "Error: actionlint is pinned for linux/amd64 only. Add a checksum for $(uname -s)/$(uname -m)." >&2
  exit 1
fi

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/stoky/actionlint-${ACTIONLINT_VERSION}"
if [ ! -x "${CACHE_DIR}/actionlint" ]; then
  mkdir -p "$CACHE_DIR"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  curl -fsSL --retry 3 -o "${TMP_DIR}/actionlint.tar.gz" \
    "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
  echo "${ACTIONLINT_SHA256}  ${TMP_DIR}/actionlint.tar.gz" | sha256sum -c -
  tar -xzf "${TMP_DIR}/actionlint.tar.gz" -C "$CACHE_DIR" actionlint
fi

echo "==> actionlint"
# Also runs shellcheck over every `run:` block in the workflow — shell that
# lives nowhere in scripts/ and is otherwise linted by nothing.
"${CACHE_DIR}/actionlint" -no-color

echo "==> shellcheck scripts/"
# -S warning: correctness, not style. The scripts predate this gate; style
# churn would bury the findings that matter.
shellcheck -S warning scripts/*.sh

echo "CI lint: OK"
```

- [ ] **Step 3: Run it — expect a clean pass or real findings**

Run: `bash scripts/check-ci.sh`

Expected: `CI lint: OK`. (The current workflow already passes actionlint v1.7.12 — verified during planning.) If shellcheck reports findings in the existing scripts: fix each one minimally, re-run until clean, and commit those fixes **first** as their own `fix(ci): <what shellcheck caught>` commits — the gate commit must not smuggle behavior changes.

- [ ] **Step 4: Prove the gate can fail (red/green)**

Append the line `local x` to the end of `scripts/verify-local.sh` (shellcheck error SC2168: `local` outside a function), run `bash scripts/check-ci.sh`, and confirm it exits non-zero naming SC2168. Then temporarily change the quality job's `needs`-free `runs-on: ubuntu-latest` to `runs-on: ${{ env.NOPE }}` in `ci.yml`, run the script again, confirm actionlint rejects it. **Revert both edits** and confirm `bash scripts/check-ci.sh` prints `CI lint: OK` again. Record this red/green in the commit body.

- [ ] **Step 5: Wire it into the quality job**

In `.github/workflows/ci.yml`, quality job, insert immediately after the checkout step:

```yaml
      # The pipeline linting itself. A workflow bug has no test to fail — it
      # surfaces as a red run on the trunk after push — so it gets a gate that
      # runs before anything else does. Same script runs locally.
      - name: Lint the pipeline itself
        run: bash scripts/check-ci.sh
```

Run: `bash scripts/check-ci.sh` (it now lints the edited workflow too).
Expected: `CI lint: OK`

- [ ] **Step 6: Commit**

```bash
git add scripts/check-ci.sh .github/workflows/ci.yml
git commit -m "ci: lint the pipeline itself with pinned actionlint and shellcheck" \
  -m "Most red runs in this repository's history were workflow-config mistakes
that only surfaced after push, not failing tests. actionlint is pinned and
checksummed like the Dockerfile's tessdata fetch. Verified the gate can fail:
SC2168 injected into verify-local.sh and an invalid runs-on expression were
both caught, then reverted."
```

---

### Task 2: Stop persisting the workflow token into checkouts

**Files:**
- Modify: `.github/workflows/ci.yml` (all five `actions/checkout` steps)

**Interfaces:**
- Consumes: `scripts/check-ci.sh` from Task 1 (gate).
- Produces: every checkout step carries `persist-credentials: false`; Tasks 4–5 copy this form into the jobs they write.

- [ ] **Step 1: Edit all five checkout steps**

Each bare checkout:

```yaml
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
```

becomes (comment on the quality job's instance only; the other four just get the `with:` block):

```yaml
      # checkout persists the workflow token into .git/config for the rest of
      # the job by default. Nothing in this pipeline pushes, so no step needs
      # it — and a credential nothing needs is only ever available to an
      # attacker in a compromised dependency.
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          persist-credentials: false
```

- [ ] **Step 2: Verify**

Run: `bash scripts/check-ci.sh && grep -c 'persist-credentials: false' .github/workflows/ci.yml`
Expected: `CI lint: OK` and `5`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: stop persisting the workflow token into every checkout" \
  -m "No job in this pipeline pushes via git, so no step needs the token that
checkout writes into .git/config by default. Least privilege, same reasoning
as the workflow's top-level permissions block."
```

---

### Task 3: Pin Bun

**Files:**
- Create: `.bun-version`
- Modify: `.github/workflows/ci.yml` (the three `oven-sh/setup-bun` steps in quality, test, e2e)

**Interfaces:**
- Consumes: `scripts/check-ci.sh` (gate).
- Produces: `.bun-version` containing the pinned version; CI reads it via `bun-version-file`.

- [ ] **Step 1: Create the version file**

Run: `bun --version` and write its output as the sole line of `.bun-version`. As of planning that is:

```
1.3.14
```

- [ ] **Step 2: Point all three setup-bun steps at it**

Each of the three:

```yaml
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
```

becomes (comment on the quality job's instance only):

```yaml
      # Pinned via .bun-version rather than left to float: unpinned, this
      # resolves to whatever Bun released last night, which can turn the trunk
      # red with no commit to blame and no revert that fixes it. The file is
      # the single place a Bun upgrade happens, deliberately.
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version-file: .bun-version
```

(The pinned setup-bun SHA supports `bun-version-file` — verified against its `action.yml` during planning.)

- [ ] **Step 3: Verify**

Run: `bash scripts/check-ci.sh && grep -c 'bun-version-file' .github/workflows/ci.yml && cat .bun-version`
Expected: `CI lint: OK`, `3`, `1.3.14`.

- [ ] **Step 4: Commit**

```bash
git add .bun-version .github/workflows/ci.yml
git commit -m "ci: pin Bun to the version the suites are written against" \
  -m "setup-bun with no version resolves to the latest release at run time, so
a Bun release could break CI overnight with no commit to blame. The test
runner's version is now an explicit, reviewable choice in .bun-version."
```

---

### CHECKPOINT A: push Tasks 1–3 and watch the run

- [ ] Run `pnpm verify:ci` — expected: every step green, total under its 600s budget.
- [ ] `git push`
- [ ] `gh run watch --exit-status` — expected: all five jobs green. If red, fix forward immediately (trunk rule); the failure names its step.

---

### Task 4: Build and scan the image alongside the tests; publish after them

The image job is ~7 minutes that today start only when the slowest test job ends. Build and scan gate nothing but the publish, so they can run concurrently with the tests. The trade-off is honest and recorded in the commit: on a run whose tests fail, the parallel build+scan minutes are spent for nothing — on a private repo those are billed. On a green run the pipeline ends ~5–6 minutes sooner, and green runs are the ones a person waits on. Reverting is one `needs:` line.

**Files:**
- Modify: `.github/workflows/ci.yml` — replace the entire `image` job (from the `# --- image --` banner to end of file) with the two jobs below.

**Interfaces:**
- Consumes: Task 2's checkout form (`persist-credentials: false`).
- Produces: job ids `image-build` and `image-publish`. Task 5 adds `needs: [changes]` + an `if:` to `image-build` — nothing else about these jobs changes after this task.

- [ ] **Step 1: Replace the image job**

Delete the current `image:` job and append:

```yaml
  # ------------------------------------------------------------ image-build --
  # Runs alongside the test jobs, not after them: the build takes six minutes
  # and used to start only when the slowest test finished, which put fifteen
  # minutes between a push and its image. Nothing here publishes — a failing
  # test run can waste a build, but it can never ship one. image-publish below
  # is what waits for green.
  #
  # The trade-off: on a red run these minutes are spent for nothing, and on a
  # private repository they are billed. Accepted, because the runs a person
  # actually waits on are the green ones. To revert, move this job's steps
  # back behind `needs: [quality, test, e2e, audit]`.
  image-build:
    name: Build and scan image
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
      security-events: write
      # `codeql-action/upload-sarif` also GETs the workflow run to annotate the
      # upload, and that call needs `actions: read`. Without it every image job
      # failed at "Upload scan results" with "Resource not accessible by
      # integration" — after the build, the scan and the push had all
      # succeeded, so the pipeline reported failure while shipping the image.
      actions: read
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          persist-credentials: false
      - uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3

      # Built and loaded locally first so it is scanned before anyone can pull
      # it. Publishing an image and scanning it afterwards is the wrong order.
      # cache-to here is what makes image-publish cheap: it rebuilds this same
      # commit from these layers.
      - name: Build for scanning
        uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6
        with:
          context: .
          target: production
          load: true
          tags: stoky:scan
          cache-from: type=gha
          cache-to: type=gha,mode=max

      # The SARIF pair below is reporting, not enforcement — the gate that
      # fails the build on findings is the separate Trivy step underneath, and
      # it runs unconditionally. These two run only where GitHub will accept
      # the upload: code scanning on a **private** repository needs Advanced
      # Security, and without it the API answers 403 "Code scanning is not
      # enabled" — which kept this job red for days while the build, the scan
      # gate and the push all succeeded. If this repository goes public, the
      # condition becomes true and the Security tab lights up on its own; a
      # private repository that gains Advanced Security should drop the
      # condition instead.
      - name: Scan image
        if: github.event.repository.private == false
        uses: aquasecurity/trivy-action@57a97c7e7821a5776cebc9bb87c984fa69cba8f1 # 0.35.0
        with:
          image-ref: stoky:scan
          format: sarif
          output: trivy.sarif
          severity: CRITICAL,HIGH
          ignore-unfixed: true

      - name: Upload scan results
        uses: github/codeql-action/upload-sarif@c3400c2f38909e0dcf3c3a41f2030a8217be5d3e # v3
        if: github.event.repository.private == false && always()
        with:
          sarif_file: trivy.sarif
          category: trivy

      # A separate gate so the SARIF above is always uploaded, even when this
      # fails. An image people self-host should not ship known criticals.
      - name: Fail on critical or high findings
        uses: aquasecurity/trivy-action@57a97c7e7821a5776cebc9bb87c984fa69cba8f1 # 0.35.0
        with:
          image-ref: stoky:scan
          format: table
          exit-code: "1"
          severity: CRITICAL,HIGH
          ignore-unfixed: true

  # ---------------------------------------------------------- image-publish --
  # The only job that waits for everything, and the only one that can ship.
  # It rebuilds the commit image-build just scanned — same context, same
  # Dockerfile — from the layer cache that build wrote moments ago, so this is
  # minutes of cache hits plus the push, not a second build. The same
  # two-build pattern the old single job already used.
  image-publish:
    name: Publish image
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: [quality, test, e2e, audit, image-build]
    permissions:
      contents: read
      packages: write # push to GHCR
      id-token: write # provenance attestation
      attestations: write
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          persist-credentials: false
      - uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3

      - name: Image metadata
        id: meta
        uses: docker/metadata-action@c299e40c65443455700f0fdfc63efafe5b349051 # v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest
            type=sha,format=long

      - name: Log in to the registry
        uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9 # v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # cache-from only: image-build already exported these layers, and
      # re-exporting identical ones here would spend upload time saying
      # nothing new.
      - name: Push
        id: push
        uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6
        with:
          context: .
          target: production
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          sbom: true
          provenance: mode=max
          cache-from: type=gha

      # Lets an operator verify the image they are about to self-host really
      # was built from this repository, by this workflow, from this commit.
      #
      # Public repositories only, like the SARIF upload in image-build and for
      # the same shape of reason: GitHub answers "Feature not available for
      # user-owned private repositories" after everything else has succeeded.
      # If this repository goes public, provenance starts attesting on its
      # own — which is also when it starts mattering, since it exists for
      # people who did not build the image themselves.
      - name: Attest provenance
        if: github.event.repository.private == false
        uses: actions/attest-build-provenance@96b4a1ef7235a096b17240c259729fdd70c83d45 # v2
        with:
          subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true
```

- [ ] **Step 2: Verify**

Run: `bash scripts/check-ci.sh`
Expected: `CI lint: OK`. actionlint validates the `needs:` graph, so a typo in a job id fails here, not on the runner.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build and scan the image alongside the tests, publish after them" \
  -m "The build gates nothing but the publish, yet ran serially after the
slowest test job — seven minutes appended to eight. Split: image-build runs
concurrently with the tests and can never ship; image-publish waits for all
green and rebuilds from the layer cache image-build just wrote, so it is
cache hits plus a push. Green-run wall clock drops from ~15 to ~10 minutes.
Cost accepted: a red test run now spends the build minutes for nothing."
```

---

### CHECKPOINT B: push Task 4 and watch the run

- [ ] `pnpm verify:ci` green, then `git push`, then `gh run watch --exit-status`.
- [ ] Confirm the shape:

```bash
gh run view "$(gh run list -L1 --json databaseId -q '.[0].databaseId')" \
  --json jobs --jq '.jobs[] | {name, startedAt, completedAt, conclusion}'
```

  - `Build and scan image` **starts within seconds of** `End-to-end`, not after it.
  - `Publish image` concludes `success` — it starts only after all five others succeed, takes well under 5 minutes, and its push step is the proof the image landed.
  - Total run duration ≈ 10 minutes or less, down from ~15.

---

### Task 5: Skip the image pair for pushes that cannot change the image

Docs-only pushes (`docs/**`, `*.md`) produce a byte-identical image at the cost of ~7 billed minutes and the pipeline's whole tail. The gate is an inline `git diff` — no third-party action — and every unresolvable case (force push, first push, manual dispatch) falls back to **building**, because the expensive mistake is a skipped image someone needed, not a spare build. Tests are never skipped: master stays verified on every push.

**Files:**
- Modify: `.github/workflows/ci.yml` — add a `changes` job; gate `image-build` on it.
- Modify: `docs/STATUS.md` — record the new pipeline shape (also serves as the verification push).

**Interfaces:**
- Consumes: `image-build` / `image-publish` from Task 4.
- Produces: job id `changes` with output `image` (`'true'` / `'false'`). `image-publish` needs no edit: a skipped `image-build` cascades — a job whose `needs` include a skipped job is itself skipped unless it opts into `always()`, which it must not.

- [ ] **Step 1: Add the `changes` job**

Insert before `image-build` (job order in the file mirrors the dependency order, matching the existing banner style):

```yaml
  # ---------------------------------------------------------------- changes --
  # Whether this push touched anything that can reach the image. A docs-only
  # push rebuilds a byte-identical image for seven billed minutes; skipping it
  # is free. The answer is computed from an explicit diff rather than
  # workflow-level paths-ignore, because paths-ignore would skip the *tests*
  # too, and master stays verified on every push.
  #
  # Every unresolvable case — force push, first push, manual dispatch — says
  # "build". The expensive mistake here is a skipped image someone needed,
  # not a spare build.
  changes:
    name: What this push touched
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      image: ${{ steps.diff.outputs.image }}
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          persist-credentials: false
      - name: Diff against the previous head
        id: diff
        env:
          BEFORE: ${{ github.event.before }}
        run: |
          # Empty on workflow_dispatch; all zeros on history rewrites; the
          # fetch fails if the commit is gone. All three mean "cannot know",
          # and "cannot know" means build.
          if [ -z "$BEFORE" ] || printf '%s' "$BEFORE" | grep -qE '^0+$' \
             || ! git fetch -q --depth=1 origin "$BEFORE"; then
            echo "image=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          # Any changed file that is not documentation reaches the image.
          if git diff --name-only "$BEFORE" HEAD | grep -qvE '^(docs/|.*\.md$)'; then
            echo "image=true" >> "$GITHUB_OUTPUT"
          else
            echo "image=false" >> "$GITHUB_OUTPUT"
          fi
```

- [ ] **Step 2: Gate `image-build`**

Change the top of `image-build` from:

```yaml
  image-build:
    name: Build and scan image
    runs-on: ubuntu-latest
    timeout-minutes: 20
```

to:

```yaml
  image-build:
    name: Build and scan image
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: [changes]
    # A skipped image-build cascades: image-publish needs it, and a needed
    # skip skips the dependant unless it opts into always(), which it must
    # not — that opt-in is how a gate gets silently stepped around.
    if: needs.changes.outputs.image == 'true'
```

- [ ] **Step 3: Verify locally**

Run: `bash scripts/check-ci.sh`
Expected: `CI lint: OK` (actionlint checks the `needs.changes.outputs.image` reference against the `changes` job's declared outputs).

- [ ] **Step 4: Commit the workflow change**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: skip the image for pushes that cannot change it" \
  -m "A docs-only push rebuilt and republished a byte-identical image for
seven billed minutes. The gate is an inline diff against github.event.before
rather than paths-ignore, so the tests still run on every push, and every
unresolvable case (force push, dispatch, missing before-commit) falls back
to building. image-publish needs no condition: a skipped need cascades."
```

- [ ] **Step 5: Write the STATUS.md paragraph (the docs-only test vehicle)**

Read `docs/STATUS.md` first and match its structure and voice. In its CI/verification section, record: the pipeline now builds and scans the image concurrently with the tests and publishes only after all jobs are green; docs-only pushes (`docs/**`, `*.md`) skip the image pair; the pipeline lints itself (`scripts/check-ci.sh`); Bun is pinned in `.bun-version`; green-run wall clock ~10 minutes. Do **not** commit yet — this commit must go in a separate push (Step 7) to exercise the skip path.

---

### CHECKPOINT C: push Task 5's workflow commit and watch both paths

- [ ] `pnpm verify:ci` green, then `git push` (the workflow commit — plus Task 6's if executing in order; both touch non-docs paths, so this run must **build**).
- [ ] `gh run watch --exit-status`, then confirm `What this push touched` concluded success and `Build and scan image` ran.
- [ ] Now commit the STATUS.md paragraph from Task 5 Step 5:

```bash
git add docs/STATUS.md
git commit -m "docs: record the CI pipeline reshape in STATUS.md" \
  -m "Also the live test of the docs-only skip path added in the previous
commit: this push must run the test jobs and skip both image jobs."
git push
```

- [ ] `gh run watch --exit-status`, then:

```bash
gh run view "$(gh run list -L1 --json databaseId -q '.[0].databaseId')" \
  --json jobs --jq '.jobs[] | {name, conclusion}'
```

  Expected: quality, test, e2e, audit, changes all `success`; `Build and scan image` and `Publish image` **`skipped`**. If they built instead, the diff pattern is wrong — fix forward before anything else.

---

### Task 6: Document the audit escape hatch where it will be reached for

`pnpm audit --audit-level moderate` blocks the pipeline — correctly — but an advisory with no fixed release holds master red for days through no fault of any commit. pnpm's scoped exception mechanism (`auditConfig.ignoreCves`) is the right escape hatch, and it belongs as a comment next to the other security-relevant pnpm settings, where the person staring at a red audit job at 2am will actually find it.

**Files:**
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Consumes / Produces: nothing — documentation in config.

- [ ] **Step 1: Append the commented block**

At the end of `pnpm-workspace.yaml`:

```yaml
# When `pnpm audit` turns CI red on an advisory that has no fixed release to
# move to, the exception goes here — scoped to the one CVE, with its reasoning
# — rather than lowering --audit-level in the workflow or letting master stay
# red until upstream ships. Same philosophy as `overrides` above: narrow,
# explained, and reviewed like code. Remove each entry the moment a fixed
# release exists.
#
# auditConfig:
#   ignoreCves:
#     - CVE-XXXX-XXXXX  # <parent>package>: why it does not apply here, and the date added
```

- [ ] **Step 2: Verify the file still parses**

Run: `pnpm install --frozen-lockfile >/dev/null && echo OK`
Expected: `OK` (pnpm reads pnpm-workspace.yaml on every invocation; a YAML error fails here, and with a warm store this is a no-op taking seconds).

- [ ] **Step 3: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "docs(ci): record the audit escape hatch next to the settings it belongs to" \
  -m "pnpm audit gates the pipeline, and an advisory with no fixed release can
hold master red for days. auditConfig.ignoreCves is the scoped exception
mechanism; documenting it here, commented out, means the fix at 2am is a
narrow reviewed entry instead of a lowered audit level."
```

- [ ] **Step 4: Push** — fold into CHECKPOINT C's first push if executing in order, or push and `gh run watch --exit-status` standalone. Note: this file is not under `docs/` and not `.md`, so the image correctly builds for this push.

---

## Considered and deferred (do not implement without new evidence)

- **Sharding the E2E job.** Each shard repays ~3 minutes of install/migrate/seed/browser setup to halve ~4.5 minutes of test time — roughly −2 minutes wall for +5 billed. The job is at 7m38s inside a 10-minute ceiling; revisit when the suite grows past its ceiling, using Playwright's `--shard` with the blob reporter and a merge job.
- **Running E2E against a production build** (`next build` + `next start`). Likely faster per-test and immune to the dev-server wedge the config documents, and `playwright.prod.config.ts` half-exists already — but it changes what the suite tests, and the config's worker counts, timeouts, and rate-limit env plumbing are all calibrated to `next dev`. A deliberate project decision, not a CI tweak.
- **Trivy hardening.** Already handled upstream: the pinned trivy-action defaults `cache: 'true'` (DB cached via actions/cache, date-keyed), and Trivy v0.69.3 tries `mirror.gcr.io` before `ghcr.io`. The duplicate DB setup between the SARIF and gate steps only exists when the repo is public; dedupe then (`skip-setup-trivy` + `TRIVY_SKIP_DB_UPDATE`), not now.
- **BuildKit cache mounts for `.next/cache` / pnpm store inside the Docker build.** `type=gha` does not persist `RUN --mount=type=cache` contents; making it work needs the cache-dance workaround, which is more machinery than the minutes it saves.
- **zizmor (workflow security audit).** Worth a look if the workflow grows more third-party actions; Task 2 already closes its highest-value finding class here.
- **Larger runners.** Money for minutes; the plan gets under 10 minutes without it.

## Execution notes

- Tasks 1–3 are independent of each other but Task 1 must land first (it is every later task's gate). Task 5 requires Task 4.
- Trunk rule: if any checkpoint run goes red, fixing it forward takes priority over the next task.
- All measured numbers (job timings, run IDs, checksums, action inputs) were verified on 2026-08-12 against live data, not assumed.
