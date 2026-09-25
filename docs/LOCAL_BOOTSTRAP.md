# Stoky Local Bootstrap

Updated: 2026-09-25

This is the shortest supported path from clone to a running local app.
For an installed alpha with prebuilt images, use [Install](INSTALL.md).

There are two of them. **Prefer the container** — it is the same image that
serves production, and the gap between "works here" and "works there" is where
this project has lost the most time. The host path is kept because it is faster
to iterate in, not because it is more correct.

## Host prerequisites

- Docker with the daemon running
- **Bun**, at the version in `.bun-version`. It is the package manager as well
  as the runtime — `bun run dev` and `bun run start` both run `bun --bun` — so
  without it nothing below works, starting with `bun: not found`

Dependency installation, Next builds, Prisma commands and the application all
run with Bun. The Dockerfile uses the pinned Bun Alpine image in every stage.
That image includes a compatibility command named `node` which resolves to Bun;
there is no separate Node.js runtime or npm installation. Production runs as
`bun` (UID/GID 1000), preserving ownership of existing upload volumes.

That version is a floor, not a suggestion, and nothing enforces it for you any
more. `bun.lock` is lockfileVersion 2, written by the pinned Bun; an older one
reports *Unknown lockfile version*, prints *Ignoring lockfile*, and then
resolves a tree nobody pinned, because only `--frozen-lockfile` turns that into
an error. `scripts/dev-local.sh` compares `bun --version` against
`.bun-version` before it installs anything, which is the only check left —
`bun upgrade`, or develop in the image, if it refuses.

## Fast path

```bash
bun install --frozen-lockfile
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d db cache
bunx --bun prisma generate
bunx --bun prisma migrate dev
bun run dev
```

Or use the repo helper:

```bash
bash scripts/dev-local.sh
```

The helper runs `bun install --frozen-lockfile` on every setup, including when
`node_modules` already exists. If it finds pnpm's `.modules.yaml`, it uses
`--force` to replace retained pnpm symlinks and removes that marker only after
installation succeeds. A failed install stops setup before Prisma runs.

### Existing checkout fails with `Failed to load external module argon2-…`

Stop the dev server and run `bun run dev:setup` again. The helper now repairs
an existing pnpm install instead of skipping it. On 2026-09-08, the host had
Next 16.3.4 in a pnpm tree while `bun.lock` pinned 16.3.3; `/login` returned
500 although importing `argon2` directly worked. A normal Bun install retained
pnpm links for unchanged packages. Running `bun install --frozen-lockfile
--force`, regenerating Prisma, and restarting the dev server restored HTTP 200.
The exact upstream cause of the generated alias failure remains unconfirmed.

`src/__tests__/unit/dev-local.test.ts` exercises setup with absent, existing,
and pnpm dependency directories, plus failed installs, using command stubs.

## The container path, which is the one to prefer

```bash
docker compose up -d --build app      # the dev server, on the compose network
docker compose exec app bun run test:unit
docker compose exec app bun run test:components
```

Or open the repository in the devcontainer (`.devcontainer/devcontainer.json`),
which attaches the editor to that same container so the language server reads
the platform's own binaries rather than the host's. That is the whole point: a
language server resolving against a `node_modules` built for a different
platform is the same class of gap as a suite that passes where nobody deploys.

Four traps, each of which cost an afternoon:

- **`--build` is not optional.** Compose reuses whatever image is already tagged
  and does not notice the Dockerfile changed, so `up -d app` after a Dockerfile
  edit silently starts the old one. Found with a container whose dev script died
  on `sh: bun: not found`, because the image predated Bun.
- **After a dependency change, the anonymous `node_modules` volume outlives the
  rebuild** and holds the old tree. Under pnpm this announced itself — it
  reinstalled on start, or aborted asking for a TTY to confirm a purge. Since
  the move to Bun on 2026-08-28 **nothing announces it**: the container's
  command is `bun run dev`, which starts Next and installs nothing, so a stale
  tree simply runs. The symptom is a module that is missing or the wrong
  version, at the point of use rather than at start-up. Renew the volume:
  `docker compose up -d --build --force-recreate --renew-anon-volumes app`.
- **Change a dependency and the image is stale.** `node_modules` is baked into
  it. Rebuilding is the fix — `docker compose build app` — and the rebuild is
  where a half-made change is caught: the `deps` stage runs
  `bun install --frozen-lockfile`, so a `package.json` edited without its
  `bun.lock` fails there with "lockfile had changes, but lockfile is frozen"
  rather than resolving something nobody pinned.
- **The dev image needs its source mounted; it does not carry a working one.**
  `docker run` on the `development` target without compose's `.:/app` starts and
  reports `✓ Ready`, then answers 500 on any page that touches auth, with
  `Failed to load external module argon2-…: Cannot find module`. Measured
  2026-08-28 on the image both before and after the move to Bun, so it is not
  something the package manager changed, and measured *not* to happen through
  compose, where the same image serves `/login` in 200. The mechanism is not
  understood and is not worth chasing: the supported way to run this image is
  `docker compose up app`, and the note exists so that a debugging `docker run`
  is not mistaken for a broken application.

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
2. `bunx --bun prisma generate` succeeds
3. `bunx --bun prisma migrate dev` succeeds
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
