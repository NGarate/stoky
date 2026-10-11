#!/bin/bash

# Runs the static checks over one of three scopes.
#
#   bash scripts/check-scope.sh all                 # what CI runs on master
#   bash scripts/check-scope.sh staged              # before a commit
#   bash scripts/check-scope.sh changed [--base R]  # a PR, or a branch before pushing
#
# --no-pipeline-lint reports actionlint and shellcheck as skipped. It is for
# the development image in CI, which has neither Docker nor shellcheck, and
# where check-ci.sh has already linted every workflow and script on the runner.
#
# Exists because a whole-project scan before a commit reports old findings in
# files nobody touched, and that teaches people to stop reading it. `staged`
# and `changed` answer the question actually being asked: is what *I* did
# clean. They are feedback, not a gate — only `verify:ci` and the CI run prove
# anything, because a change can break a file it did not touch.
#
# Each narrower scope is a subset of `all`: a file `all` would not check is not
# checked here either, so a scoped run cannot fail on something CI accepts.
#
# `changed` compares the working tree with the merge base of R and HEAD, which
# is what React Doctor's own `--scope changed` does: committed and uncommitted
# work alike. In CI the two are the same. R defaults to origin/master, fetched
# first if this clone has never seen it.
#
# Every check runs even after one fails, and the summary says which ran, which
# failed and which were skipped. An empty file list is reported as skipped,
# never as a pass: a check that did not run must not look like one that did.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

usage() {
  echo "usage: $0 {all|staged|changed [--base REF]} [--no-pipeline-lint]" >&2
  exit 2
}

SCOPE="${1:-}"
[ -n "$SCOPE" ] || usage
shift
BASE_REF=""
PIPELINE_LINT=true
while [ $# -gt 0 ]; do
  case "$1" in
    --base)
      [ "$SCOPE" = changed ] && [ $# -ge 2 ] || usage
      BASE_REF="$2"
      shift 2
      ;;
    --no-pipeline-lint)
      PIPELINE_LINT=false
      shift
      ;;
    *) usage ;;
  esac
done

# --diff-filter=ACMR: a deleted file has nothing left to lint. -z, so a path
# with a space in it arrives as one path.
FILES=()
case "$SCOPE" in
  all) ;;
  staged)
    while IFS= read -r -d '' file; do FILES+=("$file"); done \
      < <(git diff --cached --name-only --diff-filter=ACMR -z)
    ;;
  changed)
    if [ -z "$BASE_REF" ]; then
      BASE_REF=origin/master
      if ! git rev-parse --verify -q "${BASE_REF}^{commit}" >/dev/null; then
        git fetch --quiet origin master
      fi
    fi
    MERGE_BASE="$(git merge-base "$BASE_REF" HEAD)"
    while IFS= read -r -d '' file; do FILES+=("$file"); done \
      < <(git diff --name-only --diff-filter=ACMR -z "$MERGE_BASE")
    ;;
  *) usage ;;
esac

# The same sets `all` covers: oxlint and React Doctor walk the project's
# sources, actionlint the workflow directory, shellcheck scripts/*.sh.
SOURCES=()
WORKFLOWS=()
SCRIPTS=()
DEPENDENCIES=()
for file in "${FILES[@]}"; do
  case "$file" in
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs) SOURCES+=("$file") ;;
  esac
  case "$file" in
    .github/workflows/*/*) ;;
    .github/workflows/*.yml | .github/workflows/*.yaml) WORKFLOWS+=("$file") ;;
  esac
  case "$file" in
    scripts/*/*) ;;
    scripts/*.sh) SCRIPTS+=("$file") ;;
  esac
  case "$file" in
    package.json | bun.lock) DEPENDENCIES+=("$file") ;;
  esac
done

RESULTS=()
FAILED=0

run() {
  local label="$1"
  shift
  echo ""
  echo "==> $label"
  local code=0
  "$@" || code=$?
  if [ "$code" -eq 0 ]; then
    RESULTS+=("ok       $label")
  elif [ "$code" -eq 75 ]; then
    # EX_TEMPFAIL: could not run here. Only check-audit.sh, offline.
    RESULTS+=("skipped  $label: offline")
  else
    RESULTS+=("FAILED   $label (exit $code)")
    FAILED=1
  fi
}

skip() {
  echo ""
  echo "==> $1: skipped, $2"
  RESULTS+=("skipped  $1: $2")
}

# `count NAME`, for the label: how many files a scoped check was given.
count() {
  local -n list="$1"
  if [ "${#list[@]}" -eq 1 ]; then echo "1 file"; else echo "${#list[@]} files"; fi
}

# React Doctor's flags — no telemetry, no supply-chain upload, errors only —
# live once, in package.json's `check:react`, which verify-local.sh and the
# development image also run. Every scope goes through it and only adds the
# scope, so no scope can forget one.
case "$SCOPE" in
  all)
    run "oxlint" bun run lint
    run "React Doctor" bun run check:react --scope full
    if $PIPELINE_LINT; then
      run "actionlint" bash scripts/check-ci.sh actionlint
      run "shellcheck" bash scripts/check-ci.sh shellcheck
    fi
    run "dependency audit" bun run check:audit
    ;;
  staged | changed)
    if [ "${#SOURCES[@]}" -gt 0 ]; then
      run "oxlint ($(count SOURCES))" bun run lint "${SOURCES[@]}"
      if [ "$SCOPE" = staged ]; then
        run "React Doctor" bun run check:react --staged
      else
        run "React Doctor" bun run check:react --scope changed --base "$MERGE_BASE"
      fi
    else
      skip "oxlint" "no $SCOPE source files"
      skip "React Doctor" "no $SCOPE source files"
    fi

    if $PIPELINE_LINT; then
      if [ "${#WORKFLOWS[@]}" -gt 0 ]; then
        run "actionlint ($(count WORKFLOWS))" bash scripts/check-ci.sh actionlint "${WORKFLOWS[@]}"
      else
        skip "actionlint" "no $SCOPE workflows"
      fi

      if [ "${#SCRIPTS[@]}" -gt 0 ]; then
        run "shellcheck ($(count SCRIPTS))" bash scripts/check-ci.sh shellcheck "${SCRIPTS[@]}"
      else
        skip "shellcheck" "no $SCOPE scripts"
      fi
    fi

    # A new dependency is when the risk arrives, so that is when to look.
    if [ "${#DEPENDENCIES[@]}" -gt 0 ]; then
      run "dependency audit" bun run check:audit
    else
      skip "dependency audit" "no dependency change"
    fi
    ;;
esac

if ! $PIPELINE_LINT; then
  skip "actionlint" "--no-pipeline-lint"
  skip "shellcheck" "--no-pipeline-lint"
fi

# Types do not scope by file: a change to one signature breaks its callers,
# which are not in the list. Whole project, every scope.
run "typecheck" bun run typecheck

echo ""
echo "==> Summary ($SCOPE)"
for line in "${RESULTS[@]}"; do
  echo "  $line"
done

exit "$FAILED"
