# Publishing a Stoky release

Releases come from `master`; do not create release branches or pull requests.
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
4. Run `bun run verify:ci`, `bash scripts/check-ci.sh`, and the full Playwright suite
   for a release. New tests must be shown to fail against the broken behavior.
5. Build and test the production image with fresh, isolated volumes. Check migrations,
   proxy routing, registration/login, health, restart persistence and backup/restore.
   Record what was actually tested in `STATUS.md`, including any TLS/host limitations.
6. Package locally: `bash scripts/release-assets.sh vVERSION /tmp/stoky-release-assets`.
   The script rejects version mismatches (package, `example.env`, `install.sh`, and any version
   named in `docs/INSTALL.md` or `README.md`) and missing notes, pins the assets'
   guide links to the tag, and produces `SHA256SUMS`.

Commit each independent change only after its gates pass. Stage explicit paths,
push `master`, and wait for **all** CI jobs, including image publication, to pass.
Never bypass a failed test or scan to make a release.

## Tag, inspect, publish

```bash
git tag -a vVERSION -m 'Stoky vVERSION'
git push origin vVERSION
```

The `v*` tag runs the complete CI pipeline and validates the package/environment
version. The image is built and scanned before publication. After all gates pass
it is pushed only as `ghcr.io/ngarate/stoky:candidate-vVERSION`; the `release-draft`
job installs that digest with the shipped Compose file on fresh volumes, and only
when that smoke passes retags the same digest (no rebuild) as `:vVERSION`. A failed
smoke leaves no version tag behind. The job then creates a draft with the
checked-in release notes and the installation files plus checksums. Draft retries may replace draft attachments;
published releases must not be reused for a different build. Fixes get a new tag.

Download and review the draft assets with `gh release download`, run
`sha256sum -c SHA256SUMS`, and compare them with the tagged source. Confirm that
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

Use the tag-specific download URLs in the notes. GitHub's `latest` release route
does not select prereleases. Docker `latest` remains the development channel from
`master`; a prerelease tag push does not move it. Never document `latest` as an
alpha upgrade policy.

## Verification boundaries

The release smoke (`scripts/smoke-proxy.sh`) runs the shipped bundle on the CI
runner. It proves the routing — HTTP redirects, only the configured host reaches
the application, by TLS name and by `Host` header — and that Traefik discards a
client's forged `X-Forwarded-For`/`X-Real-IP`, so the per-address sign-in limit
cannot be sidestepped through the front door. It cannot prove that the network in
front of a real installation behaves the same, and it does not verify the
certificate, which a smoke host cannot obtain. For that, run
`bash scripts/smoke-proxy.sh --live DOMAIN` against the installation, from an
address nobody signs in from: the check spends that address's sign-in window.

The current image pipeline scans one build and publishes a rebuild from its cache;
it does not compare the two image digests. Docker base and
support-service tags can change across rebuilds; application/CLI dependencies use
the frozen Bun lockfile.
Release tags identify the source/version, not a reproducible byte-for-byte build.
Record the published digest when auditing an installation. SBOM, build provenance
and a signed GitHub attestation are enabled for published images; releases
before `v0.1.0-alpha.3` were built while the repository was private and have no
attestation. See [Security](../SECURITY.md#verifying-an-images-provenance).
