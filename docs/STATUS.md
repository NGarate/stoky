# Stoky Project Status

Updated: 2026-10-12

Single source of truth for where the project actually is.

Rule for this file: **every claim must be reproducible by running a command.**
If a gate could not be run, say so and say why. If a number is a measurement,
say what measured it.

---

## Gate status

**2026-10-12 the security branch, finished:** `fix/security-hardening-2026-10-12`
carries the 2026-10-12 review's fixes, and fixes for 19 of the 20 defects its
final review found in them (the twentieth is filed as `ISSUES.md` TEST-9);
`docs/SECURITY_REVIEW.md` (*The 2026-10-12 review*) maps every one of the 116
reports to its commit, an owner action or an accepted risk. The final
verification ran on its 98 commits after `e9d62eb`, ending at the first
commit of that record (the hashes are the review table's; the squash merge
replaces them), with the shared `stoky` services and
`TEST_DB_NAME=stoky_test_sec_int`, every heavy command one at a time under a
lock. What it measured:

- **Every commit on its own.** In one detached worktree, at each of the 98:
  `bun run typecheck`, `bun run lint`, `bun run test:unit` and
  `bun run test:components`, all exit 0 at every commit, with no type error, no
  lint error and no failing test (reinstalling and regenerating the Prisma
  client wherever the manifest, lockfile or schema changed). Unit tests rise
  from 897 in 98 files at the first commit to 1,481 in 118 at the last;
  component tests from 879 to 931, in 77 files throughout. The first eleven
  commits carry one lint warning (an unused `outsiderId` in
  `integration/security-log.test.ts`) inherited from `master`; the twelfth,
  "record household-scoped misses in the security log", removes it. Run with CI's placeholder `NEXTAUTH_SECRET` and a `.env`-less
  tree; those suites touch no database.
- **The head, whole.** `bun run verify:ci` exit 0 in 93 seconds: lint 0
  warnings and 0 errors over 493 files and 101 rules; typecheck clean;
  react-doctor no issues over 493 files; 118 links against 35 routes; 96
  contrast checks, all AAA; audit clean over 563 packages; 1,481 unit tests in
  118 files, 931 component tests in 77, 676 integration tests in 42; the build
  (Next.js 16.4.0, Turbopack) generates 36 of 36 static pages and lists 8
  Partial Prerender routes. `bun run test:e2e` **194 passed in 3.0 minutes**
  on four workers, none retried (chromium 172, Mobile Safari 12, firefox 4,
  webkit 4, seed 1, setup 1). `bash scripts/check-ci.sh` "CI lint: OK"
  (actionlint, shellcheck; zizmor 1.16.3 "No findings to report", with
  ten findings below its `regular` persona suppressed). `bun audit` at
  every level: no vulnerabilities in 563 packages. All of this on the host's
  Bun 1.4.2, one patch behind the 1.4.3 pin; the e2e and production images
  carry 1.4.3.
- **The production image** (`git archive HEAD | docker build --target
  production`): 563 MB, runs as `bun` (uid 1000) under `dumb-init`,
  `bun --version` 1.4.3, no `prisma/seed.ts` anywhere in it, the Prisma engine
  and `spa.traineddata` checksums verified. Trivy 0.69.3 as CI runs it
  (CRITICAL and HIGH, `--ignore-unfixed`): 0 vulnerabilities in Alpine 3.24.2's
  20 packages and in all 73 Node package targets. Seen in passing and not
  examined: inside it, `node --version` printed `error: Missing script to
  execute` rather than a version; nothing in the application runs `node`.
- **The release bundle, smoked** from `deploy/` with that image on a throwaway
  Compose project (published on loopback only, removed afterwards): all four
  services healthy. HTTP redirects to HTTPS and an unknown host gets 404. The
  headers are as documented, HSTS without `preload` and a fresh CSP nonce on
  every script. TLS 1.0 and 1.1, the 1.2 CBC suites and static-RSA are
  refused, while 1.2 ECDHE-GCM and 1.3 (`X25519MLKEM768`) are accepted. The
  first registration succeeds and the second gets 403. A signed-in session
  uses a `__Secure-`, `HttpOnly`, `SameSite=Lax` cookie and gets `no-store`
  answers. Cross-site and same-site POSTs get 403, logged as `access.denied`.
  Multipart, text and octet-stream bodies get 415. A batch of 100 calls
  answers, a batch of 101 gets 400, and none of 101 batched creates ran. Log
  rotation, process and memory limits, `cap_drop: ALL`, `no-new-privileges`,
  and read-only root filesystems for the app and Traefik are in place; only
  Traefik publishes ports. Valkey is capped at 160 MiB with `allkeys-lru`. Two
  limits on what this proves: ACME cannot issue for a test domain, so Traefik
  served its default certificate; and the image carries no revision label, so
  that it was built from that head is known from the build step, not from
  the image.

**Owner actions still pending.** `bun scripts/github-settings.ts check` (GET
requests only), re-run 2026-10-12 after the verification above: 11 of its 12
settings drift. They are private vulnerability reporting, immutable releases,
secret scanning and push protection, Dependabot security updates, CodeQL
default setup, the Actions allow-list with SHA pinning, approval for every
external contributor, squash-only merges, the two release-tag rulesets, and the
ruleset exclusion Dependabot needs. Dependabot alerts are on. The review's
other owner actions have no check and are listed in `docs/SECURITY_REVIEW.md`
(*Owner actions*): commit signing, an identity for agents, deleting two merged
branches, the alpha.2 notes, the LICENSE holder, and the first `rescan.yml`
run. Among them is **the audit's test account in the local development
database**. An audit verifier registered `a@b.co` there, and it was still
there on 2026-10-12, created 2026-10-11 23:14 (one read-only `SELECT`).
Agents may not write to that database, so deleting it, with whatever it
created, is the owner's.

**2026-10-12 recovering from a refused migration:** a migration that fails
leaves a failed row in `_prisma_migrations`, and every later start stops at
`P3009`. So when `normalise_user_email` refuses, renaming the account and
restarting, which is all the alpha.2 notes said, leaves the app restarting.
`docs/INSTALL.md` *A migration stops the upgrade* now gives the whole procedure,
and `docs/releases/v0.1.0-alpha.2.md` links to it; the published alpha.2 release
page keeps the old text until its body is replaced with that file. The procedure
was run as written, in a scratch Compose project from this branch's `deploy/`
bundle on empty volumes, with Traefik's ports removed. The `v0.1.0-alpha.1`
image registered `owner@example.com` and `Owner@Example.com` through
`auth.register` (both 200). Switching to the local `v0.1.0-alpha.3` image, whose
migration and Prisma path are byte-for-byte this tree's, gave one `P3018`
naming `owner@example.com (2 accounts)`, then `P3009` on each of the next three
restarts. `migrate resolve` run before fixing the data printed "marked as rolled
back", and the next start failed with `P3018` again. Then, in order, the backup
without its last line, the listing query, the rename (`UPDATE 1`), `migrate
resolve` and `up -d --wait` brought every service up healthy: `/api/health`
answered `{"status":"ok"}`, the migration was recorded finished,
`User_email_lower_key` existed and the renamed account's sessions were revoked.
The production image of this tree was not rebuilt for this.

**2026-10-12 Bun base by digest:** the Dockerfile names its base
`oven/bun:1.4.3-alpine@sha256:629e1741…`, the index digest
`docker buildx imagetools inspect oven/bun:1.4.3-alpine` printed that day (it
lists amd64 and arm64), so a re-pushed tag no longer changes what a release
builds. `src/__tests__/unit/image-posture.test.ts` requires
`@sha256:<64 hex>` on the base; dropping, truncating or changing the digest's
algorithm each turned it red (1 fail, 18 pass across it and
`bun-version.test.ts`). The pinned reference, run with `--network none`, reports
Bun 1.4.3 with `node` resolving to `/usr/local/bin/bun` and no npm; the full
production image builds from the tracked files and reports the same, as `bun`.

**2026-10-12 Bun 1.4.3:** `.bun-version` and the Dockerfile's base move
together from 1.4.0 to 1.4.3 (`oven/bun:1.4.3-alpine`, index digest
`sha256:629e1741…`, built 2026-10-10), for the security section of its release
notes: TLS host-name matching (CVE-2026-48618), certificate checks on reused TLS
sessions and pooled `fetch()` connections, and stricter HTTP/1.1 parsing in
`Bun.serve`. Taken two days after release, deliberately. In the 1.4.3
development image `bun install --frozen-lockfile` installs 452 packages, and a
plain `bun install` reports "no changes" and leaves `bun.lock` byte-identical at
lockfileVersion 2. In that image the quality gates pass (lint 0 errors and the
existing warning, typecheck, react-doctor, 96 contrast checks, 115 links) and so
do 922 unit, 879 component and 598 integration tests. These counts, and the
e2e run below, were measured on the lane's tree — `master` plus this change —
not on the security branch it landed on, which by then had more tests; the
branch's own are in the gate table. On the host with the 1.4.3
binary, `bun run verify:ci` passes in 178 seconds (audit clean across 564
packages, the same three counts, the build with 8 Partial Prerender routes), and
`bun run test:e2e` passes **181/181 in 2.9 minutes**. The production image, built
from `git archive` of the tree, reports `bun --version` 1.4.3 with `node`
resolving to `/usr/local/bin/bun` and no npm; run read-only against a test
database it finds no pending migrations and answers `/api/health`
`{"status":"ok"}` and `/login`, `/register` and `/` with 200, `bun server.js`
under `dumb-init`. Both versions keep `x_forwarded_for`, `x.forwarded.for` and
`x-real_ip` as distinct header names and answer 400 to a request carrying both
`Transfer-Encoding` and `Content-Length`. TEST-5's reproduction failed 0 of 80
on each of 1.4.0 and 1.4.3, interleaved under load — the reproduction no longer
separates them — and RUNTIME-1's `curl` reproduction gives 0 on both; split at
the Next.js move it gives 10 of 10 on 16.3.8 under either Bun and 0 on 16.4.0,
so the framework upgrade is where it stops (why has not been read). `ISSUES.md`
has both measurements. A host Bun older than the pin now fails
`scripts/dev-local.sh`'s version check, as designed: this machine's 1.4.2 does.

**2026-10-12 image provenance:** the repository is public (`gh api
repos/NGarate/stoky` answers `"private":false`) and already was for the
`v0.1.0-alpha.3` tag run, whose `private == false` steps in `ci.yml` ran: its
Trivy SARIF reached code scanning (`gh api
repos/NGarate/stoky/code-scanning/analyses`, category `trivy`,
`refs/tags/v0.1.0-alpha.3`) and its image is attested. With gh 2.102.0 the
command `SECURITY.md` documents, `gh attestation verify
oci://ghcr.io/ngarate/stoky:<tag> --repo NGarate/stoky --signer-workflow
NGarate/stoky/.github/workflows/ci.yml --source-ref refs/tags/<tag>`, exits 0
for `v0.1.0-alpha.3` (digest `sha256:81ebf432…`, the same digest as
`candidate-v0.1.0-alpha.3`; signer `ci.yml@refs/tags/v0.1.0-alpha.3`, run
38178388250). It exits 1 for `v0.1.0-alpha.2` and `v0.1.0-alpha.1`, both with
`HTTP 404: Not Found` from `repos/NGarate/stoky/attestations/sha256:8474120a…`
and `…/sha256:54f375ae…`: they were built while the repository was private. The
alpha.3 image with `--source-ref refs/heads/master` exits 1 (`expected
SourceRepositoryRef to be refs/heads/master, got refs/tags/v0.1.0-alpha.3`), and
with `--signer-workflow` naming another workflow file it exits 1 as well, so both
pins are checks that can fail; `latest` with `refs/heads/master` exits 0.
Without a signed-in GitHub CLI the command exits 4 at `gh auth login` before
checking anything, which is why `SECURITY.md` keeps it optional and the
account-free install path relies on `SHA256SUMS`.

