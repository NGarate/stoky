# E2E Isolation and Production Build Implementation Plan

> **EXECUTED — historical record.** All eight tasks landed on 2026-08-17/18
> (`d5e6f9e` through `f87b48a`); the checkboxes below stay as written and the
> commit history is the record. Three things the plan could not know, found in
> execution and worth more than the plan: the production CSP's
> `upgrade-insecure-requests` was killing WebKit on plain http (a real product
> defect, fixed in `e8dafd7`); a live service worker makes ordinary tests
> dishonest under load (blocked suite-wide, allowed in its own spec); and
> Docker's exported `HOSTNAME` re-binds the standalone server inside container
> jobs. `PROGRESS.md` D82–D86 carry the decisions; `TEST_SETUP.md` describes
> the result. Do not execute this plan again.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The browser suite stops touching the developer's database and dev server, and exercises the production artefact a self-hosted user actually runs.

**Architecture:** The suite gets its own database (`stoky_e2e` in the same Postgres) and its own Valkey db index, derived in one shared module and applied through Playwright's `webServer.env`; the `seed` project migrates and seeds that database itself. The `webServer` command changes from `pnpm dev` to the standalone production build — the same command `playwright.prod.config.ts` already proved — which also removes the `next dev` single-instance lock that let the suite and a developer's server kill each other today. Once the main config serves the production artefact, the separate prod config has no reason to exist and its ten tests fold in.

**Tech Stack:** Playwright 1.62.1, Next.js 16.3 standalone output, Prisma 6.19.3 (`migrate deploy` against the derived URL), ioredis (db index via URL path), pnpm overrides for the two audit advisories.

## Global Constraints

Copied from `CLAUDE.md` — every task inherits these:

- `master` is the only branch. No feature branches, no PRs. Commit directly to master.
- Conventional Commits. One commit, one change; each commit stands alone, passes its gates in isolation, and is revertable alone. Stage with `git add <path>`, never `git add -A`.
- Every commit message explains **why**, not what.
- Validate before committing: `pnpm verify:ci` for every commit, plus the browser suite for anything that changes it.
- Ten minutes is the budget for all verification, enforced — a CI test job stays at `timeout-minutes: 10` unless a measurement forces the conversation.
- Both message catalogues in the same commit (no i18n strings are touched here, but the rule stands).
- Do not run the browser suite while the owner's `pnpm dev` is up until Task 4 lands (it still shares `.next/` until then, and the whole point of this plan is to stop stepping on that session).

## Why now (context for every task)

Measured 2026-08-17, all three on this machine:

1. The suite runs `pnpm db:seed` against the **developer's own database** — it deletes and recreates the demo household on every invocation. Today that reset the household the owner was actively testing with. Their verdict: not acceptable.
2. The suite's server is `pnpm dev`, which takes Next's per-directory single-instance lock. The owner's own `pnpm dev` refused to start while the suite ran; killing the holder (which Next's own error message suggests) killed the suite's server mid-run — 57 tests green, then 51 `ERR_CONNECTION_REFUSED`.
3. `next dev` is not what anyone deploys. This gap has already shipped one invisible defect class: production auth was broken with every suite green (`docs/STATUS.md`), because `next dev` applies neither `trustHost` nor the production CSP. The patch was a separate 10-test prod config; the other 108 tests still run against dev.

Also blocking: `pnpm audit` reports **2 high** transitive advisories (nanoid <3.3.18 via postcss, deepmerge-ts <8.0.0 via @prisma/config), so the next push turns the `audit` CI job red no matter what it contains. Task 1 clears that first so the pushes this plan produces can be green.

## File Structure

