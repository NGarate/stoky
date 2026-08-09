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
PNPM_CMD=()

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

if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM_CMD=(corepack pnpm)
else
  echo "Error: pnpm not found. Install pnpm or enable corepack."
  exit 1
fi

run_step() {
  echo ""
  echo "==> $1"
  shift
  "$@"
}

run_step "Lint" "${PNPM_CMD[@]}" lint
run_step "Typecheck" "${PNPM_CMD[@]}" typecheck
run_step "Internal links" "${PNPM_CMD[@]}" check:links
run_step "Unit tests" "${PNPM_CMD[@]}" test:unit
run_step "Component tests" "${PNPM_CMD[@]}" test:components

if $WITH_INTEGRATION; then
  run_step "Integration tests" "${PNPM_CMD[@]}" test:integration
fi

if $WITH_BUILD; then
  run_step "Build" "${PNPM_CMD[@]}" build
fi

if $WITH_E2E; then
  run_step "Critical-path Playwright smoke" bunx playwright test e2e/critical-paths.spec.ts
fi
