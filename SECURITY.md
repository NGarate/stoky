# Security

Stoky is self-hosted. There is no instance we run, no central database, and no
way for us to push a fix to anybody's server. Whoever runs the container is the
operator, and the security of an installation is mostly in their hands. This
document says what the project does for you, what it does not do yet, and what
you have to do yourself.

The same rule applies here as in `docs/STATUS.md`: every claim below is
verifiable against a file in this repository. Where something is missing, it
says so.

---

## Reporting a vulnerability

Report privately through GitHub's security advisories:

**<https://github.com/NGarate/stoky/security/advisories/new>**

Please do not open a public issue for a security problem, and do not post
details in a discussion or a pull request.

Useful things to include: the version or image digest you are running, whether
the instance is exposed to the internet, what an attacker would gain, and the
smallest reproduction you can manage.

**What to expect.** This is a small project maintained in spare time. There is
no service-level agreement, no on-call rotation, and no bug bounty — no payment
of any kind. A realistic expectation is an acknowledgement within a couple of
weeks and a fix on a timescale that depends on severity and on how much time is
available. If a report goes unanswered for a month, please assume it was missed
and comment on the advisory again.

Because there is no central instance, a fix reaches operators only when they
rebuild or re-pull the image. Advisories will be published on the repository
once a fix is available, so watching releases is the only reliable way to hear
about one.

---

## Supported versions

| Version | Supported |
|---|---|
| Latest image built from `master` | Yes |
| Anything older | No |

Stoky is pre-1.0 MVP software on a trunk-only workflow: `master` is the only
branch, and every push to it that passes CI publishes a new image. There are no
release branches and no backports. The only supported configuration is the most
recent image built from `master`.

The `package.json` version field reads `1.0.0`. It is not meaningful and does
not indicate a stable release.

---

## What is already hardened

Verified against the files named in each row.

### Container and runtime — `Dockerfile`

- Multi-stage build. The compiler toolchain needed for `argon2` and `@swc/core`
  stays in the `deps` stage and never reaches the production image.
- The production image runs as `USER node`, not root.
- `dumb-init` is PID 1, so signals are forwarded and zombies reaped.
- The Prisma CLI is installed at build time into `/opt/prisma`. Container start
  used to fetch an unpinned CLI over the network on every boot; it no longer
  touches the network at start-up.
- A `HEALTHCHECK` lets the orchestrator restart a wedged container.
- The base image is pinned by tag rather than digest, deliberately, so that
  Alpine security updates arriving in `node:24-alpine` rebuilds are picked up.
  The Trivy gate in CI is what catches a base image that has gone stale.

### Deployment — `docker-compose.prod.yml`

- `no-new-privileges:true` on every service.
- `cap_drop: [ALL]` on every service, with capabilities added back only where
  they are actually needed (Postgres for its data directory, Valkey for
  setgid/setuid, Traefik for `NET_BIND_SERVICE`).
- The app container runs with `read_only: true`. Writes are confined to the
  `uploads` volume plus tmpfs mounts for `/tmp` and `/app/.next/cache`.
- Postgres and Valkey sit on an `internal: true` bridge network and publish **no
  ports**. Only Traefik publishes anything, and only 80 and 443.
- Memory limits on every service, so one runaway process cannot take the host
  down.
- Traefik terminates TLS with Let's Encrypt, redirects HTTP to HTTPS, and adds
  HSTS (two years, `includeSubDomains`, `preload`), `nosniff` and `frameDeny`.

### Application headers — `next.config.ts` and `src/middleware.ts`

- Content-Security-Policy carries a **per-request nonce** generated in
  `src/middleware.ts`, with `strict-dynamic`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` and
  `upgrade-insecure-requests` in production. `'unsafe-eval'` is added in
  development only, for hot reloading.
  One honest caveat: `style-src` still includes `'unsafe-inline'`, because Next
  inlines critical CSS that cannot carry a nonce.
- Static headers set in the app itself, not only at the proxy, because a
  self-hosted app runs behind whatever proxy the operator already has:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Permitted-Cross-Domain-Policies: none`, HSTS, and a `Permissions-Policy`
  that allows `camera=(self)` for the barcode scanner and denies everything
  else.
- `poweredByHeader: false`, so responses do not advertise the framework version.

### Authentication — `src/lib/auth.ts`, `src/server/trpc/routers/auth.ts`

- Passwords are hashed with **Argon2id**, `memoryCost: 65536` (64 MiB) and
  `timeCost: 3`.
- Auth.js v5 with the credentials provider; sessions are JWTs with a 15-minute
  lifetime.
- Credentials are validated with a Zod schema before the database is touched,
  and `authorize` returns `null` for both an unknown email and a wrong password.

### Receipt uploads — `src/server/trpc/routers/receipt.ts`

- MIME allowlist (JPEG, PNG, WebP), a 10 MB size cap, and a magic-byte check on
  the decoded buffer.
