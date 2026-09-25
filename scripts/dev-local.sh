#!/bin/bash

# Stoky Local Development Setup Script
# Starts PostgreSQL and Valkey in Docker, then runs the Next.js app on the host.
# Usage: bash scripts/dev-local.sh [--seed] [--no-app]
#   --seed    Seed the database with demo data after migrations
#   --no-app  Set up infrastructure only, don't start the dev server

set -e

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
COMPOSE_FILE="docker-compose.dev.yml"
MAX_WAIT=60  # seconds to wait for healthy services
SEED=false
START_APP=true

for arg in "$@"; do
    case "$arg" in
        --seed)   SEED=true ;;
        --no-app) START_APP=false ;;
    esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

header() {
    echo ""
    echo -e "${BLUE}--- $1 ---${NC}"
}

ok()   { echo -e "  ${GREEN}✓ $1${NC}"; }
warn() { echo -e "  ${YELLOW}! $1${NC}"; }
fail() { echo -e "  ${RED}✗ $1${NC}"; exit 1; }

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Stoky Development Setup (Docker)      ${NC}"
echo -e "${BLUE}========================================${NC}"

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
header "Checking prerequisites"

if ! command_exists docker; then
    fail "Docker is not installed. Install from https://docs.docker.com/get-docker/"
fi
ok "Docker found ($(docker --version | head -c 40))"

# Verify the Docker daemon is running
if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon is not running. Start Docker and try again."
fi
ok "Docker daemon is running"

if ! command_exists bun; then
    fail "bun is not installed. Install it from https://bun.sh, or develop in the image (docs/LOCAL_BOOTSTRAP.md)."
fi

# The version check corepack used to make unnecessary.
#
# `packageManager` pinned pnpm and corepack enforced it, so everyone installed
# with the same manager. Bun has no corepack, and the failure it leaves behind
# is quiet in the direction that matters: `bun.lock` is written by the version
# in `.bun-version`, and an *older* bun reports "Unknown lockfile version",
# prints "Ignoring lockfile", and then resolves a tree nobody pinned. Only
# `--frozen-lockfile` turns that into an error, so installation below uses it.
#
# So the comparison happens here, before anything installs. `sort -V` rather
# than a numeric compare, because "1.10.0" is newer than "1.4.0" and a string
# or float comparison says the opposite.
PINNED_BUN="$(cat "$(cd "$(dirname "$0")/.." && pwd)/.bun-version")"
INSTALLED_BUN="$(bun --version)"
if [ "$(printf '%s\n%s\n' "$PINNED_BUN" "$INSTALLED_BUN" | sort -V | head -1)" != "$PINNED_BUN" ]; then
    fail "bun $INSTALLED_BUN is older than the pinned $PINNED_BUN, and cannot read bun.lock. Run 'bun upgrade', or develop in the image (docs/LOCAL_BOOTSTRAP.md)."
fi
ok "bun found ($INSTALLED_BUN, pinned $PINNED_BUN)"

# ---------------------------------------------------------------------------
# Environment file
# ---------------------------------------------------------------------------
header "Setting up environment"

# Resolve project root (parent of scripts/)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        ok ".env created from .env.example"
    else
        fail ".env.example not found — cannot create .env"
    fi
else
    ok ".env already exists"
fi

# ---------------------------------------------------------------------------
# Start Docker services
# ---------------------------------------------------------------------------
header "Starting Docker services (PostgreSQL + Valkey)"

if [ ! -f "$COMPOSE_FILE" ]; then
    fail "$COMPOSE_FILE not found in project root"
fi

docker compose -f "$COMPOSE_FILE" up -d
ok "Containers started"

# ---------------------------------------------------------------------------
# Wait for healthy services
# ---------------------------------------------------------------------------
header "Waiting for services to be healthy"

elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
    db_health=$(docker compose -f "$COMPOSE_FILE" ps db --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)
    cache_health=$(docker compose -f "$COMPOSE_FILE" ps cache --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)

    db_ok=false
    cache_ok=false

    echo "$db_health" | grep -qi "healthy" && db_ok=true
    echo "$cache_health" | grep -qi "healthy" && cache_ok=true

    if $db_ok && $cache_ok; then
        ok "PostgreSQL is healthy"
        ok "Valkey is healthy"
        break
    fi

    sleep 2
    elapsed=$((elapsed + 2))
    printf "  Waiting... (%ds / %ds)\r" "$elapsed" "$MAX_WAIT"
done

if [ $elapsed -ge $MAX_WAIT ]; then
    echo ""
    warn "Timed out waiting for services. Current status:"
    docker compose -f "$COMPOSE_FILE" ps
    fail "Services did not become healthy within ${MAX_WAIT}s"
fi

# ---------------------------------------------------------------------------
# Install dependencies
# ---------------------------------------------------------------------------
header "Installing dependencies"

# A directory is not proof of a current Bun install: it may be a stale or pnpm
# tree. Next can start with it and only fail resolving externals on navigation.
# Check the locked tree on every setup; an up-to-date install is a cheap no-op.
if [ -f node_modules/.modules.yaml ]; then
    # A normal Bun install retains pnpm links for unchanged versions, leaving
    # two dependency trees. Force replaces those links with Bun's packages.
    bun install --frozen-lockfile --force
    rm node_modules/.modules.yaml
else
    bun install --frozen-lockfile
fi
ok "Dependencies match bun.lock"

# ---------------------------------------------------------------------------
# Database migrations
# ---------------------------------------------------------------------------
header "Running database migrations"

bunx --bun prisma generate
ok "Prisma client generated"

bunx --bun prisma migrate dev
ok "Migrations applied"

# ---------------------------------------------------------------------------
# Seed (optional)
# ---------------------------------------------------------------------------
if $SEED; then
    header "Seeding database"
    bunx --bun prisma db seed
    ok "Database seeded"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "  ${BLUE}Services:${NC}"
echo "    PostgreSQL  localhost:5432  (Docker)"
echo "    Valkey      localhost:6379  (Docker)"
echo ""
echo -e "  ${BLUE}Useful commands:${NC}"
echo "    bun run dev:services        Start Docker services"
echo "    bun run dev:services:down   Stop Docker services"
echo "    bun run dev:services:logs   Tail service logs"
echo "    bunx --bun prisma studio          Visual DB browser"
echo ""

if $START_APP; then
    header "Starting Next.js dev server"
    exec bun run dev
else
    echo -e "  Run ${YELLOW}bun run dev${NC} to start the Next.js dev server."
    echo ""
fi
