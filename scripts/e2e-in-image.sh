#!/bin/bash
#
# Run the browser suite inside Playwright's own image — the one CI's `e2e` job
# runs in — so the browsers and the system libraries they link against come
# with the project instead of from whatever the machine happens to have.
#
# They used to come from the machine. Chromium usually was there; Firefox and
# WebKit usually were not, and WebKit also wants libraries no desktop install
# carries (libmanette, libenchant, libhyphen, …). On 2026-10-09 a plain
# `bunx playwright test` reported 21 failures, 20 of which were "Executable
# doesn't exist" — the suite measuring the laptop, not the application. The
# recorded workaround was browsers unpacked under /tmp, .debs extracted with
# dpkg-deb and symlinked into WebKit's bundle, and an LD_LIBRARY_PATH: a
# procedure, not a project. A test that needs that to run is a test nobody
# runs, and the WebKit ones exist because UI-5 and UI-6 were WebKit defects.
#
# **Both versions come from the repository.** The image tag is the
# `@playwright/test` actually installed, so the browsers are always the ones the
# driver expects — the mismatch CI asserts against cannot happen here. Bun is
# `.bun-version`, copied out of its glibc image: the Dockerfile's base is the
# Alpine (musl) build, which does not run on Playwright's Ubuntu.
#
# The checkout is mounted with its own `node_modules`, and the container runs
# as the calling user, so `.next/` and the reports are the developer's files
# afterwards rather than root's. `--network host`, because that is where the
# development compose file publishes PostgreSQL and Valkey (127.0.0.1), and the
# suite derives its own database and cache index from them (`e2e/db-url.ts`).
#
# Usage:
#   bun run test:e2e                          # the whole suite
#   bun run test:e2e -- e2e/products.spec.ts  # anything playwright takes
#   bun run test:e2e -- --project=passkeys
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

PW_PACKAGE="node_modules/@playwright/test/package.json"
if [ ! -f "$PW_PACKAGE" ]; then
  echo "Error: $PW_PACKAGE not found. Run 'bun install' first." >&2
  exit 1
fi
PLAYWRIGHT_VERSION="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$PW_PACKAGE" | head -n 1)"
BUN_VERSION="$(tr -d '[:space:]' < .bun-version)"
if [ -z "$PLAYWRIGHT_VERSION" ] || [ -z "$BUN_VERSION" ]; then
  echo "Error: could not read the Playwright version ($PW_PACKAGE) or the Bun version (.bun-version)." >&2
  exit 1
fi
IMAGE_TAG="stoky-e2e:pw${PLAYWRIGHT_VERSION}-bun${BUN_VERSION}"

# The environment the suite needs, from `.env` when the caller has not exported
# it — the same file `bun run dev` reads.
if [ -z "${DATABASE_URL:-}${E2E_DATABASE_URL:-}" ] && [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

echo "==> Starting PostgreSQL and Valkey (docker-compose.dev.yml)"
docker compose -f docker-compose.dev.yml up -d --wait db cache

echo "==> Building $IMAGE_TAG"
docker build --quiet --tag "$IMAGE_TAG" - <<EOF >/dev/null
FROM oven/bun:${BUN_VERSION}-slim AS bun
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
EOF

echo "==> Running the browser suite in $IMAGE_TAG"
# --shm-size for the reason CI gives it: Docker's 64 MB /dev/shm is a cliff
# Chromium falls off quietly, by going slower rather than failing.
docker run --rm \
  --network host \
  --shm-size=2gb \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp/home \
  --volume "$PROJECT_ROOT:$PROJECT_ROOT" \
  --workdir "$PROJECT_ROOT" \
  --env "DATABASE_URL=${DATABASE_URL:-}" \
  --env "VALKEY_URL=${VALKEY_URL:-}" \
  --env "E2E_DATABASE_URL=${E2E_DATABASE_URL:-}" \
  --env "E2E_VALKEY_URL=${E2E_VALKEY_URL:-}" \
  --env "PLAYWRIGHT_PORT=${PLAYWRIGHT_PORT:-3100}" \
  "$IMAGE_TAG" \
  bunx --bun playwright test "$@"