**2026-10-11 third-alpha preparation:** `v0.1.0-alpha.3` changes installation,
not the application: `git diff v0.1.0-alpha.2` touches no file under `src/`
outside tests, nor `prisma/`, the `Dockerfile`, dependencies, or the Compose and
Traefik files. The repository and `ghcr.io/ngarate/stoky` are public; with no
saved credentials the alpha.2 image pulled by its verified digest, and the
guide's install-script path ran in an empty directory through `docker compose
pull` of all four images. `deploy/install.sh` is now a release asset listed in
`SHA256SUMS`; `release-assets.sh v0.1.0-alpha.3` packaged it with its guide links
and `DEFAULT_VERSION` pinned, and the packaged script, verified with the guide's
`grep … | sha256sum -c` line, installed from the packaged files. `bun run
verify:ci` passes in 114 seconds (897 unit, 879 component, 598 integration, build);
`bash scripts/check-ci.sh` passes; `bun run test:e2e` passes **177/177 in 2.9
minutes**. The production image was not rebuilt locally: its source is the tree
the alpha.2 entry below tested, and the tag's CI smoke runs the published one.

**2026-10-11 second-alpha preparation:** `v0.1.0-alpha.2` ships the 2026-10-05
project review, the 2026-10-06 UI alignment, the installable PWA and the scoped
checks. The one new migration, `normalise_user_email`, refuses to run while two
accounts differ only by letter case. The release notes as published said only to
rename an account and start again, which still fails (2026-10-12, *recovering
from a refused migration*). The shipped bundle (`deploy/`, unmodified but for a
loopback-ports override, because Tailscale holds TCP 443 on the test host) was started on fresh
volumes with an image built by `git archive master | docker build --target
production` from `6007533` — the application tree of this release, since the
later commits change only scripts, tests and documents. Migrations applied;
HTTP redirected to HTTPS; an unknown `Host` got 404; HSTS, `nosniff` and
`X-Frame-Options: DENY` arrived; `/register` and `/login` answered 200;
`auth.register` created an account and household that survived
`docker compose down` and `up`; the app ran as UID 1000 with a read-only root
and a writable uploads volume. **Found:** a `traefik.yml` copied under
`umask 077` is `0600`, which Traefik (root, all capabilities dropped) cannot
read, so it serves `404 page not found` everywhere while every container is
healthy. `chmod 644` fixed it; `docs/INSTALL.md` now says so. Let's Encrypt
issuance was not exercised.

`bun run verify:ci` passes in 104 seconds: 881 unit, 879 component and 598
integration tests plus the production build. `bash scripts/check-ci.sh` passes.
`bun run test:e2e` passes **177/177 in 2.9 minutes** across Chromium, Firefox
and WebKit (2026-10-11).

**2026-09-25 first-alpha preparation:** `v0.1.0-alpha.1` adds a standalone
release bundle (`deploy/docker-compose.yml`, `example.env`, `traefik.yml`). It
pulls an exact app image and derives database/cache/auth URLs from four required
operator settings. The fixed project name `stoky-release` avoids the development
project's volumes. Traefik uses a read-only file provider, no Docker socket, and
is the only service publishing ports. Inline Compose config was rejected after a
real start failed on read-only Traefik; the third downloadable file fixes it.
The installation guide then included private-repository/package authentication
(gone since alpha.3, when the repository and package became public),
backup/restore, upgrades and rollback limitations.

`bun run verify:ci` passes in 65 seconds: 713 unit, 658 component and 549
integration tests plus the production build (2026-09-25).

The local Compose test used isolated projects, loopback ports and a test
certificate: routing, redirect, registration/login, service health and restored
household/upload persistence passed. **Public DNS and Let's Encrypt issuance were
not exercised**; operators must check their actual HTTPS hostname. This alpha
supports Linux amd64 and trusted testers; its registration is open to anyone.
`master` closes registration after the first account unless `STOKY_REGISTRATION`
opens it (SECURITY.md); no release carries that yet. The release
workflow scans the published image by its pushed digest with Trivy (since
2026-10-12; no tag has run it yet) and runs it on a fresh database before
creating a draft; the maintainer publishes the reviewed prerelease afterward.
The draft's Compose file names that digest beside the tag (since 2026-10-12, no
tag has run it yet): packaged locally with the alpha.3 digest, `docker compose
config --images` of it prints `ghcr.io/ngarate/stoky:v0.1.0-alpha.3@sha256:81ebf432…`
and `pull app` succeeds; with `STOKY_VERSION=v0.1.0-alpha.1` it pulls the same
digest, and with one hex digit of the digest changed it fails with `not found`.
The newest published release's images are re-scanned every Monday by
`rescan.yml` with the same scanner and gate (since 2026-10-12; it has not run on
GitHub yet). Run by hand that day against `v0.1.0-alpha.3`'s images, the gate
was clean for the application, Valkey and PostgreSQL (gosu left out, measured
unreachable) and red for `traefik:v3.7.13` with four HIGH Go advisories that
`v3.7.14` also carries ([Releasing](RELEASING.md#after-publication-weekly-re-scans)).

`bun audit --audit-level moderate` reports no vulnerabilities across 564 packages (2026-10-08).
Trivy 0.69.3 (the CI version), with a fresh 2026-09-25 database, scans the Bun-only
production image with zero fixable HIGH/CRITICAL findings. The image was exported
and scanned read-only, without exposing the Docker socket to the scanner.
`bash scripts/check-ci.sh` passes with actionlint and shellcheck. The unit tests
for deployment and packaging pass, with deliberate mutations proving the guards.


**2026-09-25 Bun-only image:** every application Docker stage now derives from
`oven/bun:1.4.0-alpine`; build, migration and serving commands explicitly select
Bun. The upstream `node` compatibility symlink resolves to `/usr/local/bin/bun`,
verified inside the production image; no separate Node.js, npm or npx is present.
The Prisma CLI is copied with its dependency graph from the frozen installation,
including nested/scoped packages and relocatable links, rather than resolved again
with npm. Five behavioral staging tests pass on both host Bun 1.4.2 and image
Bun 1.4.0; mutations to required/optional traversal make every test fail.

`bash scripts/ci-in-image.sh quality` passes in the pinned Bun-only development
image, followed by passing unit and component suites. The original CI's seven Bash
and Git-ownership failures are fixed (ISSUES BUILD-2) and reproduced by removing
the protections. `bunx --bun playwright test` passes **154/154 in 3.3 minutes**;
`e2e/package.json` declares ES modules because Playwright's CommonJS TypeScript
loader overwrites Bun's loader. Removing the marker makes test discovery fail.

`docker build --target production -t stoky:bun-alpha-test .` succeeds. Isolated
Compose smoke/restore projects start the new image read-only with healthy
PostgreSQL and Valkey, apply/check migrations, preserve UID/GID 1000 uploads, and
serve `/api/health` with status `ok`. A test household and an upload sentinel
survive a dump/archive restore into separate empty volumes. A real Tesseract worker
recognizes `TOTAL 12.34 EUR` with `--network none --read-only --tmpfs /tmp`, using
only the bundled Spanish model. This tests packaging/runtime, not OCR accuracy on
household receipts. Browser registration reaches the authenticated dashboard.


**2026-09-12 stock integrity (INV-3):** `bun run verify:ci` passes: 695 unit,
658 component and 549 integration tests, plus the production build (79 seconds).
`bunx playwright test` passes all 154 tests in 2.8 minutes across the configured
Chromium, Firefox and WebKit projects. The first browser run lacked Firefox and
WebKit; the successful run used `PLAYWRIGHT_BROWSERS_PATH=/tmp/stoky-playwright-browsers`
and `LD_LIBRARY_PATH=/tmp/stoky-webkit-deps/usr/lib/x86_64-linux-gnu`. See
`VERIFICATION_SEQUENCE.md`, where `bun run test:e2e` has since replaced that
temporary setup (2026-10-09).

The regression follows the product list's “Ajustar” link and checks two separate
kitchen uses, a reload and the persisted ledger. Unknown batch amounts stay
unknown, unprovided locations and expiry dates stay absent, and dozens convert
exactly to individual units. Mutation checks fail when those protections are
removed. Physical stock after earlier mistaken uses still requires a recount.


**2026-09-08 authenticated navigation:** reproduced the Instant overlay after
login to `/dashboard`, then removed it by declaring `instant = false` on
`src/app/(dashboard)/layout.tsx`. The root layout's declaration did not exempt
this separate shared-layout boundary. A Chromium login probe now reports no
console errors, and the strengthened `e2e/auth.prod.spec.ts` sign-in test passes
against `next dev`. Setting the authenticated layout to `instant = true`
makes that test fail with the reported error. On 2026-09-12, mutation exposed
a timing gap: `networkidle` returned before Next reported the diagnostic over
HMR. A five-second observation window after rendering makes the assertion
catch that delayed error; restoring `instant = false` returns the same dev
test to green (2 passed including seed). A separate Chromium probe also
passed dashboard → inventory → products → dashboard and a dashboard reload.
The root provider, CSP nonce, authentication checks and client data fetching
are unchanged. The original full Playwright run passed 133 tests; 20 could
not launch
without the host's Firefox and WebKit binaries. Revalidated on 2026-09-12:
`bun run verify:ci` passes in 72 seconds with 694 unit, 653 component and
540 integration tests, followed by the production build. TEST-7 is fixed
separately below. The full browser matrix now passes **153 / 153 in 2.7 minutes**
with the pinned Firefox 1538 and WebKit 2336 extracted under `/tmp`, alongside
Chromium 1234. WebKit's missing host libraries were also downloaded and
extracted under `/tmp`; no system packages were installed. The run set
`PLAYWRIGHT_BROWSERS_PATH=/tmp/stoky-browsers` and
`LD_LIBRARY_PATH=/tmp/stoky-webkit-libs/root/usr/lib/x86_64-linux-gnu`. After
strengthening the diagnostic observation window, `bunx playwright test
e2e/auth.prod.spec.ts` also passes all six tests (including seed and setup)
in 27.9 seconds against the rebuilt production artefact.

**2026-09-08 host bootstrap repair (Bun 1.4.2):** restored dependencies with
`bun install --frozen-lockfile --force`, regenerated Prisma, and restarted
`bun run dev`. HTTP probes changed `/login` from 500 to 200; `/register`
returns 200 and `/` returns 307. `dev:setup` now checks the locked installation
even when `node_modules` exists and replaces a pnpm tree's retained symlinks.
See `LOCAL_BOOTSTRAP.md` for recovery. The original verification stopped at
the component-isolation failure TEST-7,
now fixed separately. The five setup regression tests all fail against the
original script. Revalidated independently on 2026-09-12: `bun run verify:ci`
passes in 75 seconds with 694 unit, 653 component and 540 integration tests,
plus the production build.

**2026-09-12 component isolation repair (Bun 1.4.2):** `bun run verify:ci`
passes in 83 seconds: 689 unit, 653 component and 540 integration tests,
followed by a successful production build (35 routes, eight partial prerenders).
Removing two process-wide ProductRating mocks closes ISSUES.md TEST-7; the
unchanged rating tests fail before removal and pass afterwards. This run
isolates the test repair from the pending bootstrap and navigation changes.

Measured on 2026-08-17/18 against a live PostgreSQL and Valkey — at
`443718d` after Phase 6, the CI campaign and the browser suite's move to the
production artefact, and re-measured at `70386ea`, Phase 8's closing commit.
The four suite rows were re-measured **2026-08-27** on this machine: 650 / 611
/ 494, and the browser suite 148 pass / 0 fail against a Bun-served standalone
build. The unit tier grew 30 tests and 5 files that day — the sharp import
guard, the JPEG marker walker, the EXIF writer, the PNG builder and the upload
body limit.

The same three suites were also run **inside the development image** the day
they moved there (`defd147`, at 609 / 611 / 486 — fewer, because the commits
that added `bun-version.test.ts` and `devcontainer.test.ts` came after). That
is what `scripts/ci-in-image.sh` does and what CI's `quality` and `test` jobs
now call. One caveat that only in-image running exposes: the host's own `bun`
is whatever the developer installed — 1.3.14 here — while `.bun-version` and
the image say 1.4.0. `bun-version.test.ts` compares the two files, not the
binary you happen to be holding.

| Gate | Command | Result |
|---|---|---|
| Lint | `bun run lint` | ✅ 0 errors, 0 warnings — 493 files, 101 rules (2026-10-12, security branch head) |
| Typecheck | `bun run typecheck` | ✅ clean |
| React | `bun run check:react` | ✅ 0 errors (react-doctor 0.9.11, gates on errors) |
| Internal links | `bun run check:links` | ✅ 118 links against 35 routes, none broken (2026-10-12, security branch head) |
| Contrast | `bun run check:contrast` | ✅ 96 checks over 37 tokens × 2 themes, all AAA (2026-10-12, security branch head) |
| Unit tests | `bun run test:unit` | ✅ 1,483 pass / 118 files (2026-10-12, security branch head, host Bun 1.4.2: the final verification's 1,481 plus the two `ledger-shas` tests the review's record added) |
| Component tests | `bun run test:components` | ✅ 931 pass / 77 files (2026-10-12, security branch head, host Bun 1.4.2) |
| Integration tests | `bun run test:integration` | ✅ 676 pass / 42 files (2026-10-12, security branch head, host Bun 1.4.2) |
| Build | `bun run build` | ✅ **35 routes, 8 of them Partial Prerender** since Cache Components landed 2026-08-25 (`2b6eba5`) — 9 was a miscount, see below. Re-confirmed 2026-08-28 at `f643550` on a Bun-installed tree, which also re-proved the count: a naive grep answers 9 there too, and the ninth is still the legend line. 45.8s cold was the 2026-08-11 measurement with the React Compiler on (39.8 off); ~10s warm. Not re-measured cold: a cold build deletes state a running dev server shares |
| Migration | `bunx --bun prisma migrate deploy` | ✅ all committed migrations on fresh databases; production image also starts against a restored backup (2026-09-25) |
| Seed | `bun run db:seed` | ✅ idempotent across re-runs |
| E2E | `bun run test:e2e` | ✅ 194 pass / 0 fail in 3.0 minutes (2026-10-12, security branch head), in `mcr.microsoft.com/playwright:v1.62.1-noble` with Bun 1.4.3 (`scripts/e2e-in-image.sh`) — Chromium, Firefox, WebKit and Mobile Safari from the image, nothing installed on the host. On 2026-10-09 a host `bunx --bun playwright test` reported 21 failures, 20 of them `Executable doesn't exist` |
| Dependency audit | `bun audit --audit-level moderate` | ✅ no vulnerabilities across 563 packages (2026-10-12, security branch head) |