- Modify: `pnpm-workspace.yaml` — two audit overrides (Task 1)
- Create: `e2e/db-url.ts` — derivation of the suite's DATABASE_URL / VALKEY_URL (Task 2)
- Create: `src/__tests__/unit/e2e-db-url.test.ts` — its tests (Task 2)
- Modify: `e2e/seed.setup.ts` — migrate + seed the isolated database (Task 3)
- Modify: `playwright.config.ts` — webServer → standalone build, isolated env, port default (Task 4)
- Modify: `.github/workflows/ci.yml` — e2e job env + redundant steps (Task 6)
- Modify: `playwright.config.ts`, delete `playwright.prod.config.ts`, modify `package.json` — fold the prod suite in (Task 7)
- Modify: `docs/TEST_SETUP.md`, `docs/VERIFICATION_SEQUENCE.md`, `docs/PROGRESS.md` — the new shape (Task 8)

---

### Task 1: Clear the two audit advisories so pushes can be green

**Files:**
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Produces: a clean `pnpm audit`, which Tasks 6's push depends on.

- [ ] **Step 1: Add the nanoid override** (within its major, same pattern as the four existing entries) to the `overrides:` block:

```yaml
  "postcss>nanoid": ^3.3.18
```

- [ ] **Step 2: Attempt the deepmerge-ts override.** This one crosses a major (7.1.5 → 8), which the file's own rule ("every bump stays within the same major") does not cover — so it is an attempt with a fallback, not a fact:

```yaml
  "@prisma/config>deepmerge-ts": ^8.0.0
```

- [ ] **Step 3: Install and check the advisories are gone**

Run: `pnpm install && pnpm audit --audit-level moderate`
Expected: `No known vulnerabilities found`

- [ ] **Step 4: Prove @prisma/config still loads with deepmerge-ts 8** — it is exercised by anything that reads `prisma.config.ts`:

Run: `pnpm db:generate && set -a && . ./.env && set +a && pnpm prisma migrate status`
Expected: generate succeeds; migrate status prints the four applied migrations.

**If Step 4 fails:** remove the deepmerge-ts override, run `pnpm install` again, and instead add the documented escape hatch at the bottom of `pnpm-workspace.yaml`, dated:

```yaml
auditConfig:
  ignoreCves:
    - CVE-2026-XXXXX # @prisma/config>deepmerge-ts: fix is across a major (8.0.0) and breaks @prisma/config 6.19.3's config loading; added 2026-08-17, remove when prisma ships a parent that has moved
```

(Use the CVE id `pnpm audit` prints; if it only offers the GHSA id, use that.)

- [ ] **Step 5: Full gate**

Run: `sg docker -c "pnpm verify:ci"`
Expected: green (integration exercises the generated client and a real migrate deploy).

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "build: clear the two high audit advisories before they turn the trunk red"
```

---

### Task 2: One module derives the suite's isolated URLs

**Files:**
- Create: `e2e/db-url.ts`
- Create: `src/__tests__/unit/e2e-db-url.test.ts`

**Interfaces:**
- Produces: `e2eDatabaseUrl(env?: NodeJS.ProcessEnv): string` and `e2eValkeyUrl(env?: NodeJS.ProcessEnv): string`, imported by `playwright.config.ts` (Task 4) and `e2e/seed.setup.ts` (Task 3). Both take the environment as a parameter so the tests need no env mutation.

- [ ] **Step 1: Write the failing tests** in `src/__tests__/unit/e2e-db-url.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { e2eDatabaseUrl, e2eValkeyUrl } from "../../../e2e/db-url";

describe("e2eDatabaseUrl", () => {
  it("replaces the database name, keeping credentials, host and query", () => {
    expect(
      e2eDatabaseUrl({
        DATABASE_URL:
          "postgresql://stoky:stoky_dev_password@localhost:5432/stoky?schema=public",
      }),
    ).toBe(
      "postgresql://stoky:stoky_dev_password@localhost:5432/stoky_e2e?schema=public",
    );
  });

  it("prefers an explicit E2E_DATABASE_URL verbatim", () => {
    expect(
      e2eDatabaseUrl({
        DATABASE_URL: "postgresql://a:b@localhost:5432/stoky",
        E2E_DATABASE_URL: "postgresql://x:y@elsewhere:5432/anything",
      }),
    ).toBe("postgresql://x:y@elsewhere:5432/anything");
  });

  it("refuses to run with neither, naming both variables", () => {
    expect(() => e2eDatabaseUrl({})).toThrow(/E2E_DATABASE_URL|DATABASE_URL/);
  });
});

