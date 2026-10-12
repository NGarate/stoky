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
| Latest published alpha | Best-effort fixes in the next alpha |
| `master` / `latest` image | Development snapshots |
| Older releases | No backports |

Stoky is pre-1.0 alpha software on a trunk-only workflow. `package.json`, the
release tag and `deploy/example.env` identify the same version. Release notes
state upgrade limitations; installations pin a release instead of following
`latest`. There are no release branches or compatibility guarantees for alpha
schema changes. See [installation](docs/INSTALL.md) and [releasing](docs/RELEASING.md).

---

## What is already hardened

Verified against the files named in each row.

### Container and runtime — `Dockerfile`

- Multi-stage build. The compiler toolchain needed for `argon2` and `@swc/core`
  stays in the `deps` stage and never reaches the production image.
- All application image stages use the pinned `oven/bun` Alpine image. Bun
  installs dependencies, builds Next, runs migrations and serves the app.
  The upstream `node` compatibility command resolves to the Bun executable;
  no separate Node.js runtime, npm or npx is installed.
- The production image runs as `USER bun`, not root. Its UID/GID is 1000,
  matching the former `node` account so existing upload volumes remain writable.
- `dumb-init` is PID 1, so signals are forwarded and zombies reaped.
- The Prisma CLI and its dependency tree are copied into `/opt/prisma` from
  the same frozen Bun installation used to build the application. There is
  no second package resolution or npm installation. Startup runs that bundled
  CLI through Bun and does not download packages or OCR language data.
- A `HEALTHCHECK` reports database/cache reachability through `/api/health`.
  Docker does not restart a running container solely because it is unhealthy.
- The Bun base image uses the version pinned in `.bun-version`. Production
  runs `apk upgrade --no-cache` during the build to take Alpine security fixes;
  Trivy scans the completed image before publication.

### Release deployment — `deploy/docker-compose.yml`

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
- Traefik uses a read-only file provider, with no Docker socket access.
- Traefik terminates TLS with Let's Encrypt, redirects HTTP to HTTPS, and adds
  HSTS (two years, `includeSubDomains`, `preload`), `nosniff` and `frameDeny`.

### Application headers — `next.config.ts` and `src/proxy.ts`