**Nothing enforces the installer version any more.** corepack left with pnpm,
and `setup-bun` pins only the copy CI runs, so on a developer's own machine the
single check is `scripts/dev-local.sh` comparing `bun --version` against
`.bun-version` before it installs. It earns its place because bun is quiet in
the direction that matters: `bun.lock` is lockfileVersion 2, written by 1.4.0
and left byte-identical by a plain `bun install` under 1.4.3, and an older bun
prints "Unknown lockfile version", then "Ignoring lockfile", and resolves an
unpinned tree nobody reviewed. Only `--frozen-lockfile` turns that into an
error. Local development therefore wants bun at or above the pinned version, or
the development image.

`bun run verify:local` runs the first seven — **56s** of a **600s budget**
(2026-08-28, on a Bun-installed tree; it was 33s under pnpm with roughly 200
fewer tests, so this is not a cost the package manager introduced). The script
enforces the budget, and every step has its own ceiling, so a hang fails as a
hang rather than as a long wait. `verify:ci` adds integration and build, and
ran in 83–92s across three invocations on 2026-08-17/18 — not re-measured,
because its build step needs a tree without the uncommitted `next.config.ts`
work in it.

**Ten minutes is the contract for all verification**, not just the browser
suite. Every CI test job is capped at ten; Playwright's own `globalTimeout` is
nine, so it fails first and names the test it was sitting on instead of the
runner killing the job with no report. The budget exists because verification
that takes longer stops being run, and a suite nobody runs still has to be
maintained while telling nobody anything.

### The production image, run rather than inspected

**2026-08-28, at `e9bca55`, after the move to Bun as the package manager.** The
build gate says the artefact compiles and the Dockerfile's own assertions say
three OCR paths exist. Neither says it runs, and the defect this project has
actually shipped — OCR-2 — was a `Cannot find module` that only appeared when a
deployed household scanned a receipt. So the container was started:

| Asked | Answer |
|---|---|
| `require("tesseract.js")` and spawn a worker, inside the image | both succeed — the computed 13-package closure resolves through the worker's own `require` chain, which is the thing OCR-2 broke |
| `/api/health` | 200 `{"status":"ok"}` |
| `/login`, `/register` | 200, 78 KB and 80 KB of HTML |
| Docker's own health check | `healthy` |
| `Cannot find module`, `AbortError`, refusal to start, in the log | none |

Two traps this run walked into, both the probe rather than the image. **Docker
Desktop puts `--network host` in its VM**, so a `curl` from the machine gets
`000` while the container's own health check passes — the container is right and
the probe cannot reach it. And **the first run refused to start**, correctly:
`.env` carries the published `NEXTAUTH_SECRET` from `.env.example`, which
`src/lib/auth/secret.ts` allows in development on purpose and refuses in
production. The image sets `NODE_ENV=production`, so it refused; a generated
secret is what the table above was measured with.

### Cache Components, and what was proven about the image

Landed 2026-08-25 (`2b6eba5`), both flags: `cacheComponents` for
dynamic-by-default rendering with Partial Prerendering, and `partialPrefetching`
for one prefetched shell per route rather than one request per link. The
measurements, the migration and the owner's decision on the CSP nonce are in
`docs/superpowers/plans/2026-08-25-cache-components-and-instant-navigation.md`.

**The root layout blocks on purpose** (`instant = false`), because it reads the
per-request CSP nonce and a nonce that survives prerendering is not a nonce.
That trade was decided rather than deferred; the reasoning is beside the export.

**Eight routes are Partial Prerender, not nine.** Both this file and the plan
said nine, and the plan's own list gave it away: it enumerated prices,
products ×4, receipts ×2 and shopping, which is eight. The ninth was the
legend line — `◐  (Partial Prerender)` — counted as a route by whatever grep
produced the number. Re-counted from the build output on 2026-08-27.

**`partialPrefetching` also has a cost, and it is recorded rather than
implied.** Under Bun, each completed router prefetch raises one unhandled
`AbortError` — roughly ten per page load, in the only monitoring this project
has. Node raises none on the identical artefact, so it is an interop defect
this configuration exposes. The owner chose to keep the feature on 2026-08-27;
`ISSUES.md` RUNTIME-1 has the one-line reproduction and stays open for the
upstream report.

**The production image was built and run under the flags on 2026-08-26**,
because CI never did: the image jobs were skipped on the green commit (docs
only) and cancelled on the flags commit, so nothing had exercised
`output: "standalone"` with `cacheComponents` until this was done by hand.

| Check | Result |
|---|---|
| `docker build --target production` | ✅ builds |
| Container boots against Postgres and Valkey | ✅ migrations applied, ready |
| `/api/health` twice | ✅ `200 {"status":"ok"}`, 17–24 ms |
| `/api/health` with Valkey stopped | ✅ `503 {"status":"degraded"}` |
| `/api/health` after Valkey restarts | ✅ `200 {"status":"ok"}` |

That last pair is the point rather than a formality. `/api/health` used to state
its own contract with `dynamic = "force-dynamic"` and `revalidate = 0`, both of
which Cache Components refuses outright; removing them relies on
dynamic-by-default being real. A cached health check would have gone on saying
"ok" while the cache was down, and the container would have looked healthy while
it was not. It reports the outage and recovers, so the guarantee survived the
change — measured rather than assumed.

### The pipeline

Reshaped on 2026-08-12. Measured on runs `31567346179` (the old shape, with
every other change already in), `31568215727` and `31570504804` (the new one),
so the numbers differ in the reshape and nothing else.

| | Old | New |
|---|---|---|
| Green push → published image | **902s (15m02s)** | **628s** measured, ~530s when `e2e` runs at its usual pace |
| When the image build starts | after the slowest test | with the tests |
| Building and scanning | part of one 411s job | 428s cold, **233s** on a warm layer cache |
| Publishing the image | — | **44s / 51s**, from that cache |

The remaining wall clock is `e2e` and almost nothing else: on run
`31570504804` it took 572s of a 628s run, and everything except the 51s publish
finished inside it. That is why the section below matters more than any further
work on the image jobs.

Re-measured 2026-08-18 on run `32075663881`, the first green run with the
standalone-artefact suite: green push → published image **627s** — e2e 563s
(of which 157s is the post-step pnpm-cache save, and only 313s is Playwright),
image build 195s warm beside it, publish 59s. The verification inside `e2e`
got faster; the job's tail grew a cache save — `~/.bun/install/cache` through
`actions/cache` since the migration, because `setup-node`'s `cache: pnpm` left
with pnpm and `setup-bun` caches the executable rather than the tree. That
tail came to matter on 2026-10-06 and the cache is gone: after a lockfile
change its save pushed `e2e` past ten minutes with every test passed, and a
cancelled job never saves, so it repeated on every run. Measured, it was not
paying for itself either — a 23s restore plus a 12s install, against 11s for
the uncached install `quality` does.

`e2e` no longer installs browsers — it runs in `mcr.microsoft.com/playwright`,
pinned and asserted against `package.json` — which took its setup from 106–193s
to 84–97s. Three things the image does not carry had to be added back: `unzip`,
because setup-bun unpacks a .zip and the seed runs through Bun; `HOME=/root`,
because a container job runs as root while the image owns `/github/home` as
`pwuser` and Firefox refuses to start there; and the services answer to
`postgres` and `cache` rather than `localhost`, because the job now shares a
network with them instead of a host.

The build gated nothing but the publish, yet waited for every test: on run
`31567346179` the image job started at 05:49:08 and end-to-end had finished at
05:49:05. It is now two jobs. `image-build` declares no `needs`, so it runs
beside the tests, and it holds neither `packages: write` nor a push step — a
run whose tests fail can waste a build but cannot ship one. `image-publish`
waits for all four test jobs plus the build and rebuilds the same commit from
the layer cache the first job wrote, which is why it costs 44 seconds rather
than a second build. On a tag it no longer does: since 2026-10-12 a
release's publish build reads no cache (RELEASING.md, *Verification
boundaries*), so it pays a cold build — 428s for the build-and-scan job above;
not yet measured on a tag's publish — and its limit is 30 minutes, not 10.