describe("e2eValkeyUrl", () => {
  it("moves the derived connection onto db index 1", () => {
    expect(e2eValkeyUrl({ VALKEY_URL: "redis://localhost:6379" })).toBe(
      "redis://localhost:6379/1",
    );
  });

  it("prefers an explicit E2E_VALKEY_URL verbatim", () => {
    expect(
      e2eValkeyUrl({ E2E_VALKEY_URL: "redis://cache:6379" }),
    ).toBe("redis://cache:6379");
  });

  it("defaults to localhost like src/lib/valkey.ts does", () => {
    expect(e2eValkeyUrl({})).toBe("redis://localhost:6379/1");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/__tests__/unit/e2e-db-url.test.ts`
Expected: FAIL — cannot resolve `../../../e2e/db-url`.

- [ ] **Step 3: Implement `e2e/db-url.ts`**

```typescript
/**
 * The browser suite's own database and cache, derived in one place.
 *
 * The suite seeds itself and *spends* the fixture, so it must never point at
 * the database a developer's `pnpm dev` is using — on 2026-08-17 it reset the
 * demo household underneath the owner mid-test. The rule since: the suite owns
 * `stoky_e2e` (created and migrated by `e2e/seed.setup.ts`) and Valkey db
 * index 1, and the developer's data is out of reach by construction.
 *
 * CI sets E2E_DATABASE_URL / E2E_VALKEY_URL explicitly, because its services
 * are already scoped to the job and a rename inside them buys nothing.
 */

export function e2eDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.E2E_DATABASE_URL) return env.E2E_DATABASE_URL;
  if (!env.DATABASE_URL) {
    throw new Error(
      "The browser suite needs E2E_DATABASE_URL, or DATABASE_URL to derive one from. " +
        "Export the environment first: set -a; . ./.env; set +a",
    );
  }
  const url = new URL(env.DATABASE_URL);
  url.pathname = "/stoky_e2e";
  return url.toString();
}

export function e2eValkeyUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.E2E_VALKEY_URL) return env.E2E_VALKEY_URL;
  // Same fallback as src/lib/valkey.ts, moved onto its own db index.
  const base = env.VALKEY_URL ?? "redis://localhost:6379";
  const url = new URL(base);
  url.pathname = "/1";
  return url.toString();
}
```

- [ ] **Step 4: Run the tests, expect 6 pass**

Run: `bun test src/__tests__/unit/e2e-db-url.test.ts`

- [ ] **Step 5: Verify the module breaks the tests when wrong** (the repo's "a test must be able to fail" rule): change `"/stoky_e2e"` to `"/stoky"`, watch test 1 fail, change it back.

- [ ] **Step 6: Commit**

```bash
git add e2e/db-url.ts src/__tests__/unit/e2e-db-url.test.ts
git commit -m "test(e2e): derive an isolated database and cache for the browser suite"
```

---

### Task 3: The seed project migrates and seeds the isolated database

**Files:**
- Modify: `e2e/seed.setup.ts`

**Interfaces:**
- Consumes: `e2eDatabaseUrl()` from `e2e/db-url.ts`.
- Produces: a migrated, seeded `stoky_e2e` that Task 4's server will read.

- [ ] **Step 1: Point both child processes at the suite's database.** In `e2e/seed.setup.ts`, add the import and replace the body of the setup test:

```typescript
import { e2eDatabaseUrl } from "./db-url";
```

```typescript
setup("seed the demo household", async () => {
  // The suite's own database, never the developer's — see e2e/db-url.ts.
  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl() };

  // `migrate deploy` creates the database when it does not exist and applies
  // the committed migrations; on an already-migrated database it is a no-op.
  // Doing it here rather than in a workflow step means local and CI runs have
  // one setup path, and a fresh clone needs no manual step.
  const migrate = await run("pnpm", ["prisma", "migrate", "deploy"], {
    env,
    timeout: 120_000,
  }).catch((error: unknown) => ({ stdout: "", stderr: String(error) }));

  expect(
    migrate.stdout,
    `\`prisma migrate deploy\` failed against ${e2eDatabaseUrl()}.\n${migrate.stderr}`,
  ).toMatch(/migrations? (have|has) been applied|already in sync|No pending migrations/);

  const result = await run("pnpm", ["db:seed"], {
    env,
    // A seed that hangs must not eat the suite's whole budget.
    timeout: 120_000,
  }).catch((error: unknown) => ({ stdout: "", stderr: String(error) }));

  expect(
    result.stdout,
    "`pnpm db:seed` did not report success. The browser suite needs the demo " +
      `household, and every run consumes part of it.\n${result.stderr}`,
  ).toContain("seed command has been executed");
});
```

(Keep the existing file comment, but rewrite its last paragraph: the seed no longer "touches nothing a developer has in the same database" by being scoped to the demo household — it touches nothing because it is a different database.)

- [ ] **Step 2: Verify `migrate deploy` really creates the database.** Drop it first if a previous experiment made one, then run only the seed project:

Run:
```bash
sg docker -c "docker exec stoky-db-1 psql -U stoky -c 'DROP DATABASE IF EXISTS stoky_e2e'"
set -a; . ./.env; set +a
bunx playwright test --project=seed
sg docker -c "docker exec stoky-db-1 psql -U stoky -lqt" | grep stoky_e2e
```
Expected: the seed project passes and `stoky_e2e` is listed.
**If `migrate deploy` refuses to create the database:** create it explicitly at the top of the setup instead, via the maintenance database — `run("pnpm", ["prisma", "db", "execute", "--url", adminUrl, "--stdin"], ...)` fed `CREATE DATABASE stoky_e2e` with `adminUrl` being `e2eDatabaseUrl()` with pathname `/postgres`, ignoring an "already exists" failure — and record which path was needed in the file comment.

- [ ] **Step 3: Verify the developer's database is untouched.** Write a marker, run the seed project, confirm the marker survives:

```bash
sg docker -c "docker exec stoky-db-1 psql -U stoky -d stoky -c \"insert into \\\"Store\\\" (id, name, \\\"householdId\\\", \\\"createdAt\\\", \\\"updatedAt\\\") select 'marker-e2e-isolation', 'marker', id, now(), now() from \\\"Household\\\" limit 1\""
bunx playwright test --project=seed
sg docker -c "docker exec stoky-db-1 psql -U stoky -d stoky -c \"select count(*) from \\\"Store\\\" where id = 'marker-e2e-isolation'\""
sg docker -c "docker exec stoky-db-1 psql -U stoky -d stoky -c \"delete from \\\"Store\\\" where id = 'marker-e2e-isolation'\""
```
Expected: count is 1 after the run (before the cleanup delete). If the `Store` insert fails on a column, read `prisma/schema.prisma` for the actual required columns and adjust — the point is any row in the dev database surviving a suite run.

- [ ] **Step 4: Commit**

```bash
git add e2e/seed.setup.ts
git commit -m "test(e2e): seed the suite's own database, never the developer's"
```

Note: after this task and until Task 4, the suite *server* still reads the dev database (`.env`) while the seed writes `stoky_e2e` — the suite would fail if run whole. That is why these two tasks land minutes apart and nothing between them claims the suite is runnable; Task 4's full run is the gate for both.

---

### Task 4: The suite serves the production artefact, on its own data

**Files:**
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: `e2eDatabaseUrl()`, `e2eValkeyUrl()`.
- Produces: `webServer` block Tasks 6–7 rely on.

- [ ] **Step 1: Imports and port default.** At the top of `playwright.config.ts`:

```typescript
import { e2eDatabaseUrl, e2eValkeyUrl } from "./e2e/db-url";
```

Change the port line to default to a port nothing else uses (3000 is routinely somebody's dev server — it is why `PLAYWRIGHT_PORT` exists):

```typescript
const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
```

- [ ] **Step 2: Replace the `webServer` block.** The command and the copy steps are the ones `playwright.prod.config.ts` proved against the deployed artefact (`next start` refuses `output: "standalone"`); the env is that block's plus the isolation URLs plus the rate-limit overrides the dev block already carried (copy those `RATE_LIMIT_*` entries over verbatim from the current block):

```typescript
  /**
   * A real production build, served the way the image serves it, on the
   * suite's own data.
   *
   * `pnpm dev` sat here until 2026-08-17, and cost three things at once: the
   * suite tested a server nobody deploys (which is how broken production auth
   * once shipped under green suites), it fought the developer's own `pnpm dev`
   * for Next's per-directory single-instance lock (a suite mid-run lost its
   * server that way today), and it read the developer's database. The
   * standalone server takes no lock, reads `stoky_e2e`, and is the artefact
   * a self-hosted install actually runs.
   *
   * `reuseExistingServer` is off for the same reason as in the old prod
   * config: adopting whatever holds the port means testing a stale build.
   */
  webServer: {
    command:
      "pnpm build" +
      " && cp -r .next/static .next/standalone/.next/static" +
      " && cp -r public .next/standalone/public" +
      " && node .next/standalone/server.js",
    url: BASE_URL,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      PORT,
      DATABASE_URL: e2eDatabaseUrl(),
      VALKEY_URL: e2eValkeyUrl(),
      // src/lib/auth/secret.ts refuses production service with the example
      // secret; this one signs sessions for a server that lives five minutes.
      NEXTAUTH_SECRET: "playwright-suite-secret-not-a-real-one-0001",
      // Must match the address the tests use, or Auth.js refuses the Host.
      NEXTAUTH_URL: BASE_URL,
      /* …the RATE_LIMIT_* entries exactly as they are today… */
    },
    // A cold `next build` on a slow machine, plus server start.
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
```

- [ ] **Step 3: One spec first.** The cheap probe before the matrix:

Run: `set -a; . ./.env; set +a; bunx playwright test e2e/critical-paths.spec.ts --project=chromium`
Expected: green. Diagnose anything that is not — the plausible classes are CSP (production policy now applies to every test), the service worker now registering (it only registers under `NODE_ENV=production`), and copy/latency differences between dev and prod rendering. Fix forward; each distinct cause is its own commit if it touches product code.

- [ ] **Step 4: Full matrix, timed.**

Run: `set -a; . ./.env; set +a; time bunx playwright test`
Expected: 108 passed. Record the wall clock and the portion before the first test (the build) from the output timestamps.

- [ ] **Step 5: Re-fit `globalTimeout`.** Playwright's `globalTimeout` covers webServer startup, so the build now lives inside it. Set the local value from the Step 4 measurement: suite time + build time + 60s headroom, rounded up to the minute — and rewrite the `globalTimeout` comment with the new arithmetic (the old one reasons from a 2.9-minute dev-served suite). Do the same for the CI value using Task 6's run. Keep the principle: the ceiling is the contract, set just above the measurement, not a multiple of it.

- [ ] **Step 6: The workers comment.** It reasons from `next dev` rendering on one Node process. Re-measure is not required — leave `WORKERS` at 4/2 — but rewrite the comment to say the measurement predates the standalone server and stands until someone re-measures.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts
git commit -m "test(e2e): drive the standalone production build on the suite's own data"
```

