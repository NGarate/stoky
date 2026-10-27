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
  # Read after the `cd` to the project root, so it is this repository's .env
  # whatever directory the script was started from. `|| true`: under pipefail a
  # .env with no such line (or one written `export DATABASE_URL=`) used to end
  # the script with exit 1 and no message at all.
  DATABASE_URL="$( { grep -E '^(export )?DATABASE_URL=' .env || true; } | tail -1 | cut -d= -f2- | tr -d '"'"'"'"')"
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
# `--wait` returns once both healthchecks pass, and fails past the timeout.
if ! docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout "$MAX_WAIT" db cache; then
  echo "Error: services did not become healthy within ${MAX_WAIT}s."
  docker compose -f "$COMPOSE_FILE" ps
  exit 1
fi
echo "Services are healthy."

echo "Recreating isolated test database: ${TEST_DB_NAME}"
docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"${TEST_DB_NAME}\";" \
  -c "CREATE DATABASE \"${TEST_DB_NAME}\";"

# No extensions created here: the first migration creates them, and doing it
# for it would let a migration that forgot one pass locally and fail only in
# CI or on a first install (scripts/ci-in-image.sh says why that matters).

export DATABASE_URL="$TEST_DATABASE_URL"
export VALKEY_URL="${VALKEY_URL:-redis://localhost:6379}"
# Thirty-two characters or more, the length production requires
# (src/lib/auth/secret.ts), so the suites sign with a key of the shape a real
# one has. The first STOKY_URLS entry is the one Better Auth is built with, and
# the origin the sign-in helper sends (src/__tests__/utils/authorize.ts).
export STOKY_SECRET="${STOKY_SECRET:-integration-suite-secret-not-a-real-one}"
export STOKY_URLS="${STOKY_URLS:-http://localhost:3000}"

echo "Applying database migrations..."
# `bunx`, not `bun run`: prisma is a binary in node_modules/.bin, not a script
# in package.json, and `bun run prisma` would look for the latter and find none.
bunx --bun prisma migrate deploy

echo "Checking the schema against what the migrations built..."
# Exits 2 on any difference: a schema change committed without its migration.
bunx --bun prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --exit-code

if [ "${1:-}" = "--" ]; then
  shift
fi

if [ "$#" -eq 0 ]; then
  set -- src/__tests__/integration
fi

echo "Running Bun tests: $*"
bun test "$@"