`changes` decides whether the push could have altered the image at all — **5
seconds**, an explicit diff against `github.event.before` rather than
`paths-ignore`, because `paths-ignore` would skip the *tests* too and master
stays verified on every push. A push touching only `docs/**` or `*.md` skips
both image jobs; anything else builds, as does every case the diff cannot
resolve (a force push, a `workflow_dispatch`, a before-commit that no longer
exists). The decision function was checked against real ranges in this history
and ten representative paths before it shipped.

**2026-10-05:** the base is now the head of the last *successful* run on master
(`gh run list --status success`), not `github.event.before`. Diffing against the
previous push lost images: a code push whose run was cancelled by a following
docs-only push, or failed before it, never got one. Not yet exercised on GitHub;
an API failure or a non-ancestor base still answers "build".

The gate had one bug worth keeping visible, because it failed silently rather
than loudly. `changes` originally *fetched* the before-commit, and the same
push stopped every checkout persisting the workflow token — on a private
repository that cannot authenticate, so the fetch died with "could not read
Username". The fallback answered "build", which is the safe direction and shipped
nothing wrong, but it meant the gate would have skipped nothing, ever, while
appearing to work. It clones the full history instead now, so the diff is local
and needs no credential. A gate whose failure mode is "does nothing quietly" has
to be watched being exercised, which is what the docs-only push is for.

**2026-10-12: a run that can publish is no longer cancelled.** The concurrency
group used to cancel every superseded run. On master, a cancel can land inside
`image-publish` after `Push` has moved `latest` and `sha-<commit>` but before
`Attest provenance` runs, which leaves a published image with no signed
provenance. Run `38159258844` was cancelled four seconds into `Push`. GHCR
answers 404 for its `sha-` tag, so that run pushed nothing, and no unattested
image has been found. The window is the last seconds of `Push` plus the 6–7s of
attestation. `cancel-in-progress` is now `github.event_name == 'pull_request'`,
so a superseded pull-request run is still cancelled and no run in a group that
`image-publish` uses is: a master or tag push, and a `workflow_dispatch` on any
ref, because it is the arriving run's condition that cancels the running one.
The cost is that a newer run on the same ref waits for the running one instead
of replacing it. GitHub keeps one pending run per group and replaces it with
the newest, so a burst of pushes still collapses to two runs, but trunk feedback
can lag by one run. The other proposed fix, a job-level group on
`image-publish`, would not work: the workflow-level cancel takes every job in
the run. `src/__tests__/unit/ci-workflow.test.ts` evaluates both conditions and
the group for every trigger the workflow declares. Not yet exercised on GitHub.

**2026-10-12: only a push publishes.** `image-publish` ran for every event but a
pull request, and a `workflow_dispatch` selects any ref, so dispatching a
feature branch "to see if it builds" would have pushed its unreviewed commit to
the public registry as `sha-<commit>`, with an attestation that `--repo` alone
accepts. No branch dispatch has run: the API lists one dispatch ever, on master
on 2026-08-12, and it failed. The job is now `if: github.event_name == 'push'`,
and `on.push` admits only `master` and `v*` tags; a dispatch, on any ref,
verifies and publishes nothing, and a failed publish is retried by re-running
the push's run. This stops an accident, not a writer: a dispatch runs the
workflow file of the ref it selects, so a branch can edit the condition away. A
deployment-branch policy on a GitHub environment is the control a branch cannot
edit; none exists, and creating one is the owner's call. The same test file
evaluates the condition for every trigger. A dispatch on master now succeeds
without publishing, so `changes` takes its base from successful *push* runs only
(`gh run list --event push`); otherwise that dispatch's commit would become the
base, and a docs-only push after it, or a re-run of the failed push, would skip
the image. The filter also drops a fork's pull request from its own `master`,
which the API lists under that branch name (pull-request runs report their head
branch, as this repository's `build/scoped-checks-2026-10-11` run does). A
dispatch also has a concurrency group of its own (`CI-dispatch-<ref>`): the
newest run to arrive in a group replaces the pending one whatever
`cancel-in-progress` says, so a dispatch on master sharing the pushes' group
would cancel a pending push and leave its commit unpublished. Not yet
exercised on GitHub.

**The pipeline lints itself.** `bash scripts/check-ci.sh` runs actionlint
over the workflow and shellcheck over `scripts/*.sh`, and runs as the first step
of the `quality` job. Both come from `rhysd/actionlint:1.7.12` pinned by its
multi-platform index digest, which bundles shellcheck 0.11.0, so neither is
installed on the host (2026-10-11). Without Docker, or with
`CHECK_CI_TOOLS=binary`, it falls back to the actionlint binary checked against
a SHA-256, like the Dockerfile's tessdata fetch, and a system shellcheck. It exists because a workflow bug has no suite to fail: it
surfaces as a red run on a trunk with no PR gate, which is what most of this
repository's red runs actually were. Verified able to fail in both halves —
an injected `SC2168` and an `env` context in `runs-on:` were each caught, then
reverted.

**…and audits it for security** (2026-10-12). The same script runs zizmor
1.16.3 over `.github/` — both workflows and `dependabot.yml` — from
`ghcr.io/zizmorcore/zizmor` pinned by index digest, `--offline` and with no
network, the `regular` persona, failing on any finding at any severity; the
binary fallback checks the release asset against GitHub's recorded SHA-256.
Its first run found two `cache-poisoning` findings: `e2e` and `audit` restored
Bun from setup-bun's cache on a tag. Both now download it, so no step of
`ci.yml` uses that cache. Verified able to fail on scratch copies: a
`${{ github.event.pull_request.title }}` in a `run:` step (template injection,
exit 14), the pre-fix `ci.yml` (exit 14), a Dependabot entry without its
cooldown (four medium findings, exit 13) and an unparseable workflow (exit 1,
which without `--strict-collection` was a skipped file and exit 0). The
`auditor` persona is not the gate; what it adds is in SECURITY.md, Known gaps.

**Bun is pinned** in `.bun-version` (**1.4.3** since 2026-10-12; 1.4.0 from
2026-08-26, 1.3.14 before), read by CI through `bun-version-file` where `setup-bun` still runs.
The Dockerfile names the same version by tag and by index digest (since
2026-10-12), so moving the version moves the digest too.
Unpinned, `setup-bun` resolved to whatever had shipped most recently, so a Bun
release could turn the trunk red with nothing to revert; the pin made the
version reviewable.

The pin now has a second job, and a test enforcing it. Bun is the **runtime**
as of `b81102d`, so the Dockerfile installs its own copy, and for a day the two
numbers disagreed — CI proving the suites passed on a runtime nobody deployed.
`src/__tests__/unit/bun-version.test.ts` compares `.bun-version` against the
Dockerfile's tag and fails if they drift, in the same shape as the Playwright
pin's assertion. That closed `ISSUES.md` BUILD-1, **in the direction that
entry recommended against** — read it before moving the number again; the
concern was TEST-5's rate under 1.4.0, which the alignment does not address.

No job in the pipeline pushes via git, so no checkout persists the workflow
token any more.

### End-to-end

**The suite changed shape on 2026-08-17, for three reasons that all bit the
same day.** It had always run against `pnpm dev` on the developer's own
database. That meant: it tested a server nobody deploys (which is how broken
production auth once shipped under green suites); it fought the developer's
own `pnpm dev` for Next's per-directory single-instance lock (a mid-run suite
lost its server to exactly that); and its re-seed reset the demo household the
owner was actively testing with — their words: not acceptable.

Now it builds and serves the **standalone production artefact** (the thing the
Docker image runs) on its **own database and cache** — `stoky_e2e` and Valkey
db 1, derived in `e2e/db-url.ts` — on `127.0.0.1:3100` by default. The
developer's dev server and data are out of reach by construction, proven by
the owner's live session surviving three full runs untouched. The separate
production config (`test:e2e:sw`) folded in with the move: its reason to exist
was the dev-server gap.

The parity paid for itself on the second run: nine WebKit-only failures turned
out to be a real product defect — the production CSP's
`upgrade-insecure-requests` upgrades every fetch to https even on localhost in
WebKit, so a Safari user on a plain-http LAN install got a rendered page whose
every tRPC call died. The directive is now keyed on the request's transport
(D84), and the suite is why anyone knows.

Ten spec files plus `seed` and `setup` projects. **117 tests in 2.9 minutes,
including the `next build`** — against 108 in 2.7–2.9 driving `next dev`
before the move: the production server serves faster than dev compiles, which
paid for the build. It was 96 after the Phase 4/5 audit, 182 in 5.6 before
that audit. The reductions are not fewer checks: the same checks placed in the
tier that can answer them, and the browser matrix no longer multiplying two
independent axes together.

| Project | Runs | Why |
|---|---|---|
| chromium | Everything | The reference engine |
| Mobile Safari | `dynamic-routes`, `location-picker` | WebKit at a phone width — the combination where this project's layout defects have actually appeared (UI-5, UI-6) |
| firefox | `@smoke` — 4 tests | Register, sign in, write, read Spanish |
| webkit | `@smoke` — 4 tests | As above |

**Mobile Chrome was removed.** It is Blink at 393px, and chromium already
visits every route at that width: the three a11y specs loop the viewport tiers
with `setViewportSize`, and `dynamic-routes` checks overflow at all three. It
was an engine already covered, at a width already tested.

Five picker tests moved down to the component tier, which already asserted the
same contract — keyboard navigation, Escape, tab order — against the real
component in milliseconds. The two that stayed are the two happy-dom cannot
answer: composed target size, and whether a fixed bar is painted over an option.

| Spec | What it proves | Projects |
|---|---|---|
| `critical-paths.spec.ts` | The stock journeys, login, i18n | chromium, `@smoke` elsewhere |
| `accessibility.spec.ts` | axe at WCAG AAA — 16 routes × 2 themes × 3 tiers | chromium |
| `a11y-structure.spec.ts` | Target size, heading order, landmarks | chromium |
| `a11y-aaa.spec.ts` | 1.4.8, 2.4.9, 3.3.5 and reduced motion | chromium |
| `dynamic-routes.spec.ts` | Routes with an id, found by following links | chromium, Mobile Safari |
| `location-picker.spec.ts` | Composed target size and occlusion | chromium, Mobile Safari |
| `screen-reader.spec.ts` | The accessibility tree across four journeys | chromium — the tree comes over CDP |
| `offline-shop.spec.ts` | A shop composed in aeroplane mode, applied once | chromium |
| `auth.prod.spec.ts` | The deployed artefact signs people in: `trustHost`, and the production CSP breaking nothing | chromium |
| `service-worker.prod.spec.ts` | A real worker registers, precaches, and serves offline — the one file that opts back into `serviceWorkers` | chromium |

`globalTimeout` is **5 minutes locally and 9 in CI**, and since 2026-08-17 it
covers the `next build` too, because the build runs inside Playwright's
`webServer`. Locally that still fits with room: 117 tests in 2.9 minutes,
build included.

**The CI ceiling story, which three pushes rewrote.** On 2026-08-12 the job
spent 84–193s on setup before a dev-served suite of 385–422s, and the 540s
`globalTimeout` could not fire before the 600s job ceiling — a gap this file
said wanted a product decision (raise the job to ~13 minutes) rather than a
commit. The move to the standalone artefact resolved it the other way:
**the suite got faster instead.** Measured on run `32075663881` (2026-08-18,
the first green containerised-standalone run):