- Content-Security-Policy carries a **per-request nonce** generated in
  `src/proxy.ts`, with `strict-dynamic`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'none'`.
  `'unsafe-eval'` is added in development only, for hot reloading.
  `upgrade-insecure-requests` is sent **only when the request itself arrived
  over https** (Traefik's `x-forwarded-proto`, or the URL's own scheme) — on a
  plain-http install the directive upgraded every WebKit fetch into a TLS
  handshake against a server with no TLS, which killed the application on
  Safari while the page still rendered. Behind TLS termination nothing
  changed. A client forging the header against an http install only breaks
  its own requests.
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
- Every accepted image is re-encoded through `src/server/services/image.ts` (`Bun.Image`) to JPEG, which strips EXIF —
  including any GPS coordinates in a photo of a receipt.
- Files are written with a `randomUUID()` filename into a per-household
  directory on the `uploads` volume, so a filename cannot be guessed and cannot
  be used for path traversal.
- No HTTP route serves the uploads directory. Nothing in `src/app` reads it, and
  it is not inside `public/`.

### Supply chain — `.github/workflows/ci.yml`

- Every GitHub Action is pinned to a **commit SHA**, not a tag, because a tag
  can be moved and a SHA cannot.
- `bun audit --audit-level moderate` runs as its own job and fails the build. It
  answers from `bun.lock` alone, so the job installs nothing.
- The image is built and **loaded locally, then scanned by Trivy before it is
  pushed** — scanning after publication would be the wrong order. Results are
  uploaded as SARIF, and a separate step fails the job on CRITICAL or HIGH
  findings (`ignore-unfixed: true`).
- The published image carries an **SBOM** (`sbom: true`) and **build provenance**
  (`provenance: mode=max`), and a **signed provenance attestation** pushed to the
  registry via `actions/attest-build-provenance`, which an operator can check
  without trusting the registry ([Verifying an image's
  provenance](#verifying-an-images-provenance)). The repository is public, so
  the step runs; it stays gated on `github.event.repository.private == false`
  because GitHub refuses attestations for a user-owned private repository, which
  is what a private fork or copy would be. Released images are attested from
  `v0.1.0-alpha.3` on; `v0.1.0-alpha.1` and `v0.1.0-alpha.2` were built while the
  repository was private and have none.
- Migrations are applied to an empty database in CI, so a migration that only
  works against an already-prepared database fails the build rather than
  somebody's first install.
- Workflow permissions default to `contents: read`; jobs request more
  explicitly.

Dependency status as of the last audit is recorded in `docs/STATUS.md` under
*Dependency security*.

---

## Known gaps

**Reviewed 2026-08-26.** `docs/SECURITY_REVIEW.md` is Phase 7's review: eight
areas, what each is protected by and which test proves it, and the findings that
remain with an owner. Two sections below were found to be false and are
corrected in place rather than deleted — a wrong claim in this file is worth
seeing, since its whole premise is that every claim is checkable.

Read this section before deciding where to run Stoky. It is not a wish list; it
is what is wrong today.

### Rate limiting covers authentication only

`ISSUES.md` CRITICAL-4 is closed as of Phase 3: `src/lib/rate-limit.ts` counts
sign-ins and registrations per IP in Valkey, at the numbers `CLAUDE.md`
specifies — 5 sign-ins per 15 minutes, 3 registrations per hour. A successful
sign-in is not charged to its address — the one attempt that succeeded is
refunded — so a household signing in from several devices is not locked out by
a limit meant for someone guessing. It is refunded rather than the counter
cleared, because anybody can sign in successfully from an address: clearing let
an attacker with an account of their own interleave guesses at other people's
passwords with sign-ins to their own and never fill the bucket. The refund goes
to the window that counted the attempt and to no other: a sign-in counted just
before its window ends that succeeds just after finds a newer window under the
same key, and refunding there would erase a guess made after it.

**Sign-in is also counted per account**, at 10 attempts per 15 minutes. NIST
SP 800-63B §5.2.2 asks a verifier to limit consecutive failed attempts against
*an account*, and a per-IP limit does not do that: an attacker with a hundred
addresses gets the per-IP budget from each of them, which is five hundred
attempts against one password. With both limits in force, a hundred addresses
buy ten. The number is higher than the per-IP one because this counter cannot
tell a household's phone from its tablet, and a successful sign-in clears it —
safe here, since only that account's own password can.

The counter is keyed on a SHA-256 of the normalised address rather than the
address, so a `KEYS rl:login:acct:*` on Valkey — available to anything on the
Docker network — does not come back as a list of who has tried to sign in. It
counts attempts on addresses that are not registered too, so the difference
between "refused" and "rejected" cannot be used to discover which addresses
exist.

What is still open, and worth knowing before publishing an instance:

- **Receipt upload is limited too**, at 30 per account per hour, counted
  before the file is decoded. OWASP ASVS **V11.1.4** asks for anti-automation
  on expensive operations, and this is the expensive one: up to 10 MB decoded,
  re-encoded through `src/server/services/image.ts` (`Bun.Image`), written to a volume, then handed to Tesseract. It
  is counted per *account* rather than per address, because the caller is
  already authenticated and a household behind one NAT would otherwise share a
  budget for work each member does separately. A refused upload still counts —
  otherwise sending rubbish and being rejected would be the cheapest way to
  spend the server's CPU, and it would be outside the limit.
- **Every other tRPC procedure is unlimited**, so an authenticated account can
  still make as many ordinary calls as it likes. That is a smaller problem — it
  needs credentials first, and those calls read rows rather than start OCR —
  but it is not nothing on a shared household instance.
- **The identifier is an IP address**, read from the last hop of
  `X-Forwarded-For`. Everyone behind one NAT therefore shares a bucket. An
  attacker with a range of addresses gets one bucket per address, which is what
  the per-account limit above exists to bound.
- **That makes a proxy a requirement, not a recommendation.** The last hop is
  the entry a client cannot forge *only when something in front of the app
  appends to the header*. Reachable directly, the whole header is whatever the
  caller sent — measured, not inferred: a request carrying
  `X-Forwarded-For: 1.2.3.4` is counted against `1.2.3.4`, and one carrying
  `9.9.9.9` gets a fresh counter. `X-Real-IP` is trusted the same way and for
  the same reason. Nothing in the header distinguishes a proxy's entry from a
  client's, so nothing in the application can either.

  **So: do not expose this application without a reverse proxy that sets
  `X-Forwarded-For` itself.** The release bundle (`deploy/`) puts Traefik in front
  and Traefik does — the release smoke (`scripts/smoke-proxy.sh`) forges both
  headers through it on every release and fails unless the limit still holds,
  and `--live DOMAIN` runs the same check against a real installation's
  ingress. A deployment that publishes the container's port directly has a
  per-IP limit an attacker turns off with one header — bounded only by the
  per-account limit above, which is what keeps that from being an open door
  rather than what makes it safe.

  Recorded as a deployment requirement rather than fixed, because the fixes are
  choices with costs — an allowlist of trusted proxy addresses, or refusing to
  start without one — and they are the operator's and the owner's to make.
  `src/__tests__/unit/rate-limit.test.ts` pins the current behaviour under
  "what the identifier cannot know", so changing the trust model means changing
  those tests and this paragraph together.
- **A refusal says how long to wait.** A 429 from tRPC carries `Retry-After`,
  read off the refusal rather than recomputed, so the header and the message
  cannot disagree — RFC 9110 §10.2.3. Two things deliberately do not carry it:
  the 503 a dead Valkey produces, because nothing knows when the cache is
  coming back and an invented number would be worse than none; and sign-in,
  which never produces a 429 at all, since Auth.js answers a refused
  credentials callback with a redirect to `/login?error=…`.
- **It fails closed.** If Valkey is unreachable, nobody can sign in. That is
  deliberate — failing open would hand an unlimited auth endpoint to anyone who
  can take the cache down — but it makes Valkey a hard dependency of signing
  in, which it was not before. The server log names Valkey and `VALKEY_URL`
  when it happens, and the browser is told the service is unavailable rather
  than that the password was wrong.
- **The limits are configurable** through `RATE_LIMIT_LOGIN_ATTEMPTS`,
  `RATE_LIMIT_LOGIN_WINDOW_SECONDS`, `RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS`,
  `RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS`, `RATE_LIMIT_REGISTER_ATTEMPTS` and
  `RATE_LIMIT_REGISTER_WINDOW_SECONDS`. Raising them raises the exposure; the
  browser suite raises them because it registers dozens of accounts per run,
  and a unit test asserts the shipped defaults with the environment unset so
  that override cannot become the product's behaviour.

### Refusals are recorded

OWASP ASVS **V7.1.3** asks that security-relevant events be logged, and until
Phase 7's slice of the backlog almost none were: a refused sign-in returned
`null` and said nothing, and a request for another household's receipt threw
`FORBIDDEN` at the caller and left no trace on the server. The one question an
owner will actually ask — "has anybody been trying to get into my instance?" —
had no answer anywhere.

`src/lib/security-log.ts` writes one JSON object per event to stderr, which
Docker already collects and rotates: `docker compose logs app | jq 'select(.event
== "access.denied")'` works with nothing installed. The events are
`auth.signin.failed`, `auth.signin.throttled`, `auth.unavailable`,
`access.denied` and `request.throttled`.

