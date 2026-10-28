#!/bin/bash

# Scans the release bundle's service images — PostgreSQL, Valkey, Traefik, as
# deploy/docker-compose.yml names them — with the release gate's scanner and
# its rule: Trivy 0.76.1, fixable CRITICAL or HIGH fails, read from the
# registry, postgres's gosu left out (RELEASING.md, weekly re-scans, has the
# measurement behind that one file).
#
# Exists because these images were scanned only by the weekly rescan.yml,
# after a release was published: v0.1.0-alpha.3 shipped traefik:v3.7.13 with
# four HIGH advisories, and the first anyone heard of it was a red Monday run.
# ci.yml's release-images job runs this on a tag, and release-draft waits for
# it, so a bundle with a fixable HIGH never becomes a draft. Run it by hand
# before tagging, and on candidate images before moving a pin.
#
# The application image is not scanned here: before the tag it does not
# exist, and image-build and release-draft scan it, the latter at the exact
# digest the release names.
#
# Trivy comes from its own image, pinned by the digest of its multi-platform
# index, as check-ci.sh takes actionlint and zizmor: the scanner a release
# trusts does not float, and nothing is installed on the host. One container
# scans every image, so the vulnerability database is downloaded once per run
# and kept nowhere: no cache to restore, and no volume or Docker socket handed
# to the scanner.
#
# Usage:
#   bash scripts/scan-bundle-images.sh            # every service image of deploy/docker-compose.yml
#   bash scripts/scan-bundle-images.sh IMAGE...   # these instead, e.g. candidates before a pin moves
#
# Exit status: 0 clean, 1 a fixable CRITICAL or HIGH finding in some image
# (every image is still scanned), 2 nothing to scan, or the scanner did not
# finish (Trivy failed, its database could not be fetched, the image could
# not be read): then nothing is vouched for, and it is not called a finding.
# Trivy exits 1 on its own errors, so findings are asked to exit 3 instead;
# on 2026-10-23 a 404 fetching Trivy's database read as a vulnerability.

set -euo pipefail

TRIVY_VERSION="0.76.1"
# `docker buildx imagetools inspect aquasec/trivy:0.76.1` — the index, not a
# per-platform manifest. ci-workflow.test.ts holds the version to the one
# ci.yml's release gate and rescan.yml pass to trivy-action.
TRIVY_IMAGE="aquasec/trivy:${TRIVY_VERSION}@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ "$#" -gt 0 ]; then
  IMAGES=("$@")
else
  # What Compose resolves, as rescan.yml reads a release's file. The values
  # are placeholders: `config` needs every required variable, and nothing
  # here starts. `app` is the application (see above).
  mapfile -t IMAGES < <(
    STOKY_VERSION=v0.0.0 POSTGRES_PASSWORD=unused STOKY_SECRET=unused \
      DOMAIN=scan.invalid ACME_EMAIL=scan@example.invalid \
      docker compose --project-name stoky-scan --file deploy/docker-compose.yml config --format json \
      | bun -e 'const { services } = JSON.parse(require("fs").readFileSync(0, "utf8"));
        for (const [name, service] of Object.entries(services)) if (name !== "app") console.log(service.image ?? "")'
  )
fi

if [ "${#IMAGES[@]}" -eq 0 ]; then
  echo "Error: no image to scan." >&2
  exit 2
fi
for image in "${IMAGES[@]}"; do
  if [ -z "$image" ]; then
    echo "Error: a service of deploy/docker-compose.yml names no image." >&2
    exit 2
  fi
done

# Runs inside the Trivy image, under its BusyBox sh, once per image given as
# an argument. A red image does not stop the others; a scanner failure on any
# image outranks a finding on another, since it leaves that image unknown.
# shellcheck disable=SC2016
SCAN='
status=0
for image do
  echo "==> $image"
  case "${image%%@*}" in
    postgres:* | */postgres:*)
      trivy image --quiet --image-src remote --severity CRITICAL,HIGH --ignore-unfixed \
        --exit-code 3 --skip-files usr/local/bin/gosu "$image" ;;
    *)
      trivy image --quiet --image-src remote --severity CRITICAL,HIGH --ignore-unfixed \
        --exit-code 3 "$image" ;;
  esac
  code=$?
  if [ "$code" -eq 3 ]; then
    [ "$status" -eq 2 ] || status=1
  elif [ "$code" -ne 0 ]; then
    echo "trivy did not finish scanning $image (exit $code)" >&2
    status=2
  fi
done
exit "$status"
'

set +e
docker run --rm --entrypoint /bin/sh "$TRIVY_IMAGE" -c "$SCAN" scan "${IMAGES[@]}"
status=$?
set -e
case "$status" in
  0) echo "Clean: no fixable CRITICAL or HIGH finding in ${#IMAGES[@]} image(s)." ;;
  1)
    echo "Error: a fixable CRITICAL or HIGH finding (above). A release with this bundle would be refused." >&2
    exit 1
    ;;
  *)
    echo "Error: the scanner did not finish (exit $status, above), so nothing is vouched for. Run it again; this is not a finding." >&2
    exit 2
    ;;
esac