| | Dev-served (2026-08-12) | Standalone (2026-08-18) |
|---|---|---|
| Setup before Playwright | 84–97s | **87s** |
| The `playwright test` step | 385–422s | **313s — 56s build + 117 tests in what Playwright reports as 5.2m** |
| Headroom under the 540s `globalTimeout` | ~120s | **~228s, build included** |
| Job total | 508–618s | 563s — of which **157s is the post-step pnpm-cache save**, not verification |

The production server serves pre-compiled pages; `next dev` compiled each
route on first hit under test traffic. That difference more than pays for the
build, which is why the same 117 tests with a build inside cost 70–110s *less*
than 108 without one. The largest non-test cost in the job is now the cache
save after the suite ends.

**Getting there cost two container-only failures**, both invisible locally
and both now guarded in `playwright.config.ts` comments: Docker exports
`HOSTNAME` as the container id and the standalone server binds it (the piped
build log showed the server ready on `http://<container-id>:3000` while the
probe spun against loopback — `HOSTNAME: "0.0.0.0"` is set explicitly now),
and `localhost` resolving to `::1` (trap 8). The webServer's stdout is piped
rather than ignored for exactly this class: the first timeout produced no
evidence at all, the second named the bind address.

Kept from the container measurements, because both were nearly got wrong: the
apt-install it replaced was 57–136s *depending on Ubuntu's mirrors*, so the
prize was variance off the critical path more than the average; and the
container briefly looked 100s slower against drifting runners until twin jobs
on the same commit measured 400s vs 405s (`31583973041`).

The two `test.skip`s that sat in `critical-paths.spec.ts`, scoped to phone
viewports "because the phone UI is Phase 4", were filed as TEST-6 rather than
deleted in passing — and closed on 2026-08-27 (`bcd1e74`): run at a phone
viewport the failures were all locators, nothing the product does, and the
spec passes 8 of 8 there now.

### Which tier answers which question

Three tiers, split by what each can actually decide rather than by habit. The
rule is that a check belongs in the cheapest tier that can answer it honestly.

| Tier | Runner | Answers |
|---|---|---|
| Static | Bun, milliseconds | Facts about source and CSS: token contrast, catalogue parity, internal links |
| Rendered | Bun + happy-dom, seconds | Facts about the DOM: names, roles, labels, ARIA wiring, and — via Tailwind's own compiler — what an element *declares* |
| Browser | Playwright, minutes | Facts about layout and interaction: contrast as painted, target size as composed, overflow, occlusion, focus, the accessibility tree |

The middle tier is newer and is where the target-size floor now lives.
`src/__tests__/setup/tailwind.ts` runs Tailwind's real compiler over the real
`globals.css` and resolves a component's class string to the CSS a browser would
apply — `h-10` to 40px, `min-h-[48px]` to 48, `text-sm` to 0.875rem over a 1.5
line height. 13 checks in under two seconds, covering every button variant
rather than a sample. Booting a browser to learn how tall a button declares
itself was never a good trade.

Its limit is the reason the third tier exists: it knows what an element
declares, not what the layout does. A parent's `overflow`, a sibling's
`flex-shrink`, a fixed bar drawn on top — the last of which is a defect this
project shipped (UI-6) — are only visible on a rendered page.

axe was measured in both: it runs under happy-dom and correctly reports
`button-name`, `heading-order`, `image-alt`, `label` and `link-name`, and
returns `color-contrast` as **incomplete** rather than passing. That is the
boundary drawn by the tool rather than by opinion.

### Traps that have made measurements wrong here

These are recorded because each one produced a confident, wrong number.

1. **The migration could not apply to a fresh database.** It built a GIN index
   with `gin_trgm_ops` without creating the `pg_trgm` extension. Masked because
   the only path anyone ran created the extensions beforehand. Fixed in the
   migration itself.
2. **Playwright silently tested a different application.** The config hardcoded
   port 3000 with `reuseExistingServer`, so it adopted whatever was listening.
   It now honours `PLAYWRIGHT_PORT`.
3. **A wedged dev server looks exactly like a hung test suite.** One at 100% CPU
   answering nothing swallowed a 30-minute run: Playwright was waiting on its
   `webServer` and had not started a single test. The tell is zero browser
   processes. Related: piping a long run through `tail` buffers everything until
   it ends, so redirect to a file instead.
4. **`pgrep -f` and `pkill -f` match your own shell.** Both have reported the
   wrong answer here more than once. `ps -eo pid,args` and an explicit PID work.
5. **A class name is not a measurement.** happy-dom has no layout engine — every
   rectangle there is 0×0 — so a component test can only assert that a class is
   present. That is how every form control in the application sat below the
   44px accessibility floor since inception. Anything geometric belongs in E2E,
   or in the CSS resolver above, which measures the declaration itself.
6. **A guard nobody has watched fire is a comment.** `verify-local.sh`'s
   per-step ceiling was written as `if ! timeout … then code=$?`, which reads
   the status of the `!` expression and is always 0 — every ceiling passed
   silently. Found by setting one to a second and watching the run succeed.
7. **An unbounded shell wait is not covered by any test timeout.** Three
   `until … sleep` loops were left spinning on this machine while the suite was
   being tuned, one for six and a half hours on a log file that was never going
   to be written. No Playwright setting could have caught them: a shell loop is
   not a test. Every wait needs its own cap.
8. **`localhost` is two addresses, and stacks disagree about which comes
   first.** The standalone server binds IPv4; WebKit's fetch resolves
   `localhost` to `::1` first on this machine, and Node's readiness probe can
   inside a CI container — so a server that is demonstrably up produces
   instant `Load failed` / connection-refused, which reads as anything except
   what it is. The suite names `127.0.0.1` everywhere now (D86). The tell was
   a 4 ms failure: nothing real fails that fast.
9. **A server that refused to start reports zero of everything.** Counting
   unhandled rejections in the standalone artefact (RUNTIME-1), four probes came
   back clean and were written up as negative results. The server had exited at
   boot: they used `.env`, whose `NEXTAUTH_SECRET` is still the example value,
   and `src/lib/auth/secret.ts` correctly refuses to start on it. Every request
   answered `000` and the log was empty because nothing had run. It produced the
   confident, wrong conclusion that the fix helped only the dev server, when the
   real before/after in production is 50 rejections against 0. **The guard was
   working; the probe never asked whether its subject was alive.** Assert a 200
   before counting anything, and treat an all-zero result from a new harness as
   a claim about the harness until proven otherwise.

   **And a 200 is not enough**, which the same investigation demonstrated a day
   later. A probe server printed `EADDRINUSE` and exited, while `curl` answered
   `200` on that port — a `next-server` left over from something else was
   holding it. The prescribed remedy above would have passed, and every count
   would have been read from a log the answering server never wrote. So the
   check is not "does the port answer" but **"did the process I started say it
   was ready"**: grep the server's own log for its ready line, and pick a port
   after confirming nothing already holds it.

   **Nor is the ready line**, which is the fourth face of the same mistake and
   the subtlest. Checking whether the `proxy` rename had kept the CSP nonce
   alive, a probe reported no nonce and no cookie — which reads exactly like the
   rename having broken it. It had not. The probe's `NEXTAUTH_SECRET` was 30
   characters against a 32-character floor, so the server bound the port,
   printed `✓ Ready`, and then refused to render every request. Ready is about
   the listener; the render is a separate thing that can fail on its own.

   The readiness loop is where it hid: `until curl -s -o /dev/null …` waits on
   curl's **exit code**, and a 500 satisfies that exactly as well as a 200 does.
   **Wait on the status**, and read it out loud:
   `until [ "$(curl -s -o /dev/null -w '%{http_code}' …)" = "200" ]`.

   Four faces now, all the same shape: a server that never booted, a port held
   by somebody else, a redirect nobody followed, and a listener that was not
   rendering. The probe has to check what it is measuring, and each time the
   check that was sufficient last time was not.
10. **Truncating a log the server still holds open does not empty it.** `: > log`
   between runs leaves the writer's file offset where it was, so the file fills
   with NUL padding and `grep` switches to binary mode and stops printing
   counts. Use a fresh filename per run; `grep -a` rescues a file already
   ruined.
11. **Green on the host proves nothing about the image, and the difference can
   be one binary.** The Dockerfile copied `/usr/local/bin/bun` and not `bunx`,
   so `scripts/ci-in-image.sh test` — which the `test` CI job runs — died at
   `sh: bunx: not found` before a single suite executed, while all three suites
   were green locally, where `bunx` is on the PATH. Building the *production*
   image proved nothing either: it needs no `bunx`. Fixed at `6202adc`; the
   general lesson is that the only evidence about a stage is running that stage.
12. **A git worktree is not a repository once it is mounted into a container.**
   Its `.git` is a file pointing at a path outside the mount, so every test that
   asks the repository about itself fails with `fatal: not a git repository` —
   two of them here, looking exactly like a broken suite. Verify the image with
   a real clone; CI checks one out, so CI never sees this.

---

## What exists

**Backend — substantially complete.** 10 tRPC routers (`auth`, `data`,
`household`, `product`, `location`, `inventory`, `receipt`, `store`, `price`,
`shopping`) merged in `src/server/trpc/router.ts`, **69 procedures** — a count
that has never held still (44 → 45 → 55 → 59 → 64 → 62 → 63 → 64 → 65 → 66 → 68 → 67 → 68 → 69: it reached 64
unrecorded while this file said 59, fell to 62 when the two dead pipeline
procedures were deleted, reached 63 with `product.resolveScan` on
2026-08-31 while this file went on saying 62 until 2026-10-12, 64 with
`auth.changePassword` on 2026-10-12, 65 with
`household.resetMemberPassword` the same day, 66 with `auth.session` at the
Better Auth switch on 2026-10-15, 68 with `auth.listSessions` and
`auth.endSessions` the same day, 67 when `auth.revokeMySessions`, which
they replace, was deleted with its button, and 68 when
`household.memberSessions` and `household.endMemberSessions` replaced
`household.revokeMemberSessions`, and 69 with
`household.endHouseholdSessions`) as phases closed
and the export router arrived. Asserting the count structurally did not stop
the drift, because nothing compared it with this sentence; since 2026-10-12
`capabilities.test.ts` does, and fails when the two disagree. 10 Zod
validation modules. 6 service modules: `ocr`, `receiptParser`,
`productMatcher`, `openFoodFacts`,
`product-cache`, `errors` — plus `src/lib/rating.ts`, the pure module behind
Phase 6.

**The rating — computed, explained, honest (Phase 6).** `computeRating`
weighs Nutri-Score 60%, additives 30% (the worst one decides its component),
organic 10% — but the honesty rules run before the arithmetic, structurally:
no Nutri-Score means "no information" rather than a number built from the
remaining 40%, and OFF's "not-applicable" means non-food is not scored. Shown
on the product detail the scan journey lands on, with what lowered it. The OFF
cache prefix is versioned (`off:product:v2:`) so month-old entries cannot be
served as complete.

**Offline — a shop works with no signal, and applies once.** Five writes carry
an idempotency envelope and go through `withReplay`, which claims the key and
applies the effect in one transaction, so "key claimed, effect missing" is
unrepresentable. Changes made without a connection go into a `zustand` store
persisted to `localStorage` through SuperJSON, are folded onto the screen so
they show as done, and drain one at a time on reconnect. A refused consumption
is not a failure but a question — see *Reconciliation* below. Proven by
`e2e/offline-shop.spec.ts`, which is the phase's done-when.

