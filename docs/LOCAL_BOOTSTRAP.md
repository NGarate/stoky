# Stoky Local Bootstrap

Updated: 2026-03-23

This is the shortest supported path from clone to a running local app.

## Host prerequisites

- Docker with the daemon running
- Node.js 24 LTS
- `pnpm`, or `corepack` if `pnpm` is not installed globally

The repo currently works with `corepack pnpm` and the bootstrap script now
falls back to it automatically.

## Fast path

```bash
corepack pnpm install
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d db cache
corepack pnpm prisma generate
corepack pnpm prisma migrate dev
corepack pnpm dev
```

Or use the repo helper:

```bash
bash scripts/dev-local.sh
```

## Optional seeded bootstrap

```bash
bash scripts/dev-local.sh --seed
```

## Minimum success checks

Bootstrap is only considered complete when all of the following are true:

1. `docker compose -f docker-compose.dev.yml ps` shows healthy `db` and `cache`
2. `corepack pnpm prisma generate` succeeds
3. `corepack pnpm prisma migrate dev` succeeds
4. the Next dev server responds on `http://localhost:3000`
5. `/login` and `/register` render without server errors

## Known bootstrap dependencies

- Integration tests expect PostgreSQL and Valkey from `docker-compose.dev.yml`
- `test:integration` recreates `stoky_test` on every run
- E2E tests expect a running app on port `3000`

## If bootstrap is blocked

Do not guess. Record which of these failed:

- dependency install
- Docker health
- Prisma generate
- Prisma migrate
- app start

Then attach the exact command and stderr to the task note or logbook.
