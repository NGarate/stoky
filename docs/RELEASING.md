# Publishing a Stoky release

Releases come from `master`; do not create release branches. Work reaches
`master` by the workflow in `CLAUDE.md` (Git Workflow), including the pull
requests unattended or semi-attended agent work opens; a release is cut only
from what has landed there.
The first release is `v0.1.0-alpha.1`. Alpha releases are GitHub **prereleases**,
not stable releases. The repository and the GHCR package are public; the
attestation and anonymous-pull steps below depend on that (see
[Security](../SECURITY.md#verifying-an-images-provenance)).

## Prepare a reviewable version

1. Update `package.json`, `deploy/example.env` and `DEFAULT_VERSION` in
   `deploy/install.sh` to the same version. The Compose file has no default image
   tag: it requires `STOKY_VERSION` from `.env`, so `example.env` is the one place
   the bundle names the image, and `install.sh` names the release it downloads.
   Commit no secrets.
2. Write `docs/releases/vVERSION.md`: introduction, highlights, installation link,
   upgrade instructions, known limitations and verification. Describe user-visible
   behavior; do not claim that automated tests settle the outstanding human checks.
3. Update the installation guide and owning documents whenever configuration or
   support changes. Keep release assets self-contained: Compose, `example.env`,
   `traefik.yml` and `install.sh` must work without a checkout. `install.sh` only
   downloads, verifies and creates missing configuration; it never starts Stoky.
4. Refresh the service images. `deploy/docker-compose.yml` names PostgreSQL,
   Valkey and Traefik by exact version and index digest, and between releases
   only a merged Dependabot pull request moves them ([Dependency
   updates](#dependency-updates)), a week behind upstream at best, so a release
   that skips this can ship stale builds. For each, take the newest release of the same major, which is what
   the floating tag (`postgres:16-alpine`, `valkey/valkey:8-alpine`, `traefik:v3`)
   names that day, and the digest of its multi-platform index, not one
   platform's manifest:

   ```bash
   docker buildx imagetools inspect postgres:16-alpine   # Digest: sha256:…
   docker buildx imagetools inspect postgres:16.15-alpine   # must print the same Digest
   ```

   Write `image: postgres:16.15-alpine@sha256:<that digest>`, and the same for
   `valkey/valkey` and `traefik`. A new major version is a decision with its own
   migration and release note, not a refresh. The release smoke then runs the
   builds operators will pull. `src/__tests__/unit/deployment.test.ts` fails if
   a service image loses its digest or goes back to a bare major tag.

   Then scan them with the release gate's scanner and rule — Trivy 0.69.3,
   pinned by digest and run in its own container, fixable CRITICAL or HIGH
   fails, postgres's gosu left out:

   ```bash
   bash scripts/scan-bundle-images.sh                         # what deploy/docker-compose.yml names
   bash scripts/scan-bundle-images.sh traefik:v3.7.16@sha256:…   # candidates, before moving a pin
   ```

   A red image is not refreshed into the bundle. If no release of the same
   major is clean, the release waits for upstream; never widen the skip.
5. Run `bun run verify:ci`, `bash scripts/check-ci.sh`, and the full Playwright suite
   for a release. New tests must be shown to fail against the broken behavior.
6. Build and test the production image with fresh, isolated volumes. Check migrations,
   proxy routing, registration/login, health, restart persistence and backup/restore.
   Record what was actually tested in `STATUS.md`, including any TLS/host limitations.
7. Package locally: `bash scripts/release-assets.sh vVERSION /tmp/stoky-release-assets
   "sha256:$(printf '%064d' 0)"`.
   The script rejects version mismatches (package, `example.env`, `install.sh`, and any version
   named in `docs/INSTALL.md` or `README.md`) and missing notes, pins the assets'
   guide links to the tag, and produces `SHA256SUMS`. Its third argument is the
   image digest the packaged Compose file names (`…:${STOKY_VERSION}@sha256:…`).
   Before the tag no image exists, so a local check passes a placeholder, as the
   tag run's first validation does; `release-draft` packages the attached files
   with the digest it promoted. To package a published release by hand, take the
   digest from `docker buildx imagetools inspect ghcr.io/ngarate/stoky:vVERSION
   --format '{{.Manifest.Digest}}'`.

Commit each independent change only after its gates pass. Stage explicit paths,
push `master`, and wait for **all** CI jobs, including image publication, to pass.
Never bypass a failed test or scan to make a release.

Only a push publishes an image. A manual `workflow_dispatch` runs every gate on
the ref it selects, the image build and scan included, and publishes nothing on
any ref, master and tags included. To retry a failed publish, re-run the push's
own run, which keeps its event; dispatching a new one will not publish. Re-run
only the newest push to `master`: an older run re-tags `latest` to its own
commit, and once a newer push has published, its image already carries the
older commit's changes.

## Upgrading Prisma

The image build checks the native Prisma engines against
`PRISMA_SCHEMA_ENGINE_SHA256` and `PRISMA_QUERY_ENGINE_SHA256` in the
`Dockerfile`, because Prisma downloads them at install time, outside
`bun.lock` ([Security](../SECURITY.md#container-and-runtime--dockerfile)).
An upgrade that changes the engines (`@prisma/engines-version` names the
commit they were built from; 6.19.3 is `c2990dca…`) fails `docker build` with
`sha256sum: WARNING: N of 4 computed checksums did NOT match` until both values
are refreshed. That failure is the intended signal; never remove the check to
get past it. Take the new values from the upgraded lockfile's install:

```bash
docker build --target deps -t stoky-deps .
docker run --rm --network none --entrypoint sh stoky-deps -c \
  'sha256sum /app/node_modules/@prisma/engines/*-linux-musl-openssl-3.0.x*'
```

Confirm `bun.lock` changed only by the intended Prisma version, write the two
values into the `ARG`s, and commit them with the upgrade. The pins are for the
amd64 image; an arm64 build would need its own (`linux-musl-arm64-openssl-3.0.x`),
chosen by `TARGETARCH`.

## Tag, inspect, publish

```bash
git tag -a vVERSION -m 'Stoky vVERSION'
git push origin vVERSION
```

The `v*` tag runs the complete CI pipeline and validates the package/environment
version. The image is built and scanned before publication, and `release-images`
scans the bundle's PostgreSQL, Valkey and Traefik with `scripts/scan-bundle-images.sh`
(step 4); `release-draft` needs it, so a fixable CRITICAL or HIGH in any of them
stops the release before promotion, as one in the application does. After all gates pass
it is pushed only as `ghcr.io/ngarate/stoky:candidate-vVERSION`; the `release-draft`
job scans that digest from the registry with Trivy (fixable CRITICAL/HIGH fail
it), installs it with the shipped Compose file on fresh volumes, and only when
both pass retags the same digest (no rebuild) as `:vVERSION`. A failed scan or
smoke leaves no version tag behind. The job then packages the installation files
with that digest written into the Compose file's image line, checks that
`docker compose config --images` of the packaged file names
`ghcr.io/ngarate/stoky:vVERSION@<digest>` and that Compose pulls it, attests
each of the five installation files (build provenance signed for this tag's run,
stored by GitHub), and creates a draft with the checked-in release notes and the
installation files plus checksums. Draft retries may replace draft attachments
and attest the new files again; published releases must not be reused for a
different build. Fixes get a new tag. Once the release-tag rulesets are on
([Repository settings](#repository-settings)) that is the only way: nobody, the
owner included, can move or delete a pushed `v*` tag, so a tag on the wrong
commit, or one whose fix needs a code change, is abandoned for the next
version. Disabling the ruleset to re-tag is a deliberate exception, and `check`
reports it until it is enabled again.

Download and review the draft assets with `gh release download`, run
`sha256sum -c SHA256SUMS`, and verify that every file carries this tag's
attestation, which is the check operators are offered in
[the guide](INSTALL.md#optional-check-who-published-the-files):

```bash
for asset in docker-compose.yml example.env traefik.yml install.sh SHA256SUMS; do
  gh attestation verify "$asset" --repo NGarate/stoky \
    --signer-workflow NGarate/stoky/.github/workflows/ci.yml \
    --source-ref refs/tags/vVERSION || echo "NOT ATTESTED: $asset"
done
```

A file that does not verify was not attested by a `ci.yml` run of this tag, and
the release must not be published. Files packaged by hand carry no attestation,
so never attach them to a release. Then compare the files with the tagged source: the Compose
file differs from `deploy/docker-compose.yml` by its guide link and by the
`@sha256:` digest on the application's image line, which must be the digest
`docker buildx imagetools inspect ghcr.io/ngarate/stoky:vVERSION` reports. Confirm that
the versioned image exists and the tag points to the intended commit. The GHCR
package is public, so the image pulls with no saved credentials, as an operator's
does. Verify its provenance with the `gh attestation verify` command in
[Security](../SECURITY.md#verifying-an-images-provenance), pinned to this tag's
`--source-ref`: a failure there means the version tag does not point to an image
this tag's run attested, and the release must not be published. Test the
published image before treating it as an installation result.

Publish an alpha only after these checks:

```bash
gh release edit vVERSION --draft=false --prerelease --latest=false
gh release view vVERSION --json url,isDraft,isPrerelease,targetCommitish,assets
```

With immutable releases on, that edit is one-way: a published release's files
and tag can no longer be replaced, by `release-draft` or by hand. Its notes stay
editable.

Use the tag-specific download URLs in the notes. GitHub's `latest` release route
does not select prereleases. Docker `latest` remains the development channel from
`master`; a prerelease tag push does not move it. Never document `latest` as an
alpha upgrade policy.

## After publication: weekly re-scans

`.github/workflows/rescan.yml` scans, every Monday at 05:17 UTC, what an
installation of the newest published release runs. It takes the newest
non-draft release (prereleases included: GitHub's `releases/latest` route
answers 404 while every release is an alpha), downloads that release's
`docker-compose.yml`, and scans each image `docker compose config` resolves from
it — the application at the digest the file names (by tag for bundles up to
`v0.1.0-alpha.3`), and PostgreSQL, Valkey and Traefik as named. The scanner is
`release-draft`'s: Trivy 0.69.3 pinned, from the registry, no Actions cache. One
job per image uploads the full report to code scanning under
`trivy-release-<service>` and then fails on a fixable CRITICAL or HIGH finding.
The gate leaves out one file, postgres's `/usr/local/bin/gosu`; the report keeps
it. Measured on 2026-10-12, its 25 findings were all Go standard-library
advisories in packages the binary does not link, so gating on it would keep the
run red with nothing to act on.

Run it by hand after changing it, or to check a release on demand:

```bash
gh workflow run rescan.yml --repo NGarate/stoky --ref master
```

A red run means an installation of the current release carries a fixable
CRITICAL or HIGH finding. GitHub sends a scheduled run's failure to whoever last
changed its cron line. A published release cannot be repaired in place: its
Compose file pins the application digest, and published releases are not
reused. So:

- **The application image.** An Alpine fix needs a new build and a dependency
  fix a new version; either way, a new tag. Re-running an old tag's
  `release-draft` rescans the same digest and changes nothing.
- **A service image.** Point its `image:` line in `deploy/docker-compose.yml`
  at a fixed upstream release and cut a new version. Until upstream ships a fix, the run
  stays red every week; that is the signal, not noise to silence. That is
  what happened to `v0.1.0-alpha.3`: its `traefik:v3.7.13` carries four HIGH
  advisories in Go 1.26.8 and `golang.org/x/net`, published 2026-10-08, and
  the first scheduled run, on 2026-10-19, was red for them. `v3.7.14` carried
  five by 2026-10-22; `v3.7.16`, clean that day, is in the release after it.
- **Never** widen `skip-files` or add an ignore file to turn a run green. The
  gosu exclusion is a measured decision; another one needs the same evidence,
  and `src/__tests__/unit/ci-workflow.test.ts` refuses any other skip.

In a public repository GitHub disables a schedule after 60 days without
repository activity, which on a quiet trunk is exactly when it is needed.
`gh workflow list --all --repo NGarate/stoky` shows its state, which must be
`active`; `gh workflow enable rescan.yml --repo NGarate/stoky` restores it.

What the re-scan cannot see is the same as the release scan's: dependencies
compiled into the application's `.next` bundle have no `package.json` for
Trivy to read, and the Bun runtime is a single binary no package database
lists. Neither is covered by re-scanning the image.

## Dependency updates

`.github/dependabot.yml` has Dependabot propose version updates every Monday
for four things: `bun.lock` (`bun`), the workflows' `uses:` pins
(`github-actions`), the Dockerfile's `oven/bun` base (`docker`) and the release
bundle's service images in `deploy/docker-compose.yml` (`docker-compose`). It
proposes a release only once it is seven days old. Minor and patch updates
share one pull request per ecosystem; each major arrives alone. Majors of
PostgreSQL, Valkey and Traefik are never proposed: a PostgreSQL major cannot
open the previous major's data directory, so each of those is a release with
upgrade notes, written by hand. `src/__tests__/unit/ci-workflow.test.ts` holds
that shape.

It opens nothing until an owner action lands: the branch ruleset restricts
creating and updating every branch to the owner, so Dependabot cannot push its
`dependabot/*` branches until they are excluded from it. Dependabot security
updates are a second owner action, a repository setting rather than this file
([Repository settings](#repository-settings) checks and applies both);
they bypass the cooldown, and GitHub offers none for the `bun` ecosystem, so
`bun audit` in CI remains the gate for the lockfile. Not yet measured: no
Dependabot pull request has run here, so how its own Bun rewrites `bun.lock` is
unknown until the first one does. Read from dependabot-core's `main` on
2026-10-12, not observed: its `bun/Dockerfile` installs Bun 1.4.2, not the
1.4.3 in `.bun-version`, and its parser accepts `lockfileVersion` up to 3
(this lockfile is 2).

A Dependabot pull request is reviewed like an agent's (`CLAUDE.md`, Git
Workflow): it runs the full pull-request pipeline, which never publishes, and
is squash-merged into `master` once the owner approves it. Titles are already
Conventional Commits: `build(deps):` and `build(deps-dev):` for the lockfile,
`ci:` for actions, `build(docker):` for images. What to check:

- **`bun.lock`.** The diff should touch only the packages named.
  `package-overrides.test.ts` must still resolve every security override; a
  lockfile rewritten wholesale means Dependabot's Bun disagrees with
  `.bun-version`, and the bump is better made by hand with `bun update`. A bump
  of `@playwright/test` turns `e2e` red until its container image and
  `PLAYWRIGHT_IMAGE_VERSION` in `ci.yml` follow; finish it on the branch.
- **`oven/bun`.** Arrives red: `bun-version.test.ts` requires the Dockerfile
  tag to equal `.bun-version`, which Dependabot does not edit. Move
  `.bun-version` and the `bun` row of `STATUS.md` on the same branch, or close
  it and make the bump as one commit by hand. Do not weaken the test.
- **An action major.** Read its release notes for changed inputs and defaults,
  and run `bash scripts/check-ci.sh`; the pin keeps the commit SHA and the
  exact version in its comment.
- **A bundle image.** It changes nothing for installations until a release
  ships it: `install.sh` verifies the Compose file against `SHA256SUMS`. The
  pin must still name the version's multi-platform index digest, as step 4
  checks it. Move
  the root `docker-compose.yml`, `docker-compose.dev.yml` and `ci.yml`'s
  service containers to the same version by hand, so CI tests what the bundle
  runs. No ecosystem covers those, nor the Playwright, actionlint and zizmor
  images (`scripts/check-ci.sh`).

A major the project is not taking yet is closed with
`@dependabot ignore this major version`, which Dependabot remembers.

## Repository settings

Several of a release's protections are GitHub settings, not files, so no checkout
shows whether they are on and nothing goes red when one is turned off.
`scripts/github-settings.ts` records what each should be and compares:

```bash
bun scripts/github-settings.ts check   # GET only; one DRIFT line per setting that differs, exit 1
bun scripts/github-settings.ts apply   # writes only what differs; then run check again
```

Both need `gh` signed in as an administrator of the repository, so they are the
owner's to run, never a CI step: most of these endpoints need the
administration permission, which a workflow token cannot be granted. Exit 2
means GitHub refused a request, not that anything drifted. `--repo OWNER/NAME`
points it at a fork. `apply` sends the same PUT and PATCH
requests every time and matches rulesets by name, so running it again changes
nothing; CodeQL's setup completes asynchronously, which is why `check` follows
it. `src/__tests__/unit/github-settings.test.ts` runs both against a stubbed
`gh`.

| Setting | Why |
|---|---|
| Private vulnerability reporting | The form [Security](../SECURITY.md#reporting-a-vulnerability) sends reporters to exists for people outside the project only while this is on. |
| Immutable releases | A published release's files and tag cannot be replaced. Drafts stay editable, so `release-draft` retries still work. Not retroactive: a release published before it was on stays mutable. |
| Secret scanning and push protection | Free on a public repository; push protection refuses a push that carries a recognised credential. |
| Dependabot alerts and security updates | Security updates skip the seven-day cooldown ([Dependency updates](#dependency-updates)). |
| CodeQL default setup, extended suite | Scans the TypeScript and the workflows themselves. |
| Actions: GitHub's own plus `.github/selected-actions.json`, pinned by full commit SHA | Turns the pinning rule in `ci.yml` from a convention into a refusal. |
| Fork pull requests need approval from every external contributor | The default covered first-time contributors only. |
| Squash merges only, titled and described by the pull request, branch deleted | `CLAUDE.md` (Git Workflow) lands a branch on `master` as one squash, whose message is the pull request's body: write that as the commit message. |
| Ruleset *Release tags are immutable* (`.github/rulesets/release-tags-immutable.json`) | Nobody, the owner included, can move or delete a `v*` tag, which is what the installation files' attestation check pins (`--source-ref`). |
| Ruleset *Release tags are created by an admin* (`.github/rulesets/release-tags-creation.json`) | Only a repository administrator can push a `v*` tag, the event that publishes a release. CI never creates one (`--verify-tag`). |
| Dependabot can push its branches | No enforced branch ruleset with a rule that refuses one of Dependabot's pushes (creation, update, deletion, `non_fast_forward`, or a pull request, status check or deployment requirement) reaches the branch it opens for any entry in `.github/dependabot.yml`. `apply` adds `refs/heads/dependabot/**` to the exclusions of a ruleset that does, and changes nothing else in it. Excluded rather than bypassed, because Dependabot also rewrites its own branch when it rebases a pull request, which `non_fast_forward` refuses. A ruleset narrowed to the default branch passes too. |

On 2026-10-12, before any of it was applied, `check` reported 11 of the 12
drifted: only Dependabot alerts were on.

**Adding an action.** A workflow `uses:` that the allow-list does not cover is
refused when the run starts, so it needs an entry in
`.github/selected-actions.json` and an `apply` before the workflow change lands.
`github-settings.test.ts` fails on such a `uses:`, and on an entry no workflow
uses. The one listed exception is `aquasecurity/setup-trivy`, which
`aquasecurity/trivy-action` calls from its own `action.yaml`. Read on
2026-10-12: the composite actions the workflows call (`trivy-action`,
`setup-trivy`, `attest-build-provenance`) pin their own nested actions by commit
SHA too. After applying the Actions policy, confirm it with
`gh workflow run ci.yml --repo NGarate/stoky --ref master`: nothing else
exercises it until the next push.

What it does not cover, because each is still an owner decision rather than a
setting to hold: whether the branch ruleset's `required_signatures` rule is made
real or removed (the only committer bypasses it), and whether unattended agents
get an identity without the owner's bypass.

## Verification boundaries

The release smoke (`scripts/smoke-proxy.sh`) runs the shipped bundle on the CI
runner. It proves the routing — HTTP redirects, only the configured host reaches
the application, by TLS name and by `Host` header — that TLS 1.1 and the
CBC/SHA-1 suites at TLS 1.2 are refused while TLS 1.2 with an AEAD suite is
not, and that Traefik discards a client's forged `X-Forwarded-For`/`X-Real-IP`,
so the per-address sign-in limit cannot be sidestepped through the front door.
It cannot prove that the network in front of a real installation behaves the
same, and it does not verify the certificate, which a smoke host cannot obtain.
For that, run `bash scripts/smoke-proxy.sh --live DOMAIN` against the
installation, from an address nobody signs in from: the check spends that
address's sign-in window.

The image pipeline scans one build and publishes a second; it does not compare
the two image digests. On a tag, `release-draft` therefore scans the pushed
digest itself — the one the version tag will name, read from the registry
rather than a local copy — before it promotes it, so a version tag only ever
names a scanned image; `latest` and `sha-` are covered only by the scan of the
first build. That closes the scanned-is-not-shipped gap, not the cache one
below: Trivy matches known CVEs and does not detect an implanted layer. A CVE
disclosed between the two scans stops the release too. Re-running
`release-draft` alone rescans the same digest; an Alpine fix arrives by
re-running the whole tag run, whose clean build runs `apk upgrade`, and a
dependency fix needs a new tag. On `master` the second build is rebuilt from the Actions layer
cache the first wrote. On a tag it is built from nothing — no `cache-from`,
`no-cache: true` — and the jobs that check, scan and package the release
download Bun and Trivy (with its database) instead of restoring them. The cache
of a master or tag run can be written by any job of a master run, and `e2e` runs
the whole dev-dependency tree in a container holding the runner's docker socket,
so a release assembled from that cache would carry whatever a compromised
test-only package planted after the scan. The scanned build still reads the
cache on a tag; it is never pushed. `latest` and `sha-` images are still
cache-derived; they are the development channel, not what an installation is
told to run. A clean build takes minutes rather than the cached publish's one,
so a tag's `image-publish` has 30 minutes to master's 10.
The Bun base image and the bundle's service images are pinned by digest,
application/CLI dependencies use the frozen Bun lockfile, and the Prisma engines
and the OCR model it does not cover are checked against SHA-256 values in the
`Dockerfile`. The Alpine packages are not pinned: the build's `apk add` and
`apk upgrade` take what Alpine serves that day.
Release tags identify the source/version, not a reproducible byte-for-byte build.
Record the published digest when auditing an installation. A GHCR tag can be
moved by anything holding `packages: write`, the tag run and any master run
included; the release's Compose file names the image by digest as well as tag,
so a moved tag does not change what an installation of it pulls, and
`SHA256SUMS` covers that line. Bundles up to `v0.1.0-alpha.3` name the tag only. SBOM, build provenance
and a signed GitHub attestation are enabled for published images; releases
before `v0.1.0-alpha.3` were built while the repository was private and have no
attestation. See [Security](../SECURITY.md#verifying-an-images-provenance).
The installation files are attested from the release after `v0.1.0-alpha.3`;
immutable releases were off when measured on 2026-10-12, so a published
release's files can still be replaced by anything holding `contents: write`,
and the attestation is what a replaced file lacks. The check pins the tag
(`--source-ref`), not its commit, so it is only as fixed as the `v*` tag, which
no ruleset protected on that date either. Both are
[repository settings](#repository-settings) that `check` reports.
