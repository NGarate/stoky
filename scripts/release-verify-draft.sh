#!/bin/bash

# Verifies a release draft the way an operator will meet it, before anyone
# publishes it: the files, who signed them, what they name and that it
# installs. Read-only: it downloads, asks GitHub and the registry, pulls one
# image and runs the release's install.sh in a temporary directory. Nothing is
# published, edited or started.
#
# These are the seven checks the v0.1.0-alpha.4 draft was given by hand on
# 2026-10-22 (docs/RELEASING.md, "Tag, inspect, publish"):
#
#   1. `gh release download` into an empty directory: exactly the five files,
#      and `sha256sum -c SHA256SUMS` passes with a line for each of the four.
#   2. Each of the five files carries a build-provenance attestation signed by
#      this repository's ci.yml for refs/tags/<tag>; and SHA256SUMS is REFUSED
#      for the previous v* tag's ref (refs/heads/master when there is none),
#      which proves the check is able to fail.
#   3. The released Compose file is `git show <tag>:deploy/docker-compose.yml`
#      with the guide link moved to /blob/<tag>/ and @sha256:<digest> on the
#      application's image line, and nothing else.
#   4. That digest is what ghcr.io/<owner>/stoky:<tag> resolves to.
#   5. The image under that tag carries this tag's provenance attestation.
#   6. The image pulls by digest with no saved credentials.
#   7. The release's install.sh (run only once its attestation verified and
#      it matched SHA256SUMS) installs into an empty directory from a
#      file:// copy of the release, creating the files and a .env with both
#      secrets generated; with DOMAIN and
#      ACME_EMAIL filled in, `docker compose config --images` lists exactly
#      the released Compose file's images, the application's being
#      ghcr.io/<owner>/stoky:<tag>@<digest>.
#
# Every check runs even when an earlier one fails, so one run shows everything
# that is wrong. The result is a table, `ok|FAIL  <check>  <detail>`, after
# the output of each failed check; with GITHUB_STEP_SUMMARY set (in CI) the
# same table is appended to it as Markdown.
#
# A draft is visible only to accounts and tokens with push access to the
# repository; the owner's `gh` has it. A published release is refused unless
# --published is given, which re-verifies one that is already out.
#
# Usage:
#   bash scripts/release-verify-draft.sh vVERSION [--published] [--repo OWNER/NAME]
#
# The repository is --repo, else $GH_REPO, else the one `gh repo view` names.
# The tag must exist in this clone (`git fetch --tags`) for check 3. Needs gh
# (signed in), docker with buildx and compose, git, sha256sum, and what
# install.sh needs (curl, openssl). Exit status: 0 every check ok, 1 some
# check FAILed, 2 it could not start (bad arguments, a missing tool, no such
# release, or a published release without --published).
#
# install.sh runs with a `docker` on its PATH that knows no volume: it refuses
# to generate a database password when this host already has Stoky's database
# volume, which is right for an operator and says nothing about the release.
# It says "no such volume" as Docker does, because install.sh stops on any
# other failure rather than guess.
#
# The tests (src/__tests__/unit/release-verify-draft.test.ts) replace gh,
# docker and curl with stubs on PATH.

set -euo pipefail

USAGE="usage: bash scripts/release-verify-draft.sh vVERSION [--published] [--repo OWNER/NAME]"
# The same tags scripts/release-assets.sh accepts. The tag becomes a path and
# an image reference below, so nothing else is let through.
VERSION_RE='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$'
# release-assets.sh's application image line: a repository, then the
# ${STOKY_VERSION...} tag, optionally quoted, before the digest is added.
APP_IMAGE_LINE='^([[:space:]]*image:[[:space:]]*"?[^"[:space:]@]+:\$\{STOKY_VERSION(:\?[^}]*)?\})("?[[:space:]]*)$'
ASSETS=(docker-compose.yml example.env traefik.yml install.sh SHA256SUMS)
INSTALL_FILES=(docker-compose.yml example.env traefik.yml SHA256SUMS)

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

