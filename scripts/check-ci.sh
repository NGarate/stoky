#!/bin/bash

# Lints the CI pipeline itself: the workflows with actionlint, the scripts in
# scripts/ with shellcheck, and the workflows and Dependabot's configuration
# with zizmor for security.
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
# actionlint answers "will this workflow run"; zizmor answers "can it be
# turned against the repository" — template injection into `run:`, credentials
# left in the checkout, caches a release restores, unpinned actions. Neither
# reads for the other. zizmor comes from its own image, pinned by digest the
# same way, and runs offline: its online audits ask the GitHub API about the
# pinned actions, which needs a token and a network this gate does not have.
#
# zizmor runs with its default `regular` persona and fails on every finding
# it reports, at any severity. The tree is clean at that level, so a severity
# threshold would only let a new low or medium finding in unread. The
# `auditor` persona is not the gate: on 2026-10-12 it reported ten findings
# the regular one suppresses — four jobs whose granted permissions it wants a
# comment beside, rescan.yml's missing concurrency group, and five test-job
# images pinned by tag rather than digest (SECURITY.md, Known gaps) — and a
# gate red on its first day is a gate people learn to annotate away.
#
# Where Docker is not available, or CHECK_CI_TOOLS=binary asks for it, the old
# path remains: actionlint and zizmor downloaded and checked against a
# SHA-256, and shellcheck from the system (the GitHub runner images preinstall
# it). A missing tool fails this script rather than skipping the check — a
# guard nobody runs is not a guard.
#
# Usage:
#   bash scripts/check-ci.sh                       # all three, over everything
#   bash scripts/check-ci.sh actionlint [FILE...]  # the workflows, or these
#   bash scripts/check-ci.sh shellcheck [FILE...]  # scripts/*.sh and deploy/*.sh, or these
#   bash scripts/check-ci.sh zizmor [FILE...]      # .github/ (workflows, dependabot.yml), or these
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

ZIZMOR_VERSION="1.16.3"
# `docker buildx imagetools inspect ghcr.io/zizmorcore/zizmor:1.16.3` — the
# index, not a per-platform manifest.
ZIZMOR_IMAGE="ghcr.io/zizmorcore/zizmor:${ZIZMOR_VERSION}@sha256:f09cee55087d54e7a162fc255ffe82ef942f68e683f967c8a6471ffe35e7ec64"
# The release publishes no checksum file. This is the `digest` GitHub records
# for the x86_64-unknown-linux-gnu asset
# (`gh api repos/zizmorcore/zizmor/releases/tags/v1.16.3`), and a download
# hashed to it on 2026-10-12.
ZIZMOR_SHA256="f0070985e94dd7b29e30abe249f6c7b2f14078c35a8f2de78e2d6ce89de0c132"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