- **The access-control events come from a tRPC middleware, not from the
  resolvers.** A refusal is thrown from three middlewares and from a dozen
  resolvers comparing `householdId`; catching it centrally is what stops a new
  router from forgetting to be audited. Only UNAUTHORIZED, FORBIDDEN and
  TOO_MANY_REQUESTS — logging every error would bury the refusals in
  NOT_FOUNDs and produce a log nobody greps.
- **A failed sign-in logs the same line whether or not the account exists.**
  Recording which of the two it was would put back, in a file, exactly the
  distinction the flattened error message refuses to tell the browser. **And it
  takes as long**: an address with no account is verified against a dummy
  Argon2id hash with the same parameters, so the response time does not answer
  the question the message refuses to.
- **No password, hash, token, cookie or request body ever reaches a line**, and
  the writer drops those keys defensively rather than relying on its own type
  to have no field for them. A credential in a log is a credential in every
  copy, rotation and backup of that log.

Verified in a browser, not only by test: five wrong passwords are refused as
wrong, the sixth is refused as rate-limited, a *correct* password is still
refused while the window is open, and the counter carries a TTL so the refusal
expires. The counting itself is proven against a real Valkey in
`src/__tests__/integration/rate-limit.test.ts`.

### The session signing key cannot be the example one

`NEXTAUTH_SECRET` signs the session JWT, and Auth.js reads it from the
environment itself without ever inspecting it — so until Phase 7's slice nothing
in this application had looked at what it was. `.env.example` ships a
placeholder, and that placeholder is **published in this repository**: an
instance deployed without changing it signs sessions with a key anybody can
read, and nothing about the running system looks wrong.