- Every accepted image is re-encoded through Sharp to JPEG, which strips EXIF —
  including any GPS coordinates in a photo of a receipt.
- Files are written with a `randomUUID()` filename into a per-household
  directory on the `uploads` volume, so a filename cannot be guessed and cannot
  be used for path traversal.
- No HTTP route serves the uploads directory. Nothing in `src/app` reads it, and
  it is not inside `public/`.

### Supply chain — `.github/workflows/ci.yml`

- Every GitHub Action is pinned to a **commit SHA**, not a tag, because a tag
  can be moved and a SHA cannot.
- `pnpm audit --audit-level moderate` runs as its own job and fails the build.
- The image is built and **loaded locally, then scanned by Trivy before it is
  pushed** — scanning after publication would be the wrong order. Results are
  uploaded as SARIF, and a separate step fails the job on CRITICAL or HIGH
  findings (`ignore-unfixed: true`).
- The published image carries an **SBOM** (`sbom: true`) and **build provenance**
  (`provenance: mode=max`), plus a signed provenance attestation pushed to the
  registry via `actions/attest-build-provenance`.
- Migrations are applied to an empty database in CI, so a migration that only
  works against an already-prepared database fails the build rather than
  somebody's first install.
- Workflow permissions default to `contents: read`; jobs request more
  explicitly.

Dependency status as of the last audit is recorded in `docs/STATUS.md` under
*Dependency security*.

---

## Known gaps

Read this section before deciding where to run Stoky. It is not a wish list; it
is what is wrong today.

### There is no rate limiting anywhere — brute force works

`ISSUES.md` CRITICAL-4. There is no rate limiting on login, on registration, or
on anything else. `src/` contains no cache client at all — no Valkey, no Redis,
no in-process limiter — despite a `cache` service being defined in both compose
files. `CLAUDE.md` specifies 5 login attempts per 15 minutes and 3 registrations
per hour per IP; none of that is implemented.

The practical consequence: an attacker who can reach the login form can try
passwords as fast as Argon2id will answer, indefinitely, and can create accounts
in bulk.

**Do not expose Stoky to the public internet until rate limiting lands.** Run it
on your LAN, or behind a VPN. This is the project's own position, stated in
`docs/STATUS.md` and `docs/REDESIGN_PLAN.md`, where it is the only critical
security item still open.

### The password policy is a length check

`src/lib/validations/auth.ts` requires `min(8)` and nothing else — no
complexity rules, no check against known-breached passwords, no maximum.
Combined with the absence of rate limiting, weak passwords are the most likely
way an instance gets broken into. `ISSUES.md` DEBT-1.

### Seven of eight tRPC routers throw bare `Error`

Only `receipt.ts` uses `TRPCError`. The other seven (`auth`, `product`,
`location`, `inventory`, `store`, `price`, `shopping`) throw plain `Error`, as
does the `protectedProcedure` middleware in `src/server/trpc/trpc.ts` for its
`"Unauthorized"` case. Every one of those reaches the client as
`INTERNAL_SERVER_ERROR`, so a client cannot distinguish "not signed in" from
"not found" from a genuine server fault. That is a correctness problem first,
but it also makes any future authorisation logic harder to reason about and
harder to test. `ISSUES.md` DEBT-4.

### Household roles are decorative

`HouseholdRole` (`OWNER`, `ADMIN`, `MEMBER`) is assigned at registration and
returned by `auth.me`, but it is checked nowhere. It is not carried in the JWT
or the session, and there is no role-aware tRPC middleware — only
`protectedProcedure`, which means "signed in". Any member of a household can
perform any operation on that household's data. A role system is planned
(`docs/REDESIGN_PLAN.md` §5.2, Phase 3); it does not exist yet.

### The accessibility audit is automated; the human half is not done

This section previously said no axe run and no screen-reader pass had ever been
executed. That stopped being true in Phase 2b and the section was not updated —
in the one document whose whole premise is that every claim is checkable against
a file, which is the worst place for it.

What runs today: `pnpm check:contrast` enforces WCAG AAA on the token pairs, and
four Playwright suites enforce the rest — axe at the full AAA rule set over
every route in both themes at three viewport tiers, target size and heading
order measured in CSS pixels, the criteria no tool decides (1.4.8, 2.4.9, 3.3.5,
reduced motion), and a walk of the accessibility tree across four journeys.

What is still owed, and is the reason this section survives: **a person using a
screen reader**. Automated testing catches roughly a third of real accessibility
problems. The tree can be verified to contain the right information; whether the
result *sounds* sensible cannot. Any accessibility score in an older document
was still not produced by a tool.

### Traefik has the Docker socket, which is root on the host