---

### Task 5: Prove the isolation end to end

**Files:** none (verification only)

- [ ] **Step 1: With `pnpm dev` running** (start one on a spare port to play the developer: `set -a; . ./.env; set +a; pnpm dev --port 3001 &` — or coordinate with the owner's real one), run the full suite. Both must coexist: the suite must not refuse to start, the dev server must stay up, and the dev database must not change (repeat Task 3 Step 3's marker check).

- [ ] **Step 2: Stop the spare dev server** (`kill <its pid>` by explicit PID — `pkill -f` matches your own shell, STATUS.md trap 4).

- [ ] **Step 3: Run `sg docker -c "pnpm verify:ci"`** — the non-browser gates must not have moved.

- [ ] **Step 4: Nothing to commit** — this task produces evidence, and its numbers land in Task 8's docs.

---

### Task 6: CI's e2e job hands the suite its own services and stops duplicating its setup

**Files:**
- Modify: `.github/workflows/ci.yml` (the `e2e` job only)

- [ ] **Step 1: Rename the env pair.** In the e2e job's `env:` block, replace

```yaml
      DATABASE_URL: postgresql://stoky:stoky_ci@postgres:5432/stoky?schema=public
      VALKEY_URL: redis://cache:6379
```

with

```yaml
      # Explicit rather than derived: the job's services are already scoped to
      # the job, so the suite takes them as they are. e2e/db-url.ts prefers
      # these over any derivation.
      E2E_DATABASE_URL: postgresql://stoky:stoky_ci@postgres:5432/stoky?schema=public
      E2E_VALKEY_URL: redis://cache:6379
```