`src/lib/auth/secret.ts` refuses to serve in production if the secret is
missing, is the example value, or is shorter than 32 characters — with a message
naming the file and the command that generates a real one, because the person
reading it is looking at a container that will not start.

- **At start-up, and the process exits.** `src/instrumentation.ts` runs the
  check from Next's `register` hook and exits with status 1, so the server never
  listens. Until 2026-10-06 the check ran only when `@/lib/auth` was first
  imported — by the first request needing a session — and Next answers a route
  module that fails to load with a 500, not an exit: the container stayed up,
  `/api/health` (which never imports auth) answered 200, and every sign-in
  failed. A *throw* from `register` is not enough either: measured against the
  standalone server, Next logs "Failed to prepare server" and keeps listening,
  answering 500 to everything.
- **`/api/health` checks it too**, answering 503 with the same opaque body as
  any other failed dependency, so an instance that somehow got past start-up
  with an unusable key is reported unhealthy rather than healthy.
- **Production only.** Development and the suites use whatever is to hand;
  refusing there would trade a risk nobody faces for an obstacle everybody does.
- **Not during `next build`.** The image is built without a runtime secret and
  receives one when the container starts, so asserting at build time breaks
  `docker build` — which the first version of this guard did, and which is a
  worse outage than the one it prevents.

---

### The password policy prefers length, and it is not a breach check

`src/lib/validations/password.ts` is the policy, and it is applied wherever a
password is *set*: registration, and the accounts an admin creates for a
household. Twelve characters minimum, a maximum of 128, a refusal of the
handful of passwords that appear at the top of every leak, and a refusal to
accept the account's own name or address as its password.

**No composition rules**, which is the opposite of what `ISSUES.md` DEBT-1
proposed. That entry asked for the familiar four regexes — an uppercase, a
lowercase, a digit, a symbol. NIST SP 800-63B §5.1.1.2 advises against exactly
those: they push people toward `Password1!`, which is more predictable than a
longer passphrase, and they are why passwords get written down. This document
already cites SP 800-63B for rate limiting; applying it there and ignoring it
here would be picking the half that was easy. Twelve rather than the
specification's floor of eight buys back some of what the missing breach check
gives away.

What is still open:

- **There is no breached-password check.** The real one is against a corpus of
  hundreds of millions, which needs either a large local file or an outbound
  call to a service — neither of which belongs in an install expected to work
  air-gapped. What ships is a short list of the passwords a guessing attempt
  starts with, which is a floor rather than the control.
- **The policy is not applied to an existing password at sign-in**, beyond the
  maximum. A verifier that refused a stored password because the rule changed
  would lock people out of their own household.

The maximum is not a usability rule at all: `argon2.hash` and `argon2.verify`
were both taking unbounded input on two endpoints reachable without an account,
at 64 MB per call. A body of a few megabytes turned registration into a memory
amplifier — the rate limiter bounds how often, not how much.

### ~~The services layer still throws bare `Error`~~ — closed

