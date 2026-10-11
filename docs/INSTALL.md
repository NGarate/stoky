# Install Stoky with Docker Compose

This guide is for **v0.1.0-alpha.2**, the second testing release. Keep backups;
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
- A hostname you control, with DNS pointing to the server. The included TLS-ALPN
  challenge requires Let's Encrypt to reach **TCP 443**; clients use TCP 80/443.
  Both ports must be free. An existing proxy or a LAN-only/VPN-only installation
  needs its own trusted TLS configuration; the supplied ACME setup does not work
  for `localhost`, a bare private IP, or an unreachable hostname.
- `curl`, `openssl`, `sha256sum` and a text editor. No GitHub account is needed:
  the release files and the image download anonymously.

Registration creates a new account and, when named, a household. This alpha has
no invitation-only registration switch. Restrict access to trusted testers at
your network/proxy boundary. Read [Security](../SECURITY.md) before deployment.

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
curl --fail --location --remote-name \
  https://raw.githubusercontent.com/NGarate/stoky/master/deploy/install.sh
less install.sh      # read what you are about to run
bash install.sh
```

This alpha was published before the script existed, so it comes from the
repository; it downloads and verifies this alpha's files by their tag. From
the next release on, `install.sh` is attached to the release and listed in its
`SHA256SUMS`. Continue with step 2: only `DOMAIN` and `ACME_EMAIL` are left.

### By hand

Download the exact alpha by its tag. Prereleases are not available through
GitHub's `releases/latest/download` URL.

```bash
STOKY_RELEASE=v0.1.0-alpha.2
for asset in docker-compose.yml example.env traefik.yml SHA256SUMS; do
  curl --fail --location --output "$asset" \
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
they are not a separate signature of the publisher.

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
| `STOKY_VERSION` | Keep `v0.1.0-alpha.2` for this release |
| `DOMAIN` | The hostname alone, for example `stoky.example.com`; no scheme or path |
| `ACME_EMAIL` | Your email address for Let's Encrypt |
| `POSTGRES_PASSWORD` | The first generated hex value |
| `NEXTAUTH_SECRET` | The second generated hex value |

Use hex for the database password: it is inserted into a connection URL without
percent-encoding. Do not reuse the development `.env.example`. Rotating `NEXTAUTH_SECRET` invalidates existing sessions. The bundle derives
`DATABASE_URL`, `VALKEY_URL` and `NEXTAUTH_URL` itself, so you do not edit them.
Keep `.env` private and out of version control.

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

Visit `https://YOUR_DOMAIN/register`, create your account and provide a household
name. Sign in, add a product, record stock, and upload a JPEG, PNG or WebP receipt.
Review recognized lines before applying them. Add other household members through
**Configuración → Personas del hogar**. Separate registration creates a separate household.

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

Read the target release's notes first. Back up the current installation, download
the target release's assets **into a separate directory**, and verify their
checksums. Compare `example.env` with your `.env`; preserve your secrets. Replace
the installed Compose and Traefik files with that release's files and set `STOKY_VERSION` to
its exact tag, then:

```bash
chmod 644 traefik.yml
docker compose config --quiet
docker compose pull
docker compose up -d --wait --wait-timeout 180
```

Confirm health, sign-in and your data. Automatic alpha updates are not supported.
Migrations run automatically and are not automatically reversible: a rollback may
require restoring **both** the pre-upgrade database and uploads into an empty
installation with the previous image and configuration. Changing only the image
tag is not a guaranteed rollback.

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
| Upload refused | JPEG/PNG/WebP only, maximum 10 MiB; HEIC/HEIF is unsupported |
| Empty inventory after moving directory | Check `-p`, `COMPOSE_PROJECT_NAME` and volume names before creating or deleting anything |

Report the release tag, image digest, command and redacted error through
[GitHub issues](https://github.com/NGarate/stoky/issues). Do not attach `.env`,
database dumps, session cookies or unredacted receipt photos.