- [ ] **Step 2: Remove the now-duplicated steps.** Delete these two lines from the job's steps — the seed project does both against the suite's database, so a second copy here is a second thing to keep in step:

```yaml
      - run: pnpm prisma migrate deploy
      - run: pnpm db:seed
```

(`- run: pnpm db:generate` stays: `pnpm build` needs the generated client.)

- [ ] **Step 3: Keep `PLAYWRIGHT_PORT: "3000"`** on the playwright step (free inside the container) and update `NEXTAUTH_URL` in the job env to stay `http://localhost:3000` — its comment ("this is the dev server Playwright starts") is now wrong twice over; reword to "the standalone server Playwright starts inside this same container".

- [ ] **Step 4: Lint the pipeline**

Run: `bash scripts/check-ci.sh`
Expected: clean.

- [ ] **Step 5: Commit, push, and watch the run** — this is the task that can only finish in CI:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: give the browser suite its own database URL and one setup path"
git push
gh run watch
```

Expected: all jobs green. Record the e2e job's timing (setup, build, suite) for Task 4 Step 5's CI `globalTimeout` and for Task 8. **If the job exceeds its ten-minute ceiling:** that is the measurement the ten-minute contract conversation needs — stop, present the numbers to the owner rather than raising the cap unilaterally (`CLAUDE.md` calls the budget a product decision).

---

### Task 7: Fold the ten production-config tests into the one suite

**Files:**
- Modify: `playwright.config.ts`
- Delete: `playwright.prod.config.ts`
- Modify: `package.json`

The prod config existed for one reason — the main suite served `next dev` and these ten tests need the production artefact. That reason died in Task 4.

- [ ] **Step 1: Collect the prod specs.** In `playwright.config.ts`, delete the `testIgnore: /.*\.prod\.spec\.ts/` line and its comment block (the comment explains a hazard that no longer exists). Add both specs to `CHROMIUM_ONLY` so firefox/webkit/Mobile Safari never collect them (they are artefact checks, not layout or smoke):

```typescript
const CHROMIUM_ONLY = [
  "**/accessibility.spec.ts",
  "**/a11y-aaa.spec.ts",
  "**/a11y-structure.spec.ts",
  "**/screen-reader.spec.ts",
  "**/auth.prod.spec.ts",
  "**/service-worker.prod.spec.ts",
];
```

- [ ] **Step 2: Service-worker hygiene.** Add `serviceWorkers: "allow"` under `use` with a one-line comment (it is the default; naming it records that the suite now runs with a live worker). The sw spec's tests run in one worker because tests within a file are serial by default — the old config's `workers: 1` was this, globally.

- [ ] **Step 3: Delete `playwright.prod.config.ts`** and the `test:e2e:sw` script from `package.json`.

- [ ] **Step 4: Full run**

Run: `set -a; . ./.env; set +a; bunx playwright test`
Expected: **118 passed** (108 + 5 auth.prod + 5 service-worker.prod). Diagnose deviations; the likely one is the sw spec's assumption of a pristine origin, which fresh per-test contexts satisfy — if a test proves otherwise, give that spec `test.describe.configure({ mode: "serial" })` and say why in place.

- [ ] **Step 5: Grep for stragglers**

Run: `grep -rn "test:e2e:sw\|prod.config" docs/ CLAUDE.md AGENTS.md README.md scripts/ .github/ package.json`
Expected: only historical mentions in docs that Task 8 rewrites; fix any live reference (a CI step, a script) here.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts package.json
git rm playwright.prod.config.ts
git commit -m "test(e2e): one suite, one artefact — fold the prod config into the main one"
git push
```