**Corrected 2026-08-26 by the Phase 7 review.** `ISSUES.md` DEBT-6 closed this
and the section was not updated. `grep -c "throw new Error(" src/server/services/*.ts`
returns **0**: `src/server/services/errors.ts` defines a `ServiceError`
hierarchy — `NotFoundError`, `InvalidInputError`, `UpstreamError` — translated
to tRPC codes by the same middleware that handles Prisma's, so a missing row
from a service reaches the client as `NOT_FOUND` rather than as
`INTERNAL_SERVER_ERROR`. The offline queue stops retrying it instead of spending
eight attempts on it.

DEBT-4 closed earlier, in Phase 3: the routers raise `TRPCError` with a code
chosen by what the client can do about the condition.

What is still `INTERNAL_SERVER_ERROR` is a fault nobody anticipated, and its
message is **not** the underlying error's: the `errorFormatter` in
`src/server/trpc/trpc.ts` replaces it with a generic sentence and writes the
original to the server log (OWASP ASVS V7.4.1). Before that, a raw Prisma
failure reached the browser with its SQL and the file it ran from, and was
logged nowhere. Every other code keeps the message its resolver or translator
chose, because the screens read those. `src/__tests__/unit/trpc-error-shape.test.ts`
checks both halves over HTTP.

### ~~Household roles are decorative~~ — this section was false

**Corrected 2026-08-26 by the Phase 7 review**, and it is worth leaving the
correction visible rather than quietly deleting the claim: this is the file
whose stated premise is that every claim is checkable against a file, and this
one was checkable and wrong.

It said the role "is checked nowhere", "is not carried in the JWT or the
session", that "there is no role-aware tRPC middleware", and that "any member of
a household can perform any operation on that household's data". All four were
false, and had been since Phase 3.

What is actually true: `HouseholdRole` has four values including `KITCHEN`;
`src/types/next-auth.d.ts` declares `role` on the session non-optionally;
`src/server/trpc/trpc.ts` defines `CAPABILITY_ROLES` and three enforced tiers,
where `writeProcedure` refuses `KITCHEN` and `adminProcedure` refuses `MEMBER`;
and all 60 procedures are assigned, with `src/__tests__/unit/capabilities.test.ts`
pinning every one against the matrix rather than sampling. Membership and role
are read from the database on every call rather than from the JWT, so a
demotion takes effect on the next request.

The real limit is one level down and is recorded in `docs/SECURITY_REVIEW.md`
§2: the tier answers *may this role do this*, not *may this caller touch this
row*, and the second was not uniform. Four instances of that were found and
fixed; a test now fails on the shape of them.

### The accessibility audit is automated; the human half is not done

This section previously said no axe run and no screen-reader pass had ever been
executed. That stopped being true in Phase 2b and the section was not updated —
in the one document whose whole premise is that every claim is checkable against
a file, which is the worst place for it.

What runs today: `bun run check:contrast` enforces WCAG AAA on the token pairs,
and four Playwright suites enforce the rest — axe at the full AAA rule set over
every route in both themes at three viewport tiers, target size and heading
order measured in CSS pixels, the criteria no tool decides (1.4.8, 2.4.9, 3.3.5,
reduced motion), and a walk of the accessibility tree across four journeys.

What is still owed, and is the reason this section survives: **a person using a
screen reader**. Automated testing catches roughly a third of real accessibility
problems. The tree can be verified to contain the right information; whether the
result *sounds* sensible cannot. Any accessibility score in an older document
was still not produced by a tool.

### Other things that do not exist

- No hosted error tracking or monitoring. `/api/health` checks the database/cache.
- Settings exports household JSON, without receipt files or a restore importer.
  Full backups remain the operator's job; [the guide](docs/INSTALL.md) covers them.
- Refusals are audit-logged, but there is no complete history of who changed what.
- Registration remains open to anyone who can reach the instance. Restrict access
  to trusted testers; there is no invitation-only switch.
- No account lockout, no password reset flow, no email verification, no
  two-factor authentication.
- No secret scanning or SAST in CI. `ci.yml` is the only workflow; Trivy scans
  the image, not the source.

---

## Guidance for operators

### Before the first start

Follow [the installation guide](docs/INSTALL.md). The released `example.env`
leaves all four required settings empty; Compose refuses missing values. Generate
two independent `openssl rand -hex 32` secrets, and keep `.env` private.
The app rejects short signing keys and the published development placeholder.

