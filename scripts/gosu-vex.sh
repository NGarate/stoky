#!/bin/sh

# Writes an OpenVEX document saying which of gosu's known Go advisories it
# never reaches, for Trivy to read with the weekly re-scan's report
# (rescan.yml, the db job).
#
# The postgres image ships /usr/local/bin/gosu, built by its author with an
# old Go on purpose: he rebuilds only for advisories in code gosu runs, and
# says so in its SECURITY.md, which asks for `govulncheck` as the judge. Trivy
# matches the binary's Go version against every stdlib advisory instead, so
# the report carried 61 findings of which govulncheck finds one reachable
# (measured 2026-10-28 on postgres:16.15-alpine, gosu 1.19). This runs that
# judge on the binary the image actually holds, every time, so a statement is
# never older than the scan it annotates; an advisory govulncheck finds
# reachable is written `affected` and stays in the report.
#
# govulncheck names the product "Unknown Product" with each package as a
# subcomponent, which Trivy matches to nothing; each statement is rewritten to
# name the package itself, by the purl Trivy gives it.
#
# The gate is not changed: rescan.yml and scan-bundle-images.sh still leave
# gosu out of it (RELEASING.md, weekly re-scans).
#
# Usage: sh scripts/gosu-vex.sh IMAGE OUT

set -eu

# `docker buildx imagetools inspect golang:1.26-alpine` — the index, not a
# per-platform manifest. govulncheck comes through the Go module proxy, which
# the checksum database verifies, at the version named here.
GOLANG_IMAGE="golang:1.26-alpine@sha256:a2012b4a1d1f9f7e9f44e0d39b805a901e856b1dd80b4e6ee4338db547050308"
GOVULNCHECK_VERSION="v1.9.0"

if [ "$#" -ne 2 ]; then
  echo "Usage: sh scripts/gosu-vex.sh IMAGE OUT" >&2
  exit 2
fi
IMAGE="$1"
OUT="$2"

WORK="$(mktemp -d)"
CONTAINER=""
cleanup() {
  [ -z "$CONTAINER" ] || docker rm "$CONTAINER" > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

CONTAINER="$(docker create "$IMAGE")"
docker cp "$CONTAINER:/usr/local/bin/gosu" "$WORK/gosu"

docker run --rm -v "$WORK:/scan:ro" "$GOLANG_IMAGE" sh -c \
  "go install golang.org/x/vuln/cmd/govulncheck@${GOVULNCHECK_VERSION} > /dev/null 2>&1 \
    && govulncheck -mode=binary -format openvex /scan/gosu" > "$WORK/govulncheck.json"

# shellcheck disable=SC2016 # JavaScript, expanded by Bun, not the shell.
bun -e '
const vex = JSON.parse(await Bun.file(process.argv[1]).text());
const statements = vex.statements ?? [];
if (statements.length === 0) {
  console.error("govulncheck wrote no statement; nothing to vouch for.");
  process.exit(1);
}
for (const statement of statements) {
  statement.products = statement.products.flatMap((product) => {
    const packages = product.subcomponents ?? [];
    if (packages.length === 0) {
      console.error(`${statement.vulnerability.name} names no package.`);
      process.exit(1);
    }
    // pkg:golang/github.com%2Fmoby%2Fsys%2Fuser@v0.1.0 is, to Trivy,
    // pkg:golang/github.com/moby/sys/user@v0.1.0.
    return packages.map((p) => ({ "@id": decodeURIComponent(p["@id"]) }));
  });
}
vex.author = "Stoky rescan (govulncheck)";
console.log(JSON.stringify(vex, null, 2));
' "$WORK/govulncheck.json" > "$OUT"

echo "Wrote $(grep -c '"status"' "$OUT") statements for $IMAGE's gosu to $OUT."