usage_error() {
  echo "$USAGE" >&2
  exit 2
}

TAG=""
ALLOW_PUBLISHED=false
REPO="${GH_REPO:-}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --published) ALLOW_PUBLISHED=true ;;
    --repo)
      [ -n "${2:-}" ] || usage_error
      REPO="$2"
      shift
      ;;
    -*) usage_error ;;
    *)
      [ -z "$TAG" ] || usage_error
      TAG="$1"
      ;;
  esac
  shift
done
[ -n "$TAG" ] || usage_error

if [[ ! "$TAG" =~ $VERSION_RE ]]; then
  echo "Error: expected a version tag such as v0.1.0-alpha.1, got '$TAG'." >&2
  exit 2
fi

for tool in gh docker git sha256sum; do
  if ! command -v "$tool" > /dev/null; then
    echo "Error: $tool is needed and is not installed." >&2
    exit 2
  fi
done

if [ -z "$REPO" ] && ! REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"; then
  echo "Error: could not tell which repository; pass --repo OWNER/NAME." >&2
  exit 2
fi
if [[ ! "$REPO" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "Error: expected a repository such as NGarate/stoky, got '$REPO'." >&2
  exit 2
fi
# OCI names are lowercase; the repository is NGarate/stoky.
IMAGE="ghcr.io/${REPO,,}"
WORKFLOW="$REPO/.github/workflows/ci.yml"

if ! IS_DRAFT="$(gh release view "$TAG" --repo "$REPO" --json isDraft --jq .isDraft)"; then
  echo "Error: $REPO has no release $TAG that this account can see (a draft needs push access)." >&2
  exit 2
fi
if [ "$IS_DRAFT" = true ]; then
  STATE=draft
elif [ "$ALLOW_PUBLISHED" = true ]; then
  STATE=published
else
  echo "Error: $TAG is already published; pass --published to verify it again." >&2
  exit 2
fi

# The negative check needs a ref this tag's files were not attested for. The
# previous version tag is the one a mixed-up release would most plausibly
# carry.
PREVIOUS="$({ git tag -l 'v*'; echo "$TAG"; } | grep -E "$VERSION_RE" | sort -uV \
  | awk -v tag="$TAG" '$0 == tag { print previous; exit } { previous = $0 }')"
NEGATIVE_REF="refs/heads/master"
[ -z "$PREVIOUS" ] || NEGATIVE_REF="refs/tags/$PREVIOUS"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DL="$WORK/release"
mkdir -p "$DL" "$WORK/logs"

NAMES=()
RESULTS=()
DETAILS=()
LOGS=()
DETAIL=""

# check NAME COMMAND [ARGS...]: runs the command with its output kept aside,
# and records ok or FAIL with the DETAIL it set. Never stops the run.
check() {
  local name="$1"
  shift
  local log="$WORK/logs/${#NAMES[@]}"
  DETAIL=""
  local result=FAIL
  if "$@" > "$log" 2>&1; then
    result=ok
  fi
  NAMES+=("$name")
  RESULTS+=("$result")
  DETAILS+=("$DETAIL")
  LOGS+=("$log")
}

short() {
  # sha256:0123456789ab… for a table that stays readable.
  printf '%s…' "${1:0:19}"
}

# An empty client configuration: no saved credentials, as an operator's
# first pull has none. A fresh one per use.
anonymous_config() {
  mktemp -d "$WORK/docker-config.XXXXXX"
}

check_assets() {
  if ! gh release download "$TAG" --repo "$REPO" --dir "$DL"; then
    DETAIL="gh release download failed"
    return 1
  fi
  local have expected
  # -exec basename, not GNU's -printf: CI runs this in the Alpine image,
  # whose BusyBox find has no -printf.
  have="$(find "$DL" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort | paste -sd ' ')"
  expected="$(printf '%s\n' "${ASSETS[@]}" | sort | paste -sd ' ')"
  if [ "$have" != "$expected" ]; then
    DETAIL="attached: $have; expected: $expected"
    return 1
  fi
  DETAIL="the ${#ASSETS[@]} installation files, nothing else"
}

check_checksums() {
  if [ ! -f "$DL/SHA256SUMS" ]; then
    DETAIL="no SHA256SUMS"
    return 1
  fi
  local file output
  # `sha256sum -c` alone would pass a SHA256SUMS that left a file out.
  for file in "${ASSETS[@]}"; do
    [ "$file" != SHA256SUMS ] || continue
    if ! grep -Eq "^[0-9a-f]{64}  $file\$" "$DL/SHA256SUMS"; then
      DETAIL="SHA256SUMS has no line for $file"
      return 1
    fi
  done
  if ! output="$(cd "$DL" && sha256sum -c SHA256SUMS 2>&1)"; then
    echo "$output"
    DETAIL="$(grep -v ': OK$' <<< "$output" | paste -sd ' ')"
    return 1
  fi
  echo "$output"
  DETAIL="sha256sum -c SHA256SUMS: $(grep -c ': OK$' <<< "$output") files OK"
}

# The files whose attestation verified, so that nothing is run on a checksum
# alone: a draft's own SHA256SUMS vouches for consistency, not provenance.
ATTESTED=()
check_attestation() {
  local file="$1"
  if [ ! -f "$DL/$file" ]; then
    DETAIL="not downloaded"
    return 1
  fi
  if ! gh attestation verify "$DL/$file" --repo "$REPO" \
       --signer-workflow "$WORKFLOW" --source-ref "refs/tags/$TAG"; then
    DETAIL="not attested by ci.yml for refs/tags/$TAG"
    return 1
  fi
  ATTESTED+=("$file")
  DETAIL="attested by ci.yml for refs/tags/$TAG"
}

check_attestation_can_fail() {
  if [ ! -f "$DL/SHA256SUMS" ]; then
    DETAIL="not downloaded"
    return 1
  fi
  if gh attestation verify "$DL/SHA256SUMS" --repo "$REPO" \
       --signer-workflow "$WORKFLOW" --source-ref "$NEGATIVE_REF"; then
    DETAIL="SHA256SUMS also verified for $NEGATIVE_REF: the checks above prove nothing"
    return 1
  fi
  DETAIL="SHA256SUMS refused for $NEGATIVE_REF, as it must be"
}

# The digest the released Compose file names on the application's image
# line; empty unless there is exactly one such line carrying exactly one.
released_digest() {
  local lines
  [ -f "$DL/docker-compose.yml" ] || return 0
  lines="$(grep -E '^[[:space:]]*image:.*\$\{STOKY_VERSION' "$DL/docker-compose.yml" || true)"
  [ -n "$lines" ] && [ "$(wc -l <<< "$lines")" = 1 ] || return 0
  grep -oE '\}@sha256:[0-9a-f]{64}("|[[:space:]]|$)' <<< "$lines" | grep -oE 'sha256:[0-9a-f]{64}' || true
}

check_compose_source() {
  if [ ! -f "$DL/docker-compose.yml" ]; then
    DETAIL="not downloaded"
    return 1
  fi
  if ! git show "$TAG:deploy/docker-compose.yml" > "$WORK/source-compose.yml"; then
    DETAIL="no $TAG:deploy/docker-compose.yml in this clone (git fetch --tags)"
    return 1
  fi
  if [ -z "$DIGEST" ]; then
    DETAIL="the application's image line names no single @sha256: digest"
    return 1
  fi
  if [ "$(grep -cE "$APP_IMAGE_LINE" "$WORK/source-compose.yml")" != 1 ]; then
    DETAIL="$TAG's deploy/docker-compose.yml has no single \${STOKY_VERSION} image line"
    return 1
  fi
  # What release-assets.sh makes of the tagged file with this digest. Any
  # difference from the released file is a change nobody reviewed.
  sed "s#/blob/master/#/blob/$TAG/#g" "$WORK/source-compose.yml" \
    | sed -E "s#$APP_IMAGE_LINE#\\1@$DIGEST\\3#" > "$WORK/expected-compose.yml"
  if ! diff -u --label "$TAG:deploy/docker-compose.yml, link and digest applied" \
       --label "released docker-compose.yml" "$WORK/expected-compose.yml" "$DL/docker-compose.yml"; then
    DETAIL="differs from $TAG's source by more than the guide link and the digest (diff above)"
    return 1
  fi
  DETAIL="$TAG's source plus /blob/$TAG/ links and @$(short "$DIGEST")"
}

check_digest() {
  if [ -z "$DIGEST" ]; then
    DETAIL="no digest in the released Compose file"
    return 1
  fi
  local resolved
  if ! resolved="$(docker buildx imagetools inspect "$IMAGE:$TAG" --format '{{.Manifest.Digest}}')"; then
    DETAIL="could not inspect $IMAGE:$TAG"
    return 1
  fi
  echo "$IMAGE:$TAG resolves to $resolved"
  if [ "$resolved" != "$DIGEST" ]; then
    DETAIL="$IMAGE:$TAG is $resolved; the Compose file names $DIGEST"
    return 1
  fi
  DETAIL="$IMAGE:$TAG is $DIGEST"
}

check_provenance() {
  if ! gh attestation verify "oci://$IMAGE:$TAG" --repo "$REPO" \
       --signer-workflow "$WORKFLOW" --source-ref "refs/tags/$TAG"; then
    DETAIL="$IMAGE:$TAG is not attested by ci.yml for refs/tags/$TAG"
    return 1
  fi
  DETAIL="$IMAGE:$TAG attested by ci.yml for refs/tags/$TAG"
}

check_pull() {
  if [ -z "$DIGEST" ]; then
    DETAIL="no digest in the released Compose file"
    return 1
  fi
  if ! DOCKER_CONFIG="$(anonymous_config)" docker pull --quiet "$IMAGE@$DIGEST"; then
    DETAIL="$IMAGE@$(short "$DIGEST") did not pull without credentials"
    return 1
  fi
  DETAIL="$IMAGE@$(short "$DIGEST") pulled without credentials"
}

INSTALL_DIR="$WORK/install"
INSTALL_OK=false
check_install() {
  local file
  for file in install.sh "${INSTALL_FILES[@]}"; do
    if [ ! -f "$DL/$file" ]; then
      DETAIL="$file not downloaded; not run"
      return 1
    fi
  done
  # Never run a script this tag's CI did not build: a tampered draft can
  # carry a SHA256SUMS that agrees with its own install.sh.
  if [[ " ${ATTESTED[*]} " != *" install.sh "* ]]; then
    DETAIL="install.sh is not attested for refs/tags/$TAG; not run"
    return 1
  fi
  # Never run a script the checksums do not vouch for.
  if ! grep -E '^[0-9a-f]{64}  install\.sh$' "$DL/SHA256SUMS" > "$WORK/install.sum" \
     || ! (cd "$DL" && sha256sum -c "$WORK/install.sum"); then
    DETAIL="install.sh does not match SHA256SUMS; not run"
    return 1
  fi
  # A release served from a directory, laid out as GitHub serves it.
  mkdir -p "$WORK/base/$TAG" "$INSTALL_DIR" "$WORK/no-docker"
  for file in "${INSTALL_FILES[@]}"; do
    cp "$DL/$file" "$WORK/base/$TAG/$file"
  done
  printf '#!/bin/sh\necho "Error response from daemon: no such volume" >&2\nexit 1\n' \
    > "$WORK/no-docker/docker"
  chmod 755 "$WORK/no-docker/docker"
  # No version argument: the release's own DEFAULT_VERSION must name it.
  if ! (cd "$INSTALL_DIR" && PATH="$WORK/no-docker:$PATH" \
        STOKY_RELEASE_BASE_URL="file://$WORK/base" bash "$DL/install.sh"); then
    DETAIL="install.sh failed"
    return 1
  fi
  for file in "${INSTALL_FILES[@]}"; do
    if ! cmp -s "$DL/$file" "$INSTALL_DIR/$file"; then
      DETAIL="install.sh did not install the release's $file"
      return 1
    fi
  done
  for file in POSTGRES_PASSWORD STOKY_SECRET; do
    if [ ! -f "$INSTALL_DIR/.env" ] || ! grep -Eq "^$file=[0-9a-f]{64}\$" "$INSTALL_DIR/.env"; then
      DETAIL="install.sh left no generated $file in .env"
      return 1
    fi
  done
  INSTALL_OK=true
  DETAIL="from file://, no version argument: ${#INSTALL_FILES[@]} files and .env with both secrets generated"
}

check_images() {
  if [ "$INSTALL_OK" != true ]; then
    DETAIL="nothing installed to read"
    return 1
  fi
  if [ -z "$DIGEST" ]; then
    DETAIL="no digest in the released Compose file"
    return 1
  fi
  sed -i -e 's/^DOMAIN=.*/DOMAIN=release-verify.invalid/' \
    -e 's/^ACME_EMAIL=.*/ACME_EMAIL=release-verify@example.invalid/' "$INSTALL_DIR/.env"
  local actual expected config
  config="$(anonymous_config)"
  # Only the installation's .env: a STOKY_VERSION or DOMAIN exported here
  # would override it, and an operator's shell has neither.
  if ! actual="$(cd "$INSTALL_DIR" && env -i PATH="$PATH" HOME="$HOME" DOCKER_CONFIG="$config" \
                 docker compose config --images | sort)"; then
    DETAIL="docker compose config failed"
    return 1
  fi
  # The released file's image lines, with the application's resolved to the
  # exact tag and digest.
  expected="$(grep -E '^[[:space:]]*image:' "$DL/docker-compose.yml" \
    | sed -E 's/^[[:space:]]*image:[[:space:]]*//; s/^"//; s/"?[[:space:]]*$//' \
    | awk -v app="$IMAGE:$TAG@$DIGEST" 'index($0, "${STOKY_VERSION") { print app; next } { print }' \
    | sort)"
  if [ "$actual" != "$expected" ]; then
    diff -u --label "the released Compose file's images" --label "docker compose config --images" \
      <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") || true
    DETAIL="Compose resolves other images than the released file names (diff above)"
    return 1
  fi
  printf '%s\n' "$actual"
  DETAIL="$(wc -l <<< "$actual") images, the application's $IMAGE:$TAG@$(short "$DIGEST")"
}

echo "Verifying the $STATE release $TAG of $REPO…"
check "release assets" check_assets
DIGEST="$(released_digest)"
check "checksums" check_checksums
for asset in "${ASSETS[@]}"; do
  check "attestation $asset" check_attestation "$asset"
done
check "attestation can fail" check_attestation_can_fail
check "compose vs tagged source" check_compose_source
check "image digest" check_digest
check "image provenance" check_provenance
check "anonymous pull" check_pull
check "fresh install" check_install
check "compose images" check_images

status=0
for i in "${!NAMES[@]}"; do
  if [ "${RESULTS[$i]}" = FAIL ]; then
    status=1
    echo
    echo "--- FAIL ${NAMES[$i]} ---"
    cat "${LOGS[$i]}"
  fi
done

echo
for i in "${!NAMES[@]}"; do
  printf '%-4s  %-30s  %s\n' "${RESULTS[$i]}" "${NAMES[$i]}" "${DETAILS[$i]}"
done

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Release verification: $TAG ($STATE)"
    echo
    echo "| Result | Check | Detail |"
    echo "|---|---|---|"
    for i in "${!NAMES[@]}"; do
      printf '| %s | %s | %s |\n' "${RESULTS[$i]}" "${NAMES[$i]}" "${DETAILS[$i]//|/\\|}"
    done
    echo
  } >> "$GITHUB_STEP_SUMMARY"
fi

exit "$status"