Use the release bundle, which exposes only Traefik. Development Compose files
publish local infrastructure and carry known passwords; they are not deployments.
A proxy that sanitizes forwarded addresses remains mandatory for per-IP limits.

### Where to run it

Restrict this alpha to trusted testers through your network or an authenticating
proxy. The [security review](docs/SECURITY_REVIEW.md) has run and the password
policy includes common-password/identity checks; neither makes this a stable
release. The bundled automatic certificate flow needs a hostname and inbound
TCP 443. LAN/VPN deployments need their own trusted TLS configuration.

### Keep it updated

Use exact release tags and follow the target release notes and
[upgrade/rollback procedure](docs/INSTALL.md#upgrade-and-rollback). Pulling alone
does not replace running containers; `docker compose up -d --wait` does.
Do not automatically follow `latest` for an alpha installation.

Trivy checks images before publication for fixable CRITICAL/HIGH findings.
Published images are not continuously rescanned; a clean publication scan is not
an assurance about vulnerabilities disclosed later. Updates require a newly built
image, not an in-place package upgrade inside a running container.

### Back up your data

Preserve a PostgreSQL dump, the uploads volume, the exact Compose file and `.env`
together. The [backup and restore commands](docs/INSTALL.md#backup-and-restore)
stop app writes during the copy and restore into an empty installation. Keep
backups off the host and verify restoration before relying on them. JSON export
is not a substitute for a database-and-images backup.

## Verifying an image's provenance

CI publishes signed build provenance to GHCR, so you can check that the image you
are about to run really was built by this repository's `ci.yml`, from the release
tag you chose. Verify the exact version you set as `STOKY_VERSION`, never
`latest`, and pin the workflow and the source ref as well as the repository:

```bash
gh attestation verify \
  oci://ghcr.io/ngarate/stoky:v0.1.0-alpha.3 \
  --repo NGarate/stoky \
  --signer-workflow NGarate/stoky/.github/workflows/ci.yml \
  --source-ref refs/tags/v0.1.0-alpha.3
```

`--repo` alone accepts an attestation from any workflow run on any branch of the
repository; `--source-ref` is what ties the image to the release tag. For a
`sha-` image from `master`, use `--source-ref refs/heads/master`.

This step is optional. It needs the [GitHub CLI](https://cli.github.com/) signed
in to a GitHub account (`gh auth login`): without one it stops with
`gh auth login` and exit code 4 before checking anything. The installation path
needs no account and relies on `SHA256SUMS` for the release files and on the
exact version tag for the image; the attestation is the check that the image
behind that tag was built here.

From `v0.1.0-alpha.3` on, **a missing attestation or a failed verification means
do not run the image**: report it as a [vulnerability](#reporting-a-vulnerability).
`v0.1.0-alpha.1` and `v0.1.0-alpha.2` were built while the repository was private
and carry no attestation, so for them the command fails with `HTTP 404` from the
attestations API; upgrade off them rather than treat that as normal.

Images from `master` are tagged `sha-<full-commit-sha>`. A release tag's build is
pushed as `candidate-<version>` and gains the exact version tag only after the
install smoke passes on that digest; it never rewrites the `sha-` tag. The
attestation is bound to the digest, not the tag, so the version tag verifies with
the provenance of the tag run that built it. `latest` is the development channel
from `master`. Pinning to a digest or to an exact version tag rather than `latest`
is the safer choice for a deployment you want to be reproducible.

The image also carries an SBOM, which lists the packages it contains:

```bash
docker buildx imagetools inspect \
  ghcr.io/ngarate/stoky:v0.1.0-alpha.3 \
  --format '{{ json .SBOM }}'
```

---

## Related documents

| Document | Purpose |
|---|---|
| `docs/STATUS.md` | Command-verified state of the project, including the dependency audit |
| `ISSUES.md` | Open issues, with file references — CRITICAL-4 is the rate limiting gap |
| `docs/REDESIGN_PLAN.md` | Where the product is going, and which phase closes each gap |