`docker-compose.prod.yml` mounts `/var/run/docker.sock` into the Traefik
container. It is mounted read-only, but **read access to the Docker socket is
effectively root on the host**: it is enough to enumerate containers, read their
environment (including `NEXTAUTH_SECRET` and the database password), and in
practice to escalate further. It is there because Traefik's Docker provider
discovers routes through it.

If that trade is not acceptable — and for an internet-facing box it probably is
not — put a socket proxy in front of Traefik and expose only the container-list
endpoint, or replace the Docker provider with a static file provider and drop
the socket mount entirely.

### Other things that do not exist

- No error tracking, no monitoring, no application health endpoint. The
  container health check requests `/login`.
- No data export and no in-app backup. Backups are entirely the operator's job.
- No audit log. There is no record of who changed what.
- No account lockout, no password reset flow, no email verification, no
  two-factor authentication.
- No secret scanning or SAST in CI. `ci.yml` is the only workflow; Trivy scans
  the image, not the source.

---

## Guidance for operators

### Before the first start

1. **Generate a real `NEXTAUTH_SECRET`.**

   ```bash
   openssl rand -base64 32
   ```

   `.env.example` ships the placeholder `your-secret-key-here-change-in-production`.
   Leaving it in place means anyone who has read the repository can forge a
   session cookie for your instance.

2. **Change every example password.** `.env.example` contains
   `POSTGRES_PASSWORD=change-me-in-production`, and `docker-compose.dev.yml`
   hardcodes `stoky_dev_password`. Both are public knowledge. Set your own, and
   keep the `.env` file out of version control.

3. **Use `docker-compose.prod.yml` for anything that is not your laptop.**
   `docker-compose.dev.yml` publishes PostgreSQL on 5432 and Valkey on 6379 to
   the host, with that known password. It is for local development only. The
   production file keeps both on an internal network with no published ports —
   keep it that way, and do not add a `ports:` entry to `db` or `cache` for
   convenience.

### Where to run it

**Prefer a private network.** Given the missing rate limiting, the safest
deployment today is one that is not reachable from the internet at all:

- your LAN only, with no port forwarding on the router; or
- behind a VPN — WireGuard, or Tailscale, which needs no open inbound port at
  all.

If you must publish it, put an authenticating reverse proxy in front (basic
auth, an identity-aware proxy, or your VPN's own gateway) so that the login form
is not the first thing an anonymous visitor reaches, and use a strong, unique
password for every account.

`next.config.ts` contains an `allowedDevOrigins` list with the maintainer's LAN
and Tailscale addresses. It affects `next dev` only and has no effect on a
production build, but it is worth narrowing to your own addresses if you develop
on the machine.

### Keep it updated

Base-image CVEs are fixed by rebuilding, not by patching in place. `node:24-alpine`
is pinned by tag precisely so that a rebuild picks up Alpine security updates.

Note that the `app` service in `docker-compose.prod.yml` is declared with
`build:`, not `image:`, so `docker compose pull` will not update it. Either
rebuild from an updated checkout:

```bash
git pull
docker compose -f docker-compose.prod.yml build --pull app
docker compose -f docker-compose.prod.yml up -d
```

or point the service at the published image
(`image: ghcr.io/ngarate/stoky:latest`, ideally pinned to a digest) and pull it
instead.

Trivy fails the build on CRITICAL and HIGH findings that have a fix available,
so an image that passed CI was clean at publication time — but only at that
moment. An image left running for six months is not.

### Back up your data

There is no export feature. Two things hold everything you care about:

- the `postgres_data` volume — the whole database;
- the `uploads` volume — the receipt images.

Back up both. A database dump alone loses your receipts; copying the volumes
alone gives an inconsistent database unless the container is stopped. A workable
pattern is `pg_dump` from inside the `db` container plus a copy of the `uploads`
volume, taken together, stored off the machine, and **restored at least once** so
you know the backup works.

---

## Verifying an image's provenance

CI publishes signed build provenance to GHCR, so you can check that the image
you are about to run really was built by this workflow, from this repository, at
a specific commit. With the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify \
  oci://ghcr.io/ngarate/stoky:latest \
  --repo NGarate/stoky
```

Images are tagged `latest` and `sha-<full-commit-sha>`. Pinning to a digest or
to a `sha-` tag rather than `latest` is the safer choice for a deployment you
want to be reproducible.

The image also carries an SBOM, which lists the packages it contains:

```bash
docker buildx imagetools inspect \
  ghcr.io/ngarate/stoky:latest \
  --format '{{ json .SBOM }}'
```

If verification fails, do not run the image — report it through the advisory
link at the top of this document.

---

## Related documents

| Document | Purpose |
|---|---|
| `docs/STATUS.md` | Command-verified state of the project, including the dependency audit |
| `ISSUES.md` | Open issues, with file references — CRITICAL-4 is the rate limiting gap |
| `docs/REDESIGN_PLAN.md` | Where the product is going, and which phase closes each gap |
