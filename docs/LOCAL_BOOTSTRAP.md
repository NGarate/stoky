# Stoky Local Bootstrap

Updated: 2026-08-27

This is the shortest supported path from clone to a running local app.

There are two of them. **Prefer the container** — it is the same image that
serves production, and the gap between "works here" and "works there" is where
this project has lost the most time. The host path is kept because it is faster
to iterate in, not because it is more correct.

## Host prerequisites

- Docker with the daemon running
- Node.js 24 — for `pnpm` and the tooling, not for running the app
- **Bun**, at the version in `.bun-version`. `pnpm dev` and `pnpm start` both run
  `bun --bun`, so without it the fast path below dies on `bun: not found`
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

## The container path, which is the one to prefer

```bash
docker compose up -d --build app      # the dev server, on the compose network
docker compose exec app corepack pnpm test:unit
docker compose exec app corepack pnpm test:components
```

Or open the repository in the devcontainer (`.devcontainer/devcontainer.json`),
which attaches the editor to that same container so the language server reads
the platform's own binaries rather than the host's. That is the whole point: a
language server resolving against a `node_modules` built for a different
platform is the same class of gap as a suite that passes where nobody deploys.

Three traps, each of which cost an afternoon:

- **`--build` is not optional.** Compose reuses whatever image is already tagged
  and does not notice the Dockerfile changed, so `up -d app` after a Dockerfile
  edit silently starts the old one. Found with a container whose dev script died
  on `sh: bun: not found`, because the image predated Bun.
- **After a dependency change, the anonymous `node_modules` volume outlives the
  rebuild** and holds the old tree, so pnpm reinstalls everything on start — or
  aborts, when there is no TTY to confirm the purge. Renew it:
  `docker compose up -d --build --force-recreate --renew-anon-volumes app`.
- **Change a dependency and the image is stale.** `node_modules` is baked into
  it, so pnpm finds a lockfile it does not match and aborts rather than purging
  without a TTY. `docker compose build app`.

**Bun is pinned twice** — in `.bun-version`, which CI installs, and in the
Dockerfile, because a `FROM` cannot read a file.
`src/__tests__/unit/bun-version.test.ts` fails if they disagree, which they did
once: the image moved to 1.4.0 while CI stayed on 1.3.14, and a green pipeline
was proving the suites passed on a runtime nobody deploys.

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
