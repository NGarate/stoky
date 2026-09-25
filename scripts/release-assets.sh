#!/bin/bash

# Assemble only the standalone files an operator needs. Validate the version
# before CI may publish the image: a release tag, its package and its download
# must all select the same build.
set -euo pipefail

RELEASE_TAG="${1:?Usage: release-assets.sh vVERSION OUTPUT_DIRECTORY}"
ASSET_DIR="${2:?Usage: release-assets.sh vVERSION OUTPUT_DIRECTORY}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# OCI tags cannot contain SemVer build metadata (+...). Restrict the accepted
# tags before using one as a file name or reading its release notes.
if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "Error: expected a version tag such as v0.1.0-alpha.1, got $RELEASE_TAG." >&2
  exit 1
fi

PACKAGE_VERSION="$(bun -p "require('./package.json').version")"
if [ "$RELEASE_TAG" != "v$PACKAGE_VERSION" ]; then
  echo "Error: release tag $RELEASE_TAG does not match package.json v$PACKAGE_VERSION." >&2
  exit 1
fi

if [ "$(grep -c '^STOKY_VERSION=' deploy/example.env)" != 1 ] \
   || ! grep -Fxq "STOKY_VERSION=$RELEASE_TAG" deploy/example.env; then
  echo "Error: deploy/example.env must select STOKY_VERSION=$RELEASE_TAG exactly once." >&2
  exit 1
fi

if [ ! -s "docs/releases/$RELEASE_TAG.md" ]; then
  echo "Error: release notes docs/releases/$RELEASE_TAG.md are missing or empty." >&2
  exit 1
fi

mkdir -p "$ASSET_DIR"
cp deploy/docker-compose.yml "$ASSET_DIR/docker-compose.yml"
cp deploy/example.env "$ASSET_DIR/example.env"
cp deploy/traefik.yml "$ASSET_DIR/traefik.yml"
(
  cd "$ASSET_DIR"
  sha256sum docker-compose.yml example.env traefik.yml > SHA256SUMS
  sha256sum -c SHA256SUMS
)
