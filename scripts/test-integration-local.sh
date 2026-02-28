#!/bin/bash

# Stoky Integration Test Runner
# Starts local infra services from this repo, applies migrations, and runs tests.
# Usage: bash scripts/test-integration-local.sh [bun test args...]
# Example: bash scripts/test-integration-local.sh src/__tests__/integration/auth.flow.test.ts

set -euo pipefail

COMPOSE_FILE="docker-compose.dev.yml"
MAX_WAIT=60
KEEP_SERVICES=false
PNPM_CMD=()
POSTGRES_USER="${POSTGRES_USER:-stoky}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-stoky_dev_password}"
TEST_DB_NAME="${TEST_DB_NAME:-stoky_test}"

if [[ "${KEEP_TEST_SERVICES:-}" == "1" || "${KEEP_TEST_SERVICES:-}" == "true" ]]; then
  KEEP_SERVICES=true
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM_CMD=(corepack pnpm)
else
  echo "Error: pnpm not found. Install pnpm or enable corepack."
  exit 1
fi

# Resolve project root (parent of scripts/)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: $COMPOSE_FILE not found in project root."
  exit 1
fi

cleanup() {
  if ! $KEEP_SERVICES; then
    docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  fi
}

if ! $KEEP_SERVICES; then
  trap cleanup EXIT
fi

echo "Starting local test services from $COMPOSE_FILE..."
docker compose -f "$COMPOSE_FILE" up -d db cache

echo "Waiting for services to be healthy..."
elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  db_health=$(docker compose -f "$COMPOSE_FILE" ps db --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)
  cache_health=$(docker compose -f "$COMPOSE_FILE" ps cache --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)

  db_ok=false
  cache_ok=false

  echo "$db_health" | grep -qi "healthy" && db_ok=true
  echo "$cache_health" | grep -qi "healthy" && cache_ok=true

  if $db_ok && $cache_ok; then
    echo "Services are healthy."
    break
  fi

  sleep 2
  elapsed=$((elapsed + 2))
done

if [ $elapsed -ge $MAX_WAIT ]; then
  echo "Error: services did not become healthy within ${MAX_WAIT}s."
  docker compose -f "$COMPOSE_FILE" ps
  exit 1
fi

echo "Recreating isolated test database: ${TEST_DB_NAME}"
docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"${TEST_DB_NAME}\";" \
  -c "CREATE DATABASE \"${TEST_DB_NAME}\";"

echo "Ensuring required PostgreSQL extensions in ${TEST_DB_NAME}..."
docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$POSTGRES_USER" -d "$TEST_DB_NAME" -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS \"pg_trgm\";" \
  -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"

export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${TEST_DB_NAME}?schema=public"
export VALKEY_URL="${VALKEY_URL:-redis://localhost:6379}"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-test-secret}"

echo "Applying database migrations..."
"${PNPM_CMD[@]}" prisma migrate deploy

if [ "${1:-}" = "--" ]; then
  shift
fi

if [ "$#" -eq 0 ]; then
  set -- src/__tests__/integration
fi

echo "Running Bun tests: $*"
bun test "$@"