**Auth — working, on Better Auth 1.7.7 since 2026-10-15 (D135).** Real forms
post to the auth API through `src/lib/auth/client.ts`, with Argon2id hashing,
error mapping and i18n; the route in front of Better Auth
(`src/server/http/auth-handler.ts`) answers seven endpoints and applies the
limits. Two-step verification with an authenticator app is in on the server,
each code usable once (D148); only its sign-in step is reachable, and nothing
in the interface sets it up yet. Sessions are database rows: fifteen idle minutes, slid only by the
keep-alive, a day at most, and deleted to end them — or, with "Mantener la
sesión iniciada" ticked at sign-in, ninety idle days under a year (D141). Rate-limited in Valkey
since Phase 3 — 5 sign-ins per 15 minutes per address, 10 per account, 3
registrations per hour (CRITICAL-4 closed); Better Auth's own limiter is off.

**Frontend — 27 pages, and no route is linked that does not exist.** That last
part is enforced by `check:links` in CI rather than by audit; the manual version
missed a dead route three times running, twice from routes linked on every row
of a table. The five newest pages are Phase 5's: `/kitchen`, `/shopping` as
Screen A (the list manager moved to `/shopping/lists`), `/settings/people`,
and `/settings/unsaved`. `/settings/security` (2026-10-15, D143) lists a
person's sessions and ends them; `e2e/session-revocation.spec.ts` drives it
with two browsers, and `page-titles`, `a11y-structure`, `accessibility` and
`a11y-aaa` cover it like every other private route.

**Design system — one, and it is in CSS.** 37 tokens under `@theme` in
`src/app/globals.css` — this line said 26 while line 39 of this same file said
37; measured by `awk '/@theme inline/,/^}/' src/app/globals.css | grep -c --
'--'`, so the two now agree — light and dark, with a three-state
System/Light/Dark control and a language control on every surface.
`src/components/ui/` holds
`button`, `input`, `ThemeControl`, `LocaleSwitcher`, `PreferencesCluster`.
Everything else is Tailwind against the tokens — the earlier plan to install
~23 shadcn primitives was not followed, and no page has needed them.

**Navigation — three renderers by tier.** Bottom bar below `md`, rail from `md`,
top bar from `lg`, with a focus-trapped sheet for the overflow. Audited by axe
at all three tiers in both themes.

**i18n — two catalogues that cannot silently diverge.**
`src/__tests__/unit/messages.test.ts` fails on a key present in one and not the
other, on an empty value, and on an English string that is a byte-identical copy
of the Spanish. It cannot see a string that never reached a catalogue at all,
which is what I18N-5 is.

**Roles — enforced on the server, per procedure.** Four values
(`OWNER`, `ADMIN`, `MEMBER`, `KITCHEN`), three procedure tiers in
`src/server/trpc/trpc.ts`, and all 69 procedures assigned. Membership and role
are read from the database on every call rather than from the session, so a
demotion takes effect on the next request rather than whenever the session
happens to end. `src/__tests__/unit/capabilities.test.ts` checks the assignment
of every procedure against the matrix; the integration suite proves the
refusals by calling the router as a kitchen account.

**Reconciliation, not silent loss.** Stock has a floor: two people who each use
the last unit cannot both be right, and the second to reach the server is
refused. That refusal is surfaced as the question only a person can answer —
how much is actually on the shelf — and the answer is written as an
`adjustStock`. It does not interrupt: a conflict is discovered on reconnect,
possibly with the phone in a pocket, so the sync indicator carries it and the
dialog opens when the person chooses. A KITCHEN account is told who can fix it
rather than shown a control the server would refuse. `REDESIGN_PLAN.md` §5.5.3.

**Security posture.** Per-request CSP nonce in `src/proxy.ts` with
`strict-dynamic`, `worker-src` and `child-src` named explicitly, and `/sw.js`
excluded from the matcher so the page policy does not become the worker's. CI pins every action by SHA, scans the image with Trivy before
pushing it, fails on critical or high findings, and attaches an SBOM and a
provenance attestation. `SECURITY.md` documents the model for a self-hosted
deployment.

**Seed — the fixtures the dynamic routes need.** Demo household, 6 products (3
below minimum), 4 storage locations in two levels, 3 stores, 18 price records, a
shopping list, and **2 receipts** — one needing review, one confirmed. The
receipts were added on 2026-08-09; before them `/receipts` was empty on every
fresh install and in CI, so the review and applied routes were unreachable
through the interface and were audited by nobody. Login `demo@stoky.local` /
`Demo1234!`.

---

## Accessibility

The target is **WCAG 2.1 AAA**, decided as a product requirement rather than a
compliance exercise: the premise is that anyone in a household can use this,
including people with limited technical confidence.

What is measured, and by what:

| Criterion | Checked by | State |
|---|---|---|
| Contrast (1.4.6) | `check:contrast` on the tokens, axe on the rendered page | ✅ both |
| Target size (2.5.5) | `a11y-structure.spec.ts`, measured in CSS pixels | ✅ floor is 48px, above the required 44 |
| Headings, landmarks | `a11y-structure.spec.ts` | ✅ |
| Names and roles | axe, plus the tree walk in `screen-reader.spec.ts` | ✅ zero unnamed interactive nodes |
| Visual presentation (1.4.8) | `a11y-aaa.spec.ts` | ✅ ≤80 characters, ≥1.5 line spacing |
| Link purpose (2.4.9) | `a11y-aaa.spec.ts` | ✅ |
| Help (3.3.5) | `a11y-aaa.spec.ts`, form fields only | ✅ attached, not merely adjacent |
| Reduced motion (2.3.3) | `a11y-aaa.spec.ts` | ✅ |
| Reading order | `screen-reader.spec.ts`, tree order vs geometry | ✅ desktop only |
| Announcements | `screen-reader.spec.ts` | ✅ refusals and saved movements both announced — A11Y-1 closed in Phase 5, and the pinned assertion flipped |
| Reading level (3.1.5) | `src/__tests__/unit/readability.test.ts` | ✅ es 69.0 "fácil", en 66.3 |
| Timeouts (2.2.6) | `SessionKeepAlive.test.tsx`, `session.policy.test.ts`, driven in a browser | ✅ slides on activity, warns at T−2min, and says which deadline: inactivity with "Seguir conectado", or the day's limit with no button, because nothing extends it (re-measured 2026-10-15: 12 component, 13 integration, 10 unit cases) |

**Two honest limits.** Automated testing catches roughly a third of real
accessibility problems, so this is a floor that stops regressions, not a
certificate. And **the manual screen-reader pass has not happened**. Four
journeys are audited against the tree; whether the result *sounds* sensible to
someone using it is the part no tool and no agent can answer.

The procedure for the manual half — pa11y for the AAA checklist, Accessibility
Insights for the guided assessment, and what neither covers — is in
`docs/DESIGN_AUDIT.md` §5. Both were evaluated rather than assumed: pa11y at
`WCAG2AAA` returns 0 errors and 60 "Check that…" notices on `/login`, which is
a good checklist and a bad gate, so neither tool is in CI.

---

## Dependency security

`bun audit` → **no known vulnerabilities** — again. The tree was clean on
2026-08-12, **2 high** when re-measured on 2026-08-17 (the world moved while
the repository did not: nanoid <3.3.18 under postcss, GHSA-2v37-7h3g-55p8, and
deepmerge-ts <8.0.0 under @prisma/config, GHSA-ggr8-5vv4-36mx), and clean
after two more overrides the same day.

The deepmerge-ts one is the first override to **cross a major** (7 → 8),
because that is where the only fix lives. Taken deliberately and verified
rather than assumed — prisma generate, migrate deploy and the full suites all
run through 8.0.x — and it needed fixing **twice**: `@prisma/config` pins
`deepmerge-ts` at exactly 7.1.5, and the image stages its own npm-installed
prisma under `/opt/prisma` for the entrypoint's `migrate deploy`, where the
workspace override never reaches. Trivy failed the image on the copy pnpm
audit could not see; the Dockerfile's own overrides map (the one already
holding tar and undici) now carries it too. One advisory, two package
managers, two override maps — worth remembering the next time one of these
"is fixed".

The original clearing (57 → 0, 2026-08-10) changed no source; every direct
dependency stayed within its major. The overrides were scoped to the single
parent that pulled them — `recharts>lodash`, not a bare `lodash` — for as long
as pnpm was the thing resolving them.

**The overrides live in `package.json`'s `overrides` now, and they are
global rather than parent-scoped.** They had to be rewritten rather than
carried across from `pnpm-workspace.yaml`, because pnpm's `parent>child` key is
a **silent no-op** under bun: it matches no package, it warns about nothing,
and the install that looks like it worked has quietly resolved the vulnerable
version again. lodash, effect, defu, nanoid and deepmerge-ts are pinned
wherever they appear, which is wider than the advisories strictly need and the
direction an override should err in.

**2026-10-06: two more, brace-expansion and fast-uri**, after advisories
published since the 2026-09-25 measurement turned CI red. Both arrive only
through `react-doctor` (the `check:react` dev tool, not in the image):
brace-expansion <5.0.12 via eslint's minimatch (GHSA-qhr7-859c-m2p7,
GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr) and fast-uri 3.1.6 via conf's ajv
(GHSA-qw65-cvwx-89v3, GHSA-58mr-gqgx-xq4g, GHSA-hrr3-gc8f-f4qj). Each fixed
release sits inside its parent's range (`^5.0.8`, `^3.0.1`) and the tree holds
one copy of each, so neither crosses a major. The third chain, `braces` (no
fixed release exists), was removed by moving react-doctor from 0.9.11 to
0.9.17, which no longer depends on deslop-js. The same day Next.js went to
16.3.8 for GHSA-vcvr-r3jv-pc5j (critical, `next/og`). `bun audit`: no
vulnerabilities across 564 packages.

Dependabot alerts are enabled (`gh api repos/NGarate/stoky/vulnerability-alerts`
answers 204) and on 2026-10-12 none was open: all 58 it ever raised are
`fixed`. It counts one alert per advisory-path pair, so its totals do not compare
with `bun audit`'s.

Until 2026-10-12 nothing proposed an update: of the six commits that have
touched `bun.lock`, the first being the move from pnpm, four answered an
advisory. Dependabot version updates are now configured
(`.github/dependabot.yml`) for `bun.lock`, the workflows' action pins, the
Dockerfile's base and the release bundle's service images: weekly, seven days
after a release, minor and patch grouped, no PostgreSQL, Valkey or Traefik
major. **Not yet in effect:** the branch ruleset does not let Dependabot create
its branches, which no version update can open without; Dependabot security
updates are separately off. Both are owner settings, which
`bun scripts/github-settings.ts check` reports with the repository's other
security settings. No Dependabot pull request has run yet. `docs/RELEASING.md`
(Dependency updates) says how one is reviewed.

---

## Versions

Application release: **0.1.0-alpha.3**, from `package.json`.

