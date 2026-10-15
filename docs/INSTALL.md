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
| `STOKY_SECRET` (`NEXTAUTH_SECRET` in v0.1.0-alpha.3's files) | The second generated hex value |

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
percent-encoding. Do not reuse the development `.env.example`. Rotating the
session secret signs everybody out and changes every account tag in the
security log. From the release after v0.1.0-alpha.3 the secret is called
`STOKY_SECRET`; the old name, `NEXTAUTH_SECRET`, is still read when
`STOKY_SECRET` is unset, with a `[config]` warning at start-up, until a later
release stops reading it (see [Upgrade and rollback](#upgrade-and-rollback)).

The bundle derives `DATABASE_URL`, `VALKEY_URL` and the instance's address
itself, so you do not edit them; the address is `https://` and `DOMAIN`, the
one host Traefik routes. Outside the bundle — a source install, or one behind
your own proxy — set `STOKY_URLS` (from the release after v0.1.0-alpha.3; it
was `NEXTAUTH_URL`) to every address people type, comma-separated, the
canonical one first, for example
`STOKY_URLS="http://stoky.lan:3000,http://192.168.1.10:3000"`. List only
addresses that reach this instance: every one is trusted to sign a browser in.
The first is canonical: the session cookie is `Secure` only when it is https.
In
production the app does not start without `STOKY_URLS`, with an entry that is
not a bare `http(s)://host[:port]` address (a path such as `/api/auth`, a query
or a `user:password@` counts as not bare), or with an https first entry beside
plain-HTTP addresses on the network: the cookie would be `Secure`, the browser
drops a `Secure` cookie over plain HTTP, and signing in at those addresses
would loop back to the login page. Serve every address over https, or every
one over http. `http://localhost` beside an https first entry is accepted,
because browsers keep a `Secure` cookie on localhost. `docker compose logs app`
ends with a line starting `[auth] refusing to start:` that names the entry by
its position, never its full text. The same release also refuses to
start while `BETTER_AUTH_TRUSTED_ORIGINS` is set or `BETTER_AUTH_TELEMETRY` is
on, because Better Auth, which signs people in, would obey those over its
configuration. It ignores `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS`,
`AUTH_SECRET`, `BETTER_AUTH_URL` and `AUTH_URL`, logging an `[auth] warning:`
line for each one set: `STOKY_SECRET` and `STOKY_URLS` are what it reads.
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

Check it with `docker compose config --quiet`, keep it with your backups, and
apply it with `docker compose up -d --wait`;
`docker inspect --format '{{.HostConfig.LogConfig.Type}}' stoky-release-app-1`
then names the driver in use. Plain `docker compose config` would show the
override too, but it prints your database password and session secret with
it. Upgrades replace the Compose and Traefik files, not the override, so it
stays in place.

The app's log records client addresses and account ids, and the database's log
records an email address that was added twice (SECURITY.md,
[*What an instance holds*](../SECURITY.md#what-an-instance-holds-and-for-how-long)).
Remove them before you share log lines with anybody.

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
BEGIN;
UPDATE "Account"
SET password = :'hash',
    "updatedAt" = now() AT TIME ZONE 'UTC'
WHERE "providerId" = 'credential'
  AND "userId" = (SELECT id FROM "User" WHERE email = lower(:'email'))
  AND "accountId" = "userId";
DELETE FROM "Session"
WHERE "userId" = (SELECT id FROM "User" WHERE email = lower(:'email'));
COMMIT;
SQL
unset STOKY_HASH
```

`psql` must answer `UPDATE 1` to the update, and `DELETE` with the number of
sessions it ended, which may be 0; `UPDATE 0` means no account has that
address. From the release after v0.1.0-alpha.3 the hash is kept in the
account's `credential` row of the `Account` table, which is where sign-in reads
it, and each session is a row of `Session`. On v0.1.0-alpha.3 the hash is
still a column of `User` and there are no session rows: there, replace both
statements with

```sql
UPDATE "User"
SET "passwordHash" = :'hash',
    "sessionsValidFrom" = now() AT TIME ZONE 'UTC',
    "updatedAt" = now() AT TIME ZONE 'UTC'
WHERE email = lower(:'email');
```

The other way round fails safely, with `relation "Session" does not exist` or
`column "passwordHash" does not exist` and nothing changed.
The password is read without echo and passed on standard input, so it stays out
of your shell history and the process list; `IFS=` keeps any leading or
trailing space in it, which a plain `read` would drop and sign-in would not. The hash is made by the
application's own Argon2id library with its own parameters. Both statements
run in one transaction, so the new password never stands without the second
one, which deletes every session the account had, as a reset from the
application does. This path skips the application's password rules: choose at
least 12 characters that do not contain your name or address.

## Somebody keeps being told to wait

Sign-in allows 10 attempts per account every 15 minutes, counted before the
password is checked, so once they are spent even the right password is refused.
From the release after v0.1.0-alpha.3 the person is told "Demasiados intentos
con esta cuenta. Espera unos minutos; si se repite, avisa a quien administra tu
hogar." v0.1.0-alpha.3 says "Demasiados intentos desde esta conexión" instead,
the words of the per-address limit, although another connection does not help.
From the release after v0.1.0-alpha.3, a browser that has signed in to that
account before has 5 of its own and is not affected; a new phone, a private
window or a browser whose cookies were cleared shares the 10 with everyone
else. So, after updating from a release without this, does every browser until
its first sign-in since. On v0.1.0-alpha.3 every browser shares the 10.
If that keeps happening to a person who is waiting as told, somebody who knows
their address may be spending those attempts. `docker compose logs app | grep
auth.signin` shows the addresses the attempts come from.

To give that account its attempts back now rather than at the end of the
window, run this in the installation directory with the person's address:

```bash
STOKY_ACCOUNT=$(printf '%s' 'person@example.com' | tr '[:upper:]' '[:lower:]' | sha256sum | cut -c1-32)
docker compose exec cache valkey-cli DEL "rl:login:acct:$STOKY_ACCOUNT"
```

`1` means a counter was cleared, `0` that there was none to clear. The key is
the first 32 hexadecimal characters of the SHA-256 of the address in lower case,
because the counter never stores the address itself. On macOS use
`shasum -a 256` for `sha256sum`. Clearing it does not stop whoever is spending
it, but the first browser the person signs in on afterwards keeps its own
attempts from then on.

An address like `172.18.0.1` in those lines is not a person; see
[Clients on IPv6](#clients-on-ipv6).

## Clients on IPv6

As released, Traefik's network is IPv4-only. A client that connects over IPv6
(most mobile networks, and any connection your AAAA record attracts) reaches
Traefik through Docker's userland proxy, and Stoky sees the network's gateway,
an address like `172.18.0.1`, instead of the client. Every IPv6 client then
shares one budget: 5 sign-in attempts per 15 minutes and 3 registrations per
hour. One of them spending it makes the rest wait, and the security log shows
the gateway for all of them. IPv4 clients and people already signed in are not
affected.

Choose one:

- **Publish only an A record**, with no AAAA. Every client connects over IPv4
  and is counted by its own address.
- **Accept the shared budget**, for a small household.
- **Give Traefik's network IPv6.** This needs Docker Engine 27 or newer
  (`docker version --format '{{.Server.Version}}'`), IPv6 enabled on the host
  (`cat /proc/sys/net/ipv6/conf/all/disable_ipv6` prints `0`), and `ip6tables`
  not set to `false` in `/etc/docker/daemon.json`. From Engine 27 Docker gives
  such a network an IPv6 range of its own and forwards it with ip6tables, so
  the client's address arrives intact. Create `docker-compose.override.yml`
  beside the Compose file; Compose reads it on every command, and a release
  never ships or replaces it:

  ```yaml
  networks:
    traefik:
      enable_ipv6: true
  ```

  Docker does not change an existing network, so recreate it with
  `docker compose down` and then `docker compose up -d --wait`; `down` without
  `-v` keeps your data. On an older Engine or a host without IPv6 the network
  cannot be created and nothing starts: delete the override file and start
  again.

From the release after v0.1.0-alpha.3, Stoky counts an IPv6 client by its
/64, the smallest block an internet provider gives one connection
(v0.1.0-alpha.3 counts each address on its own). Devices in one home share a budget, as they do
behind one IPv4 router, and nobody gets a fresh budget by changing address
inside their /64.

To see which case you are in, sign in once with a wrong password from a device
on IPv6, for example a phone on mobile data with Wi-Fi off, then run:

```bash
docker compose logs app | grep auth.signin.failed | tail -n 1
docker network inspect stoky-release_traefik --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}'
```

If the `address` in the first line is one of the gateways the second prints,
IPv6 clients are sharing. An address with colons that is not a gateway is the
device's own. A dotted address that is not a gateway means the device used
IPv4; try another one.

## Deleting somebody's account

Stoky cannot delete an account. Removing a person from **Personas del hogar**
takes them out of the household and keeps their account: name, address,
password hash and language. When somebody asks to be erased, delete the account
in the database. Run these in the installation directory, replacing the address
with the person's:

1. Look at the account:

   ```bash
   docker compose exec -T db psql -U stoky -d stoky -v ON_ERROR_STOP=1 \
     -v email='person@example.com' <<'SQL'
   SELECT u.id, u.name, u.role, u."householdId",
     (SELECT count(*) FROM "User" m
       WHERE m."householdId" = u."householdId" AND m.id <> u.id) AS other_members,
     (SELECT count(*) FROM "User" o
       WHERE o."householdId" = u."householdId" AND o.id <> u.id
         AND o.role = 'OWNER') AS other_owners,
     (SELECT count(*) FROM "Receipt" r WHERE r."uploadedBy" = u.id) AS receipts
   FROM "User" u
   WHERE u.email = lower(:'email');
   SQL
   ```

   `(0 rows)` means no account has that address. Write down the `id`; step 3
   needs it. If the role is `OWNER`, `other_members` is not 0 and
   `other_owners` is 0, deleting the account would leave the household without
   an owner, so step 2 refuses: first make another member an owner from
   **Personas del hogar**. If `other_members` is 0, the person is the
   household's only member. The account goes, but the household and everything
   in it stay, and nobody can sign in to them any more. Neither the application
   nor this guide deletes a household.
2. Delete the account:

   ```bash
   docker compose exec -T db psql -U stoky -d stoky -v ON_ERROR_STOP=1 \
     -v email='person@example.com' <<'SQL'
   WITH gone AS (
     DELETE FROM "User" u
     WHERE u.email = lower(:'email')
       AND NOT (u.role = 'OWNER'
         AND EXISTS (SELECT 1 FROM "User" m
           WHERE m."householdId" = u."householdId" AND m.id <> u.id)
         AND NOT EXISTS (SELECT 1 FROM "User" o
           WHERE o."householdId" = u."householdId" AND o.id <> u.id
             AND o.role = 'OWNER'))
     RETURNING u.id
   ), choices AS (
     DELETE FROM "ScreenChoice" WHERE "userId" IN (SELECT id FROM gone)
     RETURNING 1
   ), replays AS (
     DELETE FROM "MutationReplay" WHERE "userId" IN (SELECT id FROM gone)
     RETURNING 1
   )
   SELECT id AS deleted_account,
     (SELECT count(*) FROM choices) AS screen_choices,
     (SELECT count(*) FROM replays) AS replay_records
   FROM gone;
   SQL
   ```

   `psql` must print one row with the account's `id`. `(0 rows)` means nothing
   was deleted: no account has that address, or it is the last owner of a
   household that still has other members. It is one statement, so it is one
   transaction: the account, the start screen it chose on each device and its
   offline replay records go together or not at all. From the release after
   v0.1.0-alpha.3 the account's password hash, in its `credential` row of the
   `Account` table, goes with it too: the database deletes that row along with
   the account, so the statement does not name it, and so do its sessions: a
   browser signed in to it is signed out on its next request. On
   v0.1.0-alpha.3 a browser still signed in keeps its cookie, but every
   request it makes for household data is refused; it can still record a
   start screen, see what stays, below.
3. The receipts the person uploaded belong to the household and stay, with
   their photographs on the `uploads` volume. To remove those photographs too,
   put the `id` from step 1 in place of `the-id`:

   ```bash
   docker compose exec -T db psql -U stoky -d stoky -At -v ON_ERROR_STOP=1 \
     -v id='the-id' > stoky-photos.txt <<'SQL'
   SELECT "imagePath" FROM "Receipt" WHERE "uploadedBy" = :'id';
   SQL
   grep -E '^uploads/receipts/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.[a-z]+$' stoky-photos.txt \
     | docker compose exec -T app xargs -r rm -v --
   rm stoky-photos.txt
   ```

   `rm` prints one `removed` line per photograph. The `grep` passes on only
   paths of the shape the application writes, so a damaged row cannot point
   `rm` anywhere else. Nothing reads a photograph again once its receipt has
   been read, so the receipts still show their lines, store, date and total.
4. Clear the sign-in counters kept under the address. They expire on their own,
   the known devices only after a year:

   ```bash
   STOKY_ACCOUNT=$(printf '%s' 'person@example.com' | tr '[:upper:]' '[:lower:]' | sha256sum | cut -c1-32)
   docker compose exec cache valkey-cli DEL "rl:login:acct:$STOKY_ACCOUNT" "rl:known:$STOKY_ACCOUNT"
   ```

   It prints how many of the two it found. The other counters, keyed on the
   account's `id` or on the address and one browser together, expire within
   the hour.

What stays after these steps:

- **The account's `id`.** Each stock movement records who made it
  (`StockEntry.createdBy`) and each receipt who uploaded it
  (`Receipt.uploadedBy`). Neither is a foreign key, so the rows keep the `id`
  of an account that no longer exists. Nothing in the application shows it and
  the JSON export leaves it out; it no longer leads to a name or an address.
- **The receipts' text.** The whole-ticket OCR text can include a masked card
  number, a loyalty number or the cashier's name. It is the household's
  purchase history and stays with each receipt.
- **A start screen chosen afterwards**, on v0.1.0-alpha.3 only. There a
  browser still signed in when the account was deleted stays signed in for as
  long as it keeps being used; from the release after it, the account's
  sessions are deleted with it. Choosing a start screen there
  records one under the old `id`, because that does not ask the database
  whether the account still exists. If the person may have done that, remove
  it with the `id` from step 1 in place of `the-id`:

  ```bash
  docker compose exec -T db psql -U stoky -d stoky -v ON_ERROR_STOP=1 \
    -v id='the-id' <<'SQL'
  DELETE FROM "ScreenChoice" WHERE "userId" = :'id';
  SQL
  ```

  It prints `DELETE` and how many it removed.
- **Backups and logs.** Backups taken before the deletion still hold the
  account and the photographs until you delete them. The app's log keeps the
  account's `id` and the addresses it signed in from until rotation removes
  them ([Logs](#logs)).

The address is free again afterwards. An admin can add it to a household, or
the person can register where registration is open, as a new account with
nothing of the old one.

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

The directory holds `.env` (the database password and the session secret), every
account's password hash and every receipt, all in plaintext. **Encrypt it before
it leaves the server.** With [age](https://age-encryption.org), installed on
both machines, create a key pair once on the machine that keeps the backups,
not on the server: `age-keygen -o stoky-backup.key` prints its public key,
`age1…`. The server needs only that public key:

```bash
STOKY_AGE_RECIPIENT='age1…'    # the public key age-keygen printed
tar -czf "$STOKY_BACKUP.tar.gz" "$STOKY_BACKUP" \
  && age -r "$STOKY_AGE_RECIPIENT" -o "$STOKY_BACKUP.tar.gz.age" "$STOKY_BACKUP.tar.gz" \
  && rm -r "$STOKY_BACKUP" "$STOKY_BACKUP.tar.gz"
```

Keep the `&&`: the plaintext copy is deleted only once the encrypted one has
been written, so a missing `age` or a full disk leaves the backup where it was
instead of an empty file in its place. Copy the `.age` file off the server. To
restore, decrypt it on a machine that has the key, with
`age -d -i stoky-backup.key backup-….tar.gz.age | tar -xzf -`, which recreates
the `backup-…` directory. With GnuPG, import the public key of a key pair kept
off the server, then replace the `age` line with
`&& gpg --encrypt --recipient you@example.com --output "$STOKY_BACKUP.tar.gz.gpg" "$STOKY_BACKUP.tar.gz" \`
and decrypt with `gpg --decrypt`. Whoever has the private key can read
everything in the backup, so keep it apart from the backups.

Backups are not rotated for you. Delete old ones on a schedule you choose. Each
one keeps accounts and receipts that were deleted from the instance after it was
taken. Certificate storage is separate; on a new host Traefik obtains
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
docker compose exec -T db psql -U stoky -d stoky -c 'DELETE FROM "Session";'
docker compose up -d --wait --wait-timeout 180
```

The `DELETE` ends every session the backup carried, from the release after
v0.1.0-alpha.3 (before it there is no `Session` table, and the line answers
`relation "Session" does not exist`; skip it). A restored instance is a new
place to sign in to, and a cookie lifted from the old one must not open it.
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

**Returning to v0.1.0-alpha.3 needs the pre-upgrade dump.** The release after
it moves every password hash from a column of `User` into a new `Account`
table and drops the column (`20261015120000_credential_accounts`). The
v0.1.0-alpha.3 image reads that column, so started against an upgraded
database it signs nobody in. Restore the backup taken before the upgrade into
an empty installation of v0.1.0-alpha.3 instead, as above.

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

**Everybody signs in once after upgrading** to the release after
v0.1.0-alpha.3. Sessions move from a signed token in the browser to a row in
the database, and a token from the old release names no row, so each device
is asked to sign in again the first time it is used; passwords are kept, and
changes a phone queued offline are kept, as they are whenever a session ends.
From then on a session ends after fifteen minutes unused, a day after
sign-in however much it is used, or when somebody ends it — *Authentication*
in [SECURITY.md](../SECURITY.md) says why — unless **Mantener la sesión
iniciada** was ticked at sign-in: then it ends after ninety days unused or a
year after sign-in. **Sign each kitchen tablet in again with that box
ticked**, or it asks for the password after every fifteen idle minutes; the
box is unticked by default, and an old session does not become a remembered
one. If nobody remembers the kitchen account's password, an admin sets a new
one from **Configuración → Personas del hogar** (see
[A forgotten password](#a-forgotten-password)). Set `STOKY_URLS` to the addresses
people use before upgrading a deployment that is not the bundle; the bundle
sets it from `DOMAIN`.

**`NEXTAUTH_SECRET` is now `STOKY_SECRET`** from the release after
v0.1.0-alpha.3: names starting `NEXTAUTH_`, `AUTH_` and `BETTER_AUTH_` are read
by libraries on their own, and Stoky's settings should be read by Stoky alone.
The new release's `install.sh` renames the line in `.env` and keeps its value,
printing `renombrado NEXTAUTH_SECRET → STOKY_SECRET`. By hand, rename the key
and keep the value: generating a new one signs everybody out and changes every
account tag in the security log. Until the line is renamed the app starts and
reads the old name, logging `[config] NEXTAUTH_SECRET is deprecated` once at
start-up; with both set, `STOKY_SECRET` is used and the warning says the other
is ignored. A later release stops reading the old name. The Compose file no
longer refuses an empty secret itself: the app does, at start-up, with a line
naming `STOKY_SECRET`, and `docker compose up --wait` reports the container
unhealthy.

**`NEXTAUTH_URL` is now `STOKY_URLS`**, a list, from the same release. Bundle
installs have nothing to do: the Compose file sets it from `DOMAIN`, and
`.env` never held it. A deployment that is not the bundle renames the line;
its one URL is a list of one. Until then the app reads `NEXTAUTH_URL`, logging
`[config] NEXTAUTH_URL is deprecated` once at start-up. An old value with a
path, such as `https://stoky.example.com/api/auth`, is refused in production:
keep only the scheme, host and port.

For an existing source-built deployment, first back it up. Keep its Compose
project name and volume identities; the new bundle assumes database/user `stoky`
and URL-safe credentials. Review custom database names, passwords, networks and
proxy settings before migrating. Do not point an unreviewed bundle at existing data.

## A migration stops the upgrade

The app applies migrations each time it starts, before it serves anything.
When one fails, Prisma, which applies them, records the failure in the database
and the app container restarts over and over. The first attempt logs `P3018`
with the database's reason. Every attempt after it logs only `P3009` (`migrate
found failed migrations in the target database`) and the migration's name,
until the failure is cleared by hand. Fixing the data and restarting is not
enough on its own.

`20261006120000_normalise_user_email` fails this way on purpose. It changes every
stored address to lower case and refuses to run while two accounts share one
address in different case, such as `owner@example.com` and `Owner@Example.com`.
Earlier releases stored addresses exactly as typed, so anyone who could register
could create such a pair. Choosing between the two accounts is up to you, not
the migration. It refuses before changing anything, so the database is as the
previous release left it. Run these steps in the installation directory:

1. Take a backup as in [Backup and restore](#backup-and-restore), leaving out
   its last line, because the app cannot start yet. Its `docker compose stop app`
   ends the restarts.
2. List the accounts that collide:

   ```bash
   docker compose exec -T db psql -U stoky -d stoky <<'SQL'
   SELECT u.id, u.email, u.name, u.role, h.name AS household, u."createdAt"
   FROM "User" u LEFT JOIN "Household" h ON h.id = u."householdId"
   WHERE lower(trim(u.email)) IN
     (SELECT lower(trim(email)) FROM "User" GROUP BY 1 HAVING count(*) > 1)
   ORDER BY lower(trim(u.email)), u."createdAt";
   SQL
   ```

   Keep the account its owner uses: usually the one in the household that holds
   the inventory, and usually the older one. For each other account, put its
   `id` in place of `the-id` and give it an address that nobody can type:

   ```bash
   docker compose exec -T db psql -U stoky -d stoky -v ON_ERROR_STOP=1 \
     -v id='the-id' <<'SQL'
   UPDATE "User"
   SET email = 'duplicate-' || id || '@invalid',
       "sessionsValidFrom" = now() AT TIME ZONE 'UTC',
       "updatedAt" = now() AT TIME ZONE 'UTC'
   WHERE id = :'id';
   SQL
   ```

   `psql` must answer `UPDATE 1`. Renaming an account keeps everything it
   recorded and ends its sessions. Deleting it would take its data with it.
   Prisma applies migrations in order and stops at the first that fails, so
   this runs before the later `20261015120000_credential_accounts` has moved
   the password hashes out of `User`; neither statement touches them, and they
   stay as written.
3. Clear the recorded failure:

   ```bash
   docker compose run --rm --no-deps --entrypoint bun app \
     /opt/prisma/node_modules/prisma/build/index.js migrate resolve \
     --rolled-back 20261006120000_normalise_user_email \
     --schema=/app/prisma/schema.prisma
   ```

   It answers `Migration 20261006120000_normalise_user_email marked as rolled
   back.` This step only lets the migration run again. If an address still
   collides, the next start fails with `P3018` again, and you repeat steps 2 and 3.
4. Start again: `docker compose up -d --wait --wait-timeout 180`.

Another migration that fails is recovered the same way when it changed nothing
before failing: read the `P3018` reason in `docker compose logs app`, fix what it
names, and pass that migration's name to `--rolled-back`. If it may have changed
part of the database, roll back instead, as [Upgrade and rollback](#upgrade-and-rollback)
describes: restore the backup taken before the upgrade into an empty installation
of the previous release. Restoring it under the new release only runs the same
migration again.

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
| App keeps restarting and its log says `P3018` or `P3009` | A migration failed; see [A migration stops the upgrade](#a-migration-stops-the-upgrade) before restarting again |
| TLS error / certificate not issued | DNS A/AAAA records, inbound TCP 443, port conflicts and Traefik logs; an incorrect AAAA record can also break issuance |
| Sign-in unavailable | Valkey must be healthy; authentication rate limiting fails closed |
| App exits with `[auth] refusing to start:` | From the release after v0.1.0-alpha.3: the line names the setting to fix — `STOKY_SECRET` unset, the example value or too short; `STOKY_URLS` unset, an entry that is not a bare address, or an https first entry beside plain-HTTP network addresses; `BETTER_AUTH_TRUSTED_ORIGINS` set, or `BETTER_AUTH_TELEMETRY` on. See step 2 |
| Log says `[config] NEXTAUTH_SECRET is deprecated` or `[config] NEXTAUTH_URL is deprecated` | From the release after v0.1.0-alpha.3: rename the key to `STOKY_SECRET` or `STOKY_URLS` in `.env`, keeping the value, then `docker compose up -d --wait`. See [Upgrade and rollback](#upgrade-and-rollback) |
| Sign-in refused with 403 `INVALID_ORIGIN` or `MISSING_OR_NULL_ORIGIN` (the form says the service is unavailable; the app's log says `Invalid origin`) | From the release after v0.1.0-alpha.3: the browser is at an address `STOKY_URLS` does not list, or a proxy strips `Origin`. Add the address people use to `STOKY_URLS` — only one that reaches this instance — or sign in at a listed one. The bundle lists only `https://` and `DOMAIN`, the one host Traefik routes. In development, `DEV_ALLOWED_ORIGIN` hosts are trusted too |
| People on IPv6, often on mobile data, are told to wait at sign-in | IPv6 clients share the Docker gateway's budget; see [Clients on IPv6](#clients-on-ipv6) |
| The right password is told to wait for minutes, again and again | The account's shared attempts are being spent; see [Somebody keeps being told to wait](#somebody-keeps-being-told-to-wait) |
| Somebody forgot their password | From the release after v0.1.0-alpha.3 an admin sets a new one from **Personas del hogar**; a sole owner's, and anybody's on v0.1.0-alpha.3, is set in the database, see [A forgotten password](#a-forgotten-password) |
| Somebody asks to be erased | The application cannot delete an account; see [Deleting somebody's account](#deleting-somebodys-account) |
| `/register` says registration is closed, with no form | From the release after v0.1.0-alpha.3: expected once an account exists with `first-user`, or always with `closed`; an admin adds people from **Configuración → Personas del hogar**. See `STOKY_REGISTRATION` in step 2 |
| App exits with `refusing to start: STOKY_REGISTRATION` | From the release after v0.1.0-alpha.3: the value is not `open`, `first-user` or `closed`; fix `.env`, or remove the line for `first-user` |
| Upload refused | JPEG/PNG/WebP only, maximum 10 MiB; HEIC/HEIF is unsupported |
| A scanned code always opens the empty product form | Open Food Facts is not being asked: the app needs outbound HTTPS to `world.openfoodfacts.org`, Valkey must be healthy (a lookup that cannot be counted is not sent), and each account may send 60 lookups an hour for codes this instance has not looked up recently — past that the scan page says so. This bundle does not pass `RATE_LIMIT_PRODUCT_LOOKUP_*` to the app, so the default applies |
| Empty inventory after moving directory | Check `-p`, `COMPOSE_PROJECT_NAME` and volume names before creating or deleting anything |

Report the release tag, image digest, command and redacted error through
[GitHub issues](https://github.com/NGarate/stoky/issues). Do not attach `.env`,
database dumps, session cookies or unredacted receipt photos.

**Never share the output of `docker inspect` or of `docker compose config`
without `--quiet`.** The secrets reach the containers as environment variables,
and both commands print them: the database password, which is also in
`DATABASE_URL`, and `STOKY_SECRET` (`NEXTAUTH_SECRET` before the release after
v0.1.0-alpha.3), which signs every session. Remove client
addresses and email addresses from log lines before you share them as well.

A security problem is not an issue: report it through the private form in
[Reporting a vulnerability](../SECURITY.md#reporting-a-vulnerability), which
also says what to do when the form is not offered. Every installation runs the
same image, so a public report reaches everyone before a fix does.
