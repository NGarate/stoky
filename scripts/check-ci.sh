#!/bin/bash

# Lints the CI pipeline itself: the workflow with actionlint, the scripts in
# scripts/ with shellcheck.
#
# Exists because a workflow bug has no test suite to fail: it surfaces as a red
# run after the push, on a trunk with no PR gate — so master is already wearing
# it. Most of the red runs in this repository's history were exactly that class
# of mistake, not failing tests.
#
# Both tools come from actionlint's own image, which bundles shellcheck, pinned
# by digest. Same reasoning as the tessdata model in the Dockerfile: executable
# content entering the build from the internet does not get to float. And it
# keeps both tools off the host, where shellcheck used to have to be installed
# by hand — the host-tooling dependency the rest of the project has moved away
# from (tests take their browsers from the Playwright image, gates run in the
# development image). The digest is the multi-platform index, so the pin holds
# on arm64 as well as amd64.
#
# Where Docker is not available, or CHECK_CI_TOOLS=binary asks for it, the old
# path remains: actionlint downloaded and checked against a SHA-256, shellcheck
# from the system (the GitHub runner images preinstall it). A missing tool fails
# this script rather than skipping the check — a guard nobody runs is not a
# guard.
#
# Usage:
#   bash scripts/check-ci.sh                       # both, over everything
#   bash scripts/check-ci.sh actionlint [FILE...]  # the workflows, or these
#   bash scripts/check-ci.sh shellcheck [FILE...]  # scripts/*.sh, or these
#
# The file forms are how scripts/check-scope.sh lints only what is staged or
# changed. Choosing the files is its job; an empty list here means everything.
#
# Environment:
#   CHECK_CI_TOOLS  `image` or `binary`. Defaults to `image` when a Docker
#                   daemon answers, `binary` otherwise.

set -euo pipefail

ACTIONLINT_VERSION="1.7.12"
# `docker buildx imagetools inspect rhysd/actionlint:1.7.12` — the index, not a
# per-platform manifest.
ACTIONLINT_IMAGE="rhysd/actionlint:${ACTIONLINT_VERSION}@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667"
# From actionlint_1.7.12_checksums.txt on the GitHub release, linux_amd64.
ACTIONLINT_SHA256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

TOOL="${1:-both}"
case "$TOOL" in
  both) ;;
  actionlint | shellcheck) shift ;;
  *)
    echo "usage: $0 [actionlint|shellcheck] [FILE...]" >&2
    exit 2
    ;;
esac
FILES=("$@")

if [ -z "${CHECK_CI_TOOLS:-}" ]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    CHECK_CI_TOOLS=image
  else
    CHECK_CI_TOOLS=binary
  fi
fi

case "$CHECK_CI_TOOLS" in
  image)
    # Read-only and with no network: a linter has no business writing to the
    # checkout or reaching anywhere. Run as the caller so nothing it might
    # create is owned by root.
    in_image() {
      local entrypoint="$1"
      shift
      docker run --rm --network none \
        --user "$(id -u):$(id -g)" \
        --volume "$PROJECT_ROOT:/repo:ro" --workdir /repo \
        --entrypoint "$entrypoint" \
        "$ACTIONLINT_IMAGE" "$@"
    }
    actionlint() { in_image /usr/local/bin/actionlint "$@"; }
    shellcheck() { in_image shellcheck "$@"; }
    ;;
  binary)
    if ! command -v shellcheck >/dev/null 2>&1; then
      echo "Error: shellcheck not found. Run with Docker available, which takes it from" >&2
      echo "${ACTIONLINT_IMAGE%%@*}, or install it (apt-get install shellcheck / brew install shellcheck)." >&2
      exit 1
    fi

    # The checksum above is for the linux/amd64 build — the GitHub runners and
    # the machines this project is developed on. Another platform needs its own
    # checksum from the same release added here, not a bypass, or Docker.
    if [ "$(uname -s)/$(uname -m)" != "Linux/x86_64" ]; then
      echo "Error: the actionlint binary is pinned for linux/amd64 only. Use Docker, or add a checksum for $(uname -s)/$(uname -m)." >&2
      exit 1
    fi

    CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/stoky/actionlint-${ACTIONLINT_VERSION}"
    if [ ! -x "${CACHE_DIR}/actionlint" ]; then
      mkdir -p "$CACHE_DIR"
      TMP_DIR="$(mktemp -d)"
      trap 'rm -rf "$TMP_DIR"' EXIT
      curl -fsSL --retry 3 -o "${TMP_DIR}/actionlint.tar.gz" \
        "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
      echo "${ACTIONLINT_SHA256}  ${TMP_DIR}/actionlint.tar.gz" | sha256sum -c -
      tar -xzf "${TMP_DIR}/actionlint.tar.gz" -C "$CACHE_DIR" actionlint
    fi
    actionlint() { "${CACHE_DIR}/actionlint" "$@"; }
    ;;
  *)
    echo "Error: CHECK_CI_TOOLS must be 'image' or 'binary', not '${CHECK_CI_TOOLS}'." >&2
    exit 2
    ;;
esac

if [ "$TOOL" != shellcheck ]; then
  echo "==> actionlint (${CHECK_CI_TOOLS})"
  # Also runs shellcheck over every `run:` block in the workflow — shell that
  # lives nowhere in scripts/ and is otherwise linted by nothing. With no
  # files it finds .github/workflows/ itself.
  actionlint -no-color "${FILES[@]}"
fi

if [ "$TOOL" != actionlint ]; then
  if [ "${#FILES[@]}" -eq 0 ]; then
    FILES=(scripts/*.sh)
  fi
  echo "==> shellcheck (${CHECK_CI_TOOLS})"
  # -S warning: correctness, not style. The scripts predate this gate; style
  # churn would bury the findings that matter.
  shellcheck -S warning "${FILES[@]}"
fi

echo "CI lint: OK"
