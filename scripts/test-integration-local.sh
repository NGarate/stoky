#!/bin/bash

# Stoky Integration Test Runner
# Starts local infra services from this repo, applies migrations, and runs tests.
# Usage: bash scripts/test-integration-local.sh [bun test args...]
# Example: bash scripts/test-integration-local.sh src/__tests__/integration/auth.flow.test.ts

set -euo pipefail

COMPOSE_FILE="docker-compose.dev.yml"
MAX_WAIT=60
KEEP_SERVICES=false
TEST_DB_NAME="${TEST_DB_NAME:-stoky_test}"

# The credentials the *running container* answers to, taken from the same place
# the application takes them: `DATABASE_URL`.
#
# These used to be read from `POSTGRES_USER` / `POSTGRES_PASSWORD` with the
# compose defaults as a fallback, and that fails in the one case a developer
# actually hits. `.env` carries both a working `DATABASE_URL` and a
# `POSTGRES_PASSWORD`, and nothing keeps the two in step — the second is only
# read when the container is *created*. Source `.env` into your shell, which is
# what the documented workflow does, and this script would build a connection
# string from a password the database has never been told about, then fail with
# a bare Prisma `P1000` naming neither the variable nor the mismatch.
#
# Deriving from `DATABASE_URL` and swapping only the database name means the
# credentials are whatever already works.
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  # Only this one line, and only its value: sourcing the whole file would pull
  # in every other variable and change what the tests run against.
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"'"')"
fi

if [ -n "${DATABASE_URL:-}" ]; then
  # postgresql://user:password@host:port/name?params → keep everything but name.
  DB_PREFIX="${DATABASE_URL%/*}"
  DB_QUERY=""
  case "$DATABASE_URL" in
    *\?*) DB_QUERY="?${DATABASE_URL#*\?}" ;;
  esac
  TEST_DATABASE_URL="${DB_PREFIX}/${TEST_DB_NAME}${DB_QUERY}"
  POSTGRES_USER="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[^:]+://([^:]+):.*#\1#')"
else
  POSTGRES_USER="${POSTGRES_USER:-stoky}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-stoky_dev_password}"
  TEST_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${TEST_DB_NAME}?schema=public"
fi

if [[ "${KEEP_TEST_SERVICES:-}" == "1" || "${KEEP_TEST_SERVICES:-}" == "true" ]]; then
  KEEP_SERVICES=true
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun not found. Install it from https://bun.sh, or run this suite"
  echo "in the development image: bash scripts/ci-in-image.sh test"
  exit 1
fi

# Resolve project root (parent of scripts/)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: $COMPOSE_FILE not found in project root."
  exit 1
fi

# Whether `db` or `cache` was already running before this script touched
# anything.
#
# `cleanup` runs `docker compose down`, which removes the containers and the
# network — and it used to do that whatever the state was when it started. So a
# developer with services up, running the integration suite, got them taken away
# underneath whatever they were doing next: the browser suite that follows fails
# at its seed step with a hundred tests unrun, which reads as a catastrophe and
# is a stopped container.
#
# Tearing down what this script started is right. Tearing down what it found is
# not.
ALREADY_RUNNING=false
if docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null \
    | grep -qE '^(db|cache)$'; then
  ALREADY_RUNNING=true
fi

cleanup() {
  if ! $KEEP_SERVICES && ! $ALREADY_RUNNING; then
    docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  fi
}

if ! $KEEP_SERVICES; then
  trap cleanup EXIT
fi

if $ALREADY_RUNNING; then
  echo "Reusing the services already running from $COMPOSE_FILE (they will be left up)."
else
  echo "Starting local test services from $COMPOSE_FILE..."
fi
docker compose -f "$COMPOSE_FILE" up -d db cache

echo "Waiting for services to be healthy..."
elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  db_health=$(docker compose -f "$COMPOSE_FILE" ps db --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)
  cache_health=$(docker compose -f "$COMPOSE_FILE" ps cache --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)

  db_ok=false
  cache_ok=false

  echo "$db_health" | grep -qx '"Health":"healthy"' && db_ok=true
  echo "$cache_health" | grep -qx '"Health":"healthy"' && cache_ok=true

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

export DATABASE_URL="$TEST_DATABASE_URL"
export VALKEY_URL="${VALKEY_URL:-redis://localhost:6379}"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-test-secret}"

echo "Applying database migrations..."
# `bunx`, not `bun run`: prisma is a binary in node_modules/.bin, not a script
# in package.json, and `bun run prisma` would look for the latter and find none.
bunx --bun prisma migrate deploy

if [ "${1:-}" = "--" ]; then
  shift
fi

if [ "$#" -eq 0 ]; then
  set -- src/__tests__/integration
fi

echo "Running Bun tests: $*"
bun test "$@"
