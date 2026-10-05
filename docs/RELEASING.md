# Publishing a Stoky release

Releases come from `master`; do not create release branches or pull requests.
The first release is `v0.1.0-alpha.1`. Alpha releases are GitHub **prereleases**,
not stable releases. Repository/package visibility is a separate owner decision.

## Prepare a reviewable version

1. Update `package.json` and `deploy/example.env` to the same version. The
   Compose file has no default image tag: it requires `STOKY_VERSION` from `.env`,
   so `example.env` is the one place the bundle names its version. Commit no secrets.
2. Write `docs/releases/vVERSION.md`: introduction, highlights, installation link,
   upgrade instructions, known limitations and verification. Describe user-visible
   behavior; do not claim that automated tests settle the outstanding human checks.
3. Update the installation guide and owning documents whenever configuration or
   support changes. Keep release assets self-contained: Compose, `example.env` and
   `traefik.yml` must work without a checkout.
4. Run `bun run verify:ci`, `bash scripts/check-ci.sh`, and the full Playwright suite
   for a release. New tests must be shown to fail against the broken behavior.
5. Build and test the production image with fresh, isolated volumes. Check migrations,
   proxy routing, registration/login, health, restart persistence and backup/restore.
   Record what was actually tested in `STATUS.md`, including any TLS/host limitations.
6. Package locally: `bash scripts/release-assets.sh vVERSION /tmp/stoky-release-assets`.
   The script rejects version mismatches/missing notes and produces `SHA256SUMS`.

Commit each independent change only after its gates pass. Stage explicit paths,
push `master`, and wait for **all** CI jobs, including image publication, to pass.
Never bypass a failed test or scan to make a release.

## Tag, inspect, publish

```bash
git tag -a vVERSION -m 'Stoky vVERSION'
git push origin vVERSION
```

The `v*` tag runs the complete CI pipeline and validates the package/environment
version. The image is built and scanned before publication. Only after all gates
pass is the exact version image published to `ghcr.io/ngarate/stoky:vVERSION`.
The `release-draft` job then creates a draft with the checked-in release notes and
the installation files plus checksums. Draft retries may replace draft attachments;
published releases must not be reused for a different build. Fixes get a new tag.

Download and review the draft assets with `gh release download`, run
`sha256sum -c SHA256SUMS`, and compare them with the tagged source. Confirm that
the versioned image exists and the tag points to the intended commit. Private GHCR
packages need `read:packages`; GitHub repository access alone may not provide it.
Test the published image before treating it as an installation result.

Publish an alpha only after these checks:

```bash
gh release edit vVERSION --draft=false --prerelease --latest=false
gh release view vVERSION --json url,isDraft,isPrerelease,targetCommitish,assets
```

Use the tag-specific download URLs in the notes. GitHub's `latest` release route
does not select prereleases. Docker `latest` remains the development channel from
`master`; a prerelease tag push does not move it. Never document `latest` as an
alpha upgrade policy.

## Verification boundaries

The current image pipeline scans one build and publishes a rebuild from its cache;
it does not compare the two image digests. Docker base and
support-service tags can change across rebuilds; application/CLI dependencies use
the frozen Bun lockfile.
Release tags identify the source/version, not a reproducible byte-for-byte build.
Record the published digest when auditing an installation. SBOM and build provenance
are enabled; separate signed GitHub attestations are skipped while the repository
is private. See [Security](../SECURITY.md).
