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

# The install script downloads the release it names. Attached to another
# release, it would install that one's predecessor instead of its own.
if [ "$(grep -c '^DEFAULT_VERSION=' deploy/install.sh)" != 1 ] \
   || ! grep -Fxq "DEFAULT_VERSION=$RELEASE_TAG" deploy/install.sh; then
  echo "Error: deploy/install.sh must set DEFAULT_VERSION=$RELEASE_TAG exactly once." >&2
  exit 1
fi

# The guide and README name the version in prose and in copy-paste commands
# (`gh release download vX`). Nothing else ties those to the tag, so a release
# that forgets them ships instructions that download the previous one.
for doc in docs/INSTALL.md README.md; do
  STALE="$(grep -noE 'v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?' "$doc" \
    | sed 's/\.md$//' | awk -F: -v tag="$RELEASE_TAG" '$2 != tag' || true)"
  if [ -n "$STALE" ]; then
    echo "Error: $doc names a version other than $RELEASE_TAG:" >&2
    echo "$STALE" >&2
    exit 1
  fi
done

if [ ! -s "docs/releases/$RELEASE_TAG.md" ]; then
  echo "Error: release notes docs/releases/$RELEASE_TAG.md are missing or empty." >&2
  exit 1
fi

mkdir -p "$ASSET_DIR"
# The templates link to the guide on master, which is right for a checkout and
# wrong for a download: once the next release lands, master's guide describes
# that release. Each asset points at the guide written for its own tag.
for asset in docker-compose.yml example.env traefik.yml install.sh; do
  sed "s#/blob/master/#/blob/$RELEASE_TAG/#g" "deploy/$asset" > "$ASSET_DIR/$asset"
done
(
  cd "$ASSET_DIR"
  chmod 755 install.sh
  sha256sum docker-compose.yml example.env traefik.yml install.sh > SHA256SUMS
  sha256sum -c SHA256SUMS
)
