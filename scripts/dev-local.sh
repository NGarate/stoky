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
PNPM_CMD=()

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

if command_exists pnpm; then
    PNPM_CMD=(pnpm)
    ok "pnpm found ($(pnpm --version))"
elif command_exists corepack; then
    PNPM_CMD=(corepack pnpm)
    ok "pnpm will be resolved through corepack"
else
    fail "pnpm is not installed and corepack is unavailable. Install pnpm or enable corepack."
fi

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

if [ ! -d node_modules ]; then
    "${PNPM_CMD[@]}" install
    ok "Dependencies installed"
else
    ok "node_modules already exists (run 'corepack pnpm install' to update)"
fi

# ---------------------------------------------------------------------------
# Database migrations
# ---------------------------------------------------------------------------
header "Running database migrations"

"${PNPM_CMD[@]}" prisma generate
ok "Prisma client generated"

"${PNPM_CMD[@]}" prisma migrate dev
ok "Migrations applied"

# ---------------------------------------------------------------------------
# Seed (optional)
# ---------------------------------------------------------------------------
if $SEED; then
    header "Seeding database"
"${PNPM_CMD[@]}" prisma db seed
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
echo "    pnpm dev:services        Start Docker services"
echo "    pnpm dev:services:down   Stop Docker services"
echo "    pnpm dev:services:logs   Tail service logs"
echo "    pnpm prisma studio       Visual DB browser"
echo ""

if $START_APP; then
    header "Starting Next.js dev server"
    exec "${PNPM_CMD[@]}" dev
else
    echo -e "  Run ${YELLOW}corepack pnpm dev${NC} to start the Next.js dev server."
    echo ""
fi