| Package | Version |
|---|---|
| next | 16.4.0 |
| react | 19.2.8 |
| @trpc/server, @trpc/client | 11.18.0 |
| prisma, @prisma/client | 6.19.3 |
| better-auth | 1.7.7 — exact, replacing next-auth 5.0.0-beta.32 on 2026-10-15 (D135); `bun audit` clean with it, no new override |
| next-intl | 4.14.0 |
| tailwindcss | 4.3.3 |
| zod | 3.25.76 |
| bun | 1.4.3 — `.bun-version` and the Dockerfile pin (tag and index digest `sha256:629e1741…`); all application image stages use Bun. Released 2026-10-10, taken on 2026-10-12 for its TLS and HTTP fixes |
| node | No separate runtime installed in application images; upstream compatibility command resolves to Bun (2026-09-25) |
| sharp | 0.35.5, **devDependency only** — not shipped, not loaded at runtime |
| traefik | v3.7.14 — `deploy/docker-compose.yml`, the release bundle's proxy; the newest v3 release on 2026-10-12 (`gh api repos/traefik/traefik/releases`) |

**The runtime changed on 2026-08-26 and this is the row that says so.** `next
dev` and `next start` run under `bun --bun` (`b81102d`), the production image
serves with `bun server.js`, and image processing went from `sharp` to
`Bun.Image` behind `src/server/services/image.ts`. `sharp` stays installed
because the HEIC investigation in the pre-plan still needs it for comparison;
`next.config.ts` excludes it and `@img/*` from output file tracing so it cannot
reach the standalone artefact. Two consequences worth knowing before changing
anything here: the application has left Next's supported runtime, and phone
HEIC uploads are still refused — `Bun.Image` wants an OS codec Alpine does not
carry.

No known drift as of **2026-08-26** — every row re-read out of `package.json`,
`.bun-version` and the `Dockerfile` today, not eyeballed. `CLAUDE.md`'s stale claims — tRPC as a release candidate,
a `household` router that never existed, a refresh token that was never
implemented — were corrected on 2026-08-10.

**The pnpm row, which this table carried until pnpm left, had drifted for six
days, and the sentence above it said it had not.** `5289e2b` bumped the pin to
11.22.0 on 2026-08-19 while this table went on saying 11.19.0 and the paragraph
went on claiming the table had been checked against `package.json`. A drift
note is only worth the check behind it, and the check is cheap: read the
versions out of the file rather than trusting the sentence that says somebody
already did.

**This paragraph was itself wrong until 2026-08-25**, and it is worth saying
how: it claimed `CLAUDE.md` says Prisma 7.x, when that file said 6.x and always
had. A drift note that had drifted is the exact failure this file exists to
prevent, and it survived because nobody re-read the source it was describing.

**That whole class of drift is now closed at the source.** `CLAUDE.md` carries
no version numbers at all since 2026-08-27 — four of the nine claims it had
gone stale on were versions, and a file loaded into every context is the worst
place to keep a number that changes. This table is the only owner, and it is
read out of `package.json`, `.bun-version`, the `Dockerfile` and
`deploy/docker-compose.yml` rather than recalled.

---

## Known gaps, by severity

**Security**
- ~~Password policy is `min(8)` only.~~ **Closed.** Twelve characters, no
  composition rules, common-password and identity checks, and a maximum — the
  last of which was missing entirely, leaving Argon2id at 64 MB per call taking
  unbounded input on two endpoints reachable without an account.
- ~~There is no sign-out control.~~ **Built.** `/settings` ends the session,
  purges the queue and tells the worker to forget the cached shell. It asks
  before discarding unsent changes and offers to send them first.
- ~~Rate limiting is per IP only, `receipt.upload` is unthrottled, and a refusal
  carries no `Retry-After`.~~ **Closed**, one commit each. Sign-in is counted
  per account as well as per address (NIST SP 800-63B §5.2.2), on a hashed key
  so the cache is not a list of who has tried to sign in. `receipt.upload` is
  metered at 30/hour per account, counted *before* the file is decoded, so
  sending rubbish and being refused is not the cheap way in (ASVS V11.1.4). A
  429 carries `Retry-After`, read off the refusal rather than recomputed (RFC
  9110 §10.2.3); the 503 from a dead Valkey and the sign-in redirect
  deliberately do not, and SECURITY.md says why. It still **fails closed**,
  which makes Valkey a hard dependency of signing in.
- ~~An authorisation refusal is logged nowhere (OWASP ASVS V7.1.3).~~
  **Closed.** One JSON object per event on stderr, written by a tRPC middleware
  rather than by the resolvers, so a new router cannot forget to be audited.
  Only UNAUTHORIZED, FORBIDDEN and TOO_MANY_REQUESTS — logging everything would
  bury the refusals in NOT_FOUNDs. Since 2026-10-12 a NOT_FOUND from a
  household procedure is recorded as well, because another household's id is
  refused with it (SECURITY.md "Refusals are recorded").
- ~~Roles are enforced on the server per procedure, but no interface creates a
  KITCHEN account.~~ **Closed in Phase 5.** `/settings/people` lists the
  household and creates an account with a role, which is what makes `KITCHEN`
  reachable at all — it had been enforced since Phase 3 and creatable only by
  a database write ever since.

**Correctness**
- ~~`transferStock`'s availability guard is read-then-write.~~ **Closed.** Both
  halves of INV-2 now guard inside a transaction with the product row held.
- ~~The services layer still throws bare `Error`.~~ **Closed.** Three domain
  errors and a translator on the same middleware that handles Prisma's, so a
  missing row from a service reaches the client as `NOT_FOUND` — which the
  offline queue stops retrying instead of spending eight attempts on.
- ~~`openFoodFacts` caches in a process-local `Map`.~~ **Closed.** Valkey-backed
  and shared across replicas, failing *open* — the opposite of the rate limiter
  — because the fallback for an unreachable cache is to ask Open Food Facts,
  which is what a miss already means.
**Accessibility and interface**
- ~~The location picker and several wording items are still hardcoded Spanish or
  inconsistent.~~ **Closed**, I18N-2 through I18N-6, one commit each.
- ~~Assorted validation and accessibility gaps found while building
  `/inventory/add`.~~ **Closed.** The last of the eight: the stock procedures'
  inputs described a database row rather than what each one does, and
  `ProductPicker` read one page's namespace on both stock screens.

Closed since this section was written, and listed because a status file that
only ever grows is one nobody trusts: DEBT-2 (the scanner's torch), UI-9 (a
failed query rendering the empty state), TEST-4 (the low-stock badge on the
card tier), A11Y-1 (a saved stock movement announcing nothing), I18N-7 (the
hardcoded badge) and I18N-8 (both auth pages). `ISSUES.md` holds the detail;
where it disagrees with this file, it is right.

**Found while documenting, and fixed**
- ~~`product.delete` and `store.delete` fail on a foreign key and blame the
  caller.~~ **Closed** (PROD-1). Both count references first and refuse with
  CONFLICT naming them; the rule that a used product cannot be deleted is
  unchanged, and asserted.
- ~~A shopping item with neither a product nor a name is accepted.~~ **Closed**
  (SHOP-1). Exactly one of the two, whitespace not counting as a name; no
  existing row was in either state.

**Production authentication was broken, and every suite was green.**
Auth.js v5 defaults `trustHost` to false off Vercel and then refuses any request
whose Host it cannot vouch for: `/api/auth/session` answered 500 `UntrustedHost`
on a production build, so a deployed instance could not sign anybody in.
Setting `NEXTAUTH_URL` correctly does **not** help — verified against a build
whose value matched the server's own address exactly.

Nothing caught it because `next dev` does not apply the check and every suite
ran against `next dev`. (Auth.js was replaced by Better Auth on 2026-10-15,
D135; the spec now asserts Better Auth's `get-session` answers on the
production build, and that it refuses a foreign origin.) `trustHost: true` is now set, with the trade written
down (Traefik's `Host(...)` rule is what makes trusting the header safe here),
and `e2e/auth.prod.spec.ts` guards it in the one config that serves the
standalone artefact. Verified to fail without the fix.

That suite now also **signs in for real** against the production build, and
asserts no Content-Security-Policy violation reaches the console while it does.
The production policy is stricter than any other suite exercises — no
`unsafe-eval`, no websocket origins, `upgrade-insecure-requests` — and a policy
that blocks the framework's own scripts renders a login form that does nothing,
which is the same shape as the defect above. It passes: the policy does not
break the application.

**Verified end to end on 2026-08-11**, at `2b148a2`, every gate in one sequence:

| Gate | Result |
|---|---|
| `pnpm verify:ci` — lint, typecheck, react-doctor, links, contrast, unit, components, integration, build | 436 unit, 342 component, 395 integration, build ✅ |
| `bunx playwright test` | 108 passed, 3.8 min |
| `pnpm test:e2e:sw` — the standalone artefact the image runs | 5 passed |
| `pnpm lint` | 0 warnings, 0 errors |

Two things that sequence surfaced, both operational rather than defects:

- **`verify:ci` fails roughly one run in seven, on TEST-5.** It took three
  attempts to get a clean one. The failure is always the same test, always out
  of `answerFromRecord`, and it is the diagnosed bun defect below — not a
  regression. Re-run before investigating. This is the concrete cost of that
  entry: the gate `CLAUDE.md` requires before every commit is the gate it
  breaks.
- ~~**`verify:ci` stops the `db` and `cache` containers when it finishes.**~~
  **Fixed.** It now tears down only what it started: if the services were
  already running when it began, it leaves them up. Before, running the
  integration suite took a developer's services away underneath whatever they
  did next — the browser suite then failed at its `seed` step with 107 tests
  unrun, which reads as a catastrophe and is a stopped container. Both paths are
  tested.

**One intermittent failure, diagnosed and upstream**
- bun intermittently **abandons a test body at a rejecting `await`** — measured
  on 1.3.14 and again on 1.4.0: the
  `catch` beside it never runs, the test's own assertion never executes (one
  fewer `expect()` than a passing run), and the test is reported as failed with
  the error rendered at its origin. `withReplay` and its tests are both correct
  — the record it refuses matches on key, user and procedure, and differs only
  in the request hash, which is the condition it exists to refuse.
- It reproduces **only under load**: 3 failures in 24 with another suite running
  against the same database, 0 in 90 on a quiet machine. `docs/reproductions/`
  carries a self-contained file and the recipe. **TEST-5** in `ISSUES.md`
  (open alongside TEST-6 and RUNTIME-1; PRICE-1 closed on 2026-08-18), and it
  wants an upstream report rather than work here.
- **The `retry: 2` mitigation does not make CI green, and this is new.**
  Measured on run `31568215727`: the retry did its job — the test passed on
  attempt 2 and the suite reported `395 pass / 0 fail` — but bun also reported
  `1 error`, because the abandoned attempt's assertion lands after bun has moved
  on and is counted as an *unhandled error between tests*. `bun test` therefore
  exits 1 on a run where nothing failed, and the `test` job goes red. Re-running
  the job cleared it, which is the same signature and the same remedy as before.
  So the retry fixed the pass/fail tally and not the exit code, and the honest
  cost of TEST-5 is still roughly one CI run in seven — it did exactly this
  again on run `32792826678` (`e13c540`) on 2026-08-25. A pin forward was the
  documented workaround, and **it has been measured and does not work**: bun
  1.4.0 shipped on 2026-08-20 and still reproduces the defect, at a rate this
  many runs cannot tell apart from 1.3.14's. On 2026-10-12, moving to 1.4.3,
  the same recipe failed 0 in 80 on *both* 1.4.0 and 1.4.3, so it no longer
  measures the defect at all, and nothing says 1.4.3 fixed it. `ISSUES.md` TEST-5 carries the
  numbers, and the interleaving the comparison turns out to need. Narrowing the
  exit code without also hiding genuine unhandled rejections across the other
  442 tests is a judgement call that has not been made.

