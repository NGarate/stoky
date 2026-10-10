# Stoky Local Bootstrap

Updated: 2026-10-10

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

## Running the development server

Five ways to reach it, in the order you will need them. **What you can test
depends on whether the origin is a secure context**: the barcode camera and the
service worker exist only on `https://` or `localhost`, so a plain-HTTP LAN or
tailnet address renders the app and nothing more.

| Way | URL | Camera | Service worker / install | Reachable from |
|---|---|---|---|---|
| 1. Local | `http://localhost:3000` | ✅ | ❌ dev tears it down | this machine |
| 2. LAN, plain HTTP | `http://<lan-ip>:3000` | ❌ | ❌ | your network |
| 3. Local TLS | `https://localhost:3000` | ✅ | ❌ dev tears it down | this machine |
| 4. Tailscale + TLS | `https://<machine>.<tailnet>.ts.net` | ✅ | ❌ dev tears it down | your tailnet, a phone included |
| 5. Production build | any of the above | ✅ | ✅ | as the row it is served through |

The service worker is **never** registered by `bun run dev`: development
actively unregisters it (`src/lib/sw/register.ts`), because a worker left from
a production build serves chunks that no longer exist. Testing offline or
"Install app" therefore needs row 5.

### 1. Local

```bash
bun run dev:setup          # first time: install, start db + cache, generate, migrate, start
bun run dev:services       # afterwards: db + cache, if they are not running
bun run dev                # http://localhost:3000
```

Or `docker compose up -d --build app` for the container path above. It
publishes `127.0.0.1:3000` only, so rows 2 and 3 do not apply to it. Row 4 does,
because `tailscale serve` proxies to loopback.

### 2. From another device on the LAN (plain HTTP)

`next dev` listens on every interface and prints the `Network:` address. Next
answers **403 to `/_next/*` from an origin it was not told about**, and the
symptom is a page that renders and never hydrates: the login form falls back
to a native GET. `192.168.8.*` is allowed in `next.config.ts`; any other
address goes in `.env`, and `next dev` must be restarted to read it:

```bash
DEV_ALLOWED_ORIGIN=192.168.1.20
```

Useful for layout on a real screen. The camera says it needs `https://`, and it
is right.

### 3. Local TLS, without Tailscale

```bash
bun run dev --experimental-https
```

Next creates a certificate with `mkcert` and, the first time, **installs a
local certificate authority into this machine's trust store** (it may ask for
your password). Only this machine trusts it, so a phone does not: use row 4
for a phone. Set `NEXTAUTH_URL="https://localhost:3000"` in `.env` while you
use it, so Auth.js builds its callback URLs with the right scheme. *Not run
while writing this section* (2026-10-10), because it changes the system trust
store. The flag is from `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`.

### 4. Tailscale with TLS — the phone path

`tailscale serve` terminates TLS with a real Let's Encrypt certificate for the
machine's tailnet name and proxies to the dev server. The phone needs only the
Tailscale app, with no certificate to trust by hand. This is how the scanner was
tested on a real device (`docs/PROGRESS.md`, "the owner's second pass").

Once per tailnet, in the admin console under **DNS**: enable **MagicDNS** and
**HTTPS Certificates**. Then:

```bash
# The name to use (strip the trailing dot)
tailscale status --json | jq -r '.Self.DNSName'      # e.g. my-machine.tail1234.ts.net.

# .env — then restart `bun run dev`, which reads it at start-up
DEV_ALLOWED_ORIGIN=my-machine.tail1234.ts.net
NEXTAUTH_URL="https://my-machine.tail1234.ts.net"

bun run dev                         # terminal 1
tailscale serve --bg 3000           # once; persists across reboots
tailscale serve status              # https://my-machine…ts.net (tailnet only) |-- / proxy http://127.0.0.1:3000
```

Open `https://my-machine.tail1234.ts.net` on any device signed in to the
tailnet. The first request after enabling HTTPS can take several seconds
while the certificate is issued.

- **Tailnet only.** `serve` is not `funnel`. Nothing is exposed to the
  internet, and it must stay that way for a development server.
- **To stop:** `tailscale serve --https=443 off`. **Not `tailscale serve
  reset`**, which deletes every serve rule on the machine, not just this one.
- `DEV_ALLOWED_ORIGIN` takes a comma-separated list. Add the tailnet IP
  (`tailscale ip -4`) as well if you also open `http://100.x.y.z:3000`
  directly. That plain-HTTP route behaves like row 2.

Verified on 2026-10-10: on this project's development machine, `tailscale serve
status` reports `https://<machine>.ts.net (tailnet only) |-- / proxy
http://127.0.0.1:3000`, which is the configuration above.

### 5. A production build, to test offline and installing

```bash
bun run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1 bun .next/standalone/server.js
```

These are the steps the browser suite runs (`playwright.config.ts`,
`webServer`) and the image runs. `bun run start` *appears* to work, but it warns
`"next start" does not work with "output: standalone"` and serves `.next/`
rather than the bundle the image ships, so it can hide a tracing defect.
`NEXTAUTH_SECRET` must not be the example value, because production refuses to
start on it.

Served through row 4, this is the one setup where a phone can **install** the
app. On Android, Chrome's menu shows **Install app**. On iOS, use Safari's
**Share → Add to Home Screen**. The manifest is `src/app/manifest.ts`, and the
icons are generated from `public/icons/*.svg` by `bun scripts/generate-icons.ts`.

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
- E2E tests build, serve and seed their own server, database and cache; see
  [Environment assumptions](VERIFICATION_SEQUENCE.md#environment-assumptions),
  which owns how the browser suite runs. A taken port (3100 by default,
  `PLAYWRIGHT_PORT` overrides) fails loudly; it is never adopted.

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
