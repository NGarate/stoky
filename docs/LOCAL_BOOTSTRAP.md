# Stoky Local Bootstrap

Updated: 2026-08-09

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
- E2E tests need two things this file did not previously mention: a **seeded
database** — the suite signs in once as the demo account, so an unseeded one
fails the whole matrix at its first step — and a **free port**. Playwright
starts its own server and adopts an existing one when the port is taken, so on
this machine, where port 3000 belongs to something else, pass `PLAYWRIGHT_PORT`

## If Docker is unreachable

If `docker ps` or any `docker compose` command fails with:

```
permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock
```

then this user is not in the `docker` group, or the current session predates the
membership. Grant the group once:

```bash
sudo usermod -aG docker $USER
```

That command alone is not enough, and this is where the time usually goes.
Group membership is fixed when a login session starts, so a shell opened before
the group was granted still fails even though the membership now exists. Apply
it one of three ways:

- log out and back in — the durable fix
- `newgrp docker` — opens a new shell in the current terminal with the group applied
- `sg docker -c "docker compose -f docker-compose.dev.yml up -d db cache"` — for a single command

Confirm with `docker ps`, which must succeed without `sudo`.

If the message is *Cannot connect to the Docker daemon* rather than *permission
denied*, the daemon is not running at all:

```bash
sudo systemctl start docker
sudo systemctl enable docker   # auto-start on boot
```

`sudo docker compose ...` works as a stopgap, but it runs with root's
environment rather than yours; use `sudo -E` if that matters. Prefer the group
fix.

Port 3000 already being in use is a separate trap. It is documented, with the
Playwright workaround, in `docs/VERIFICATION_SEQUENCE.md`.

## If bootstrap is blocked

Do not guess. Record which of these failed:

- dependency install
- Docker health
- Prisma generate
- Prisma migrate
- app start

Then attach the exact command and stderr to the task note or logbook.