**Offline, honestly**
- ~~**The service worker is not exercised by any test.**~~ **Closed.**
  `pnpm test:e2e:sw` builds and serves the standalone artefact the Docker image
  runs, then drives a real worker: it registers and claims the page, `install`
  precaches `/offline`, the static cache holds real hashed chunks, a navigation
  with the network cut off is served from cache, and an uncached route gets the
  offline document. Separate from the ordinary suite because a `next build` is a
  minute the five-minute budget cannot absorb.
- **iOS Safari is unverified.** Playwright's WebKit is not iOS Safari, and §5.4
  defers installability on iOS grounds specifically. The queue, the storage and
  the worker all need a pass on a real device, and that pass must be dated here
  rather than implied by a green suite.
- The 2,500 ms navigation timeout in `public/sw.js` is a guess calibrated on
  "supermarket lie-fi", not a measurement.
- ~~Read persistence is not implemented.~~ **Built.** Seven allowlisted queries
  are kept per account in `localStorage` for 24 hours. Restoration happens
  after the first render rather than before it, so a screen opened with no
  signal shows the "nothing saved" panel for a moment before the cache
  arrives — the cost of scoping the cache to the account, which the root
  provider could not do because it has never known who is signed in.
- Cross-tab locking is absent. Two tabs draining at once is *safe* because the
  same key applies once, so it is an efficiency question rather than a
  correctness one.

**Operational**
- ~~**Receipt scanning does not work in the production image.**~~ **Closed**
  (OCR-2). The Dockerfile stages tesseract.js whole — tracing had copied three
  of its ten dependency entries, the WASM engine among the missing — with
  build-time assertions on the two files whose absence broke scanning. Verified
  air-gapped: a real upload reached NEEDS_REVIEW in under three seconds and the
  lines read back character-perfect, which also puts data behind OCR-1's
  smaller-model trade.
- ~~OCR fetches its Tesseract language data from a CDN at first use.~~
  **Closed**, and still true as far as it goes: the model is baked in, pinned
  and checksummed, and `TESSDATA_PATH` points at it. That was necessary and, as
  OCR-2 shows, not sufficient.
- ~~No error boundaries.~~ **Closed**, one inside the intl provider and one
  outside every provider.
- ~~No health-check endpoint.~~ **Closed.** `/api/health` checks Postgres and
  Valkey; the image and Compose both use it.
- ~~No PWA.~~ **Installable since 2026-10-10.** The worker had shipped for
  months with no web app manifest, icon or `<link rel="manifest">`, so no
  browser could install the app and nothing went red. `src/app/manifest.ts`,
  `public/icons/` and the iOS `apple-touch-icon` closed it.
  `pwa-manifest.test.ts` checks the install criteria and that the PNG sizes
  match their declarations. `service-worker.prod.spec.ts` checks that Chromium
  parses the manifest cleanly and loads every icon. What stays deferred on iOS
  grounds (`REDESIGN_PLAN.md` §5.4) is an install *prompt*, push and background
  sync. Measured trap: CDP's `Page.getInstallabilityErrors` answers `[]` even
  for a manifest with no icons, so it cannot be the assertion.
- ~~No data export.~~ **Closed.** `/settings` downloads the household as JSON;
  password hashes are never in it, and a test proves that by breaking the query
  that keeps them out.
- No error tracking or monitoring beyond the container's own healthcheck — and
  worth a decision rather than a ticket, since every option sends a household's
  errors to somebody else's server. (An earlier line here also said "no data
  export" — stale since the export closed above; a backup story beyond the
  JSON export is still absent.)
- Coverage is measured now, but **per tier, and the denominators differ**: each
  report counts only the files that tier loads, so the three numbers do not
  compose into a project figure and must not be added. Integration 90.2% of
  functions / 87.1% of lines; components near 100% on every component except
  `UploadZone` (83.5%); unit 70.0% / 63.4%, which is low by construction —
  it loads modules it only partly exercises on purpose (D25). No tier covers
  `src/app/**`; those routes are reached only by the browser suite.
- No visual regression coverage.
- ~~**The gates run on a toolchain nobody deploys.**~~ **Closed 2026-08-26.**
  `quality` and `test` now build the image's `development` stage and run inside
  it (`scripts/ci-in-image.sh`, wired by `defd147`), CI and the image share one
  pinned Bun (`e2a6a8e`), and `.devcontainer/` attaches the editor to the same
  container (`b5200da`). This was not hypothetical: `sharp` on the host decoded
  what `sharp` in the image could not, and an afternoon of HEIC investigation
  ran the wrong way round because of it. `e2e` stays in Microsoft's Playwright
  image, deliberately — it needs browsers, not this application's runtime. **The
  workflow wiring itself is unverified**: `actionlint` and `shellcheck` pass and
  the script was run here, but the first real pipeline run is the proof.
- **Phone HEIC uploads are still refused, and the door is narrower than it was.**
  Measured on four real files across both platforms: the bundled `sharp` binary
  carries AV1 but no `de265`, and `Bun.Image` wants an OS codec Alpine does not
  provide. Moving to `Bun.Image` closed the runtime gap and left this one open —
  the remaining route, Alpine's `vips-heif`, now means reintroducing a library
  this work just removed. It is the one question
  `docs/superpowers/plans/2026-08-25-development-in-the-image-preplan.md` leaves
  standing; nothing in that file chose a door.
- **Bun raises unhandled rejections that Node consumes** — `ISSUES.md`
  RUNTIME-1, **half closed on 2026-08-26**. It was two causes filed as one. The
  prerender chain — every route calling `auth()`, Auth.js minting a CSRF token
  with `crypto.getRandomValues()` merely to read a session — is fixed by
  `d0e7566`: `auth()` now declares that reading a session is request data, so
  Next attempts no prerender to interrupt. Measured on both servers and at no
  cost in prerendering — 13 dev-server routes go from 13 errors to 0, and the
  standalone artefact under Bun from **50 rejections over 39 requests to 0**, so
  production is fixed and not just the console. What remains is an
  `AbortError` out of `node:async_hooks` when a client abandons an in-flight
  request — ~1500 in a browser-suite run, and **pre-dating the fix**: the same
  21-test subset raised 250 on master and 253 after. No response changes and no
  gate fails, which is what makes it expensive — with no error tracking (bullet
  above), the logs are what this project has. **2026-10-15:** Auth.js is gone
  (D135), and with it the CSRF mint that tripped the prerender; `auth()` still
  awaits `connection()` first, because reading a session is request data
  whichever library reads it, and `auth-dynamic.test.ts` still holds the
  ordering. Not re-measured on the standalone artefact at that commit; the
  `AbortError` half does not involve authentication.

---

## Where the plan is

Execution follows `docs/REDESIGN_PLAN.md`. Live progress and every decision
taken without asking are in `docs/PROGRESS.md`.

| Phase | State |
|---|---|
| 0 — Clean slate | ✅ Complete |
| 1 — Close the dead routes | ✅ Complete |
| 2 — One design system | ✅ Complete |
| 2b — Foundations of use | ✅ Complete except the manual screen-reader pass |
| 3 — Roles, rate limiting | ✅ Complete |
| 4 — Offline, and a shop that survives it | ✅ Complete against its done-when |
| 4b — Client state, the compiler, a React gate | ✅ Complete |
| 5 — Kitchen screen, and Screen A's layout | ✅ Complete against its done-when, except a week on a real tablet |
| 6 — Product rating | ✅ Complete against its done-when — T7 (offline scan resolution) landed 2026-09-01 |
| 7 — Security review | ✅ **Complete** — `docs/SECURITY_REVIEW.md` (2026-08-26). Found and closed four household-isolation defects and a shipped OpenSSL CVE. Reviewed again 2026-10-12 (*The 2026-10-12 review* in the same file), with owner actions pending |
| 8 — The owner's first pass | ✅ All six closed; the done-when — the owner repeats their pass — is the owner's to run |

**What remains, in one place.** The three human
passes no suite can answer (the manual screen-reader pass, a week on a real
tablet, iOS Safari on a real device); ~~a household admin panel~~ and ~~session
revocation~~ — **both landed**: members and roles at `cdab308`, and revocation
in both halves, an admin ending a member's sessions from that panel and an
account ending its own from `/settings`. That closes the question
`SECURITY_REVIEW.md` finding 8 left open. ~~T7, the offline scan
resolution~~ **landed 2026-09-01** — a queued scan rather than a queued
product, so Journeys 5 and 6 pass in full. And
**Phase 8's human half** — the two §3/§5.1 promises the 2026-08-17 re-audit
found unbuilt have both landed, the ± stepper at `74cff4b` and the screen
choice at `300f665`, so Journeys 4 and 8 pass — all six of the
owner's observations are built and green (`70386ea` closes the last); what
remains of the phase is its done-when, which no suite can run: the owner
repeating the pass that produced them. All of it is in
`REDESIGN_PLAN.md` §10, which is the list an item may only leave by being done
or deliberately dropped.

All ten journeys of `docs/SMOKE_JOURNEYS.md` pass at the tiers a suite can
answer — 4 since 2026-08-25, 8 since 2026-08-26, and 5 since 2026-09-01, when
T7 closed the offline scan it had been short on. Journeys 2 and 7 pass in their widened
2026-08-18 shape — the owner's amendments landed at `941d1ed` (D88): a kitchen
account can start a list and add an item, and every running-out row carries a
one-tap add-to-list. The per-journey evidence is in that file.

### Environment notes

- ~~`pnpm prisma` commands need `DATABASE_URL` exported.~~ **Fixed** by
  `6d5d3c3`: `prisma.config.ts` calls `process.loadEnvFile(".env")` itself. Its
  own presence is what made Prisma 6 stop doing that, so the file that caused
  the problem is the file that solves it. It does not overwrite variables
  already set, so a CI-provided `DATABASE_URL` still wins.
- `scripts/test-integration-local.sh` stops the compose services when it
  finishes unless `KEEP_TEST_SERVICES=1`. Running it and then `db:seed` fails
  with "can't reach database" for that reason and no other.

- The `docker` group includes this user, but a login session started before that
  change will not have it. Re-login, or prefix with `sg docker -c "..."`.
- Port 3000 is occupied on this machine by an unrelated application, and 3001
  is routinely this project's own `bun run dev`. The browser suite defaults to
  3100 and no longer conflicts with either — it may be run while a dev server
  is up, and touches neither its port nor its data.
- Next refuses a second dev server from the same directory — `next dev` only.
  The suite's standalone server takes no such lock, which is half of why the
  suite moved to it; the other half is `stoky_e2e`. Before the move, a suite
  and a developer's dev server could and did kill each other's.
- If message catalogues appear stale, the running dev server has cached them —
  `touch next.config.ts` makes it reload.

---

## Related documents

| Document | Purpose |
|---|---|
| `docs/REDESIGN_PLAN.md` | What is being built, phase by phase |
| `docs/PROGRESS.md` | What is done, and every decision taken without asking |
| `docs/DESIGN_AUDIT.md` | The interface audit and its actions |
| `docs/SMOKE_JOURNEYS.md` | User journeys that must work before calling work done |
| `docs/LOCAL_BOOTSTRAP.md` | Clone → running app |
| `docs/VERIFICATION_SEQUENCE.md` | The command ladder and what each gate proves |
| `docs/TEST_SETUP.md` | Test database configuration and troubleshooting |
| `SECURITY.md` | Threat model and hardening for a self-hosted deployment |
| `ISSUES.md` | Open issues and technical debt, with file references |
