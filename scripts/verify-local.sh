#!/bin/bash

# Stoky verification runner
# Usage:
#   bash scripts/verify-local.sh
#   bash scripts/verify-local.sh --ci
#   bash scripts/verify-local.sh --ci --with-e2e

set -euo pipefail

WITH_INTEGRATION=false
WITH_BUILD=false
WITH_E2E=false
RUN_CMD=()

for arg in "$@"; do
  case "$arg" in
    --ci)
      WITH_INTEGRATION=true
      WITH_BUILD=true
      ;;
    --with-integration)
      WITH_INTEGRATION=true
      ;;
    --with-build)
      WITH_BUILD=true
      ;;
    --with-e2e)
      WITH_E2E=true
      ;;
  esac
done

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun not found. Install it from https://bun.sh, or run the gates"
  echo "in the development image: bash scripts/ci-in-image.sh quality"
  exit 1
fi
# `bun run <script>`, never `bun <script>`: the bare form looks for a *file*,
# and `bun test` is Bun's own runner, which would sweep the integration suite
# with no database up instead of running the script of that name.
RUN_CMD=(bun run)

# The whole ladder is held to a budget, and every step to a ceiling.
#
# The budget exists because verification that takes half an hour stops being
# run, and a suite nobody runs is worse than none: it still has to be maintained
# and it no longer tells anyone anything. Ten minutes is the contract for
# everything here, not just the browser tests.
#
# The per-step ceilings exist because a step with no ceiling cannot tell you it
# is in trouble. This project has lost a thirty-minute run to a dev server that
# had wedged at 100% CPU and looked exactly like a slow one, and a shell wait
# loop that span for six and a half hours because nothing bounded it.
#
# Ceilings are generous against measured times (2026-08-09: lint 1s, typecheck
# 7s, links 1s, contrast 2s, unit 2s, components 10s, integration 39s). They are
# there to catch a hang, not to police a second.
BUDGET_SECONDS=${VERIFY_BUDGET_SECONDS:-600}
STARTED_AT=$(date +%s)

run_step() {
  local label="$1"
  local ceiling="$2"
  shift 2

  echo ""
  echo "==> $label"

  local step_started
  step_started=$(date +%s)

  # `code=0; cmd || code=$?` rather than `if ! cmd; then code=$?`. The second
  # form reads the status of the `!` expression, which is always 0 inside the
  # branch, so every ceiling silently passed. Found by setting one to a second
  # and watching the run succeed anyway — a guard nobody tests is not a guard.
  local code=0
  timeout "$ceiling" "$@" || code=$?

  if [ "$code" -ne 0 ]; then
    if [ "$code" -eq 124 ]; then
      echo "!! $label exceeded its ${ceiling}s ceiling and was stopped." >&2
      echo "   It is not slow, it is stuck. Look at what it was waiting for." >&2
    fi
    exit "$code"
  fi

  echo "    ${label}: $(( $(date +%s) - step_started ))s"
}

report_budget() {
  local total=$(( $(date +%s) - STARTED_AT ))
  echo ""
  echo "==> Total: ${total}s of a ${BUDGET_SECONDS}s budget"
  if [ "$total" -gt "$BUDGET_SECONDS" ]; then
    echo "!! Over budget. Verification this slow stops being run, which costs" >&2
    echo "   more than whatever the slow step was protecting." >&2
    exit 1
  fi
}

run_step "Lint" 120 "${RUN_CMD[@]}" lint
run_step "Typecheck" 180 "${RUN_CMD[@]}" typecheck
run_step "React doctor" 120 "${RUN_CMD[@]}" check:react
run_step "Internal links" 120 "${RUN_CMD[@]}" check:links
run_step "Contrast" 120 "${RUN_CMD[@]}" check:contrast
run_step "Unit tests" 120 "${RUN_CMD[@]}" test:unit
run_step "Component tests" 180 "${RUN_CMD[@]}" test:components

if $WITH_INTEGRATION; then
  run_step "Integration tests" 300 "${RUN_CMD[@]}" test:integration
fi

if $WITH_BUILD; then
  run_step "Build" 300 "${RUN_CMD[@]}" build
fi

if $WITH_E2E; then
  run_step "Critical-path Playwright smoke" 420 bunx playwright test e2e/critical-paths.spec.ts
fi

report_budget
