#!/bin/bash

# Lints the CI pipeline itself: the workflow with actionlint, the scripts in
# scripts/ with shellcheck.
#
# Exists because a workflow bug has no test suite to fail: it surfaces as a red
# run after the push, on a trunk with no PR gate — so master is already wearing
# it. Most of the red runs in this repository's history were exactly that class
# of mistake, not failing tests.
#
# actionlint is fetched pinned and checksummed, same reasoning as the tessdata
# model in the Dockerfile: executable content entering the build from the
# internet does not get to float. shellcheck comes from the system because the
# GitHub runner images preinstall it; locally, install it once
# (apt-get install shellcheck / brew install shellcheck). A missing tool fails
# this script rather than skipping the check — a guard nobody runs is not a
# guard.

set -euo pipefail

ACTIONLINT_VERSION="1.7.12"
# From actionlint_1.7.12_checksums.txt on the GitHub release, linux_amd64.
ACTIONLINT_SHA256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "Error: shellcheck not found. Install it (apt-get install shellcheck / brew install shellcheck)." >&2
  exit 1
fi

# The checksum above is for the linux/amd64 build — the GitHub runners and the
# machines this project is developed on. Another platform needs its own
# checksum from the same release added here, not a bypass.
if [ "$(uname -s)/$(uname -m)" != "Linux/x86_64" ]; then
  echo "Error: actionlint is pinned for linux/amd64 only. Add a checksum for $(uname -s)/$(uname -m)." >&2
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

echo "==> actionlint"
# Also runs shellcheck over every `run:` block in the workflow — shell that
# lives nowhere in scripts/ and is otherwise linted by nothing.
"${CACHE_DIR}/actionlint" -no-color

echo "==> shellcheck scripts/"
# -S warning: correctness, not style. The scripts predate this gate; style
# churn would bury the findings that matter.
shellcheck -S warning scripts/*.sh

echo "CI lint: OK"
