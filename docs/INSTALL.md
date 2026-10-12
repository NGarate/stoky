# Install Stoky with Docker Compose

This guide is for **v0.1.0-alpha.3**, the third testing release. Keep backups;
alpha upgrades can change the database and may require manual migration steps.
For development from source, use [Local Bootstrap](LOCAL_BOOTSTRAP.md).

The installation follows the [Immich Compose guide](https://docs.immich.app/install/docker-compose/):
download the release's Compose file, environment template and Traefik file, configure them,
then start the containers. Stoky's bundle includes PostgreSQL, Valkey, the app
and Traefik. You do not need Git, Node.js, Bun or a local build.

## Requirements

- A Linux **x86-64 / amd64** Docker host. ARM images are not published for this alpha.
- Docker Engine and **Docker Compose 2.23.1 or newer** (`docker compose version`).
  Use the Compose plugin (`docker compose`), not the legacy Python binary.
- A starting allocation of **2 CPU cores and 4 GiB RAM**, plus disk space for
  images, PostgreSQL, uploaded receipts and backups. This is a planning allowance,
  not a measured minimum. OCR performance depends on the host and photographs.
- A hostname you control, with DNS pointing to the server — preferably a
  dedicated subdomain such as `stoky.example.com`, for the reason given under
  `DOMAIN` in step 2. The included TLS-ALPN
  challenge requires Let's Encrypt to reach **TCP 443**; clients use TCP 80/443.
  Both ports must be free. An existing proxy or a LAN-only/VPN-only installation
  needs its own trusted TLS configuration; the supplied ACME setup does not work
  for `localhost`, a bare private IP, or an unreachable hostname.
- `curl`, `openssl`, `sha256sum` and a text editor. No GitHub account is needed:
  the release files and the image download anonymously.

From the release after v0.1.0-alpha.3, registration is closed after the first
account. The person who installs Stoky registers first and becomes the owner of
the household; everyone else is added by them from **Configuración → Personas
del hogar**. `STOKY_REGISTRATION` in `.env` changes that (step 2).
**v0.1.0-alpha.3 itself has no such switch:** anyone who can reach it can
register, each with a household of their own, so restrict access to people you
trust at your network or proxy boundary. Read [Security](../SECURITY.md) before
deployment.

## 1. Download and prepare the release files

Use an empty directory and retain it for this installation. The bundle uses project
name `stoky-release`; keep it unchanged. Overriding it
with `-p` or `COMPOSE_PROJECT_NAME` selects different volumes and can make
existing data appear absent. Use a distinct project and host ports for a second instance.

```bash
mkdir stoky-app
cd stoky-app
```

### With the install script

`install.sh` does this step for you and stops: it downloads the release files,
verifies every one against `SHA256SUMS`, sets their permissions, and creates
`.env` from `example.env` with both secrets generated. It changes no value that
is already set, never replaces an installed file that differs (that is an
upgrade, below), and **never starts anything**: you review `.env` and start
Stoky yourself in step 3. Running it again is safe.

```bash
STOKY_RELEASE=v0.1.0-alpha.3
for asset in install.sh SHA256SUMS; do
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location \
    --output "$asset" \
    "https://github.com/NGarate/stoky/releases/download/${STOKY_RELEASE}/${asset}"
done
grep -E '  install\.sh$' SHA256SUMS | sha256sum -c
less install.sh      # read what you are about to run; q to quit
bash install.sh
```

`sha256sum -c` must print `install.sh: OK` before you run it. It catches a
damaged download, not a replaced one: `SHA256SUMS` comes from the same place as
the file. If you have the GitHub CLI, [check who published the
files](#optional-check-who-published-the-files) between `sha256sum -c` and
`bash install.sh`; from the release after v0.1.0-alpha.3 that catches a
replaced one too. The `--proto` and
`--tlsv1.2` flags keep every hop on HTTPS with TLS 1.2 or later, GitHub's
redirect included. From the release after v0.1.0-alpha.3, `install.sh` passes
`--proto-redir '=https' --tlsv1.2` to its own downloads. The script installs
the release it came with. Continue with step 2: only `DOMAIN` and `ACME_EMAIL`
are left.

### By hand

Download the exact alpha by its tag. Prereleases are not available through
GitHub's `releases/latest/download` URL.

```bash
STOKY_RELEASE=v0.1.0-alpha.3
for asset in docker-compose.yml example.env traefik.yml SHA256SUMS; do
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location \
    --output "$asset" \
    "https://github.com/NGarate/stoky/releases/download/${STOKY_RELEASE}/${asset}"
done
grep -E '  (docker-compose\.yml|example\.env|traefik\.yml)$' SHA256SUMS | sha256sum -c
cp example.env .env
chmod 600 .env
chmod 644 traefik.yml
```

`traefik.yml` must stay readable by everyone (`644`); it holds no secrets. Traefik
runs with every capability dropped, so it cannot read a file only its owner can,
and a restrictive `umask` (such as `077`) creates the downloads that way. It then
starts without its routes and answers every request with `404 page not found`.

`sha256sum -c` must print `OK` for all three files. Take the Compose, Traefik
and environment files from the release, never from `master`: `master` may
already describe the next release. Checksums detect damaged/mismatched files;
they are not a separate signature of the publisher, which the
[attestation below](#optional-check-who-published-the-files) is. Releases after
v0.1.0-alpha.3 also fix the image through them: the Compose file names it by
digest as well as tag (`…:${STOKY_VERSION}@sha256:…`), so a tag moved on the
registry later does not change what you pull. To check who built that image,
see [Verifying an image's provenance](../SECURITY.md#verifying-an-images-provenance).

### Optional: check who published the files

`SHA256SUMS` comes from the same release as the files it covers, so a writer who
replaced a file could replace its checksum line too. Releases after
v0.1.0-alpha.3 also carry a signed provenance attestation for each installation
file, `SHA256SUMS` included, made by the CI run of the release tag and stored by
GitHub rather than in the release. With the [GitHub CLI](https://cli.github.com/)
signed in to any GitHub account (`gh auth login`), in the directory you
downloaded into:

```bash
gh attestation verify SHA256SUMS \
  --repo NGarate/stoky \
  --signer-workflow NGarate/stoky/.github/workflows/ci.yml \
  --source-ref "refs/tags/${STOKY_RELEASE}"
```

It must exit 0 before you go on. One verified `SHA256SUMS` is enough:
`sha256sum -c` then vouches for the files it lists, and `install.sh` stops
without changing anything if the `SHA256SUMS` it downloads differs from the one
already in the directory. Any single file verifies the same way
(`gh attestation verify install.sh …`). `--source-ref` is what ties the file to
the tag you chose; `--repo` alone accepts any run of the repository.
v0.1.0-alpha.3 was packaged before CI attested its files, so for it the command
fails with `HTTP 404` from the attestations API and the checksums are the only
check. For any later release, a missing attestation or a failed verification
means do not install those files; report it as a
[vulnerability](../SECURITY.md#reporting-a-vulnerability).

## 2. Configure `.env`

If you used the install script, the two secrets are already in `.env`: fill in
`DOMAIN` and `ACME_EMAIL` and review the rest. By hand, generate **two
different** random values:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Open `.env` in your editor and fill in:

| Setting | Value |
|---|---|
| `STOKY_VERSION` | Keep `v0.1.0-alpha.3` for this release |
| `DOMAIN` | The hostname alone, for example `stoky.example.com`; no scheme or path |
| `ACME_EMAIL` | Your email address for Let's Encrypt |
| `POSTGRES_PASSWORD` | The first generated hex value |
| `NEXTAUTH_SECRET` | The second generated hex value |

From the release after v0.1.0-alpha.3, `.env` also carries
`STOKY_REGISTRATION`, which decides who may create an account at `/register`:

| Value | Who may register |
|---|---|
| `first-user` (the default) | Only the first account. After that, a household admin adds people from **Configuración → Personas del hogar** |
| `closed` | Nobody. People are only added by an admin |
| `open` | Anyone who can reach the server, each with a household of their own |

When registration is closed, `/register` shows no form. It says that
registration is closed, asks the visitor to have whoever runs their household
add them, and links back to sign-in. With `first-user` that page replaces the
form as soon as the first account exists.

An unknown value, such as `Open` or `true`, stops the app starting, with the
reason in `docker compose logs app`; it never falls back to `open`. To change it
later, edit `.env` and run `docker compose up -d --wait` again.
v0.1.0-alpha.3's files have no such setting, and adding the line to its `.env`
changes nothing: registration there stays open to anyone (see Requirements).

Use hex for the database password: it is inserted into a connection URL without
percent-encoding. Do not reuse the development `.env.example`. Rotating `NEXTAUTH_SECRET` invalidates existing sessions. The bundle derives
`DATABASE_URL`, `VALKEY_URL` and `NEXTAUTH_URL` itself, so you do not edit them.
Keep `.env` private and out of version control.

**Prefer a dedicated subdomain for `DOMAIN`.** Stoky sends HSTS for two years
with `includeSubDomains`, from the app and from Traefik. On `stoky.example.com`
that covers only the hosts beneath it. On an apex such as `example.com`, every
browser that opens Stoky then refuses plain `http://` for **every** host under
that domain — a router, a NAS, another service — for two years, and changing
`DOMAIN` afterwards does not release it. Neither layer sends `preload`: listing
a domain in the browsers' built-in HSTS lists is close to permanent and covers
the whole domain, so it is left to the domain's owner, at their own proxy.

PostgreSQL uses its password setting **only when creating a new data volume**.
Editing `POSTGRES_PASSWORD` later does not rotate the database password; it
breaks the application's connection until the stored password agrees.

## 3. Start and check

```bash
docker compose config --quiet
docker compose pull
docker compose up -d --wait --wait-timeout 180
docker compose ps
docker compose logs --tail=100 app traefik
```

`config --quiet` rejects missing settings without printing your credentials.
The application applies the included database migrations before starting;
there is no manual Prisma command and no demo account to seed.

**Register straight away.** From the release after v0.1.0-alpha.3, with
`first-user`, whoever reaches `https://YOUR_DOMAIN/register` first becomes the
owner of this installation (on v0.1.0-alpha.3 anyone can register at any time),
and the hostname is public from the moment its certificate is issued:
certificates are published in Certificate Transparency logs, which people
watch for new hosts. Visit `/register`, create your account and provide a
household name. If `/register` says registration is closed on a new
installation, somebody else registered first. Remove the installation with
`docker compose down -v`, which deletes its data volumes (only on an
installation with no data you want to keep), and start step 3 again.

Sign in, add a product, record stock, and upload a JPEG, PNG or WebP receipt.
Review recognized lines before applying them. Add other household members through
**Configuración → Personas del hogar**. On v0.1.0-alpha.3, and with
`STOKY_REGISTRATION=open` after it, a separate registration creates a separate
household.

```bash
curl --fail --show-error https://YOUR_DOMAIN/api/health
```

The health endpoint checks both PostgreSQL and Valkey. A healthy app container
does not prove DNS or the public TLS certificate works; check the HTTPS URL too.
Camera access and offline service workers require a trusted HTTPS origin.

Only Traefik publishes ports. The database/cache stay on an internal network,
the application runs as a non-root user with a read-only filesystem, and Traefik
uses a file provider without access to the Docker socket. Named volumes preserve
the database, uploads, cache and certificates across container replacement.

## Everyday operation

```bash
docker compose logs --tail=100 app      # migration/runtime errors
docker compose restart app            # restart the process
docker compose stop                   # stop, keep containers and data
docker compose up -d --wait            # start again
docker compose down                   # remove containers, keep data volumes
```

**Do not use `docker compose down -v` on an installation you want to keep.** It
deletes the data volumes. Docker's restart policy restarts exited containers;
an `unhealthy` status alone does not automatically restart a running process.

## Logs

From the release after v0.1.0-alpha.3, every container logs through Docker's
`json-file` driver, capped at five files of 10 MB each: at most 50 MB on disk
per container, about 200 MB for the four. Docker's own default keeps
everything, and anyone who can reach the instance can add lines to the app's
security log, so the cap is what stops logs from filling the disk.
v0.1.0-alpha.3's Compose file sets no cap, so there the Docker daemon's own
logging settings apply, which by default keep everything. Older lines are discarded as new ones arrive, so how far back the logs
reach depends on traffic. `docker compose logs` reads all five files; the files
themselves are under Docker's data directory
(`docker inspect --format '{{.LogPath}}' stoky-release-app-1`).

The Compose file sets the driver on each service, so it replaces a daemon-wide
driver configured in `/etc/docker/daemon.json`. To keep your own (for example
`journald`, or a shipper that keeps logs longer), create
`docker-compose.override.yml` beside the Compose file; `docker compose` reads it
automatically:

```yaml
x-logging: &logging
  driver: journald
services:
  db: { logging: *logging }
  cache: { logging: *logging }
  app: { logging: *logging }
  traefik: { logging: *logging }
```

Check it with `docker compose config`, keep it with your backups, and apply it
with `docker compose up -d --wait`. Upgrades replace the Compose and Traefik
files, not the override, so it stays in place.

## A forgotten password

There is no email, so there is no reset link. From the release after
v0.1.0-alpha.3, a household admin sets a new password for anyone else in the
household from **Configuración → Personas del hogar → Cambiar su contraseña**;
every session that person had ends, and they change the password from
**Configuración** once signed in. Only an owner can do this for an owner.
v0.1.0-alpha.3 has neither screen, so there every forgotten password is set in
the database as below.

If you are the only owner and have forgotten your own password, set it in the
database. Run these in the installation directory, replacing the address with
your account's:

```bash
IFS= read -rs STOKY_NEW_PASSWORD    # type the new password; nothing is shown
STOKY_HASH=$(printf '%s' "$STOKY_NEW_PASSWORD" | docker compose run --rm --no-deps -T \
  --entrypoint bun app -e 'const a = require("argon2"); const p = await Bun.stdin.text();
  console.log(await a.hash(p, { type: a.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 }))')
unset STOKY_NEW_PASSWORD
docker compose exec -T db psql -U stoky -d stoky -v ON_ERROR_STOP=1 \
  -v hash="$STOKY_HASH" -v email='you@example.com' <<'SQL'
UPDATE "User"
SET "passwordHash" = :'hash',
    "sessionsValidFrom" = now() AT TIME ZONE 'UTC',
    "updatedAt" = now() AT TIME ZONE 'UTC'
WHERE email = lower(:'email');
SQL
unset STOKY_HASH
```

`psql` must answer `UPDATE 1`; `UPDATE 0` means no account has that address.
The password is read without echo and passed on standard input, so it stays out
of your shell history and the process list; `IFS=` keeps any leading or
trailing space in it, which a plain `read` would drop and sign-in would not. The hash is made by the
application's own Argon2id library with its own parameters, and setting
`sessionsValidFrom` ends every session the account had, as a reset from the
application does. This path skips the application's password rules: choose at
least 12 characters that do not contain your name or address.

## Backup and restore

The JSON export in Settings is useful for inspection, but is not a full restore
format and does not include uploaded images. Back up the database and uploads
together, with the app stopped so neither changes during the copy. Run these
commands in the installation directory, checking each command succeeds:

```bash
umask 077
STOKY_BACKUP="backup-$(date +%Y%m%d-%H%M%S)"
mkdir "$STOKY_BACKUP"
docker compose stop app
docker compose exec -T db pg_dump -U stoky -d stoky -Fc > "$STOKY_BACKUP/database.dump"
docker compose run --rm --no-deps -T --entrypoint tar app \
  -C /app/uploads -czf - . > "$STOKY_BACKUP/uploads.tar.gz"
cp .env docker-compose.yml traefik.yml "$STOKY_BACKUP/"
docker compose up -d --wait app
```

Store the directory securely off the server. It includes credentials and private
household data. Certificate storage is separate; on a new host Traefik obtains
certificates again, subject to your DNS and ACME rate limits.

**Test restoration on an empty installation on another host**, using the same
release and the saved `.env`, Compose and Traefik files. These commands assume its database and
uploads are empty and the backup files have been copied into its directory.
The backup was written under `umask 077`, so make `traefik.yml` readable again:

```bash
chmod 644 traefik.yml
docker compose pull
docker compose up -d --wait db cache
docker compose exec -T db pg_restore -U stoky -d stoky \
  --exit-on-error --no-owner < database.dump
docker compose run --rm --no-deps -T --entrypoint tar app \
  -C /app/uploads -xzf - < uploads.tar.gz
docker compose up -d --wait --wait-timeout 180
```

Sign in and check inventory and a receipt image. Restoring over existing data is
not covered by these commands. Never delete the original volumes to test a backup.

## Upgrade and rollback

When the new Compose file changes a service's configuration, `up -d` recreates
that container and deletes its old log files with it; the first release that
rotates logs changes all four. Save the logs you need before upgrading, for
example `docker compose logs --no-color --timestamps > logs-before-upgrade.txt`.

Read the target release's notes first. Back up the current installation, download
the target release's assets **into a separate directory**, and verify their
checksums and, with the GitHub CLI, [who published
them](#optional-check-who-published-the-files), with `STOKY_RELEASE` set to the
target tag. Compare `example.env` with your `.env`; preserve your secrets. Replace
the installed Compose and Traefik files with that release's files and set `STOKY_VERSION` to
its exact tag. The Compose file is what selects the image: from releases after
v0.1.0-alpha.3 it names it by digest, Docker pulls that digest whatever tag
`STOKY_VERSION` gives, and changing `STOKY_VERSION` alone changes nothing. Then:

```bash
chmod 644 traefik.yml
docker compose config --quiet
docker compose pull
docker compose up -d --wait --wait-timeout 180
```

The Traefik file sets the proxy's security headers as well as its routing, so
an upgrade that replaces only the image keeps the previous release's headers.

Confirm health, sign-in and your data. Automatic alpha updates are not supported.
Migrations run automatically and are not automatically reversible: a rollback may
require restoring **both** the pre-upgrade database and uploads into an empty
installation with the previous image and configuration. A rollback takes the
previous release's Compose file, not only its tag, and returning to the previous
image is not by itself a guaranteed rollback.

PostgreSQL, Valkey and Traefik change only with a Stoky release. The Compose
file names each of them by exact version and by digest
(`postgres:16.15-alpine@sha256:…`), so `docker compose pull` fetches the build
the release was tested with, not whatever the tag names that day. Their
security fixes reach you by upgrading to the release that carries them. Within
one major version (PostgreSQL 16, Valkey 8) an update keeps the stored data
format and needs no data migration; a release that changes a major version
says so, and what to do, in its notes.

**Registration closes on upgrade** to the release after v0.1.0-alpha.3 from a
release whose `example.env` has no `STOKY_REGISTRATION`, such as
v0.1.0-alpha.3. When `.env` does not set it, the Compose file uses
`first-user`, and an existing installation already has accounts, so `/register`
says registration is closed and shows no form. Add people from
**Configuración → Personas del hogar**, or, if your installation relies on
people registering themselves, set `STOKY_REGISTRATION=open` in `.env` before
`docker compose up`. To have the line in `.env`, add
`STOKY_REGISTRATION=first-user` yourself; the Compose file uses that value when
it is absent. The new release's `install.sh` adds every missing setting to
`.env`, but only when `example.env` and `SHA256SUMS` are replaced along with
the Compose and Traefik files: against the previous release's copies it stops
before it reaches `.env`.

For an existing source-built deployment, first back it up. Keep its Compose
project name and volume identities; the new bundle assumes database/user `stoky`
and URL-safe credentials. Review custom database names, passwords, networks and
proxy settings before migrating. Do not point an unreviewed bundle at existing data.

## Troubleshooting

| Symptom | Check |
|---|---|
| Release download returns 404 | Exact alpha tag; the stable `latest` URL excludes prereleases |
| Image pull says `denied` or `unauthorized` | Exact tag in `STOKY_VERSION`; stale saved credentials for `ghcr.io` are sent even to a public image, so try `docker logout ghcr.io` |
| `no matching manifest` | This alpha publishes Linux amd64 only |
| Traefik configuration file missing | Download `traefik.yml` beside the Compose file from the same release |
| Every page is `404 page not found` | `docker compose logs traefik` shows `permission denied` for `dynamic.yml`: run `chmod 644 traefik.yml`, then `docker compose restart traefik` |
| `P1000` / database authentication | Password differs from the one stored when the volume was initialized; changing `.env` is not rotation |
| App is unhealthy | `docker compose logs --tail=100 app db cache`; migrations, database connectivity and Valkey |
| TLS error / certificate not issued | DNS A/AAAA records, inbound TCP 443, port conflicts and Traefik logs; an incorrect AAAA record can also break issuance |
| Sign-in unavailable | Valkey must be healthy; authentication rate limiting fails closed |
| Somebody forgot their password | From the release after v0.1.0-alpha.3 an admin sets a new one from **Personas del hogar**; a sole owner's, and anybody's on v0.1.0-alpha.3, is set in the database, see [A forgotten password](#a-forgotten-password) |
| `/register` says registration is closed, with no form | From the release after v0.1.0-alpha.3: expected once an account exists with `first-user`, or always with `closed`; an admin adds people from **Configuración → Personas del hogar**. See `STOKY_REGISTRATION` in step 2 |
| App exits with `refusing to start: STOKY_REGISTRATION` | From the release after v0.1.0-alpha.3: the value is not `open`, `first-user` or `closed`; fix `.env`, or remove the line for `first-user` |
| Upload refused | JPEG/PNG/WebP only, maximum 10 MiB; HEIC/HEIF is unsupported |
| A scanned code always opens the empty product form | Open Food Facts is not being asked: the app needs outbound HTTPS to `world.openfoodfacts.org`, Valkey must be healthy (a lookup that cannot be counted is not sent), and each account may send 60 lookups an hour for codes this instance has not looked up recently — past that the scan page says so. This bundle does not pass `RATE_LIMIT_PRODUCT_LOOKUP_*` to the app, so the default applies |
| Empty inventory after moving directory | Check `-p`, `COMPOSE_PROJECT_NAME` and volume names before creating or deleting anything |

Report the release tag, image digest, command and redacted error through
[GitHub issues](https://github.com/NGarate/stoky/issues). Do not attach `.env`,
database dumps, session cookies or unredacted receipt photos.

A security problem is not an issue: report it through the private form in
[Reporting a vulnerability](../SECURITY.md#reporting-a-vulnerability), which
also says what to do when the form is not offered. Every installation runs the
same image, so a public report reaches everyone before a fix does.