TOOL="${1:-all}"
case "$TOOL" in
  all) ;;
  actionlint | shellcheck | zizmor) shift ;;
  *)
    echo "usage: $0 [actionlint|shellcheck|zizmor] [FILE...]" >&2
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
      local image="$1" entrypoint="$2"
      shift 2
      docker run --rm --network none \
        --user "$(id -u):$(id -g)" \
        --volume "$PROJECT_ROOT:/repo:ro" --workdir /repo \
        --entrypoint "$entrypoint" \
        "$image" "$@"
    }
    actionlint() { in_image "$ACTIONLINT_IMAGE" /usr/local/bin/actionlint "$@"; }
    shellcheck() { in_image "$ACTIONLINT_IMAGE" shellcheck "$@"; }
    zizmor() { in_image "$ZIZMOR_IMAGE" /usr/bin/zizmor "$@"; }
    ;;
  binary)
    if ! command -v shellcheck >/dev/null 2>&1; then
      echo "Error: shellcheck not found. Run with Docker available, which takes it from" >&2
      echo "${ACTIONLINT_IMAGE%%@*}, or install it (apt-get install shellcheck / brew install shellcheck)." >&2
      exit 1
    fi

    # The checksums above are for the linux/amd64 builds — the GitHub runners
    # and the machines this project is developed on. Another platform needs its
    # own checksums from the same releases added here, not a bypass, or Docker.
    if [ "$(uname -s)/$(uname -m)" != "Linux/x86_64" ]; then
      echo "Error: the actionlint and zizmor binaries are pinned for linux/amd64 only. Use Docker, or add checksums for $(uname -s)/$(uname -m)." >&2
      exit 1
    fi

    TMP_DIR=""
    trap '[ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"' EXIT
    # `fetched NAME VERSION URL SHA256 MEMBER` sets FETCHED to the cached
    # binary, downloading it first and checking the archive against SHA256
    # before anything is extracted. Only the tool being run is fetched.
    fetched() {
      local dir="${XDG_CACHE_HOME:-$HOME/.cache}/stoky/$1-$2"
      FETCHED="${dir}/$1"
      [ -x "$FETCHED" ] && return 0
      TMP_DIR="${TMP_DIR:-$(mktemp -d)}"
      curl -fsSL --retry 3 -o "${TMP_DIR}/$1.tar.gz" "$3"
      echo "$4  ${TMP_DIR}/$1.tar.gz" | sha256sum -c -
      mkdir -p "$dir"
      tar -xzf "${TMP_DIR}/$1.tar.gz" -C "$dir" "$5"
    }
    actionlint() {
      fetched actionlint "$ACTIONLINT_VERSION" \
        "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
        "$ACTIONLINT_SHA256" actionlint
      "$FETCHED" "$@"
    }
    zizmor() {
      fetched zizmor "$ZIZMOR_VERSION" \
        "https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-x86_64-unknown-linux-gnu.tar.gz" \
        "$ZIZMOR_SHA256" ./zizmor
      "$FETCHED" "$@"
    }
    ;;
  *)
    echo "Error: CHECK_CI_TOOLS must be 'image' or 'binary', not '${CHECK_CI_TOOLS}'." >&2
    exit 2
    ;;
esac

if [ "$TOOL" = all ] || [ "$TOOL" = actionlint ]; then
  echo "==> actionlint (${CHECK_CI_TOOLS})"
  # Also runs shellcheck over every `run:` block in the workflow — shell that
  # lives nowhere in scripts/ and is otherwise linted by nothing. With no
  # files it finds .github/workflows/ itself.
  actionlint -no-color "${FILES[@]}"
fi

if [ "$TOOL" = all ] || [ "$TOOL" = shellcheck ]; then
  if [ "${#FILES[@]}" -eq 0 ]; then
    # nullglob: a tree with no deploy/*.sh must not hand shellcheck the
    # literal pattern as a file name.
    shopt -s nullglob
    FILES=(scripts/*.sh deploy/*.sh)
    shopt -u nullglob
  fi
  echo "==> shellcheck (${CHECK_CI_TOOLS})"
  # -S warning: correctness, not style. The scripts predate this gate; style
  # churn would bury the findings that matter.
  shellcheck -S warning "${FILES[@]}"
fi

if [ "$TOOL" = all ] || [ "$TOOL" = zizmor ]; then
  # .github/ rather than .github/workflows/: zizmor also audits
  # dependabot.yml, and any composite action that lands under .github/.
  # The shellcheck step may have filled FILES; only a zizmor run takes them.
  if [ "$TOOL" = all ] || [ "${#FILES[@]}" -eq 0 ]; then
    FILES=(.github)
  fi
  echo "==> zizmor (${CHECK_CI_TOOLS})"
  # --strict-collection: a workflow zizmor cannot parse is an error, not a
  # warning and an audit that quietly covered one file fewer.
  zizmor --offline --persona regular --strict-collection \
    --no-progress --color never "${FILES[@]}"
fi

echo "CI lint: OK"