Watch the run as in Task 6.

---

### Task 8: The documents that describe the suite describe this one

**Files:**
- Modify: `docs/TEST_SETUP.md` — the E2E sections: the suite builds and serves the standalone artefact on `stoky_e2e` / Valkey db 1; `PLAYWRIGHT_PORT` default 3100; the suite and `pnpm dev` coexist by design; the troubleshooting entry that says "Ensure dev server is running / check port 3000" is replaced by "the suite starts its own server; do not start one for it".
- Modify: `docs/VERIFICATION_SEQUENCE.md` — the browser-smoke section names the build cost and the isolation; the environment-assumptions bullet about adopting an existing server is rewritten (reuse is off now).
- Modify: `docs/PROGRESS.md` — one row per task with its commit, and a decision entry: the suite moved to the production artefact and its own data, why, and what it cost (the measured build time inside the budget).

- [ ] **Step 1: Make the three edits above**, with the numbers measured in Tasks 4–6, not estimates.
- [ ] **Step 2: `pnpm verify:local`** (docs commits still ride a green tree).
- [ ] **Step 3: Commit**

```bash
git add docs/TEST_SETUP.md docs/VERIFICATION_SEQUENCE.md docs/PROGRESS.md
git commit -m "docs: describe the browser suite that exists now"
git push
```

(The wider documentation reconciliation — STATUS.md's gate table, phase table, SMOKE_JOURNEYS states, the index — is the separately-scoped docs-sync task already in flight, and lands after this plan so it records the final shape once.)

## Self-Review

- Spec coverage: isolation (Tasks 2–3, 5), production build (Task 4), CI (Task 6), consolidation (Task 7), docs (Task 8), the push-blocking audit (Task 1). The owner's three complaints from today each map to a task: database (3), lock collision (4), dev-vs-deployed (4/7).
- Placeholders: the RATE_LIMIT env entries in Task 4 Step 2 are a deliberate "copy verbatim from the current block" instruction rather than a restatement — restating them here risks drifting from the file, which is the exact class of bug this repo documents. Everything else is literal.
- Types: `e2eDatabaseUrl`/`e2eValkeyUrl` signatures match across Tasks 2, 3, 4, 6.
- Known unknowns, each with a decision branch written in place: whether `migrate deploy` creates a missing database (Task 3 Step 2), production-only test fallout (Task 4 Step 3), CI fit inside ten minutes (Task 6 Step 5), sw-spec origin pristineness (Task 7 Step 4).
