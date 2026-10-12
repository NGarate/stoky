#!/bin/bash

# Assemble only the standalone files an operator needs. Validate the version
# before CI may publish the image: a release tag, its package and its download
# must all select the same build.
#
# IMAGE_DIGEST is the digest the release smoke ran and the version tag was
# promoted to. The packaged Compose file names the image by it, so the
# checksums cover which image runs: a GHCR tag can be moved later by anything
# holding packages: write, and a tag alone would follow it.
set -euo pipefail

USAGE="Usage: release-assets.sh vVERSION OUTPUT_DIRECTORY sha256:DIGEST"
RELEASE_TAG="${1:?$USAGE}"
ASSET_DIR="${2:?$USAGE}"
IMAGE_DIGEST="${3:?$USAGE}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# OCI tags cannot contain SemVer build metadata (+...). Restrict the accepted
# tags before using one as a file name or reading its release notes.
if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "Error: expected a version tag such as v0.1.0-alpha.1, got $RELEASE_TAG." >&2
  exit 1
fi

if [[ ! "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Error: expected an image digest such as sha256:<64 lowercase hex>, got $IMAGE_DIGEST." >&2
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

# The application's image line: a repository, then the required
# ${STOKY_VERSION:?...} tag, optionally quoted, and no digest yet. Exactly one,
# so the digest cannot land on a second line or on none.
APP_IMAGE_LINE='^([[:space:]]*image:[[:space:]]*"?[^"[:space:]@]+:\$\{STOKY_VERSION(:\?[^}]*)?\})("?[[:space:]]*)$'
if [ "$(grep -cE "$APP_IMAGE_LINE" deploy/docker-compose.yml)" != 1 ]; then
  echo "Error: deploy/docker-compose.yml must name the application image by \${STOKY_VERSION} on exactly one image: line." >&2
  exit 1
fi

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
# Tag and digest: the tag keeps the line readable, the digest decides what is
# pulled. Only the packaged copy: the checkout's file has no digest to name
# until CI has pushed the image, and a source build overrides the line.
sed -E -i "s#$APP_IMAGE_LINE#\\1@$IMAGE_DIGEST\\3#" "$ASSET_DIR/docker-compose.yml"
if [ "$(grep -cF "}@$IMAGE_DIGEST" "$ASSET_DIR/docker-compose.yml")" != 1 ]; then
  echo "Error: the packaged docker-compose.yml does not name $IMAGE_DIGEST exactly once." >&2
  exit 1
fi
(
  cd "$ASSET_DIR"
  chmod 755 install.sh
  sha256sum docker-compose.yml example.env traefik.yml install.sh > SHA256SUMS
  sha256sum -c SHA256SUMS
)
