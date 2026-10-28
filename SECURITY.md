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

It needs a GitHub account: no email address or other channel is published for
someone without one, which is a gap, not a policy. Please do not open a public
issue for a security problem, and do not post details in a discussion or a pull
request. The issue chooser carries the same link
(`.github/ISSUE_TEMPLATE/config.yml`) for anyone who starts there.

**The form is the only channel.** Contributions from other people are closed for
now, and a repository setting, an interaction limit, lets only collaborators
comment, open issues or open pull requests
([Releasing](docs/RELEASING.md#repository-settings)). While it holds, an issue
is not a way in for anyone else.

**If the form is not offered to you.** GitHub offers it to people outside the
project only while the repository's private vulnerability reporting setting is
on, and the Security tab then shows a **Report a vulnerability** button that
opens it. `gh api repos/NGarate/stoky/private-vulnerability-reporting` answers
`{"enabled":true}` when it is; on 2026-10-23 it still answered
`{"enabled":false}`, and turning it on is a repository setting only the owner
can change. Without the button there is no private channel at all: that is a
gap too, and the owner's settings check reports it. If GitHub still lets you
open an [issue](https://github.com/NGarate/stoky/issues/new), open one that
says only that you have a security report and asks for a private channel. Leave
out every detail: not the affected feature, the version, or the kind of
weakness. A public issue is read by everyone running the same image, and there
is no way for us to patch their servers first.

**What is in scope.** This project's code, the container image it publishes,
and the release bundle (`deploy/` and the files attached to a release). Someone
else's Stoky installation is not: a weakness that comes from how one instance
is configured goes to whoever runs it, and a weakness in Stoky itself comes here
whatever instance you found it on. A defect in an upstream component (Bun,
Next.js, PostgreSQL, Valkey, Traefik) belongs to that project, unless the way
Stoky uses or ships it is what makes it exploitable.

**Which version.** Only the latest published alpha is supported (see
[Supported versions](#supported-versions)); please check a finding against it
before reporting. A report against `master` is welcome too.

Useful things to include: the version or image digest you are running, whether
the instance is exposed to the internet, what an attacker would gain, and the
smallest reproduction you can manage.

**What to expect.** This is a small project maintained in spare time. There is
no service-level agreement, no on-call rotation, and no bug bounty — no payment
of any kind. A realistic expectation is an acknowledgement within a couple of
weeks and a fix on a timescale that depends on severity and on how much time is
available. These are best-effort intentions, not commitments. If a report goes
unanswered for a month, please assume it was missed and comment on the advisory
(or the contact issue) again.

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

- Multi-stage build. The compiler toolchain (`python3 make g++`) stays in the
  `deps` stage and never reaches the production image. Nothing needs it today:
  it is the fallback for `argon2`, whose `node-gyp-build` loads the shipped
  musl prebuild (a clean `--target deps` build on 2026-10-12 left no
  `node_modules/argon2/build`). Until then this line also named `@swc/core`,
  which compiles nothing.
- All application image stages use the `oven/bun` Alpine image, pinned by
  version and digest. Bun installs dependencies, builds Next, runs migrations
  and serves the app.
  The upstream `node` compatibility command resolves to the Bun executable;
  no separate Node.js runtime, npm or npx is installed.
- The production image runs as `USER bun`, not root. Its UID/GID is 1000,
  matching the former `node` account so existing upload volumes remain writable.
  Everything else under `/app` and `/opt` is root-owned and read-only to it.
- The image does not depend on the build host's `umask`. `COPY` keeps the
  context's modes, so a source build from a checkout made under `umask 077`
  used to ship root-owned `0600` files and `0700` directories (`package.json`,
  `public/`, `prisma/`) that `bun` could not read, and the server died with
  `EACCES` at start. The builder's last step runs
  `chmod -R a+rX,go-w` over every path production copies: readable and
  traversable by all, writable by root alone, executables kept executable.
  `src/__tests__/unit/image-posture.test.ts` fails if a production `COPY` reads
  a builder path the step does not cover, or if the step stops being last.
- `dumb-init` is PID 1, so signals are forwarded and zombies reaped.
- The Prisma CLI and its dependency tree are copied into `/opt/prisma` from
  the same frozen Bun installation used to build the application. There is
  no second package resolution or npm installation. Startup runs that bundled
  CLI through Bun and does not download packages or OCR language data.
- The native Prisma schema engine is the one install-time download that
  `bun.lock` does not cover: the trusted `@prisma/engines` postinstall fetches
  it from `binaries.prisma.sh` and checks it only against a `.sha256` from the
  same origin. The build checks it against a SHA-256 value pinned in the
  `Dockerfile`, as it does the OCR model: the schema engine `migrate deploy`
  runs. Since Prisma 7 there is no query engine binary; the server queries
  through the `pg` driver adapter and a WebAssembly query compiler that comes
  in the npm tarball, which `bun.lock` does cover. It also fails if a native engine
  appears under `/opt/prisma` or the standalone output at a path it does not
  check. `src/__tests__/unit/image-posture.test.ts` fails if a path or a pin
  is dropped. The values are for `linux-musl-openssl-3.0.x` on amd64, the only
  image published, and change whenever a Prisma upgrade changes the engines
  ([Releasing](docs/RELEASING.md#upgrading-prisma)).
- From `prisma/`, the production image copies only `schema.prisma` and
  `migrations/`, which is what startup's `migrate deploy` reads. The demo seed
  (`prisma/seed.ts`), which creates an `OWNER` with the password the README
  publishes, is not in the image: the build fails if `/app/prisma/seed.ts`
  exists, and `src/__tests__/unit/image-posture.test.ts` fails on a broader
  `COPY` of `prisma/`. The seed itself refuses to run under
  `NODE_ENV=production` (`prisma/seed-guard.ts`, tested by
  `src/__tests__/unit/seed-guard.test.ts`), and its reset finds the demo
  household through the `demo@stoky.local` account rather than the free-text
  name *Hogar Demo*, in one transaction.
- The build context leaves out env files at every depth (`**/.env*`, with only
  the root `.env.example` let back in), so the `deploy/.env` that the
  source build in `docker-compose.prod.yml` has the operator write does not
  enter the `builder` or `development` layers through `COPY . .`. Nested
  `node_modules` and `.next`, local agent and tool state (`.claude`, `.codex`,
  `.opencode`, `.playwright`, whose `auth/` holds session cookies), stray
  `*.traineddata` and `*.tsbuildinfo` are excluded too.
  `src/__tests__/unit/image-posture.test.ts` fails if a rule goes back to
  root-only or a second negation appears. Published images are built from a
  clean CI checkout and never held these files.
- A `HEALTHCHECK` reports database/cache reachability through `/api/health`.
  Docker does not restart a running container solely because it is unhealthy.
- The Bun base image is the version pinned in `.bun-version`, named by tag and
  by the digest of its multi-platform index
  (`oven/bun:1.4.4-alpine@sha256:…`). A tag can be re-pushed and a digest
  cannot, so a re-pushed or substituted upstream tag cannot change what a
  release builds without a change in this repository.
  `src/__tests__/unit/image-posture.test.ts` fails if the digest is dropped
  and `src/__tests__/unit/bun-version.test.ts` if the tag and `.bun-version`
  disagree; neither can check offline that the tag and the digest name the
  same image, which is checked with `docker buildx imagetools inspect` when the
  pin moves. Production runs `apk upgrade --no-cache` during the build to take
  Alpine security fixes, so the packages on top of the pinned base are still
  whatever Alpine serves that day; Trivy scans the completed image before
  publication.

### Release deployment — `deploy/docker-compose.yml`

- **PostgreSQL, Valkey and Traefik are pinned by exact version and digest**
  (`postgres:16.15-alpine@sha256:…`, the digest of the multi-platform index).
  A tag can be re-pushed and a digest cannot, so the release smoke and every
  later `docker compose pull` of that release run the same builds, and a
  re-pushed upstream tag cannot reach an installation without a change in this
  repository. The cost is that their fixes reach an installation only with a
  Stoky release: `docs/RELEASING.md` refreshes the pins for each one. Between
  releases Dependabot (`docker-compose` ecosystem, `docs/RELEASING.md`,
  *Dependency updates*) proposes minor and patch refreshes weekly — once its
  branches are allowed, an owner setting not yet applied on 2026-10-12
  (`docs/STATUS.md`, *Dependency security*); a merged one lands on `master`
  and ships with the next release. The app image is named by `STOKY_VERSION`.
  `src/__tests__/unit/deployment.test.ts` fails if a service image loses its
  digest or names a floating major. Verified by running each pinned reference:
  PostgreSQL 16.15, Valkey 8.1.11, Traefik 3.7.16.
- `no-new-privileges:true` on every service.
- `cap_drop: [ALL]` on every service, with capabilities added back only where
  they are actually needed (Postgres for its data directory, Valkey for
  setgid/setuid, Traefik for `NET_BIND_SERVICE`).
- The app container runs with `read_only: true`. Writes are confined to the
  `uploads` volume plus tmpfs mounts for `/tmp` and `/app/.next/cache`.
- Postgres and Valkey sit on an `internal: true` bridge network and publish **no
  ports**. Only Traefik publishes anything, and only 80 and 443.
- Memory limits on every service, so one service's runaway allocation stops at
  its own limit. Valkey is also bounded inside its own limit, with
  `--maxmemory`, because it does not read the container's: see "It fails
  closed" below.
- A process limit on every service (`deploy.resources.limits.pids`, which
  counts threads as well as processes): app 512, db 256, cache 128, traefik
  128. A fork loop or a runaway thread pool stops at its own container's
  ceiling instead of using up the host's process table. These are ceilings, not
  sizing. Measured on the bundle (8 cores, `v0.1.0-alpha.3`), from the cgroup's
  `pids.peak` after a sign-up, a sign-in, six receipt uploads run through OCR
  and 900 concurrent page and health requests through Traefik: app 50, db 25,
  cache 14, traefik 26. Postgres runs one process per connection, and its
  default `max_connections` of 100 keeps it under 256 however many connections
  the app's pool asks for. Forking 300 `sleep`s inside the cache container
  stopped at 127 of 128, with `pids.events` counting the refused forks.
  `docker exec` into that container was refused until they exited, the host
  was unaffected, and Valkey stayed healthy with no restart.
- **No CPU limit, deliberately.** Docker refuses to create a container whose
  `cpus` is above the host's core count ("range of CPUs is from 0.01 to 8.00,
  as there are only 8 CPUs available" here), and small hosts are the common
  install, so a fixed value would stop the bundle from starting on them. A busy
  service can therefore still use every core. The expensive path an account
  can trigger, OCR, runs on one shared worker (`src/server/services/ocr.ts`)
  and receipt upload is metered per account (below).
  `src/__tests__/unit/deployment.test.ts` pins each process limit and the
  absence of a `cpus` limit.
- Traefik uses a read-only file provider, with no Docker socket access.
- **Traefik does not contact Traefik Labs.** Its version check is on by
  default (`--global.checknewversion`, default `true` in `traefik:v3.7.13
  --help`) and asks Traefik Labs' update service for releases, which tells them
  a Traefik runs at the instance's address. The bundle sets it to `false`:
  Traefik reaches an operator through a Stoky release, which pins its version,
  so the notice was one they could not act on. Anonymous usage statistics are
  off by default and set to `false` anyway, so a changed default cannot turn
  them on. Measured by starting `traefik:v3.7.13` with no network and the
  bundle's command list for 11 minutes: before this change it logged "Version
  check is enabled" and, ten minutes in, a failed lookup of
  `update.traefik.io`; after it, "Version check is disabled" and no lookup at
  all. `src/__tests__/unit/deployment.test.ts` pins both flags. Traefik still
  contacts Let's Encrypt, which it must to issue and renew the certificate.
- Traefik terminates TLS with Let's Encrypt, redirects HTTP to HTTPS, and adds
  HSTS (two years, `includeSubDomains`), `nosniff` and `frameDeny`.
- **HSTS does not send `preload`**, from Traefik or from the app. The token is
  the domain owner's consent to the browsers' built-in HSTS lists:
  hstspreload.org checks the header, not who submits, and leaving the list is
  slow. Until 2026-10-12 both layers sent it on whatever `DOMAIN` an operator
  chose, so anyone could have submitted an apex install's domain, every
  subdomain with it; hstspreload.org asks software that ships HTTPS defaults
  not to send it (`docs/SECURITY_REVIEW.md` §8). An operator who wants
  preloading adds it at their own proxy. `includeSubDomains` stays, as ASVS 5
  V3.4.1 asks; on an apex `DOMAIN` it makes every host under that domain
  HTTPS-only for two years in each browser that opens Stoky, which
  `docs/INSTALL.md` warns about.
- **TLS 1.2 or later, and at 1.2 only forward-secret AEAD suites** — ECDHE
  with AES-GCM or ChaCha20-Poly1305, Mozilla's "intermediate" profile, in the
  `tls.options.default` block of `deploy/traefik.yml`. Without it Traefik takes
  Go's defaults, and measured against v3.7.13 those still accepted
  `ECDHE-RSA-AES128-SHA` and `ECDHE-RSA-AES256-SHA` (CBC with SHA-1) at TLS
  1.2. TLS 1.3 suites are not configurable in Go and are all AEAD. Clients that
  cannot do TLS 1.2 with one of those suites cannot connect; none is supported.
  Two settings are left out on purpose. `sniStrict` would refuse the handshake
  for the configured name itself while ACME has not yet issued (alert 112,
  measured in the 2026-10-12 audit), turning a pending certificate into an
  opaque failure and failing the release smoke, which has no certificate to
  issue; the cost is that a client without SNI still gets Traefik's default
  certificate, which names the software. `curvePreferences` would replace Go's
  list, which negotiates the post-quantum hybrid `X25519MLKEM768`;
  `[X25519, CurveP256]` measurably fell back to plain X25519. The release smoke
  (`scripts/smoke-proxy.sh`) requires a TLS 1.1 handshake and a CBC/SHA-1 suite
  at TLS 1.2 to be refused by the server, and a TLS 1.2 AEAD handshake to
  succeed; `src/__tests__/unit/deployment.test.ts` pins the block.
- **A quiet keep-alive connection is closed after 60 seconds**, not Traefik's
  default 180 (`transport.respondingTimeouts.idleTimeout=60s` on both
  entrypoints), so sockets held open for nothing free Traefik's 256m sooner.
  Browsers reconnect without the person noticing. `readTimeout` is stated at
  its default of 60s so that it cannot drift: in Go it covers the whole request,
  body included, and a 10 MiB receipt is about 14 MB of base64 on the wire, so
  60s already needs about 1.9 Mbps of uplink. There is no `writeTimeout`, which
  would cut off streamed tRPC batches. Measured against `traefik:v3.7.13` with
  the bundle's flags (no network, a Bun client in its namespace): an idle
  keep-alive connection closed 180.0s after its response before this change and
  60.1s after, on both entrypoints; a partial request line closed at 60.1s
  either way. `src/__tests__/unit/deployment.test.ts` pins the exact set of
  timeout flags. This shortens how long a connection is held; it does not cap
  how many one address holds: see "One address can hold Traefik's connections
  open" below.

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
  its own requests. Keeping a plain-http install *working* (D84) is not
  calling it safe: passwords and session cookies cross the network in
  cleartext there, and the server says so at start-up (*Authentication*,
  below).
  One honest caveat: `style-src` still includes `'unsafe-inline'`, because Next
  inlines critical CSS that cannot carry a nonce.
  **A page reaches one other origin, and only for images:** `img-src` allows
  `images.openfoodfacts.org`, for the product photographs. `connect-src` is
  `'self'` — Open Food Facts lookups are the server's, outside the policy, and
  the links to it are navigations, which `connect-src` does not govern. Until
  2026-10-12 it also allowed `world.openfoodfacts.org`, which no page fetched
  (`docs/SECURITY_REVIEW.md` §8).
- **The policy is on every page the app renders, including its not-found
  page.** The proxy's matcher excludes only what is served from disk —
  `/_next/static/`, the icon files by name, and `/sw.js`, which has a policy
  of its own in `next.config.ts` — each anchored to exactly that. Until
  2026-10-12 they were unanchored prefixes, so `/icons/x` or `/sw.jsx`
  rendered the app's not-found document with no policy at all
  (`docs/SECURITY_REVIEW.md` §8). One exception remains, and §8 says why it is
  harmless: a request labelled `Purpose: prefetch` or `Next-Router-Prefetch`
  skips the proxy, and so carries no policy either.
- **Next's Image Optimization endpoint is switched off**
  (`images: { unoptimized: true }` in `next.config.ts`): `/_next/image`
  answers 404 with the app's not-found page, which carries the policy like any
  other. Nothing renders `next/image`, but until 2026-10-12 the endpoint was
  live regardless — Next registers it whatever the source imports — and it
  fetched any same-origin path for an anonymous caller through the whole
  router, returning what sniffed as a raster image (`docs/SECURITY_REVIEW.md`
  §8). The same switch is what makes leaving `sharp` out of the production
  image correct.
- Static headers set in the app itself, not only at the proxy, because a
  self-hosted app runs behind whatever proxy the operator already has:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin` (below),
  `X-Permitted-Cross-Domain-Policies: none`, HSTS with the value Traefik
  sends (`src/__tests__/unit/deployment.test.ts` keeps the two equal), and a
  `Permissions-Policy` that allows `camera=(self)` for the barcode scanner,
  `publickey-credentials-create=(self)` and `publickey-credentials-get=(self)`
  for passkeys (PROGRESS D151), and
  denies, by name, eighteen powerful features Stoky does not use —
  microphone, geolocation, payment, USB, serial, HID, MIDI, screen capture,
  wake lock, the motion sensors and the rest (the list is in
  `next.config.ts`). It is a deny list, not a default: the header has no
  "everything else", so a feature it does not name keeps the browser's
  default, usually `'self'`. Until 2026-10-12 it named three, plus
  `interest-cohort`, the token of the retired FLoC, while its successor
  `browsing-topics` went undenied — and this line claimed the rest were
  denied (`docs/SECURITY_REVIEW.md` §8).
  `publickey-credentials-create` was on that list until 2026-10-15, when the
  settings screen began adding passkeys: denied, every registration fails
  with a `NotAllowedError` that reads like the person cancelling. Both
  passkey grants are `(self)`, their default, written out so the next edit of
  the list sees them; no frame is granted either. `bluetooth` is left unset
  because Chromium (151) does not recognise the token. No browser test pins
  the value since 2026-10-27 (PROGRESS D154).
- **`Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Resource-Policy: same-origin`**, on every route, since
  2026-10-12 (`docs/SECURITY_REVIEW.md` §8). A page on another origin that
  opens Stoky in a window keeps no handle to it, so cannot navigate it to a
  look-alike sign-in page or time its navigations; and no other origin can
  load a Stoky response as an image, script or other subresource. Defence in
  depth: framing was already refused, and browsers' opaque-response blocking
  already withholds most JSON and HTML from another origin's no-cors request.
  The HTML standard applies COOP only on a secure context, so a plain-http LAN
  install gets the CORP half — read from the standard, not measured here.
  A page the service worker serves from its cache carries the headers it was
  cached with, so after upgrading an existing install a shell route cached
  before the upgrade lacks both until the next online visit replaces it, and
  `/offline`, cached once when the worker installs, until `public/sw.js` next
  changes — read from the worker, not measured.
  **There is deliberately no `Cross-Origin-Embedder-Policy`**. All it would
  add is cross-origin isolation (`SharedArrayBuffer`, precise timers), which
  Stoky does not use, and `require-corp` would refuse the product photographs:
  the product page loads them as a plain `<img>`, and
  `images.openfoodfacts.org` sends no CORP. That host does answer
  `Access-Control-Allow-Origin: *` (measured 2026-10-12), so `crossorigin` on
  the image or `credentialless` would let them through — for as long as a host
  that is not ours keeps answering that way. No browser test checks either
  header's effect since 2026-10-27 (PROGRESS D154).
- **`Referrer-Policy: same-origin`**, since 2026-10-12, and the product
  photograph's `<img>` carries `referrerpolicy="no-referrer"` of its own, for
  an operator whose proxy rewrites the header. A request to another origin
  carries no `Referer`. Until then the policy was
  `strict-origin-when-cross-origin`, and every product page sent the
  instance's origin — its hostname, however private — to
  `images.openfoodfacts.org` with the photograph (`docs/SECURITY_REVIEW.md`
  §8). The image request itself still goes there, with the viewer's address
  and the barcode in its path; only the instance's name has stopped
  travelling with it. Not `no-referrer`: under it the Fetch standard sends
  `Origin: null` on every POST, same-origin ones included, and Next aborts a
  Server Action whose Origin does not match the host — measured, the no-JS
  screen choice fails under it, and sign-out and the language switch are
  Server Actions too. `same-origin` nulls the Origin only on a cross-origin
  POST, which Stoky's pages never make. No browser test pins the header since
  2026-10-27 (PROGRESS D154).
- `poweredByHeader: false`, so responses do not advertise the framework version.
- **Every response from `/api/trpc` carries `Cache-Control: no-store`** —
  data, errors, the 429 and the handler's own 403, 413 and 415 — set once, at
  the handler's exit in `src/server/http/trpc-handler.ts`. Until 2026-10-12
  nothing set one: tRPC adds no cache directive, Next sends a route handler's
  response as it is, and neither `next.config.ts` nor Traefik adds one. A
  query is a GET carrying one household's data, often under a URL that is the
  same for every account, with a `Vary` that does not name the cookie, so a
  shared cache in front of the instance could have served one person's
  answer to the next. Offline reads are unaffected: TanStack Query persists
  them in client storage, and the service worker never caches `/api/`.
  `src/__tests__/unit/trpc-handler.test.ts` checks each kind of answer.

### Request bodies — `src/server/http/body-limit.ts`

- **The API routes bound a request body themselves**: 15 MiB for `/api/trpc`
  (a 10 MB receipt is 13.98 MB once base64'd into JSON) and 64 KiB for a POST to
  `/api/auth`, whose bodies are a few hundred bytes of JSON (a form is
  refused there with 415 before Better Auth sees it). A declared
  `Content-Length` over the limit is refused with 413 without reading the body;
  a body with no declared length is counted as it arrives and refused at the
  first byte over. The tRPC route does this before it looks up the session, so
  a refused body costs an anonymous caller nothing but the bytes it sent.
- Next's `proxyClientMaxBodySize` is set to the same 15 MiB, imported from the
  same constant, but it is **not** the bound: Next applies it only when the
  proxy runs, and the proxy's matcher skips a request labelled
  `Purpose: prefetch` or `Next-Router-Prefetch`. Until 2026-10-12 it was the
  only bound, so one request header let an unauthenticated POST to
  `auth.register` be buffered and JSON-parsed whole, at any size — Bun's server
  sets no ceiling of its own (`docs/SECURITY_REVIEW.md` §8).
- Server Actions are bounded separately, by Next's `serverActions.bodySizeLimit`
  (1 MB by default), which its documentation describes as a limit on the raw
  request body rather than a proxy setting. Not measured here with a prefetch
  label.
- What remains is concurrency: a body may still be up to 15 MiB, held more
  than once while it is read and parsed — the bytes, then the text, then the
  parsed value — and nothing limits how many arrive at once. The app
  container's limit in `deploy/docker-compose.yml` is 1 GiB. How many
  concurrent 15 MiB requests that takes has not been measured.

### Batched calls — `src/lib/trpc/batch.ts`

- **One tRPC request carries at most 100 calls.** tRPC batches by default and,
  until 2026-10-12, set no ceiling: one GET of about 15 KB named about 850
  `household.current` calls, run concurrently, and an anonymous caller got 850
  `access.denied` log lines for it. Whatever a call costs — a query, a password
  hash, a log line — one request multiplied it before any rate limit counted
  anything. The handler now passes `maxBatchSize`, which tRPC checks against the
  list of paths before it reads an input or runs a procedure: a longer batch is
  a 400, with no procedure run and nothing logged. Measured in-process against
  the real router, 850 anonymous calls now get one 400 and no log line.
- **A request with nobody signed in writes at most one refusal line**, however
  many of its calls are refused. The cap alone still let one 1.8 KB GET of 100
  `household.current` calls write 100 `access.denied` lines, 13,100 bytes
  (final review, 2026-10-12). The middleware now records the first refusal of
  an anonymous request and drops the rest; measured the same way, that GET
  writes 1 line of 131 bytes. A signed-in caller's refusals are each still
  written: they name an account, and each can be a different row reached for.
  [*Refusals are recorded*](#refusals-are-recorded) says what this does not
  bound.
- The browser client passes the same constant as the link's `maxItems`, so it
  splits a longer batch into several requests rather than tripping the refusal.
  The offline queue's replays do not batch at all (`src/lib/offline/sender.ts`).
- 100 rather than fewer because the widest batch a screen sends today is 52,
  counted from the code rather than measured in a browser: `/prices` lists up to
  50 products, each row with its own `price.getLatestPrices`, and a refetch of
  everything on screen adds the list and `auth.me`. A tab still running a build
  from before the cap has no `maxItems`, and a ceiling of 50 would refuse that
  refetch whole.
- What this bounds is the fan-out of one request. It is not a rate limit: a
  caller can still send as many requests as it likes (see "Every other tRPC
  procedure is unlimited" below). `src/__tests__/unit/trpc-handler.test.ts`
  sends 101 calls and 100 through the real handler.

### Cross-site requests — `src/server/http/trpc-handler.ts`, `src/server/http/auth-handler.ts`

- **The session cookie is `SameSite=Lax`** (Better Auth's default, not
  overridden), so a POST from another *site* carries no session. A sibling
  subdomain under the operator's own domain — a photo gallery at
  `photos.home.example` beside Stoky at `stoky.home.example` — is the same
  site, and Lax sends the cookie with its requests. Until 2026-10-12 that was
  the whole defence of `/api/trpc`, and tRPC accepts `multipart/form-data`,
  which a plain HTML form sends with no CORS preflight: a compromised sibling
  could post a form to `auth.revokeMySessions`, which took no input, and sign
  the household out of every device. Procedures with an input refuse a form
  body at validation; the three that took none did not. (`auth.endSessions`
  replaced it on 2026-10-15, and asks for the password.)
- **Every mutation declares an input**, and the two that take nothing —
  `auth.logout` and `shopping.generateFromLowStock`, and
  `auth.revokeMySessions` until `auth.endSessions` replaced it — declare
  `z.void()`, so a form body that got past the rule below would now fail
  validation there too, with 400 and nothing written. `z.void()` and not
  `z.object({})`, which a `FormData` satisfies. It does not refuse every JSON
  body: superjson reads only a body's `json` field, so `{}` or any object
  without one arrives as no input. The application's own call sends
  `{"json":null,"meta":{"values":["undefined"]}}`, which superjson reads back
  as `undefined`; a bare `{"json":null}` is `null`, and `z.void()` now
  refuses it with 400.
  `src/__tests__/unit/procedure-inputs.test.ts` walks the running router and
  names any mutation without an input parser; `integration/routers.test.ts`
  shows `auth.logout` refusing an object and a `FormData` on the running
  router. The nine queries that take no input do not declare one: they write
  nothing.
- **A POST whose content type is not `application/json` is refused with 415**
  before its body is read. Both of the application's links send JSON, and a
  receipt photograph travels base64'd inside it; nothing sends multipart or
  `application/octet-stream`, the two other types tRPC accepts. JSON is not a
  type a form can send, so a page on another origin cannot send it without a
  preflight, which this application never grants: nothing in it, its proxy or
  Traefik's configuration sets an `Access-Control-Allow-Origin`.
- **A request whose `Sec-Fetch-Site` is anything but `same-origin` or `none`
  is refused with 403** and an `access.denied` line with `reason:
  "cross-site"` and the header's value: `same-site` in that line means a
  sibling under the operator's domain sent it. This covers queries as well as
  mutations.
- **A request with no `Sec-Fetch-Site` passes** to the two defences above.
  Browsers send it to an HTTPS origin or to localhost; curl, Playwright's
  `request` fixture, a native client and older browsers do not, and none of
  those is a page that can make another person's browser send a request.
- **On a plain-HTTP LAN install the 403 rule does nothing.** Fetch Metadata
  goes only to potentially trustworthy origins: on 2026-10-12 Playwright
  1.62.1's Chromium, Firefox and WebKit sent no `Sec-Fetch-Site` to a
  plain-HTTP LAN address — not with a same-origin `fetch` on
  `http://192.168.8.132`, nor with a multipart form that page posted to
  `http://172.17.0.1` — and all three sent `same-origin` to the same `fetch`
  on `http://localhost`. There the JSON-only rule, with Lax, is the whole
  defence — and it is the one that refuses the form.
- **On tRPC, `Origin` is deliberately not compared with `STOKY_URLS`**: tRPC
  stays on Fetch Metadata, and a strict comparison would lock out an address
  somebody forgot to list for no gain over that header.
- **The auth API (`/api/auth/*`) applies the same Fetch Metadata and JSON-only
  rules, and compares `Origin` too** (PROGRESS D135). Fetch Metadata covers
  its GETs as well, before anything is charged: the passkey options spend a
  per-address budget (D151), and an `<img>` on a page a household member
  visits would otherwise spend it from the household's address. Better Auth refuses a
  POST that carries a cookie unless its `Origin` (or `Referer`) is a trusted
  origin — the origin of every entry in `STOKY_URLS` (PROGRESS D138), plus,
  outside production only, each `DEV_ALLOWED_ORIGIN` host as
  `http://<host>:<PORT or 3000>` and `https://<host>`; production never reads
  `DEV_ALLOWED_ORIGIN` for this — with 403 `INVALID_ORIGIN`, or `MISSING_OR_NULL_ORIGIN`
  when there is none. Nothing else can join that list: Better Auth would add
  `BETTER_AUTH_TRUSTED_ORIGINS` to it whatever the configuration says, so the
  server refuses to start while that variable is set (PROGRESS D136). A POST
  with no cookie — a native client — needs none.
  Better Auth switches this check off when `NODE_ENV` is `test`; the
  configuration sets `disableOriginCheck: false`, so the suites run what
  production runs, and `integration/auth.surface.test.ts` sends a foreign
  origin and sees 403. A sign-in is the
  one request that sets a session, which is why this check is here and not on
  tRPC. A plain-HTTP LAN install reached both by name and by address lists
  both; before D138 one URL named one of them, and the other answered 403.
  Every listed origin can send a cookie-bearing sign-in, so the list holds
  only addresses that reach this instance; the bundle lists only
  `https://${DOMAIN}`, the one host Traefik routes.
  `integration/auth.origins.test.ts` signs in, under a production instance
  with two entries, at both, and is refused from an unlisted origin and from
  a `DEV_ALLOWED_ORIGIN` host.
- **A bearer token is no way round these rules** (PROGRESS D142). A native
  client sends `Authorization: Bearer` and no cookie, no `Origin` and no
  Fetch Metadata, so both APIs let it through as they let curl through. A
  page on another origin cannot send that header: `Authorization` is not a
  header a cross-origin request may carry without a preflight, which nothing
  here answers. Nor can it read the token: `set-auth-token` is withheld from
  every answer to a request that carried a cookie, so a page's script cannot
  turn the browser's `HttpOnly` session into a header it could copy.
  `integration/bearer.test.ts` signs in without a cookie or `Origin`, uses the
  token on `get-session` and on a tRPC query, and is refused with an unsigned
  or foreign-signed one; `unit/trpc-handler.test.ts` shows a bearer call with
  no Fetch Metadata passing and a cross-site one carrying the cookie refused.
- **The consequence:** a browser front-end on another origin cannot call
  these APIs. None exists. Server Actions are outside these routes and carry
  Next's own `Origin` check.
- `src/__tests__/unit/trpc-handler.test.ts` shows tRPC alone running a
  mutation sent as a form, then the handler refusing it. No browser test
  sends one against the production build since 2026-10-27 (PROGRESS D154).

### Authentication — `src/lib/auth/instance.ts`, `src/server/http/auth-handler.ts`, `src/server/trpc/routers/auth.ts`

- Passwords are hashed with **Argon2id**, `memoryCost: 65536` (64 MiB),
  `timeCost: 3` and `parallelism: 4`, in one place:
  `src/lib/auth/password-hash.ts` hashes for registration, for an admin
  adding a member or setting a member's password, and for a person changing
  their own password, and verifies for sign-in and for that change. A test
  pins the parameters and that the dummy hash for unknown addresses was made
  with the same ones. Where the hash is stored is known to one module of
  ours, `src/lib/auth/credentials.ts`: every caller of ours that creates an
  account with a password, reads a stored hash or sets a new one goes
  through it. Better Auth is the one other reader and writer: it reads the
  hash at sign-in and writes it when a person changes their own password
  (PROGRESS D144), with our Argon2id either way. It is stored in the
  account's `credential` row of the `Account` table, where Better Auth reads
  it, not on `User` (PROGRESS D134); that row is deleted with its account.
- **Better Auth 1.7.12, with sessions in the database** (PROGRESS D135,
  replacing next-auth and D125). A session is a `Session` row and the cookie
  is a signed reference to it: Better Auth reads the row on every request —
  its cookie cache is off — and refuses one whose `expiresAt` has passed,
  deleting it as it does. The cookies are `stoky.session_token` and
  `stoky.dont_remember`, `HttpOnly`, `SameSite=Lax` and with no `Max-Age`, so
  they end with the browser — except a remembered session's token, below,
  which has ninety days; behind https they are `__Secure-` prefixed and
  `Secure` (below). The token is never in a response body: the auth route
  strips `token` and `session.token` from every JSON answer, and the bearer
  plugin's `set-auth-token` header, with its `Access-Control-Expose-Headers`
  entry, from any answer to a request that carried a cookie
  (`src/server/http/auth-handler.ts`). A browser always carries one there:
  the page that signs in was rendered, which gave it `stoky_device`.
- **A native client signs in with a bearer token** (PROGRESS D142). The iOS
  app is written against this contract:
  1. It keeps no cookies (`httpShouldSetCookies = false`): the token is handed
     only to a request that carried none.
  2. It signs in with `POST /api/auth/sign-in/email`, `Content-Type:
     application/json` and `{"email", "password", "rememberMe": true}`. It
     needs no `Origin`, since Better Auth asks for one only beside a cookie.
     `rememberMe` must be the literal `true`; anything else is a browser
     session, ended by fifteen idle minutes.
  3. It reads the `set-auth-token` response header, `<token>.<signature>`
     (possibly percent-encoded), and keeps it in the Keychain. It is not in the
     body.
  4. It sends `Authorization: Bearer <that value>` on every request, tRPC and
     the auth API alike. Better Auth reads it as the session cookie
     (`bearer({ requireSignature: true })`).
  5. It signs out with `POST /api/auth/sign-out`, the header,
     `Content-Type: application/json` and `{}`. That deletes the row.

  A 401 from tRPC, or `null` from `get-session`, means the session has
  ended, and the client asks for the password again. A token with a wrong or
  missing signature reads the same.
  Only the signed value is accepted, because the `Session` table holds tokens
  unsigned: a copy of the table is not a set of credentials. The signature is
  an HMAC with `STOKY_SECRET`, so rotating the secret ends every native
  session too. The token does not change while the session lives; the row
  slides as a remembered browser's does, at most daily on a tRPC read and
  never past a year. A native sign-in is charged, tidied (D139) and counted
  toward the ten sessions (D140) like any other. A password change, or an
  admin setting the password, ends it with the rest. **Not supported yet:**
  an account with two-step verification on a native client — deferred by
  the owner on 2026-10-15 — so such an account signs in on the web only. The
  proxy never mints `stoky_device` for a bearer request, so a native client
  is never handed a cookie it did not ask for (`src/proxy.ts`).
- **Fifteen minutes is a browser session's idle timeout, and only activity
  moves it.** The row is created fifteen minutes out, and only `auth.session` — which the
  keep-alive calls when a pointer or a key moves, at most every four minutes —
  slides it, by writing the row itself (`src/lib/auth/session-policy.ts`).
  Page renders and tRPC calls read the session without moving it: a
  dashboard left polling on a counter is not somebody at the screen, and its
  session ends. Better Auth's own refresh would push a row ninety days out; it
  is never asked for on a browser session, and a database hook drops
  `expiresAt` from any update it makes to one anyway.
- **A session lasts a day at most, however active** (`BROWSER_CAP_S`),
  counted from `Session.authenticatedAt` — when the password was typed — not
  from `createdAt`, which Better Auth resets when it re-creates a session. The
  slide is clamped to it. This replaces D125's thirty days for a browser
  session, which is what a sign-in gets unless the box below is ticked, and a
  day is what one shift on a shared device needs. Two minutes before the day runs out the keep-alive says so, and
  says that it is the day's limit rather than inactivity, with no "Seguir
  conectado" button, because nothing can extend it (WCAG 2.2.6; `auth.session`
  answers which deadline is next, `deadlineKind`). Then the next read is
  refused, the same path an ended session takes, so the offline queue keeps
  its unsent changes and asks for a sign-in. Everybody signed in on a JWT before this
  release signs in once after upgrading; passwords are kept.
- **"Mantener la sesión iniciada" makes a remembered session** (ASVS 5.0.0
  7.1.1, PROGRESS D141). The login form's box, unticked by default, with a hint
  saying it is for home devices used every day, the kitchen screen included.
  Ticked, the row is marked `persistent`, the cookie gets a ninety-day
  `Max-Age`, and the row lives ninety idle days under a year from
  `authenticatedAt` (`REMEMBERED_IDLE_S`, `REMEMBERED_CAP_S`). Better Auth
  slides it on a tRPC read at most once a day — `readSession` asks for the
  refresh only when the row was last written a day or more ago — and a
  database hook holds the slide to the year. Page renders never slide it, and
  `auth.session` only reads it. The route passes `rememberMe` only when the
  body says exactly `true`, because Better Auth reads a missing value as
  true; it says which it was in an internal `x-stoky-remember` header that it
  deletes from every client request; and a ticked sign-in expires the
  `dont_remember` cookie an earlier unticked one left, which Better Auth
  clears only at a sign-out or a read that finds the session gone, never at a
  ticked sign-in. **Why these numbers** (7.1.1 asks for the justification):
  the kitchen screen is a shared device in a home whose point is to be picked
  up, and fifteen minutes would ask for a password at nearly every glance —
  which in practice means a password taped to the tablet. Ninety idle days
  ends a device left in a drawer; the year ends any session however used.
  **Deviation from NIST SP 800-63B-4**: a password alone is AAL1, for which
  the guidance is re-authentication at least every thirty days; a remembered
  session asks once a year. Accepted by the owner on 2026-10-15 for the
  compensating controls: every session is a row that can be ended at once — by
  signing out, from **Tus dispositivos** in **Seguridad y acceso**, by an admin,
  by a password change, by removal from the household — the account holds ten
  at most (below), and the box is off unless somebody ticks it. A browser
  session meets AAL2's figures (fifteen idle minutes, a day in all).
- **Signing out ends this device's session**: `signOutAction` asks Better Auth
  to delete the row and expire the cookies, so a copy of the cookie taken
  before the sign-out is refused too. The other devices' sessions end when
  idle for fifteen minutes, a day after their sign-in, or when somebody ends
  the account's sessions — from **Tus dispositivos** in Configuración ›
  **Seguridad y acceso** (`auth.endSessions`, below), or an admin from
  **Personas del hogar** (`household.endMemberSessions`, below), or an admin
  removing them from the household (below) — which delete the rows and log
  `auth.session.ended` with the `reason` (`self`, `admin`, `removed`), who
  asked and how many sessions went.
- **A person can list their sessions and end one, every other or every one,
  after re-entering the current password** (ASVS 5.0.0 7.5.2, PROGRESS
  D143). `auth.listSessions` answers each live row as the browser and system
  its User-Agent names (`src/lib/auth/device-label.ts`), the screen its
  device opens on when it has chosen one — so the kitchen tablet reads as the
  kitchen screen — when it was signed in, last used and ends, whether it is
  remembered, and whether it is the one asking. It never answers a token or
  the device id: the select names its columns, and the device id is
  `Session.deviceId`, the `stoky_device` cookie the sign-in carried, which
  Better Auth is told never to return (`returned: false`) and which the list
  reads only to join `ScreenChoice`. `auth.endSessions` takes the current
  password and a scope. Every branch deletes only rows of the caller's own
  account, so another account's session id is `NOT_FOUND`, like an id
  nobody has; "every other" keeps the asking session by its id, and a
  context without one is refused before the password is asked, because
  Prisma reads `{ id: { not: undefined } }` as no condition and
  `endSessions` refuses that filter too. A wrong password is `BAD_REQUEST`,
  ends nothing and logs `auth.reauth.refused` with `via: "end-sessions"`.
  The re-entry is metered twice before Argon2id runs: five per fifteen
  minutes **per session**, refunded when the password is right, so whoever
  holds a stolen session cannot spend the owner's way to end it; and twenty
  per fifteen minutes **per account**, never refunded, so ten sessions are
  not ten budgets (`reauthRateLimit`, `reauthAccountRateLimit`). Better
  Auth's own session-listing and revoking endpoints stay closed (below).
  **Deviation from ASVS 5.0.0 7.2.4**, accepted by the owner on 2026-10-15:
  re-entering the password does not rotate the session token. 7.2.4 reads a
  re-authentication as an authentication, after which a new token is due.
  Here the password confirms one action and nothing else — the session is
  not marked as freshly authenticated and gains no standing it did not have
  — and the call is tRPC, whose response headers are on their way before a
  resolver could set a rotated cookie. The same holds for every later
  re-entry (`confirmCurrentPassword`, `src/lib/auth/reauth.ts`).
  The screen is **Tus dispositivos** at `/settings/security`
  (`src/components/session/DeviceList.tsx`): a row per session, this
  device's marked, each with **Cerrar esta sesión**, then **Cerrar las
  demás** and **Cerrar todas**; every one asks for the password first
  (`ReauthDialog`). An ending that includes this device runs the sign-out
  sequence after the server has answered — the queue, the saved reads and
  the cached shell go, then the redirect — and one that does not purges
  nothing. The screen also says the account holds ten sessions at most and
  which one an eleventh sign-in ends.
- **An admin can list a member's sessions and end one or every one**
  (ASVS 5.0.0 7.4.5, PROGRESS D145). On **Personas del hogar**, "Ver sus
  sesiones" on another member's row opens their sessions
  (`household.memberSessions`), read exactly as the member's own list is
  (`liveSessionsOf`, `src/lib/auth/session-list.ts`) — the device and the
  screen it opens on, never a token or the device id — each with **Cerrar
  esta**, and **Cerrar todas sus sesiones** below them
  (`household.endMemberSessions`). One rather than only all: the lost
  kitchen tablet need not sign the member out of the phone in their pocket.
  `adminProcedure`, then the guards of the rest of member management: the
  caller's own id is `BAD_REQUEST` — their own sessions end from **Tus
  dispositivos**, behind their password, and an admin session must not be a
  way round that question — the member must be this household's
  (`NOT_FOUND` otherwise, without confirming the id exists), and only an
  owner may list or end an owner's (`FORBIDDEN`, logged as
  `access.denied`). The delete names the member's id beside the session id,
  so another account's session id is `NOT_FOUND` and ends nothing, and it
  repeats the household and the role that were checked, so a member who
  left or was made an owner in between is not touched. Logged as
  `auth.session.ended` with `reason: "admin"`, the admin as `userId`, the
  member as `targetUserId` and the count; the answer is the count alone.
  **No password**: the owner confirmed on 2026-10-15 that an admin ending
  somebody else's sessions is not re-asked. Whoever holds an admin's
  session can therefore sign the household's non-owners out — and they can
  sign straight back in, since nothing about their password changes — but
  cannot reach an owner's sessions or the admin's own.
- **An owner can end every session in the household, their own included**
  (ASVS 5.0.0 7.4.5, PROGRESS D147). On **Personas del hogar**, owners alone
  are shown "Cerrar todas las sesiones del hogar"
  (`household.endHouseholdSessions`): every member signed out of every
  device, other owners and the owner asking included, for when somebody who
  should not have been has had an account or a device. `adminProcedure`,
  then owners only inside the resolver — an admin is `FORBIDDEN` before the
  password is asked, since an admin may not reach an owner's sessions one at
  a time either — then the owner's current password through
  `confirmCurrentPassword` and its two budgets, because this ends the
  owner's own sessions too and a session somebody else is holding must not
  be able to sign the household out. A wrong password is `BAD_REQUEST`,
  ends nothing and logs `auth.reauth.refused` with `via:
  "household-end-all"`. One filter, the household through each session's
  account, so nothing outside it is touched. Logged as one
  `auth.session.ended` with `reason: "owner"`, the owner as `userId`, the
  household and the count, with no `targetUserId`. The screen then signs
  this device out the way **Cerrar todas** on **Tus dispositivos** does —
  the server first, then the queue, the saved reads and the cached shell —
  and offers to send unsent changes first. No token rotation, as for every
  re-entry (the 7.2.4 deviation above).
- **Removing somebody from the household signs them out everywhere** (ASVS
  5.0.0 7.4.2, PROGRESS D146). `household.removeMember` deletes every
  session the member has (`endSessions`) in the transaction that clears
  their household, after the guards that removal already had — this
  household's member, only an owner removes an owner, the household keeps an
  owner — so a refused removal ends nothing, and a removal never leaves the
  sessions behind. Losing the household already refused every household
  request; what a live session still reached was the account itself — its
  password, its devices, a new household of its own — on a device such as
  the kitchen tablet that the household may no longer control. The account
  stays (the application deletes none, below), so the person can sign in
  again, to no household. An owner removing themselves beside another owner
  is signed out too, this device included. Logged as `auth.session.ended`
  with `reason: "removed"`, the admin as `userId`, the member as
  `targetUserId` and the count, once the transaction has committed. The
  confirmation on **Personas del hogar** says so before the fact.
- **Signing in ends the session the browser presented** (ASVS 5.0.0 7.2.4,
  PROGRESS D139). Better Auth issues a new token at every sign-in and leaves
  the old row alive, so after the sign-in succeeds the auth route deletes the
  session whose cookie the request carried — whoever it belonged to: on a
  shared tablet, the previous person's — together with the signing-in
  account's expired rows (`src/lib/auth/sign-in-tidy.ts`). A wrong password
  ends nothing. Another browser's session is untouched: the tidy knows only
  the cookie this request sent. It writes `auth.session.ended` with `reason:
  "replaced"`, the `userId` who signed in and the `targetUserId` whose session
  went. If the tidy itself fails, the sign-in still succeeds and the failure
  is an `[auth] error` line; the old session then ends on its own clock.
- **Ten sessions per account at most** (ASVS 5.0.0 7.1.2, PROGRESS D140,
  `MAX_SESSIONS_PER_ACCOUNT`). The sign-in that would make the eleventh ends
  the least recently used one — the oldest `updatedAt` — never the session it
  just issued, and logs `auth.session.ended` with `reason: "evicted"`. It runs
  after the tidy above, so signing in again in the same browser never costs
  another device its session, and inside one transaction holding the
  account's `User` row `FOR UPDATE`, so sign-ins of one account at the same
  moment still leave ten. "Least recently used" is as fine-grained as the
  writes that move `updatedAt`. For a browser session that is the
  keep-alive's slide (`auth.session`), which asks at most every four minutes
  of activity and writes only when more than a minute has passed since the
  last write, so the row trails real use by about five minutes at most. For a
  remembered session it is Better Auth's daily refresh, so the row trails
  real use by up to a day: of two remembered devices used on the same day,
  either may be the one evicted. A row is not written on every request, by
  design (D135), so there is no finer clock to read. Ten is above a household's devices; an account signed in on more
  loses its least-used one at each new sign-in, the kitchen screen included
  if that is it. Like the tidy, it runs from the route once a sign-in has
  succeeded, never from a session-create hook: Better Auth creates and then
  deletes a session at the password step of a two-step sign-in, and a hook
  would let a password alone end other sessions.
- **Two-step verification with an authenticator app** (TOTP, PROGRESS D148),
  Better Auth's two-factor plugin. For an account that has it, a right
  password is not a sign-in: Better Auth deletes the session it made and
  answers `twoFactorRedirect` with a signed `two_factor` cookie naming a
  ten-minute challenge (a `Verification` row), and `POST
  /two-factor/verify-totp` or `/two-factor/verify-backup-code` with the code
  turns the challenge into a session. The password step settles its budget
  there — the account's counter cleared, the address refunded — ends the
  session the browser presented, as a sign-in does (Better Auth has already
  expired its cookie, so the row would otherwise outlive any copy of it), and
  is logged `auth.signin.challenged`. A sign-in's code is charged against the
  address only, since it names no account; Better Auth counts wrong codes itself, five
  per challenge and ten in a row per account, which locks the account's
  second step for fifteen minutes: refused 429 with a `Retry-After` of the
  seconds left until the lock ends, which Better Auth's own refusal leaves
  out and the policy plugin adds. That lock forgets its count when it ends,
  and a right password opens a new challenge for nothing, so on their own
  those limits let somebody who has the password guess ten codes every
  quarter of an hour, about 960 a day, for ever — even odds of getting past
  the second factor in about eight months. So every authenticator code of a
  sign-in is also charged to its account's budget for the day
  (`twoFactorCodeRateLimit`, twenty a day, `RATE_LIMIT_TWO_FACTOR_CODE_*`),
  before it is compared; a right code gives its attempt back, and nothing
  else clears it, a right password included. Past it every code, the right
  one too, is refused 429 `TOO_MANY_WRONG_CODES` with `Retry-After` until
  the day's window ends, and logged `auth.twofactor.locked`; a recovery code
  still signs in. The bound is twenty guesses a day per account — with the
  ±1 step, about 2% a year — at the cost that a guesser who has the
  password can keep the owner's authenticator out for the rest of the day,
  which says the password needs changing. The code step is a sign-in only when it
  carried the challenge cookie and was answered with a session: then the
  address is refunded, the browser becomes a known device, the account is
  tidied and held to ten sessions as above, and `auth.signin.succeeded` says
  `method: "totp"` or `"backup-code"`. The route passes on the `code` alone:
  not `trustDevice`, a cookie that would skip the code on that browser for a
  month, nor `disableSession`, which spends a backup code without a session
  to show for it. A remembered-or-not choice made at the password step
  carries through.
  - **A code works once** (ASVS 5.0.0 6.5.1). Better Auth accepts any code
    inside its window as often as it is sent — the spike signed in twice with
    one — so a before-hook of ours (`src/lib/auth/policy-plugin.ts`) works out
    which time step the code is for and claims it in the same `UPDATE` that
    checks it: `TwoFactor.lastTotpCounter` must be below the step. A code for
    a step already used, or for an earlier one, is refused as `INVALID_CODE`
    and logged `auth.twofactor.replayed`. A code matching no step is replaced
    with one no step can produce, so Better Auth refuses it *and counts it*;
    passing it on would let a request whose two clock reads straddle a step
    boundary through unclaimed. The first code from a new authenticator is
    claimed the same way, a native client's included: Better Auth hands the
    hook the request before the bearer plugin turns `Authorization: Bearer`
    into the session cookie, so the hook runs that plugin's own conversion
    first and reads the session the endpoint will (`requestSession`);
    without it a bearer enrolment's code was never claimed and worked again
    at a web sign-in. `integration/two-factor.test.ts` holds the row
    locked while two requests with one code reach the claim, and exactly one
    gets in.
  - **±1 step** (ASVS 5.0.0 6.5.5 deviation, accepted by the owner on
    2026-10-15). Better Auth accepts the code for the previous and the next
    30-second step as well as the current one, so a code is good for up to a
    minute and a half. The window is Better Auth's, kept for phones whose
    clocks drift; single use, above, is what stops a code being reused within
    it.
  - **Optional, for every role**, set up from Settings → *Seguridad y
    acceso* → *Verificación en dos pasos*. The kitchen's shared account may
    turn it on too (the owner's decision of 2026-10-15); a household that does
    needs the authenticator, or a backup code, wherever that account signs
    in. Nothing requires it, which is a deviation from ASVS 5.0.0 6.3.3
    (more than one factor for every account, at L2): a household instance's
    accounts are its members, and whether to carry a second factor is each
    one's choice.
  - **Setting it up takes the password, three times over.** `POST
    /two-factor/enable` (the new authenticator's `otpauth:` address and the
    backup codes, once; nothing is on until the first code from the app is
    accepted at `verify-totp`, which also uses that code up), `/disable` and
    `/generate-backup-codes` are answered only for a signed-in session, with
    its password, charged before Better Auth checks it against the same two
    re-entry budgets as every other confirmation (five per session and twenty
    per account a quarter of an hour, the session's refunded on a right
    password; D143). The route passes on `password` alone — no `issuer`, no
    `method`. That first code, and any code a signed-in session sends, is
    charged to the same two re-entry budgets, the session's given back when
    it is right — never to sign-in's per-address budget, which nothing would
    give it back to, so a household behind one address setting up its
    authenticators would otherwise spend the attempts everyone there signs
    in with. A wrong password is `auth.reauth.refused` with `via:
    "two-factor"`; turning it off is `auth.twofactor.disabled`, new codes are
    `auth.twofactor.codes-regenerated`, and turning it on is
    `auth.twofactor.enabled` at the first code. Turning it on (at that code)
    and off re-creates the session Better Auth was asked from, which keeps
    its sign-in time, kind and device; new codes leave it as it is. After
    every change the screen reads the devices list again and points to *Tus
    dispositivos* to end any other session (ASVS 5.0.0 7.4.3). The QR code is drawn in the browser
    (`uqr`), never fetched: the address holds the secret. The backup codes
    are shown once, kept in the screen's state and nowhere else, offered as a
    copy and as a text file made in the browser, and cannot be shown again.
    `POST /two-factor/get-totp-uri` never opens: it hands the decrypted
    secret back to whoever holds the session, password or not.
  - **A challenge ends with the account's sessions.** Whoever holds one has
    the password, so a password set by an admin or changed by its owner, a
    removal from the household and every "end these sessions" also delete
    the account's challenges in progress (`src/lib/auth/end-sessions.ts`).
    The sign-in's own tidy does not: an expired row going is no reason to
    stop the same person signing in on another device.
  - **Backup codes are 120-bit codes stored as hashes** (ASVS 5.0.0 6.5.2,
    PROGRESS D149, `src/lib/auth/backup-codes.ts`). Ten, each 24 Crockford
    base32 characters shown as six groups of four, drawn from
    `crypto.getRandomValues`, in place of Better Auth's ten-character codes
    of about 60 bits kept encrypted with `STOKY_SECRET`. Each is stored as
    `sha256:` and the hex digest of the code upper-cased without spaces or
    dashes, O read as 0 and I or L as 1, so a code typed off paper in lower
    case still matches; ASVS 6.5.2 allows a plain hash at 112 bits or more.
    The policy plugin hashes whatever is typed before Better Auth compares
    it, so a stored hash sent as the code is hashed again and refused:
    reading the column is not a way in. A code works once — Better Auth
    rewrites the list without it, conditionally on the list it read — and a
    wrong one counts towards the same lockout as a wrong TOTP code.
    Generating a new set replaces the old one whole. No secret is involved,
    so a rotation of `STOKY_SECRET` leaves them working.
  - **The secret is encrypted with `STOKY_SECRET`**
    ([*Secrets*](#secrets)). One that no longer decrypts — the secret was
    rotated — is refused as `TWO_FACTOR_UNREADABLE` before Better Auth counts
    an attempt, and logged `auth.twofactor.unreadable`: no code will ever
    work, and the operator is the one who can say why. The way back is a
    backup code, or a household admin removing it (below), or — for a sole
    owner without a backup code — the operator's runbook in
    [the installation guide](docs/INSTALL.md#a-lost-authenticator).
  - **A household admin can remove a member's** (PROGRESS D150), for a lost
    authenticator with no backup code left: "Quitar la verificación en dos
    pasos" on **Personas del hogar** (`household.removeMemberTwoFactor`).
    The admin's own current password first (`confirmCurrentPassword`, the
    two D143 budgets; a wrong one is `BAD_REQUEST` and
    `auth.reauth.refused` with `via: "member-two-factor"`), before the
    member is looked up, so a session somebody else holds learns nothing
    about ids; then the member must be this household's (`NOT_FOUND`), and
    only an owner may act on an owner (`FORBIDDEN`) — so an owner's can be
    removed only by another owner. Never the caller's own (`BAD_REQUEST`):
    owners and admins turn theirs off from *Seguridad y acceso* like
    anybody. One transaction clears `twoFactorEnabled` — conditioned on the
    household, the role checked and that it is on, so a member who changed
    in between or has none is `CONFLICT` and nothing is touched — deletes
    the authenticator row (secret and backup codes) and ends every session
    and challenge in progress the member has (`endSessions`), since
    whoever has the lost phone may be signed in on it. Logged as
    `auth.twofactor.removed` and `auth.session.ended` with `reason:
    "two-factor-removed"`, the admin as `userId` and the member as
    `targetUserId`. It is the trust `resetMemberPassword` already grants an
    admin — who can set the very password this leaves standing alone — so
    a stolen admin session plus that admin's password can strip a non-owner's
    second step; the log records who did it to whom.
  - **Not for native clients yet**: an account with two-step verification
    signs in from a browser (D142).
- **Passkeys** (PROGRESS D151, `@better-auth/passkey` 1.7.12 with
  `@simplewebauthn/server`), where WebAuthn can work:
  - **Only at the first `STOKY_URLS` address.** A passkey belongs to a
    relying party named by a host, and here that is the canonical entry's
    (`src/lib/auth/passkeys.ts`): its hostname is the `rpID` and its origin
    the only `origin` a ceremony is accepted from — never the list, so a
    signature made for one listed address is refused at another. A passkey
    therefore cannot be used or registered at any other listed address (they
    sign in with the password), and **changing the first entry orphans every
    passkey**: people sign in with the password and add a new one.
  - **Only in a secure context, never at an IP address.** Browsers expose
    WebAuthn to https and to http on `localhost`, and a relying party id must
    be a domain name, so the plugin is registered only when the first entry
    is https, or http at `localhost`, with a host that is not an IP literal.
    Elsewhere — a plain-HTTP LAN install, `https://192.168.1.10` — there are
    no passkeys and their endpoints answer 404, and the settings screen says
    the install cannot have them rather than showing an empty list.
  - **The person must be verified, not only present** (ASVS 5.0.0 6.6.x):
    registration asks the authenticator for user verification as
    `required`, and both ceremonies refuse an answer without the UV flag
    (`USER_VERIFICATION_REQUIRED`), after the signature is checked and before
    anything is written. Better Auth itself asks for it only as "preferred"
    at sign-in and checks for none, so a security key without a PIN would
    otherwise be a single factor anybody holding it could use. That is why a
    passkey sign-in is not asked for an authenticator code: it is two
    factors already, the device and the fingerprint, face or PIN.
  - **Added or removed only after the password** (ASVS 5.0.0 7.5.1): the
    settings page first calls `auth.confirmPassword` (`confirmCurrentPassword`,
    the D143 budgets, `via: "step-up"`), which leaves a step-up — a
    `Verification` row `stoky-step-up:<session id>`, five minutes,
    `src/lib/auth/step-up.ts`. Asking for the registration options needs one;
    the registration and the removal spend it, in the statement that checks
    it, so it confirms one change. It is bound to the session that asked: the
    same account's tablet cannot spend the phone's. Without it the answer is
    `403 STEP_UP_REQUIRED`, and with no session at all `401`. A native
    client's bearer token is held to it as a cookie is: the check reads the
    session the endpoint will be served as (`requestSession`), not the one
    Better Auth shows a hook before the bearer plugin has turned the token
    into a cookie, which for a token was none — and a check that stood aside
    on none let a stolen token add a passkey with no password at all. It
    goes with its session when `endSessions` ends
    the session. Renaming one and listing one's own need the session alone.
    No token rotation, as for every re-entry (the 7.2.4 deviation above).
  - **A registration never signs anybody in**: the route forwards only the
    WebAuthn answer and a name, and the policy plugin forces Better Auth's
    `createSession` off as well.
  - **A passkey sign-in is a sign-in like the password's**: charged per
    address against sign-in's budget and given back when it gets in, the
    remember-me box honoured (an unticked box is a browser session with a
    cookie without `Max-Age`; the policy plugin sets Better Auth's ninety-day
    cookie again as a browser cookie and takes the first `Set-Cookie` out, so
    the answer carries one), the presented session ended, the account's
    expired rows and any past ten ended, and `auth.signin.succeeded` with
    `method: "passkey"`. A refusal is `auth.passkey.signin-failed` with
    Better Auth's code. The options that start it are charged per address on
    a budget of their own, thirty a quarter of an hour
    (`RATE_LIMIT_PASSKEY_OPTIONS_*`): they are not a guess, but each writes a
    challenge row, and they cannot be given back from sign-in's five — a
    household signing in with passkeys behind one address would otherwise
    lock itself out.
  - **Managed from Seguridad y acceso** (*Llaves de acceso*,
    `src/components/security/PasskeyManager.tsx`): the list shows a name,
    when it was added and whether the authenticator syncs it — never the
    public key, credential id or counter the endpoint answers, which
    `listPasskeys` drops. Adding and removing go through the password dialog
    and `auth.confirmPassword`; renaming needs the session alone. Where adding
    cannot work the screen says why instead of offering a button that fails:
    `auth.me` carries `passkeyOrigin` (the first `STOKY_URLS` origin, or null
    when the install cannot have them), and a page at any other origin is
    told the address that works; then an insecure context, then a browser
    without WebAuthn. The list and removal work at every listed address, so a
    lost phone's passkey can be removed from wherever the person is.
    `@simplewebauthn/browser` (13.3.0, exact, the version
    `@better-auth/passkey` already resolved) is loaded on the click, not with
    the page.
  - **Only one's own can be renamed or removed.** The route forwards the
    passkey's `id` as sent; Better Auth's plugin looks the row up and answers
    401 when it belongs to another account (`requireResourceOwnership`), in
    another household or the same one, its owner included — a household role
    gives no say over a member's passkeys. That check is Better Auth's, not
    Stoky's, so `integration/passkeys.test.ts` holds it against an upgrade
    that drops it. A removal refused there has still spent the step-up.
  - **Every role may have them**, the kitchen's shared account included (the
    owner's decision of 2026-10-15); the add dialog advises against adding
    one on a device other people use. Removing a member's two-step
    verification (D150) leaves their passkeys alone. Rotating `STOKY_SECRET`
    leaves them working: nothing about them is encrypted with it.
  - **Logged**: `auth.passkey.added` and `auth.passkey.removed` with whose it
    was, never the credential or its public key.
- **Only seventeen endpoints of the auth API answer**: `POST /sign-in/email`,
  `POST /two-factor/verify-totp`, `POST /two-factor/verify-backup-code`,
  `POST /two-factor/enable`, `POST /two-factor/disable`,
  `POST /two-factor/generate-backup-codes`,
  `GET /passkey/generate-authenticate-options`,
  `POST /passkey/verify-authentication`,
  `GET /passkey/generate-register-options`,
  `POST /passkey/verify-registration`, `POST /passkey/delete-passkey`,
  `POST /passkey/update-passkey`, `GET /passkey/list-user-passkeys`,
  `POST /sign-out`, `GET /get-session`, `GET /ok` and `GET /error`. Every other
  path Better Auth mounts — sign-up, password reset, account deletion, session
  listing, about forty in all — is 404 before Better Auth sees it, so one a
  later version adds is closed until somebody decides otherwise.
  `integration/auth.surface.test.ts` reads the list off the running instance
  and tries each by GET and POST with a signed-in cookie and its own origin,
  and finds no row changed. A sign-in is rebuilt before Better Auth gets it —
  the address trimmed and lower-cased, the password, `rememberMe` as a
  boolean and nothing else — so no `callbackURL` or other option reaches it;
  every other POST carries only the keys its endpoint needs, and the
  registration options GET only `authenticatorAttachment`. A passkey's name,
  which Better Auth only trims into an unbounded column, is held to 64
  characters with no control or text-direction characters
  (`passkeyNameSchema`, the settings field's own limit), or the request is
  answered 400.
- The address is validated with a Zod schema before the database is touched,
  and an unknown email and a wrong password get the same 401
  `INVALID_EMAIL_OR_PASSWORD`, after the same Argon2id cost.
- **A signed-in person can change their own password**, from Settings →
  *Seguridad y acceso* (`auth.changePassword`, security review 2026-10-12 — until then nothing
  changed a password once it was set, so a leaked one could not be rotated and
  one an admin chose stayed known to that admin). It asks for the current
  password through `confirmCurrentPassword`, the re-entry every confirmation
  uses, with its two budgets (D143, below); a wrong one is `BAD_REQUEST`,
  never `UNAUTHORIZED`, because the offline queue reads that as a session
  that has ended, and is logged as `auth.reauth.refused` with `via:
  "password-change"`. The new password meets the policy, identity rule
  included — checked after the current password, so it answers nobody who
  has not proved they know it. **Every other session ends and this one stays
  signed in under a new token** (ASVS 5.0.0 7.4.3, PROGRESS D144): Better
  Auth's `changePassword` writes the hash, deletes every session row the
  account has, and creates one for the device that asked, which keeps that
  session's `authenticatedAt`, remembered-or-not and device; its cookie comes
  back with the answer. The browser sends this one call without streaming
  (`src/lib/trpc/links.ts`), because a streamed answer's headers leave before
  the resolver sets the cookie — measured: with the stream, the device was
  signed out by its own change. Nor does a request this device sent with the
  old cookie just before the change undo it: a session read that finds the
  row gone answers no session without expiring any cookie (the policy
  plugin takes Better Auth's expiring `Set-Cookie` lines out of every
  `get-session` answer), so an answer arriving after the rotation's cannot
  delete the new cookie. A copy of the old cookie is refused, its row
  being gone. Nothing on the device is discarded, since the same person is
  still there. A request that carried no cookie — a native client — is not
  given a new session: every session ends, its own included, and the app asks
  for the new password (D142). Logged as `auth.password.changed` and
  `auth.session.ended` with `reason: "password-change"` and the count.
  **Not one transaction**: Better Auth writes the hash, deletes the sessions
  and creates the new one as separate statements, so a failure between the
  first two would leave the new password beside sessions meant to end, and
  the form would report a failure although the hash is already new; the
  sessions are then ended from **Tus dispositivos**. The single transaction
  it replaces could not split, and ended this device too.
- **A household admin can set a member's password**, from **Personas del
  hogar** (`household.resetMemberPassword`, security review 2026-10-12). There
  is no email, so this is the way back from a forgotten password; until it
  existed a member who forgot theirs was locked out for good. The member must
  be the caller's household's (`NOT_FOUND` otherwise), only an owner may act on
  an owner — an admin who could set an owner's password could sign in as that
  owner — and nobody may use it on themselves, because their own password
  changes through the current one. The new password meets the policy, the
  identity rule checked against the member, and one transaction sets the hash,
  deletes the member's session rows and removes their passkeys (D151), so
  whoever used the old password is signed out too and keeps no passkey they
  added with it — the step-up that adding one asks for is that password, and
  a passkey signs in without any. The admin cannot see a member's passkeys to
  tell whose they are, so all of them go, and the member adds theirs again.
  Ending a member's sessions, or the whole household's, leaves passkeys
  alone: neither changes a password, which already lets whoever knows it
  back in, and the way to shut such a person out is this reset. The
  write repeats the household and role in its `where`, so a member who leaves
  or is made an owner during the quarter-second hash is not written to. It
  shares `addMember`'s limit (below) and is logged as `auth.password.reset`,
  naming the admin and the member. The admin knows the password they set, as
  they know the first one; the confirmation tells them to hand it over and ask
  the person to change it, and nothing makes the person do so. The owner of a
  single-owner household has nobody above them: their way back is the
  operator, through [the installation guide](docs/INSTALL.md#a-forgotten-password).
- **The session cookie is `Secure` only when the canonical address is
  https**, and the server says so when it is not. `STOKY_URLS` lists the
  addresses the instance is reached at; the first is canonical (PROGRESS
  D138). Better Auth is built once, from it, and decides then:
  `useSecureCookies` is set exactly when the first entry is https
  (`src/lib/auth/instance.ts`), never from a request's `Host` or
  `X-Forwarded-Proto`. The release bundle sets `STOKY_URLS` to
  `https://${DOMAIN}`, so its session cookie is `__Secure-stoky.session_token`
  and `Secure`; `unit/public-url.test.ts` builds the instance with an https, a
  LAN http and a loopback first entry, and with lists in both orders, and
  reads the cookie's name and flag back. Because one entry decides for all, an
  https first entry beside plain HTTP to another machine is refused in
  production: the cookie would be `Secure`, and the browser would drop it at
  the plain-HTTP address — a sign-in loop. `http://localhost` beside it is
  accepted, because Chromium and Firefox keep a `Secure` cookie on localhost.
  An https address listed after a plain-HTTP first entry gets a cookie that is
  not `Secure` either, and the server warns about it. In production a missing
  `STOKY_URLS` is not guessed: the server refuses to start, as it does for an
  entry that is not a bare `http(s)` origin — a path, a query, a fragment or
  credentials (PROGRESS D136, `src/lib/auth/environment.ts`). Messages name
  an entry by its position and print only its origin, never the text as
  written, which may carry a password. `NEXTAUTH_URL`, its name before the
  `STOKY_` rename, is not read (D152). An `http://` address for
  another machine — where an operator ends up after publishing the app port
  on a LAN — is allowed, and `src/lib/auth/public-url.ts` logs one
  `[auth] warning:` line at start-up for each. It
  names the consequences — passwords and session cookies in
  cleartext, no barcode camera, no offline support — and the way to TLS. **A
  warning, not a refusal**: refusing would reverse D84 and stop every
  plain-http LAN install on upgrade, and forcing `Secure` would make sign-in
  there impossible, because a browser drops a `Secure` cookie set over http.
  `localhost`, `*.localhost`, `127.0.0.0/8` and `[::1]` are not warned about:
  browsers treat them as this
  machine, and CI and the browser suite serve there.
  `src/__tests__/unit/public-url.test.ts` pins each case and that the hook
  warns without exiting.
- Self-registration is the operator's to open: `STOKY_REGISTRATION` is
  `first-user` unless set, so the first account claims the instance and later
  people are added by a household admin. See
  [Registration closes after the first account](#registration-closes-after-the-first-account).

### Input validation — `src/lib/validations/`

- Every tRPC procedure parses its input with Zod, and **every string and array
  it accepts has a maximum**. The lengths are named in
  `src/lib/validations/bounds.ts`: an email address 254 (RFC 5321), a name
  200, a note, reason or shop address 1000, a unit 32, a barcode 64, an id 64,
  a declared MIME type 255. A currency is three letters after trimming and
  upper-casing.
- A product created from an Open Food Facts hit takes its name, brand and
  category from text anyone can edit on OFF, not from a caller, so
  `productFromOff` cuts each to the name bound before it is stored. Otherwise
  the detail form, which sends all three back on every save, could not save
  that product again.
- `src/__tests__/unit/procedure-input-bounds.test.ts` walks the parser of every
  procedure in `appRouter` — the inline ones as well as the shared schemas —
  and fails naming the field when a string or array has no maximum, or when it
  meets a Zod type it does not understand.
- The bound is in the application, not the column: every Prisma `String` is
  still `text`. A `VarChar(n)` migration would fail on any instance already
  holding a longer value. A row stored before the bound still displays; saving
  it again means shortening it first.

### Receipt uploads — `src/server/trpc/routers/receipt.ts`

- MIME allowlist (JPEG, PNG, WebP), a 10 MB size cap, and a magic-byte check on
  the decoded buffer.
- Every accepted image is re-encoded through `src/server/services/image.ts` (`Bun.Image`) to JPEG, which strips EXIF —
  including any GPS coordinates in a photo of a receipt.
- **The re-encode's output is then walked against an allowlist of JPEG
  segments**: the JFIF header (without a thumbnail), the quantisation and
  Huffman tables, the restart interval, the frame header, and the scan through
  to the end. Every other application segment and every comment is dropped —
  the ICC colour profile above all, which `Bun.Image` carries through a
  re-encode on purpose. Without the walk a caller's bytes reached the uploads
  volume verbatim: an `APP2` `ICC_PROFILE` segment holding a minimal header
  and 2 KB of `<script>` text came out of the re-encode byte for byte, and a
  JPEG, PNG or WebP tagged Display P3 kept its profile (measured, Bun 1.4.2).
  A stream the walk cannot parse, or a marker it does not expect before the
  scan, throws, and the upload is refused with `BAD_REQUEST`. The cost is
  colour: a wide-gamut photograph loses the tag that says so and displays as
  sRGB, which neither Tesseract nor anything in the application looks at. This
  cleans what is stored; the decoder still parses whatever profile was sent
  when the upload is decoded. Files stored before the walk keep their
  profiles, and OCR parses them again if such a receipt is re-processed.
- Decoding refuses anything over 50 megapixels before allocating for it, and
  the re-encode keeps at most **4000 pixels on the long edge**: larger
  photographs are scaled down in proportion, smaller ones are left at their
  own size. The first bounds the decode; the second bounds what is stored and
  what Tesseract is later handed. Before it, a 6.1 MB noise PNG at 7000 × 7000
  was stored as a 47 MB JPEG at full size; it is now 11.7 MB at 4000 × 4000
  (measured, `Bun.Image` at quality 90) — smaller, but still more than the
  10 MB the upload accepts, which the next point refuses. A 12-megapixel
  phone photograph (4000 × 3000) is untouched. Photographs stored before the
  bound are not rewritten and keep their size on disk; OCR runs once, at
  upload, and nothing re-processes a stored receipt, so none of them is
  handed to Tesseract again.
- **The re-encoded file is held to the same 10 MB as the upload**, and one
  over it is refused with `BAD_REQUEST` before a directory, a file or a row
  is written. The two caps are not the same thing: one bit per pixel of
  black-and-white noise does not deflate and costs a JPEG about a byte, so a
  2.0 MB palette PNG at 4000 × 4000 re-encoded to 15.4 MB (measured, 7.7×).
  Without the check that was seven times the bytes sent, and half as much
  again as the largest upload accepted, written to a volume that in the
  release bundle is a plain named volume beside PostgreSQL's — on the same
  disk unless the operator moves it. With it nothing stored is larger than
  what could have been sent; storage still grows without bound over time,
  because nothing is deleted and there is no per-household quota
  (`docs/SECURITY_REVIEW.md` finding 16).
- **Recognition is bounded in time** (`src/server/services/ocr.ts`): one image
  may hold the Tesseract worker for `OCR_TIMEOUT_MS`, 120 seconds unless the
  variable is set to a positive whole number of milliseconds no larger than a
  timer can hold, 2 147 483 647 (the release bundle does not pass it). Past
  that the worker is terminated, the receipt becomes FAILED, and the next one
  loads a fresh worker. tesseract.js cannot cancel a recognition, so
  termination is the only way to get the worker back; images are handed to it
  one at a time, because its `terminate()` leaves jobs queued on that worker
  unanswered for good. Before this, the worker was shared and had no limit, so
  one image Tesseract could not finish stalled every receipt behind it.
  Measured with the bundled model (Bun 1.4.2), on the audit's 7000 × 7000
  noise image as the re-encode scales it (4000 × 4000, 11.7 MB — over the
  stored-size cap above, so a harder case than one that can be uploaded):
  still being read at 120 s, refused at 120.2 s, and a synthetic 48-megapixel
  receipt photograph queued behind it was read 2.7 s later on the new worker
  (3.0 s on its own). Termination under Bun is not instant on a thread busy in
  Tesseract's WebAssembly. Terminated 2 to 40 s into that image, the thread
  stopped within 2 s in five runs and 10 to 13 s later in the two terminated
  about 6 s in, so a terminated worker can briefly hold its memory (about
  300 MB on that image) beside the new one. What the bound does not do is
  shorten the queue: each image that runs out the limit costs everyone behind
  it 120 s, and the 30 uploads an account may make in an hour can fill an hour
  of OCR.
- **A restart does not strand a receipt** (`src/server/services/receipt-recovery.ts`,
  called from `src/instrumentation.ts`). A receipt is read inside the process
  that took its upload, so one that process was still reading when it stopped
  — a deploy, a restart, an OOM kill — used to stay in UPLOADING, PROCESSING
  or PARSED for good, with the upload screen polling it. At start the server
  now marks FAILED every receipt in those states created before it started;
  the person re-uploads (ISSUES.md OCR-3). This assumes one application
  process per database, which is what the release bundle runs.
- Files are written with a `randomUUID()` filename into a per-household
  directory on the `uploads` volume, so a filename cannot be guessed and cannot
  be used for path traversal.
- No HTTP route serves the uploads directory. Nothing in `src/app` reads it, and
  it is not inside `public/`. Whatever one day serves a receipt image checks
  the household first, and the response that carries the bytes declares
  `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`, a
  `Content-Disposition` with a fixed filename and `Cache-Control: private,
  no-store` — the walk above narrows what a stored file can carry, it does not
  make serving it any less careful.

### Data minimisation — receipt reads

- The four receipt reads — `getStatus`, `getReceiptWithItems`, `list` and
  `getAppliedSummary` — name the columns they return instead of `include`-ing
  the row. They are household reads, so the KITCHEN role on a shared tablet
  receives whatever they return. Until 2026-10-12 that was every column of
  `Receipt`, three of which no screen reads:
  - `rawOcrText`, the whole ticket as OCR read it. This includes the header
    and footer the parser drops, which is where a masked card number, a
    loyalty number and the cashier's name are printed.
  - `imagePath`, the photograph's location on the server's disk.
  - `uploadedBy`, the member who scanned it.

  The receipts list sent the OCR text of up to fifty receipts on every visit.
- The header the reads return is `id`, `status`, `storeId`, `purchaseDate`,
  `totalAmount`, `createdAt` and the store's `id` and `name`. `getStatus`
  returns only the id, the status and the progress count.
- `src/__tests__/integration/receipt.router.test.ts` ("what a receipt read
  sends") pins each read's key set exactly and checks that no excluded key or
  value appears in the serialised response, so a column added to `Receipt`
  reaches a client only when a read is changed to send it. Two mutations made
  the test fail: restoring `include` failed all four cases, and returning the
  OCR text under an allowed key failed on its value.
- Not covered: `upload` still returns the row it created, `imagePath`
  included, to the member who uploaded it. `rawOcrText` is also still stored
  for as long as the receipt exists. Clearing it would not remove the data,
  because the photograph it was read from is kept just as long
  (`docs/SECURITY_REVIEW.md` finding 16, no `receipt.delete`). Retention is a
  decision for that finding to make.

### Household isolation — product row locks

- Stock writes and `product.update` hold the product row
  (`SELECT … FOR UPDATE`) so that two writes to one product take turns
  (`ISSUES.md` INV-2). The lock's own `WHERE` names the caller's household as
  well as the id, in all five places: `addStock`, `consumeStock`,
  `adjustStock`, `transferStock` and `product.update`.
- Until 2026-10-12 four of them locked by id alone, before the household
  check that refuses a foreign id. A caller holding another household's
  product id therefore locked that household's row for the instant before
  `NOT_FOUND`, and had to wait whenever the owner was holding it, which told
  the caller when the owner was writing. `consumeStock` is open to KITCHEN.
  Product ids are random, so this needed an id leaked from elsewhere. Postgres
  filters rows before it locks them, so a foreign id now locks nothing and
  waits on nothing. `addStock` already checked the product before its lock;
  it carries the predicate too, so there is one rule.
- `src/__tests__/integration/product.lock-isolation.test.ts` has household A
  hold its product's lock in an open transaction while household B calls each
  of the four procedures with A's id. B must be refused with `NOT_FOUND` while
  A still holds the lock. Removing the predicate from any one procedure made
  that procedure's case fail ("blocked" after the 5-second ceiling) and left
  the other three passing.

### Supply chain — `.github/workflows/`, `bunfig.toml`, `package.json`

- Every GitHub Action is pinned to a **commit SHA**, not a tag, because a tag
  can be moved and a SHA cannot. The comment beside each pin names the exact
  release (`# v5.1.0`, not `# v5`). The SHA must be the commit's, not an
  annotated tag object's: the runner resolves both, but the commits API answers
  422 for a tag object, so pin tooling cannot reliably check or bump it. Two
  pins were tag objects until 2026-10-12.
  `src/__tests__/unit/ci-workflow.test.ts` refuses a tag, a major-only comment
  and those two SHAs; that a new SHA is a commit is checked with
  `gh api repos/<owner>/<repo>/commits/<sha>`. Container images follow the
  same rule: the `Dockerfile`'s Bun base and the bundle's service images are
  pinned by digest ([Container and runtime](#container-and-runtime--dockerfile),
  [Release deployment](#release-deployment--deploydocker-composeyml)).
- **The workflows are audited for security before anything is published.**
  `scripts/check-ci.sh`, the first step of the `quality` job (which
  `image-publish` needs) and part of `check:all`, runs zizmor 1.16.3 over
  `.github/` (both workflows and `dependabot.yml`): template injection, credentials persisted in the
  checkout, caches a release path restores, dangerous triggers, Dependabot
  without a cooldown. It comes from `ghcr.io/zizmorcore/zizmor` pinned by
  index digest, runs with no network (`--offline`, `--network none`), and
  fails on any finding its `regular` persona reports, at any severity; an
  unparseable workflow fails it too (`--strict-collection`), where by default
  zizmor skips the file and exits 0. Verified on scratch copies: a
  `${{ github.event.pull_request.title }}` in a `run:` step exits 14, a
  Dependabot entry without its cooldown exits 13. Its online audits, which
  ask the GitHub API about each pinned action, are not run.
- `bun audit --audit-level moderate` runs as its own job and fails the build. It
  answers from `bun.lock` alone, so the job installs nothing.
- The image is built and **loaded locally, then scanned by Trivy before it is
  pushed** — scanning after publication would be the wrong order. Results are
  uploaded as SARIF, and a separate step fails the job on CRITICAL or HIGH
  findings (`ignore-unfixed: true`).
- **A release's version tag names only a scanned digest.** The scanned build is
  never pushed: the published image is a second build, and on a tag a clean
  one, so the two digests differ. `release-draft` scans the pushed digest from
  the registry with the same gate (Trivy 0.76.1 pinned, CRITICAL/HIGH,
  `ignore-unfixed`, no Actions cache) before it retags it as the version.
  `latest` and `sha-` rely on the first build's scan. This catches a known CVE
  that only the shipped build carries; it is not a defence against a poisoned
  build, since Trivy does not detect an implanted layer. Run by hand against
  the published digests on 2026-10-12, the same scan passes `v0.1.0-alpha.3`
  and fails `v0.1.0-alpha.1` (Next.js 16.3.3: one CRITICAL, one HIGH, both
  fixed upstream).
- **A release's Compose file names that digest.** GHCR tags can be moved by
  anything holding `packages: write`, which includes every master run's
  `image-publish` and a maintainer token. `release-assets.sh` writes the
  promoted digest into the packaged application image line
  (`…:${STOKY_VERSION}@sha256:…`) and `SHA256SUMS` covers it; `release-draft`
  checks that Compose resolves and pulls exactly that reference before the
  draft exists. Docker then pulls the digest and ignores the tag, so a moved
  tag does not reach an installation. Bundles up to `v0.1.0-alpha.3` name the
  tag only. The pin is as fixed as the release's files: immutable releases are
  off (`gh api repos/NGarate/stoky/immutable-releases` answered
  `"enabled":false` on 2026-10-12), so anything holding `contents: write` can
  still replace a published release's files and their `SHA256SUMS` together.
  The attestation in the next point is what such a replacement does not carry.
- **A release's installation files are attested.** `release-draft` signs build
  provenance (`actions/attest-build-provenance`, `subject-path`) for the five
  files it attaches — `docker-compose.yml`, `example.env`, `traefik.yml`,
  `install.sh` and `SHA256SUMS` — after the packaged Compose file has been
  checked and before the draft exists. The attestation is stored by GitHub, not
  in the release, and names the signing workflow and the tag, so a file swapped
  on the release later fails `gh attestation verify` pinned to `ci.yml` and
  that tag ([the guide's optional
  check](docs/INSTALL.md#optional-check-who-published-the-files)). It binds a
  file to a run of `ci.yml` on that tag, not to an unmoved tag: a writer who can
  move the tag and push a changed workflow can have a new run attest other files
  under the same ref, which only a tag ruleset on `v*` stops, and none existed
  on 2026-10-12 (`.github/rulesets/` holds the two the settings check applies).
  It also vouches only for what that run wrote: every earlier step of
  `release-draft` (the Trivy action and its scanner, the downloaded Bun, the
  smoke) shares the runner and, with `id-token: write` granted to the job, can
  request the OIDC token the signing certificate is issued for, so the
  attestation is no stronger than they are. Releases after `v0.1.0-alpha.3` carry it; for alpha.3's `SHA256SUMS` the
  command answered `HTTP 404` and exit 1 on 2026-10-12. Gated on
  `github.event.repository.private == false` like the image's, for the same
  private-fork reason.
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
- **A release is built and packaged from nothing in the Actions cache.** The
  cache of a master or tag run can be written by any job of a master run, and
  `e2e` runs test-only code in a container that holds the runner's docker socket.
  So a tag's publish build uses no layer cache (no `cache-from`, `no-cache`), and
  the jobs that check, scan and package a release download Bun, Trivy and its
  database rather than restore them — `release-draft` holds `contents: write` and
  `packages: write` and runs `bun` beside its registry login. No step of
  `ci.yml` uses setup-bun's cache at all: `e2e` and `audit` restored Bun from
  it, on tags too, until zizmor's `cache-poisoning` audit named them on
  2026-10-12. `e2e` gates `image-publish`, so a binary planted there would run
  a gate the release passes through, and an ignore annotation would have been
  a judgement no test holds; `audit` installs nothing, so the cache saved it
  nothing. `latest` and `sha-`
  images still rebuild from the layer cache: they are the development channel,
  and an installation runs an exact version tag. `ci-workflow.test.ts` holds each
  setting. `v0.1.0-alpha.3` was assembled from that cache: in run
  `38178388250` every Dockerfile step of its publish build but the last was
  `CACHED`, and `release-draft` logged a cache hit for Bun.
- **The newest published release is re-scanned every week**
  (`.github/workflows/rescan.yml`, Mondays and by hand). It downloads that
  release's `docker-compose.yml` and scans every image Compose resolves from it
  — the application at its digest, PostgreSQL, Valkey and Traefik — with
  `release-draft`'s scanner and gate (Trivy 0.76.1, from the registry, no Actions
  cache, fixable CRITICAL/HIGH), uploading one SARIF report per image and failing
  the run so the failure reaches the maintainer. The workflow holds
  `contents: read`; only its scan job adds `security-events: write` and
  `actions: read` for the upload. The gate leaves out postgres's
  `/usr/local/bin/gosu`, whose 25 findings on 2026-10-12 were all in Go
  packages the binary does not link; the report keeps them. Before this, a
  release was scanned once and an advisory published later reached nobody until
  the next push. Neither scan sees dependencies compiled into the `.next` bundle
  or the Bun binary itself. [Releasing](docs/RELEASING.md#after-publication-weekly-re-scans)
  says what a red run asks for. `ci-workflow.test.ts` holds the schedule, the
  permissions, the pins and the gate.
- **A release's service images are scanned before its draft exists.** On a
  tag, `ci.yml`'s `release-images` job runs `scripts/scan-bundle-images.sh`
  over the PostgreSQL, Valkey and Traefik images `deploy/docker-compose.yml`
  names, with the same rule (Trivy 0.76.1 pinned by digest, from the registry,
  no cache, fixable CRITICAL/HIGH, gosu the only skip), and `release-draft`
  needs it: a red bundle is never promoted or packaged. It runs on pull
  requests too, as information. Before it, these images were first scanned by
  the weekly re-scan, after publication; `v0.1.0-alpha.3` shipped
  `traefik:v3.7.13` with four HIGH advisories that way.
- **A package version younger than three days is not installed.** `bunfig.toml`
  sets `[install] minimumReleaseAge = 259200`, so `bun add`, `bun update` and
  any install that resolves something new skip versions, direct or transitive,
  published within the last three days. A hijacked release is often found
  and pulled within that window, and before an advisory exists `bun audit` has
  nothing to say about it. Until 2026-10-12 nothing held one back: commit
  `f643550` locked next-intl 4.14.0, a shipped runtime package, 27.9 hours
  after it was published, with `@eloqnt/config` 0.0.2 at 46.6 hours. The gate
  does not touch a frozen install: CI, the Dockerfile and `scripts/dev-local.sh`
  install exactly what `bun.lock` names (a copy of the lockfile installed with
  a ten-year gate exited 0 and left it byte-identical, Bun 1.4.2). Measured on
  Bun 1.4.0, then the pinned image, and 1.4.2: `bun add` of a TypeScript nightly 20
  hours old fails with `blocked by minimum-release-age: 259200 seconds`.
  **A security fix younger than three days** goes in through `bun audit fix`,
  which Bun documents as installing the safe version anyway and marking the row
  `(newer than --minimum-release-age)`, or through `--minimum-release-age 0` on
  that one command, which was measured to override the file. Neither lowers the
  gate for the next update; `minimumReleaseAgeExcludes` would, so it stays
  empty. Dependabot's seven-day cooldown is longer than the gate, so a version
  it proposes is already old enough to clear it. `package-overrides.test.ts`
  holds the value, the empty exclusion list and that ordering.
- **Three packages may run install scripts**: `argon2`, `prisma` and
  `@prisma/engines` (`trustedDependencies` in `package.json`, which replaces
  Bun's default allow-list rather than extending it). A trusted script runs at install time with network access and, on a
  developer machine, the repository's `.env` in its environment: Bun exports
  it to lifecycle scripts, and neither `--no-env-file` nor bunfig `env = false`
  stops that (a probe dependency's `postinstall` printed a value set only in
  `.env` under both, Bun 1.4.0 and 1.4.2). CI and the image build have no
  `.env`. Until 2026-10-12 the list also held `@swc/core`, `@parcel/watcher`,
  `sharp` and `tesseract.js`, carried over from pnpm in `f643550`: sharp
  0.35.5 has no install script, tesseract.js's is a donation banner,
  `@parcel/watcher`'s builds from source only when asked to, and `@swc/core`'s
  checks its prebuilt binding and, if that fails, runs `npm install
  @swc/wasm` outside the lockfile. The last two are next-intl's, for its
  message extractor, which is not enabled — but its plugin imports both
  whenever `next.config.ts` loads, so every `next build` and `next dev` loads
  their native bindings, from optional platform packages that have no script
  (measured: importing `next.config.ts` under Bun loads
  `@swc/core-linux-x64-gnu` and `@parcel/watcher-linux-x64-glibc`). After the
  change, a clean `--target deps` build reports those three as blocked in
  `bun pm untrusted`, and SWC, the watcher, sharp, argon2 hash/verify and the
  Prisma engines all load in it; the production image builds.
  `package-overrides.test.ts` holds the exact list.
- **`dependencies` lists what the application runs**, so an advisory is
  triaged against the right exposure. GitHub's dependency graph and the scope
  Dependabot gives an alert are read from `package.json`, and until 2026-10-12
  they called TypeScript, `@types/node`, `@types/react`, `@types/react-dom`,
  Tailwind, `@tailwindcss/postcss` and PostCSS runtime packages; all seven are
  build tooling and are now devDependencies. PostCSS stays in the runtime graph
  all the same, because `next` declares its own pinned copy (8.5.23) as a
  dependency: an advisory against PostCSS is still scoped "runtime" through
  `next`, as Dependabot alerts 31, 53, 54 and 56 were (all "transitive"), and
  neither copy is in the image. `server-only`, imported nowhere, was removed.
  The image did not change: its builder installs both sections and ships only
  the traced standalone output and the staged OCR and Prisma trees, and
  production images built before and after the move held the same
  5,708 files under `/app/node_modules` and `/opt/prisma`, byte for byte. The
  release SBOM is made from the image, so it was never affected.
  `dependency-scope.test.ts` requires every entry in `dependencies` to be
  imported by shipped code or named with the reason it runs without one
  (`prisma` for migrations, `react-dom` for Next).
- Migrations are applied to an empty database in CI, so a migration that only
  works against an already-prepared database fails the build rather than
  somebody's first install.
- Workflow permissions default to `contents: read`; jobs request more
  explicitly.
- **The repository's own settings are written down and checked.** Private
  vulnerability reporting, immutable releases, secret scanning and push
  protection, Dependabot alerts and security updates, CodeQL's default setup,
  the Actions allow-list (`.github/selected-actions.json`) with SHA pinning
  enforced, approval for every external contributor's fork run, squash or
  rebase merges and never a merge commit, the two `v*` tag rulesets
  (`.github/rulesets/`) and Dependabot's branches left outside the branch
  ruleset live on GitHub, where a checkout cannot see them. `bun scripts/github-settings.ts check`
  compares each with what it should be, with GET requests only, and exits 1 on
  any difference; `apply` writes what differs. It needs an administrator's `gh`,
  so the owner runs it; CI cannot. Its first run, on 2026-10-12, found 11 of
  those 12 settings not as written, Dependabot alerts the exception: written
  down is not the same as on until `check` exits 0. [Releasing](docs/RELEASING.md#repository-settings)
  says what each is for.

Dependency status as of the last audit is recorded in `docs/STATUS.md` under
*Dependency security*.

---

## Known gaps

**Reviewed 2026-08-26, and again 2026-10-12.** `docs/SECURITY_REVIEW.md` is
Phase 7's review: eight areas, what each is protected by and which test proves
it, and the findings that remain with an owner. It also records the 2026-10-12
review, whose accepted risks are listed at the end of this section
([*What the 2026-10-12 review accepted*](#what-the-2026-10-12-review-accepted)). Two sections below were found to be false and are
corrected in place rather than deleted — a wrong claim in this file is worth
seeing, since its whole premise is that every claim is checkable.

Read this section before deciding where to run Stoky. It is not a wish list; it
is what is wrong today.

### Rate limiting covers authentication and the expensive calls, not the rest

`ISSUES.md` CRITICAL-4 is closed as of Phase 3: `src/lib/rate-limit.ts` counts
sign-ins and registrations per IP in Valkey, at the defaults in that file — 5
sign-ins per 15 minutes, 3 registrations per hour. A successful
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
tell a household's phone from its tablet, and a successful sign-in charged to
it clears it — safe here, since only that account's own password can.

The counter is keyed on a SHA-256 of the normalised address rather than the
address, so a `KEYS rl:login:acct:*` on Valkey — available to anything on the
Docker network — does not come back as a list of who has tried to sign in. It
counts attempts on addresses that are not registered too, so the difference
between "refused" and "rejected" cannot be used to discover which addresses
exist.

**A full account counter refuses the right password too**, and anyone can fill
it: ten wrong guesses at a member's address, from two addresses at the per-IP
five each, at the start of every window. Until 2026-10-12 that kept the member
from signing in on any device for as long as somebody kept doing it, and this
section said nothing about it (security review, 2026-10-12, medium; ASVS 4.0.3
V2.2.1 asks anti-automation to resist exactly this). So **a browser that has signed in
to the account before is counted on its own budget instead** — 5 attempts per
15 minutes per account and device — and a stranger's guesses never reach it.
This is OWASP's device-cookie pattern, and NIST SP 800-63B §5.2.2's "accept
authentication only from known devices":

- The device is the existing `stoky_device` cookie: a random v4 UUID,
  `httpOnly`, a year. Anyone can send any value, so **a cookie being present
  buys nothing**. A device is known only if a successful sign-in *to that
  account* recorded it, in a Valkey sorted set `rl:known:<account hash>` of
  SHA-256 fingerprints (never the cookie value), newest twenty kept, expiring a
  year after the last success. Any other id — none, a minted one, one recorded
  for a different account — is counted on the shared budget exactly as before,
  so a distributed guess is still bounded at ten per window.
  `src/lib/auth/known-devices.ts`; the integration suite proves each case and
  the twenty-device cap.
- The id is minted by the proxy when a page is rendered, never for the auth
  API or for a request carrying `Authorization: Bearer` (`src/proxy.ts`). So
  **a client that never rendered a page — a native app, a script — has no
  id and is charged to the shared account budget**, as a browser with a
  cleared cookie jar is. For its first sign-in that is the same outcome as
  before, when the id it was handed on the spot had never been recorded
  either. It is not the same for the next one: a client that kept cookies
  used to have that minted id recorded by its successful sign-in, and so
  signed in on a budget of its own afterwards; now it stays on the shared
  one, and a stranger filling that budget can keep it from signing in again
  (not from using a session it already holds). That is accepted: not
  handing it an id keeps a cookie the client never sent off requests that
  are judged by whether they carry a cookie.
- The set is deliberately not under `rl:login:`. Without a proxy the per-IP
  counter is `rl:login:<whatever X-Forwarded-For says>`, and a forged header
  naming the set would plant a string at its key and, failing closed, stop
  every sign-in to that account. A test forges exactly that header.
- A known device's own budget still runs out: a stolen device cookie is five
  guesses a window. A success clears only the counter it was charged to, so the
  owner signing in on their phone does not hand whoever is filling the shared
  counter a fresh one.
- Asking whether a device is known fails closed like the counters, and is asked
  for registered and unregistered addresses alike.

**What is left is accepted:** somebody who knows a member's address can still
keep them from signing in **on a browser that has never signed in to that
account** — a new phone, a private window, a cleared cookie jar — because that
budget must stay shared to bound guessing. A browser pushed out of the newest
twenty is a new browser again, and so, on an installation updated from a
release before this one, is every browser until it next signs in: nothing was
recorded before, and a session still open from then is not a record. Ending
sessions or changing the password does not forget devices: a device only ever
buys its own five guesses, not access. The person refused is told it is the
account — "Demasiados intentos con esta cuenta… si se repite, avisa a quien
administra tu hogar" — not the per-address "desde esta conexión", because
another network cannot help them and their report is how the operator hears
that somebody is spending the counter. Naming the account reveals nothing: the
counter runs only after the per-address check passes, and for unregistered
addresses alike. An operator can clear an account's shared counter by hand —
[docs/INSTALL.md](docs/INSTALL.md#somebody-keeps-being-told-to-wait) has the
command.

Beyond sign-in, what is limited, what is not, and what is worth knowing before
publishing an instance:

- **Receipt upload is limited too**, at 30 per account per hour, counted
  before the file is decoded. OWASP ASVS **V11.1.4** asks for anti-automation
  on expensive operations, and this is the expensive one: up to 10 MB decoded,
  re-encoded through `src/server/services/image.ts` (`Bun.Image`) at no more
  than 4000 pixels on the long edge, written to a volume, then handed to Tesseract. It
  is counted per *account* rather than per address, because the caller is
  already authenticated and a household behind one NAT would otherwise share a
  budget for work each member does separately. A refused upload still counts —
  otherwise sending rubbish and being rejected would be the cheapest way to
  spend the server's CPU, and it would be outside the limit.
- **Barcode lookups that reach Open Food Facts are limited**, at 60 per
  account per hour (`productLookupRateLimit`). They are the one thing an
  account can make this instance ask of somebody else: every `scanBarcode` or
  `resolveScan` of a code the household does not have went out to
  `world.openfoodfacts.org` from the instance's one address, and Open Food
  Facts throttles API clients per address. A member scanning random codes in a
  loop — under open registration, anyone — could get the instance throttled
  and barcode enrichment stopped for every household on it. Only a request
  that actually leaves is counted, after the household's own products and the
  shared cache (hits, and codes known to be unknown) have missed, so rescanning
  a cupboard never spends it. Past the budget the lookup is refused with a 429
  before it is sent; the scan page hands the person the creation form with the
  code filled in, and a scan queued offline becomes the same question the
  sync indicator asks of a code nobody knows ("needs a name") rather than a
  429 the queue would retry for two minutes and then give up on. It is per
  account, not for the instance: N accounts are N budgets, so this bounds
  what one account can do, not the instance's total.
- **Adding a member is limited too**, at 20 per admin account per hour,
  counted before the password is hashed (security review, 2026-10-12).
  Setting a member's password (`household.resetMemberPassword`) spends the
  same budget, for the same hash: twenty a member added or a password set.
  `household.addMember` runs Argon2id at 64 MiB on every call before the
  database is asked anything, and a duplicate address pays that hash as well,
  because the unique index only answers once the row is written. Unmetered,
  any account that admins a household — on an instance with open registration,
  anyone who registers one — could ask for those hashes in a loop, or hundreds
  at once in one batched request. An address that is already taken is
  counted like any other call — it has already paid the hash. What is refused
  before the count, by the role check or the input schema, never reaches the
  hash either. Twenty is a household setting up every device and person it has
  in one sitting with room for mistakes; past it, the admin waits for the
  window to end.

  What it bounds is one account, not one person. An owner can promote the
  accounts it creates to admin (`household.updateRole`), and each of those
  starts with a budget of its own. Nor is this the cheapest way left to make
  the server run Argon2id: signing in runs `argon2.verify` at the same cost,
  and a sign-in that succeeds is refunded and clears the counter it was charged
  to (above), so anyone with a password can repeat it without being counted. What
  this limit removes is the unmetered, batchable, account-creating form of the
  cost — not every way an authenticated caller can ask for a hash.

  The same limit bounds the one thing this procedure tells an admin about
  other households: `CONFLICT` means the address has an account somewhere on
  the instance, not only in this household. That is accepted — with no email
  channel there is nothing else to tell an admin who typed an address already
  in use — and it is visible only to an account that admins a household, at
  twenty questions an hour.
- **Changing a password is limited too**, at 5 per account per 15 minutes,
  counted before the current password is checked (security review,
  2026-10-12). The procedure answers "is this the password?", so unmetered it
  would let whoever holds a stolen session — an unlocked phone, a kitchen
  tablet — guess the password behind it with none of sign-in's limits. Five
  is sign-in's per-address number; a refusal carries `Retry-After` like the
  others. Per account, because the caller is already signed in and the
  account is what the guesses are against.
- **Every other tRPC procedure is unlimited**, so an authenticated account can
  still make as many ordinary calls as it likes. That is a smaller problem — it
  needs credentials first, and those calls read and write rows rather than
  start OCR, hash a password or reach a third party — but it is not nothing
  on a shared household instance. It is not only reads, either:
  `product.create`, `store.create` and the other writes are unlimited too.
  Until 2026-10-12 each of them could store as much text as the 15 MiB request
  body carried, so open registration plus a loop of writes could fill the
  disk every household shares. The per-field bounds above cap what one call
  stores — under 700 characters of text for a product, about 100,000 for the
  largest, a 500-line receipt review that creates a product per line — but
  not how many calls there are, so an account can still grow the database
  row by row. Keep the database volume on a disk something watches. Since
  2026-10-12 one request can also carry at most 100 calls ("Batched calls"
  above), so how many arrive at once is bounded by how many requests a caller
  sends — and nothing counts those.
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
- **An IPv6 client is counted by its /64, and logged by its address.** One
  IPv6 subscriber is at least a whole /64 — the smallest block a line is
  given — and a host picks addresses inside it at will, so counted per address
  it would have 2^64 budgets. `rateLimitIdentifier` normalises the address first (case,
  leading zeros, `::`, brackets, a port, a zone), keys it by its first four
  hextets, and counts an IPv4-mapped `::ffff:a.b.c.d` as the IPv4 client it
  is; IPv4 is counted per address as before. The security log keeps the full
  address (`clientAddress`): the bucket is what a limit needs, the address is
  what an operator reading the log needs. The cost is the one a NAT already
  has, a household's devices sharing a budget. A line delegated more than a
  /64 — a /56 or a /48, as many home connections are — still has one budget
  per /64 in it (256 or 65,536): that is the attacker with a range of
  addresses above, and the per-account limit is what bounds it.
- **Under the release bundle as shipped, IPv6 clients are not told apart at
  all.** Traefik's network is IPv4-only, so a client connecting over IPv6
  reaches it through Docker's userland proxy, which opens a connection of its
  own: the application sees the network's gateway (`172.x.0.1`) in place of
  every IPv6 client. They share one sign-in and one registration budget, so
  anyone on IPv6 can keep every other IPv6 visitor waiting, and the security
  log names the gateway for all of them. Established from Docker's
  documentation and the proxy's source (security review, 2026-10-12), not
  reproduced: that needs ports published on a dual-stack host. IPv6 is
  not turned on in the bundle because it breaks Engines before 27, hosts with
  IPv6 disabled, and an existing network on upgrade; it is an opt-in, and
  [the installation guide](docs/INSTALL.md#clients-on-ipv6) says how to take
  it, how to avoid the question with an A record only, and how to tell from
  the log which applies. The /64 grouping above is what makes taking it safe.
- **A refusal says how long to wait.** A 429 from tRPC carries `Retry-After`,
  read off the refusal rather than recomputed, so the header and the message
  cannot disagree — RFC 9110 §10.2.3. Two things deliberately do not carry it:
  the 503 a dead Valkey produces, because nothing knows when the cache is
  coming back and an invented number would be worse than none. Sign-in is
  answered by the auth route, not tRPC, and does the same: 429 with
  `Retry-After` and a code (`RATE_LIMITED`, `ACCOUNT_RATE_LIMITED`), 503
  `AUTH_UNAVAILABLE` without one (`src/server/http/auth-handler.ts`). Better
  Auth's own limiter is switched off; these counters are the only ones.
- **It fails closed.** If Valkey is unreachable, nobody can sign in. That is
  deliberate — failing open would hand an unlimited auth endpoint to anyone who
  can take the cache down — but it makes Valkey a hard dependency of signing
  in, which it was not before. The server log names Valkey and `VALKEY_URL`
  when it happens, and the browser is told the service is unavailable rather
  than that the password was wrong. Receipt upload refuses the same way. The
  one exception is the Open Food Facts lookup: a request it cannot count is not
  sent, and the scan ends on the creation form as it would in an Open Food
  Facts outage — still closed for what the limit protects, since no uncounted
  request leaves, without refusing a person a form they can fill in anyway.
- **So the cache must not die of being full.** Valkey shares its memory between
  these counters and the Open Food Facts product cache, which keeps one entry
  per barcode for thirty days (a day for a code Open Food Facts does not know)
  and which any account can grow by scanning barcodes. Valkey does not read the container's memory limit, so without a
  bound of its own it would grow until the kernel killed it, and the limiter
  would take sign-in down with it. The release bundle starts it with
  `--maxmemory 160mb` (Valkey's `mb` is MiB) under the 256 MiB container
  limit, leaving the rest for the copy-on-write of a background save, and
  `--maxmemory-policy allkeys-lru`. The policy is the part that matters.
  `noeviction`, Valkey's default, refuses the limiter's `INCR` once the cache
  is full, and a refused count is a refused sign-in: the same outage without
  the crash. `volatile-ttl` evicts the soonest-expiring
  keys first, which are these counters, so filling the cache would reset
  somebody's lockout. Under LRU a live counter is touched on every attempt and
  the cold product entries go first. Measured against the bundle's own `cache`
  service: 400 MB of 2 KB product-shaped keys left used memory at 160 MiB with
  121,933 keys evicted, a counter incremented between batches survived with its
  count and TTL intact, a background save at the bound succeeded, and the
  container stood at 183 MiB of 256 MiB afterwards, never OOM-killed. The same
  full cache under `noeviction` answered the limiter's script with "OOM command
  not allowed". The cost: under memory pressure, a counter idle for longer than
  most of the product cache can be evicted, which forgets the attempts counted
  on it. An attacker who stopped guessing in order to have its own counter
  evicted would first have to make most of the 160 MiB more recently used than
  that counter, by adding or re-reading products, before the counter's window
  (fifteen minutes for sign-in) ran out on its own; that is reasoning, not a
  measurement. Lookups that reach Open Food Facts are metered per account,
  which slows how fast one account can add products, but re-reading a cached
  product is not. The development compose files set no container memory limit
  and leave Valkey unbounded.
  `src/__tests__/unit/deployment.test.ts` pins the flags and that the bound sits
  at or below three quarters of the container limit.
- **The limits are configurable** through `RATE_LIMIT_LOGIN_ATTEMPTS`,
  `RATE_LIMIT_LOGIN_WINDOW_SECONDS`, `RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS`,
  `RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS`, `RATE_LIMIT_LOGIN_DEVICE_ATTEMPTS`,
  `RATE_LIMIT_LOGIN_DEVICE_WINDOW_SECONDS`, `RATE_LIMIT_REGISTER_ATTEMPTS`,
  `RATE_LIMIT_REGISTER_WINDOW_SECONDS`, `RATE_LIMIT_UPLOAD_ATTEMPTS`,
  `RATE_LIMIT_UPLOAD_WINDOW_SECONDS`, `RATE_LIMIT_PRODUCT_LOOKUP_ATTEMPTS`,
  `RATE_LIMIT_PRODUCT_LOOKUP_WINDOW_SECONDS`, `RATE_LIMIT_ADD_MEMBER_ATTEMPTS`,
  `RATE_LIMIT_ADD_MEMBER_WINDOW_SECONDS`, `RATE_LIMIT_REAUTH_ATTEMPTS`,
  `RATE_LIMIT_REAUTH_WINDOW_SECONDS`, `RATE_LIMIT_REAUTH_ACCOUNT_ATTEMPTS`,
  `RATE_LIMIT_REAUTH_ACCOUNT_WINDOW_SECONDS`,
  `RATE_LIMIT_PASSKEY_OPTIONS_ATTEMPTS`,
  `RATE_LIMIT_PASSKEY_OPTIONS_WINDOW_SECONDS`,
  `RATE_LIMIT_TWO_FACTOR_CODE_ATTEMPTS` and
  `RATE_LIMIT_TWO_FACTOR_CODE_WINDOW_SECONDS`. Raising them raises the
  exposure; the browser suite raises the sign-in, known-device, registration,
  add-member and product-lookup attempts (`playwright.config.ts` says why for
  each), and a
  unit test asserts the shipped defaults with the environment unset so that
  override cannot become the product's behaviour.

### Refusals are recorded

OWASP ASVS **V7.1.3** asks that security-relevant events be logged, and until
Phase 7's slice of the backlog almost none were: a refused sign-in returned
`null` and said nothing, and a request for another household's receipt threw
`FORBIDDEN` at the caller and left no trace on the server. The one question an
owner will actually ask — "has anybody been trying to get into my instance?" —
had no answer anywhere.

`src/lib/security-log.ts` writes one JSON object per event to stderr, which
Docker collects. With `jq` installed on the host, `docker compose logs
--no-log-prefix app | jq -cR 'fromjson? | select(.event == "access.denied")'`
lists the refusals: `--no-log-prefix` drops the `app-1  | ` Compose puts
before every line, which jq cannot parse, and `fromjson?` skips the lines that
are not JSON. The events are
`auth.signin.failed`, `auth.signin.throttled`, `auth.signin.succeeded`,
`auth.unavailable`,
`auth.session.ended`, `auth.password.changed`, `auth.password.reset`,
`auth.signin.challenged` (a right password on an account with two-step
verification, before the code; D148), `auth.twofactor.failed` (a code
refused, with Better Auth's refusal as `code`), `auth.twofactor.replayed` (a
right code sent again), `auth.twofactor.locked` (wrong codes have locked the
account's second step), `auth.twofactor.unreadable` (the stored secret no
longer decrypts), `auth.twofactor.enabled`, `auth.twofactor.disabled`,
`auth.twofactor.codes-regenerated`, `auth.twofactor.removed` (an admin took
a member's off, with the member as `targetUserId`; D150),
`auth.passkey.added` and `auth.passkey.removed` (a passkey added or removed
by its account's holder, after the password; D151),
`auth.passkey.signin-failed` (a passkey sign-in refused, with Better Auth's
refusal as `code`; D151),
`auth.reauth.refused` (a wrong current password re-entered to confirm an
action, with the action as `via` — `end-sessions`, `password-change`, which
replaces the `auth.password.change.refused` event of earlier releases,
`household-end-all`, `two-factor`, `member-two-factor`, or `step-up` before
a passkey is added or removed; D143, D144, D147, D148, D150, D151),
`access.denied` and
`request.throttled`. `auth.session.ended` replaces `auth.session.revoked`
(PROGRESS D135): it is written when somebody ends sessions on purpose, with a
`reason` — `self` for a person ending their own, `password-change` for the
other sessions a password change ended (D144), `admin` for an admin ending a
member's, `removed` for an admin removing a member from the household (D146),
`owner` for an owner ending every session in the household, with no
`targetUserId` (D147), `two-factor-removed` for an admin removing a member's
two-step verification (D150),
`replaced` for a sign-in ending the session its browser presented
(D139), `evicted` for a sign-in ending the account's least recently used
session to stay within ten (D140) — the `userId` who asked, the
`targetUserId` whose they were, and
the `count` of sessions ended (`self` covers ending one, every other or every
one, D143; for `replaced`, the account's expired rows the
same sign-in deleted are counted too). A session that simply runs out writes nothing;
its row is deleted when next read.

A sign-in that gets in is recorded as well, as ASVS 5.0.0 **16.3.1** asks:
`auth.signin.succeeded` carries the `userId` it signed in as, the factor in
`method` (`password`, `totp`, `backup-code` or `passkey`, D151), and the
same `account` tag and `address` a
failure carries, so one filter follows an account from its refusals to the
sign-in that ended them — the line that tells a member who mistyped twenty
times from somebody who guessed right on the twenty-first. Like every other
line it holds no address that was typed, no token and no password, and it is
written only once the sign-in has completed.

- **The release bundle rotates them; Docker alone does not.** Docker's default
  `json-file` driver has no size limit, and every throttled refusal writes a
  line, so an unauthenticated client could add to the log until the host disk
  filled and took PostgreSQL with it. Every service in `deploy/docker-compose.yml`
  therefore names `json-file` with `max-size: 10m` and `max-file: 5`: at most
  50 MB on disk per container. The cap is a size, not a period, so it is also
  what bounds how long the addresses and identifiers in the security log
  survive, and under a flood that is not long: the oldest file goes when a new
  one opens, and measured, 80 MiB of 71-byte lines left 23,412,327 bytes
  readable through `docker logs` (the JSON wrapping counts toward the cap).
  **An unauthenticated client can make that flood**, and nothing throttles
  it: an anonymous tRPC request writes at most one refusal line (about
  130 bytes; [*Batched calls*](#batched-calls--srclibtrpcbatchts)), and a
  sign-in from a foreign origin makes Better Auth write one line of at most
  313 bytes beside the security event (the Better Auth bullet below). At
  about 430 bytes a request, some hundred and twenty thousand requests replace
  the 50 MB — arithmetic, not a measurement — and with it the
  `auth.signin.failed` lines of a guessing run made just before.
  The cap protects the disk, not the record. An operator who needs the record
  to survive ships the logs off the host ([Install](docs/INSTALL.md#logs)),
  which is the only defence against having it flushed. The driver is named next to its options
  because under a daemon-wide driver such as `journald` a bare `max-size` stops
  the container from starting.
  `src/__tests__/unit/deployment.test.ts` asserts the block on every service.

- **The access-control events come from tRPC middleware, not from the
  resolvers**, so a new router cannot forget to be audited. Every procedure
  logs UNAUTHORIZED, FORBIDDEN and TOO_MANY_REQUESTS, which come from three
  middlewares and two resolver checks (`assertMayActOnOwner` and the replay
  envelope's composer check) — every one for a signed-in caller, and the
  first one per HTTP request for a caller with no session, whose other
  refusals in a batch said the same thing again. A cross-site request is refused before tRPC sees
  it, so no middleware runs for it; the route handler writes its
  `access.denied` line itself, with `reason: "cross-site"`.
- **A household lookup that misses is logged too**, as `access.denied` with
  `"code": "NOT_FOUND"` and `"reason": "not-found"` (ASVS V7.2.2). A resolver
  asked for another household's row answers NOT_FOUND exactly as it does for
  an id nobody has, so the browser learns nothing about which ids exist; the
  server does not run a second, unscoped read to tell the two apart, so it
  records both alike. **A not-found line is therefore not proof of a probe**
  — a row deleted on another device, or a stale link, writes one as well.
  What an operator looks for is a run of them from one account:
  `docker compose logs --no-log-prefix app | jq -rR 'fromjson? | select(.reason
  == "not-found") | .userId' | sort | uniq -c` counts them per account. The line names the account, its household and
  the procedure, **never the id that was asked for**. It follows the code the
  caller received, so a write scoped by `householdId` (`store.update`,
  `shopping.removeItem`), which refuses a foreign id as Prisma's `P2025`, is
  recorded like a read; a row deleted between a check and a write is
  therefore recorded too. The one NOT_FOUND left out is a barcode nobody
  knows, which is about Open Food Facts rather than anybody's household. Only
  household procedures are covered; logging every error everywhere would bury
  the refusals and produce a log nobody greps. This reverses the 2026-08-31
  decision to leave these probes invisible (`docs/DEFERRED.md` item 22),
  along the path that entry left open: logged at the middleware, with the
  refusal codes still uniform.
- **A failed sign-in logs the same line whether or not the account exists.**
  Recording which of the two it was would put back, in a file, exactly the
  distinction the flattened error message refuses to tell the browser. **And it
  takes as long**: an address with no account is verified against a dummy
  Argon2id hash with the same parameters, so the response time does not answer
  the question the message refuses to.
- **No password, hash, token, cookie or request body ever reaches a line**, and
  the writer drops those keys defensively rather than relying on its own type
  to have no field for them. A credential in a log is a credential in every
  copy, rotation and backup of that log. The same holds for the *other* log,
  the server-fault lines below: a Prisma error is written through
  `describeError` (`src/server/log-error.ts`), because Prisma's own message
  is the failed call with its arguments.
- **A sign-in line names the account by a tag, never by the address it
  tried.** `auth.signin.failed` and `auth.signin.throttled` used to carry
  `email` in plain text, for every well-formed address anybody submitted —
  a member's typo, a neighbour, a credential-stuffing list — people the
  database never holds, kept for as long as the container's output and in
  every paste of `docker compose logs` (security review, 2026-10-12). They
  now carry `account`: the first 16 hex characters of an HMAC-SHA256, keyed
  with `STOKY_SECRET`, over `stoky-log-account:` and the address trimmed
  and lowercased (`src/lib/account-tag.ts`). Keyed rather than a plain hash
  because an address is guessable: without the secret, a pasted log cannot be
  checked against a list of likely addresses. `email` is one of the keys the
  writer drops, so no caller can put the address back, and every value is cut
  to 200 characters, because some of them are chosen by whoever sent a
  request that was refused. To find one person's lines, compute their tag in
  the installation directory and grep for it:

  ```bash
  printf 'stoky-log-account:%s' 'ana@example.org' \
    | openssl dgst -sha256 -hmac "$(sed -n 's/^STOKY_SECRET=//p' .env)" \
    | cut -d' ' -f2 | cut -c1-16
  ```

  Type the address in lowercase. The command reads the secret as `install.sh`
  writes it, without quotes; a value quoted by hand in `.env` gives a tag that
  matches nothing. **Rotating `STOKY_SECRET` changes every
  tag**, so lines from before a rotation do not match lines from after it.
  Lines written before this change keep the address they were written with
  until the log holding them is removed.
- **Better Auth writes nothing for a refused sign-in.** At its default level
  it writes a warning for every wrong password and unknown address;
  `src/lib/auth/instance.ts` sets its logger to `error`, writing one
  `[auth] <level> <message>` line, never the arguments, with the message cut
  to 300 characters and its whitespace collapsed. Measured
  through the route on 2026-10-15 (PROGRESS D135), against what next-auth
  wrote for the same request: a wrong password, 0 lines from the library and
  the one `auth.signin.failed` line of about 117 bytes (next-auth: 1 line and
  99 bytes beside it); a session cookie whose signature does not verify, 0
  lines (a `JWTSessionError`, 10 lines and 988 bytes); an endpoint nobody
  allowed, 0 lines (an `UnknownAction`, 1,252 bytes). Two refusals still
  write. A cookie-bearing sign-in from a foreign origin: one
  `[auth] error Invalid origin: …` line of at most 313 bytes, the origin
  being the caller's choice. And a passkey answer the verifier refuses: one
  `[auth] error Failed to verify authentication` line of 45 bytes, beside the
  `auth.passkey.signin-failed` security line (about 127 bytes for an IPv4
  address; measured 2026-10-16). There Better Auth 1.7.7 hands the logger the
  `@simplewebauthn/server` error, which quotes the origin the answer was
  signed for; dropping the arguments is what keeps it out.
  `integration/security-log.test.ts` signs in with ten wrong passwords and
  finds ten security lines and nothing else on any console stream; its
  `what the auth library writes` block reads every console method through an
  unknown address, a refused authenticator code, that refused passkey and a
  sign-out, and finds no line naming the address, its local part, the
  password, the code, the authenticator secret, the origin or a session
  token. Of the four, only the passkey writes a line of the library's. A
  failure of the server's own — a database that does not answer — is still
  written, as one line with the error's name and message.

Verified in a browser, not only by test: five wrong passwords are refused as
wrong, the sixth is refused as rate-limited, a *correct* password is still
refused while the window is open, and the counter carries a TTL so the refusal
expires. The counting itself is proven against a real Valkey in
`src/__tests__/integration/rate-limit.test.ts`.

### The session signing key cannot be the example one

`STOKY_SECRET` signs the session cookie, and Better Auth only warns about a
weak one — so until Phase 7's slice nothing in this application had looked at
what it was. `.env.example` ships a placeholder, and that placeholder is
**published in this repository**: an instance deployed without changing it
signs sessions with a key anybody can read, and nothing about the running
system looks wrong.

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
- **The key it checks is the key that signs.** `src/lib/auth/instance.ts`
  hands Better Auth `STOKY_SECRET` twice: as `secret`, and as the one entry
  of `secrets` (`[{ version: 1, value }]`). Left to itself Better Auth reads
  `BETTER_AUTH_SECRETS`, then `BETTER_AUTH_SECRET`, then `AUTH_SECRET`; with
  `secrets` named it never reads the first, and with `secret` named the other
  two never fill its legacy fallback. Those variables are therefore ignored,
  not refused, and the server says so: each one that is set gets an
  `[auth] warning: … is set and ignored` line at start-up naming the variable
  read instead, never its value (PROGRESS D136; `BETTER_AUTH_URL` and
  next-auth's `AUTH_URL` likewise, since `STOKY_URLS` is what is read).
  The guard, `/api/health`, the account tag and the instance all read the key
  through one function (`configuredSecret`), so they cannot disagree about
  which variable it came from.
  The same bug was found under next-auth on 2026-10-12, where
  `AUTH_SECRET` won over `NEXTAUTH_SECRET` while the guard and `/api/health`
  read only the latter: a valid `NEXTAUTH_SECRET` beside `AUTH_SECRET=changeme`
  started, answered healthy, and signed every session with `changeme`.
  `src/__tests__/unit/auth-secret.test.ts` builds the instance in a fresh
  production process with `STOKY_SECRET` beside `BETTER_AUTH_SECRETS`,
  `BETTER_AUTH_SECRET` and `AUTH_SECRET` all set to something else, and reads
  back the key it signs with: `STOKY_SECRET`. Outside production, with no
  key set, it signs with a random 32-byte key for the life of the process and
  says so once, so a restart signs everybody out.
- **Its name is ours.** Until D137 it was `NEXTAUTH_SECRET`, a name a library
  reads on its own, as `AUTH_*` and `BETTER_AUTH_*` are; that is how
  `AUTH_SECRET` came to win above. The old name is not read (D152): an
  `.env` that still has it refuses to start with `STOKY_SECRET is not set`.
  An empty value is unset, as Compose passes it, and the bundle's Compose
  file passes `STOKY_SECRET` through, so the application, not Compose,
  refuses an empty one.
- **Rotating it signs everybody out** and changes every account tag in the
  security log. Better Auth's versioned keys are not used beyond that single
  version-1 entry, so there is no window in which an old key still verifies.
- **Production only.** Development and the suites use whatever is to hand;
  refusing there would trade a risk nobody faces for an obstacle everybody does.
- **Not during `next build`.** The image is built without a runtime secret and
  receives one when the container starts, so asserting at build time breaks
  `docker build` — which the first version of this guard did, and which is a
  worse outage than the one it prevents.

---

### Registration closes after the first account

`auth.register` is one of the two procedures anybody who can reach the instance
may call. Until 2026-10-12 nothing let an operator close it (security review,
2026-10-12): every stranger who registered got receipt upload and OCR, an
upload volume nothing cleans, and every unmetered procedure, and tenant
isolation became the only thing between them and the owner's household.

`STOKY_REGISTRATION` (`src/lib/auth/registration.ts`) takes `open`,
`first-user` or `closed`. **Unset, it is `first-user` in production** and `open`
elsewhere, and the release bundle passes `${STOKY_REGISTRATION:-first-user}`
explicitly. A household does not need open registration: an admin adds people
through `household.addMember`, which the setting does not govern.

- **Parsed strictly.** An unknown value is `closed` at run time, never `open`,
  and in production the server refuses to start over it, from the same
  instrumentation hook and in the same way as the signing-key guard above. Both
  problems are reported before the exit.
- **In this order**, in `auth.register`: `closed` refuses with `FORBIDDEN`
  before the rate limiter and before any query; then the per-address limiter;
  then, in `first-user`, a count of accounts, before the existence check, so a
  refusal says nothing about whether an address is registered; then the
  existence check and the Argon2id hash. Every refusal is an `access.denied`
  line in the security log, with the path `auth.register`.
- **The first-user count cannot race.** The account is created in a
  transaction that holds a PostgreSQL advisory lock
  (`pg_advisory_xact_lock`) and counts again under it, so two people claiming a
  fresh instance at once cannot both see zero. The household is written first,
  then the account and then its credential `Account` row, which holds the
  password hash, all in the same transaction, so a failure at any step rolls
  back every earlier one; before this, a registration that failed after its
  household was written left a household nobody belonged to, and a user row
  without its credential could neither sign in nor be registered again.
- **`/register` says so before anyone types.** The page is a server component
  that asks the same rule after `connection()`, so the answer is the running
  container's and not the build's, and renders a page saying registration is
  closed in place of the form, without needing JavaScript. It counts accounts
  only in `first-user`, so a visitor to a `closed` instance causes no query.
  The page decides what to show and guards nothing; `auth.register` refuses on
  its own. The sign-in page still links to `/register`, which now explains
  instead of refusing after submit.
- **Tested against PostgreSQL** on a database of its own
  (`src/__tests__/integration/registration.test.ts`): `closed` refuses
  everyone without touching the database; `first-user` admits exactly one;
  two simultaneous claims leave one account and one household; a registration
  waits while the lock is held and is then refused; a credential row that
  cannot be written leaves no user, account or household behind. Removing the
  re-count, the lock, the `closed` branch, or the nested household each turns
  a test red.

What is still open:

- **The claim window.** On a fresh installation, whoever reaches `/register`
  first owns it, and the hostname is public from the moment its certificate is
  issued, through Certificate Transparency logs. [The installation
  guide](docs/INSTALL.md) says to register immediately, and to start again from
  empty volumes if someone else did. A one-time setup token printed to the logs
  would close the window; it is not built.
- **`open` is still what it was.** An installation that sets it accepts
  strangers, and registration still reveals whether an address has an account.

---

### The password policy prefers length, and it is not a breach check

`src/lib/validations/password.ts` is the policy, and it is applied wherever a
password is *set*: registration, the accounts an admin creates for a
household, an admin setting a member's password
(`household.resetMemberPassword`), and a person changing their own. Twelve characters minimum, a
maximum of 128, a refusal of the handful of passwords that appear at the top
of every leak, and a refusal to accept the account's own name or address as
its password.

**The identity refusal was documented here before it was applied** (security
review, 2026-10-12). `newPasswordSchema` is a field schema and cannot see the
name and address beside it, so it checked with no identity at all, and both
`registerSchema` and `addMemberSchema` accepted `noelgarate2026` for
`noelgarate@example.com`. `withIdentityRule` in the same file now wraps both
forms with an object-level check that attaches the refusal to `password`; the
register page and the add-a-member form name it in words rather than as a
generic failure. A procedure whose input carries no name or address has to
load the person and check against them itself: `auth.changePassword` and
`household.resetMemberPassword` do.

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
- **The identity check is a substring match, not a guess at variations.** It
  refuses a password containing the address's local part or the whole name,
  case-insensitively, and ignores either when it is shorter than three
  characters. For `ng@example.com` named "Noel Garate", `noel garate cocina` is
  refused and `noel en la cocina` is accepted: a first name alone is not the
  name. Growing it into token or fuzzy matching would start refusing ordinary
  words that happen to be somebody's name.
- **The policy is not applied to an existing password at sign-in**, beyond the
  maximum. A verifier that refused a stored password because the rule changed
  would lock people out of their own household.

The maximum is not a usability rule at all: `argon2.hash` and `argon2.verify`
were both taking unbounded input on two endpoints reachable without an account,
at 64 MB per call. A body of a few megabytes turned registration into a memory
amplifier — the rate limiter bounds how often, not how much. The password was not
the only unbounded field on those endpoints: the address, the name and the
household name were bare strings too, and a failed sign-in wrote the address
it was given into the security log, whatever its length. All three are bounded
now, with every other input (see *Input validation* above).

**At sign-in the maximum is Better Auth's, not this schema's.** Since the move
to Better Auth the sign-in route (`src/server/http/auth-handler.ts`) checks
only that the password is a string and runs no Stoky schema over it;
`loginSchema` still names the bound, but nothing on that path reads it. The
bound holds because `src/lib/auth/instance.ts` sets Better Auth's
`maxPasswordLength` to `MAX_PASSWORD_LENGTH`, and Better Auth refuses a longer
password with `PASSWORD_TOO_LONG` before it looks the account up — so before
Argon2id runs. The login form reads that code as wrong credentials. That this
holds at the route, and that a password of exactly 128 is still checked, is
`auth.flow.test.ts` (*refuses a password over the maximum before Argon2id
runs*), which goes red if the setting is raised or lowered by one.

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

"The original" is not written verbatim when it is Prisma's. Prisma 6 renders a
`PrismaClientValidationError` as the whole call, argument values included —
measured on 6.19.3, with `errorFormat: "minimal"` as well, a `user.create`
that fails validation prints the email, the name and the Argon2id hash it was
writing — and Bun's `error.stack` and `console.error` repeat the message and
the error's `meta`, where a raw query's Postgres error quotes the input it
refused. No request reaches such a validation failure today (Zod leaves no
typed field for one), so this was a latent leak a future bug would have
opened. `describeError` (`src/server/log-error.ts`) now reduces a Prisma error
to its class, code and client version, the call that failed and the file it
was made from, the last line of a validation error (which names the argument
and the expected type, and in every case measured not the value), the names of
the `meta` keys, a raw query's SQLSTATE, and the stack frames, less any line
that is also a line of the message, since a raw query's input can carry its
own "    at "; an initialisation error keeps its
message, the "database is down" line, which names host and port but not the
credentials. Anything that is not a Prisma error is logged as before. The
tRPC `errorFormatter`, the receipt pipeline's background processing and the
start-up sweep of receipts a restart interrupted all log through it; `src/__tests__/unit/log-error.test.ts` checks each kind.
So do the two auth lines that write an error as text, through
`describeErrorLine` — the first line of the description, flattened and still
cut at 300 characters: what Better Auth's router writes when an endpoint
throws (`onAPIError.onError` in `src/lib/auth/instance.ts`; the Prisma
adapter rethrows the client's errors as they are) and what a failed sign-in
tidy or session ending writes (`quietly` in `src/server/http/auth-handler.ts`,
whose tidy passes the new session's token as an argument). Both had written
`name: message` until 2026-10-16; `unit/auth-log.test.ts` and
`unit/auth-handler.test.ts` feed each a validation error carrying a marker and
went red with the marker on the line before the change.

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
`src/lib/auth/session.ts` declares `role` on the session the application reads
(`AppSession`) non-optionally;
`src/server/trpc/trpc.ts` defines `CAPABILITY_ROLES` and three enforced tiers,
where `writeProcedure` refuses `KITCHEN` and `adminProcedure` refuses `MEMBER`;
and all 72 procedures are assigned, with `src/__tests__/unit/capabilities.test.ts`
pinning every one against the matrix rather than sampling, and failing when the
count in this sentence stops matching the router's. Membership and role
are read from the database on every call rather than from the session, so a
demotion takes effect on the next request.

The real limit is one level down and is recorded in `docs/SECURITY_REVIEW.md`
§2: the tier answers *may this role do this*, not *may this caller touch this
row*, and the second was not uniform. Four instances of that were found and
fixed; a test now fails on the shape of them.

### A device keeps the last account's data while it stays offline

Opening without a signal is a requirement, so a copy of household data lives
on every device that has used the app: the cached shell (the service worker's
copy of six pages, which carry no household data), the write queue
(`stoky.queue.v1.<account>`), and the **saved reads** — the seven allowlisted
queries in `PERSISTED_QUERIES` (`src/lib/offline/persist.ts`: the shopping
lists, the stock overview, expiring and expired items, the product list),
stored in `localStorage` under `stoky.reads.v1.<account>`.

What removes them:

- **Signing out** — **Cerrar sesión**, or ending a set of sessions that
  includes this device's from **Tus dispositivos**, both through
  `useEndSession` — clears the memory cache, the queue, the saved reads and
  the shell before it leaves. Changing the password no longer does: it keeps
  this device signed in, and what is stored is the same person's (D144).
- **Reaching `/login` with the network up** — where an expired or ended
  session is sent — clears the previous account's saved reads, its shell and
  the memory cache (`ShellCacheGuard`). So does a different account signing
  in on the device. The queue is kept, because an expired session is asked to
  sign in again and its unsent changes are what it signs in to send. Until the
  security review of 2026-10-12, `/login` left the saved reads in place, and
  an account that never signed in on that device again left them there
  indefinitely: TanStack removes an expired copy only when the same account
  restores it. A device updated from before then may hold such a copy under
  a key nobody recorded as the last account's, so the guard also sweeps every
  saved-reads key but the signed-in account's — all of them on `/login` — on
  each run (`forgetPersistedReadsExcept`). A browser holds one session at a
  time, so no other account's copy could be restored without that account
  signing in, online.

What does not:

- **Ending a session ends its row, not the device's copy.** Expiry, the
  day's ceiling, **Cerrar todas** in **Tus dispositivos** and an
  admin in **Personas del hogar** all work on the server. A device that is not
  online never hears of it: opened offline, or when a navigation takes longer
  than the service worker's 2.5 seconds, the cached shell renders and the
  saved reads appear without anybody signing in. That is the offline
  requirement working, not a defect in it — and it cannot be gated on the
  session's expiry, which on an offline device is nearly always in the past
  (the token lapses after fifteen idle minutes).
- **The 24-hour `maxAge` is not a bound on how old the copy can be.** TanStack
  stamps the time on every save and every open saves — the invalidation after
  a restore is enough — so a device opened offline at least once a day keeps
  its copy for as long as that continues. Measured: a copy stamped 23 hours
  earlier, restored with nothing able to reach a server, was saved back
  stamped with the current time.
- **Blocked storage** means the guard cannot tell who was here, and forgets
  nothing (the in-memory cache is still emptied on `/login`).

So for a lost or shared device: end its sessions, and expect it to keep what
it last saw until it next reaches the network. The device's own lock screen is
what protects that copy; on a shared tablet, sign out rather than walk away.
What would change this is encrypting the saved reads under a key the server
releases only to a live session — which is the same as not reading them
offline.

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

### One address can hold Traefik's connections open

Nothing in the bundle limits how many connections one source address keeps
open. The 2026-10-12 audit measured 4,000 TLS connections from one client, each
holding an unfinished request line, taking the Traefik container from 17.5 MiB
to 192.9 MiB of its 256 MiB (not re-measured since). Past that the container is
killed and restarted, and the instance is unreachable for as long as the
sockets are held. No account and no application request are needed.

Shorter timeouts do not close this. A client that reopens what expires needs
about 88 new connections a second to keep 5,300 open against a 60s
`readTimeout`, and about 350 against 15s; both are easy from one host, and 15s
would break slow receipt uploads (above). Traefik cannot cap connections per
address on an HTTP router: `inFlightConn` exists only for TCP routers, and in
the HTTP section of the dynamic file Traefik v3.7.13 rejects the whole file
("field not found, node: inFlightConn", measured in the audit), so the `stoky`
router disappears and every request gets 404. `inFlightReq` is valid there but
runs only once the request headers have arrived, which the held connections
never send. The memory limit stays: it is what turns the attack into a Traefik
restart instead of memory pressure on the whole host.

A per-address connection cap belongs in front of Traefik: the host firewall
(nftables `ct count over N` per source address on TCP 443, or iptables
`connlimit`), or a CDN or tunnel that does its own. The project ships no rule
and has not tested one. Leave room for a household: its phones and laptops
usually share one public address, and every browser opens connections of its
own.

### Other things that do not exist

- No hosted error tracking or monitoring. `/api/health` checks the database/cache.
- Settings exports household JSON, without receipt files or a restore importer.
  Full backups remain the operator's job; [the guide](docs/INSTALL.md) covers them.
  Only an admin can export, and the file is not a copy of everything held
  about one person ([*What the JSON export does not include*](#what-the-json-export-does-not-include)).
- Refusals are audit-logged, but there is no complete history of who changed what.
- No account or household deletion in the application. Removing somebody from
  a household keeps their account and ends its sessions (D146). The operator
  deletes an account in the database
  ([Install](docs/INSTALL.md#deleting-somebodys-account)), which
  leaves its id on the stock movements and receipts it recorded, and its
  receipt photographs until they are removed by the command given there.
  Nothing deletes a household (ASVS 4.0.3 V8.3.2, security review 2026-10-12).
- No invitations: with registration closed, an admin sets a new person's first
  password and hands it over. The person can change it from Settings →
  *Seguridad y acceso* once signed in; nothing makes them.
- No permanent account lockout — but the per-account sign-in limit is a
  temporary one that a stranger can renew every fifteen minutes against a
  browser that has never signed in to the account (see *Rate limiting* above
  for the known-device budget that keeps it off the rest).
- No email verification and no self-service password reset: there is no
  email to send a link to. A forgotten password is set again by a household
  admin; an owner's by another owner or, for a sole owner, by the operator in
  the database. (Two-step verification and passkeys exist since 2026-10-15,
  PROGRESS D148 and D151, and ending one other device's session since D143:
  *Authentication* above.)
- No secret scanning or SAST of the source in CI. `ci.yml` and the weekly
  `rescan.yml` are the only workflows; Trivy scans images, and zizmor the
  workflows, not the source. Secret scanning, push protection and CodeQL are
  repository settings instead (see *Supply chain*), and on 2026-10-12 all
  three were off.
- **CI's test containers are pinned by tag, not digest.** zizmor's `auditor`
  persona, which is not the gate, reports five `unpinned-images` findings in
  `ci.yml`: the `test` and `e2e` jobs' PostgreSQL and Valkey services and the
  Playwright container. They run test code only and never reach an image or a
  release, but a moved tag changes what CI tests against. The same persona
  also wants a comment beside the granted permissions in four jobs and a
  concurrency group in `rescan.yml`: ten findings on 2026-10-12, every one of
  them suppressed by the gate's `regular` persona.

### What the 2026-10-12 review accepted

The 2026-10-12 review ([`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md#the-2026-10-12-review))
fixed what it could and accepted the rest. These are the risks it accepted. Each
has the reason, and what would change the decision; most are described in
full in the section named.

- **A new browser can still be kept out by someone who knows the address.**
  The shared per-account budget is what bounds a distributed guess, so it stays
  shared for browsers that have never signed in; known browsers have their own
  ([*Rate limiting*](#rate-limiting-covers-authentication-and-the-expensive-calls-not-the-rest)).
  The operator clears it by hand. An email channel would change it. Since
  2026-10-15 a passkey does, for whoever has one: a passkey sign-in is
  charged per address only (PROGRESS D151), since it names no account and
  cannot be guessed, so a person with a passkey signs in past an exhausted
  per-account password budget, on an instance where passkeys are offered.
  Two-step verification (D148) does not: the password step is charged per
  account before a code is asked for.
- **The first-user claim window.** Whoever reaches `/register` first on a fresh
  installation owns it; register at once, and start again if somebody else did
  ([*Registration closes after the first account*](#registration-closes-after-the-first-account)).
  A one-time setup token would close it, and is out of proportion for an alpha.
- **An address's existence is visible** through `register` under
  `STOKY_REGISTRATION=open` and through `addMember` to an admin. `first-user`
  closes the first after the first account; the second is admin-only and
  metered, and a uniform answer would hide real errors from the household's
  own admins.
- ~~**No per-session sign-out.**~~ Closed by PROGRESS D135 and D143
  (2026-10-15): sessions are database rows, and signing out deletes this
  device's, so a copied cookie is refused at once; **Tus dispositivos**
  (`/settings/security`) lists every session and ends one, every other or
  every one, after the password.
- **IPv6 clients share the bridge gateway's budget by default.** IPv6 on
  Traefik's network is an opt-in, because enabling it breaks older Docker
  engines, hosts without IPv6 and existing networks; /64 grouping applies once
  it is on ([Install](docs/INSTALL.md#clients-on-ipv6)).
- **No proxy-level cap on connections per address.** Traefik cannot put one in
  the HTTP chain; the idle timeout is shorter and host-level limits are
  documented ([*One address can hold Traefik's connections open*](#one-address-can-hold-traefiks-connections-open)).
- **An unauthenticated client can rotate the app's log out.** One refusal line
  per anonymous request and the 50 MB cap bound the disk and the
  amplification, not the volume of requests. Shipping logs off the host is the
  defence ([*Refusals are recorded*](#refusals-are-recorded)).
- **The application connects to PostgreSQL as the bootstrap superuser, and
  Valkey has no password.** Neither publishes a port; both sit on an internal
  network, so abusing either needs code execution inside a container already.
  Separate migrator and runtime roles, or `requirepass`, need new secrets and
  manual steps on existing volumes; the next breaking bundle change is the
  time for them.
- **Traefik runs as root inside its container**, with every capability
  dropped, `no-new-privileges` and a read-only filesystem. Running it as
  another user means chowning the existing ACME volume on every installation.
- **Secrets reach the containers as environment variables**, not `_FILE`
  secrets. Reading them takes `docker inspect`, which takes the Docker daemon,
  which is root on the host ([*Secrets*](#secrets)).
- **Next's preview-mode id and Server Action key are baked into the public
  image.** Nothing uses draft mode, revalidation or a closure-bound action, and
  a test fails if one appears ([*Keys `next build` writes into the image*](#keys-next-build-writes-into-the-image)).
- **No per-household storage quota, and uploaded photographs are never
  deleted** (`ISSUES.md` UPLOAD-1, Phase 7 finding 16). Uploads are metered and
  bounded per file; a quota needs a schema change, accounting and a screen.
  Revisit before any open-registration or multi-tenant use.
- **No `CHECK` constraints in the database** (`ISSUES.md` DB-1). Zod bounds
  guard every write path; a constraint migration needs a data audit first.
- **No account erasure in the application.** The operator is the data
  controller and has the database; the runbook is in
  [Install](docs/INSTALL.md#deleting-somebodys-account). In-app erasure needs
  decisions about shared household records.
- **Saved offline reads stay on a device for up to 24 hours** until the app is
  next opened after a change of session
  ([*A device keeps the last account's data while it stays offline*](#a-device-keeps-the-last-accounts-data-while-it-stays-offline)).
  Encrypting `localStorage` would not resist a local attacker.
- **Plain-HTTP LAN installations stay supported** (D84): the server warns at
  start-up instead of refusing, and the weaker guarantees are documented under
  *Authentication* and *Cross-site requests*. They have no passkeys (D151):
  browsers offer WebAuthn only to https or `localhost`, and the security
  screen says so in place of the button.
- **Trivy does not inventory the Bun binary**, so a Bun advisory is invisible to
  the image scans. The version is tracked through `.bun-version` and
  Dependabot's `docker` updates, and each update reads Bun's security notes.
- **`master`'s `latest` image is still built with the Actions cache.** Releases
  are built without it, scanned at the pushed digest and attested; `latest` is
  not an installation channel.
- **`v0.1.0-alpha.1` and `v0.1.0-alpha.2` have no attestations and their
  releases stay mutable**, and a promoted release image's OCI version label
  reads `candidate-v…`. Attestations and immutable releases are not
  retroactive; the label is cosmetic, and the promoted digest is the one that
  was smoked, scanned and attested.
- **Nothing tests that the caller's own row has no reset button, and a
  self-reset would be reported as "too easy"** (`ISSUES.md` TEST-9). Deferred
  by the final review of the branch that added the reset: the server refuses a
  self-reset and the people screen offers none today, so this is a missing
  test and a wrong message waiting for a regression, not a way in. A test that
  goes red without the screen's `me.data.id !== member.id` check, and
  `resetRefusalOf` giving the self-reset refusal its own answer, close it.

---

## Personal data, outbound connections and secrets

Whoever runs an instance holds its members' data and answers for it, so this
section lists what the instance keeps, what it contacts and how its secrets
are handled (security review, 2026-10-12). Update it when a change alters what
is stored, logged or sent.

### What an instance holds, and for how long

| Data | Where | How long |
|---|---|---|
| Accounts: email address, name, role, language and display preference | PostgreSQL `User`, on the `postgres_data` volume | Until it is deleted in the database ([Install](docs/INSTALL.md#deleting-somebodys-account)). The application cannot delete an account. Removing somebody from a household clears their household and keeps the rest of the row |
| Each account's Argon2id password hash, in its `credential` row: the account id, the hash and when the row was written | PostgreSQL `Account`, on the `postgres_data` volume | As long as the account. The database deletes the row with its `User` row (a cascade, PROGRESS D134), so no hash outlives its account |
| Sessions, one row each: the account id, the session token (the value the cookie signs), when it expires, was created, last written and was signed in, whether it is remembered, the browser's User-Agent string, and the `stoky_device` cookie value the sign-in carried (`deviceId`, D143), which the list of a person's sessions joins to `ScreenChoice` and never returns. No IP address: Better Auth's address tracking is off, so `ipAddress` stays null | PostgreSQL `Session` | Until the session ends: signing out, ending sessions (one's own, a member's, or the whole household's, D147), a password being set, removal from the household (D146), signing in again in the same browser, an eleventh session ending the least recently used one (D140), or the account's deletion (a cascade) delete it, and an expired row is deleted the next time its cookie is read or the account next signs in (D139). A row whose cookie is never sent again stays, expired, until one of them happens. At most fifteen idle minutes and a day in all for a live browser session (PROGRESS D135); ninety idle days and a year in all for a remembered one (D141) |
| Each passkey a person adds (D151): the account id, the credential's id and public key, its signature counter, whether it can sync to the person's other devices and is backed up, the transports the browser named, when it was added, the name the person gave it, and its AAGUID — the make of authenticator or password manager, never the device or the person | PostgreSQL `Passkey` | Until the person removes it, or the account's deletion (a cascade, like `Account`). Not in the JSON export |
| A confirmed password, for five minutes after it is re-entered before a passkey is added or removed (D151): the session's id and the account id | PostgreSQL `Verification` (`stoky-step-up:…`) | Until the change spends it, its session ends, or it lapses |
| Each account's authenticator, once two-step verification is set up (D148): the account id, the TOTP secret, encrypted with `STOKY_SECRET`, the unused backup codes as SHA-256 hashes (D149), whether the first code has been accepted, the count of wrong codes in a row and the lockout's end, and the last time step a code was accepted for | PostgreSQL `TwoFactor` | Until two-step verification is removed, or the account's deletion (a cascade, like `Account`). Not in the JSON export |
| Better Auth's short-lived values: an identifier, a value and an expiry. Today, a two-step sign-in in progress (the account id, under a random identifier) and its count of wrong codes | PostgreSQL `Verification` | Ten minutes, or until the code is accepted, the challenge has had five wrong codes, or the account's sessions are ended (D148). An expired row stays until it is next read |
| The household's things: products, stock movements (each one records the member who made it, and can carry a free-text note), locations, stores (a name and an optional address), price records and shopping lists | PostgreSQL | Until somebody deletes them in the application, where it allows that, or in the database. Price records and stock movements add up to the household's purchase history |
| Receipts: the photograph, re-encoded as a JPEG with no EXIF or GPS data; the OCR text of the whole ticket (`rawOcrText`), which can include a masked card number, a loyalty number and the cashier's name; the text of each line; the store, date and total; and the member who uploaded it | The photograph on the `uploads` volume, everything else in PostgreSQL | Indefinitely. Nothing in the application deletes a receipt or its photograph (`docs/SECURITY_REVIEW.md` finding 16). The photographs a deleted account uploaded can be removed by hand ([Install](docs/INSTALL.md#deleting-somebodys-account)) |
| Which screen each person opens on each device: an account id, the `stoky_device` cookie value and the chosen screen | PostgreSQL `ScreenChoice` | Indefinitely. Deleting the account as [Install](docs/INSTALL.md#deleting-somebodys-account) describes deletes its rows; deleting the `User` row alone leaves them (`prisma/schema.prisma`) |
| Offline replay records: account, household, procedure, a hash of the request and the ids of the rows it wrote | PostgreSQL `MutationReplay` | 90 days (`REPLAY_RETENTION_DAYS`). An expired row is deleted the next time the same account sends a replayable write, so an account that stops writing leaves its rows behind |
| The security log: time, event, the client's full address, account and household ids, procedure, and for a sign-in the keyed tag of the address that was tried ([*Refusals are recorded*](#refusals-are-recorded)) | The `app` container's log | Until rotation removes it. Each container keeps at most 50 MB of log, so how far back it reaches depends on traffic ([Install](docs/INSTALL.md#logs)) |
| An email address entered a second time. PostgreSQL logs `DETAIL: Key (email)=(…) already exists` with the address in full when an admin adds a member whose address already has an account, or when two registrations of one address race. Query values are sent as bind parameters, so no other value reaches this log | The `db` container's log | As above |
| Rate-limit counters, each with its key. The key is the client's IPv4 address or IPv6 /64 for the per-address sign-in and registration limits. It is the first 32 hex characters of an unkeyed SHA-256 of the address that was tried for the per-account sign-in limit, followed by a SHA-256 fingerprint of the `stoky_device` id when the browser has signed in to that account before. It is the account id for the metered actions, and the session id for the per-session budget of a re-entered password (D143) | Valkey memory, saved to `dump.rdb` on the `valkey_data` volume | The limit's window: 15 minutes or an hour. A snapshot taken during the window keeps a counter until the next snapshot replaces it. Under the release bundle's command line, the pinned Valkey saves at least once an hour while anything changes (`CONFIG GET save` answers `3600 1 300 100 60 10000`, measured 2026-10-12) |
| Known devices: for each account (keyed by the same unkeyed hash), SHA-256 fingerprints of up to 20 `stoky_device` ids | Valkey | A year after the last successful sign-in from that device |
| The Open Food Facts cache: product data, keyed by barcode alone, with nothing about who scanned the code | Valkey | 30 days. A day for a code Open Food Facts does not know |
| Certificates: the ACME account key, `ACME_EMAIL`, and the certificates with their private keys | `acme.json` on the `letsencrypt` volume | Until the volume is removed |
| On each device: the saved reads, the write queue, the `stoky_device` cookie, and while signed in the `stoky.session_token` and `stoky.dont_remember` cookies (`__Secure-` prefixed behind https) | The browser's storage | See [*A device keeps the last account's data while it stays offline*](#a-device-keeps-the-last-accounts-data-while-it-stays-offline). The device cookie lasts a year; the session cookies end with the browser, and are refused once their row has gone |
| Backups made with [the documented commands](docs/INSTALL.md#backup-and-restore): the database dump (every PostgreSQL row above, password hashes included), the uploads, `.env`, and the Compose and Traefik files | Wherever the operator puts them | As long as the operator keeps them. Nothing in Stoky rotates or expires a backup, and a backup still holds accounts and receipts deleted after it was taken. Valkey, the logs and the certificates are not in it |

Two hashes in that table are weaker than they look. The security log's
account tag is keyed with `STOKY_SECRET`, so a pasted log line cannot be
checked against a list of likely addresses. The Valkey account hash is not
keyed. Anyone who can read the Valkey data can confirm whether a guessed
address has tried to sign in during the window, or has a known device.

No request body or receipt text reaches a log. Traefik has no access log: the
release bundle does not pass `--accesslog`, so the proxy does not record
requests.

### What the JSON export does not include

**Configuración → Descargar tus datos** is `data.exportHousehold`
(`src/server/trpc/routers/data.ts`). Only an OWNER or ADMIN can use it, and it
covers the whole household: the household itself; its current members (id,
email address, name, role, language and creation date); its locations and
stores; its products, each with its stock movements and price records; its
receipts, each with the photograph's path and each line's text; and its
shopping lists. It leaves out:

- password hashes, always, and every other way a member signs in: the
  authenticator secret and backup codes, and passkeys;
- receipt photographs, which it gives only as paths, and each receipt's
  whole-ticket OCR text (`rawOcrText`). The file says so in its `notes`;
- who uploaded a receipt and who made a stock movement;
- each product's Open Food Facts data and image address;
- members' display preference and the time their sessions were last ended;
- people who have been removed from the household;
- the landing-screen choices and the replay records;
- everything in Valkey, the logs and the certificate store.

It is therefore not a complete copy of what the instance holds about one
person, and a member who is not an admin cannot export at all. There is no
per-person export or account deletion. If a person asks the operator for their
data, the operator answers from the database and the uploads volume. If they
ask to be erased, [Install](docs/INSTALL.md#deleting-somebodys-account) deletes
the account in the database and lists what stays. Either way the operator also
has to account for the backups.

### Outbound connections

What an instance contacts on its own, as released:

- **The server calls the Open Food Facts API**, `world.openfoodfacts.org`,
  over HTTPS, for a scanned barcode that neither the household's own products
  nor the shared cache can answer (`src/server/services/openFoodFacts.ts`).
  A call sends the barcode, the instance's IP address and the User-Agent
  `Stoky/<version> (+https://github.com/NGarate/stoky)`. It sends nothing
  about the account or the household. Calls are metered at 60 an hour per
  account and give up after 5 seconds. This is the only outbound `fetch` in
  `src/`.
- **The browser loads product photographs from `images.openfoodfacts.org`**,
  on the product page. Open Food Facts sees the viewer's IP address and
  browser, but no `Referer`: the image carries `referrerPolicy="no-referrer"`,
  and the page sends `Referrer-Policy: same-origin`. It is the only other
  origin the CSP allows, and only in `img-src`. `connect-src` is `'self'`. The
  product page's links to `world.openfoodfacts.org` are navigations, made only
  when somebody follows one.
- **Traefik contacts Let's Encrypt** over ACME to obtain and renew the
  certificate, and registers `ACME_EMAIL` there. Its version check and its
  anonymous usage statistics are both off ([*Release deployment*](#release-deployment--deploydocker-composeyml)).
- **Nothing else, and no telemetry.** Stoky reports nothing to the project or
  to anybody else: there is no analytics, no error tracking and no update
  check. Better Auth's telemetry is off in its configuration, and a
  `BETTER_AUTH_TELEMETRY` that would turn it back on stops the server at
  start-up rather than send (`src/lib/auth/environment.ts`, PROGRESS D136).
  The OCR model is part of the image (`TESSDATA_PATH`). Fonts come from
  the instance itself (`font-src 'self'`). The image sets
  `NEXT_TELEMETRY_DISABLED=1`. PostgreSQL and Valkey sit only on the
  `internal: true` network, which has no route out.

**One exception, which the release bundle prevents only by accident.** The
image's start command runs `prisma migrate deploy`. Unless
`CHECKPOINT_DISABLE` is set, Prisma's CLI starts a background check against
`checkpoint.prisma.io` that sends, among other things, Prisma's and the
runtime's versions, the OS and architecture, the schema's database provider,
hashes of the project and CLI paths, and the command line. The image does not
set the variable. Under the release bundle, and the source overlay that
inherits it, the application's root filesystem is read-only. The CLI fails to
create its cache directory (`EROFS` on `/home/bun/.cache`) before it would
send, so nothing leaves. Measured on 2026-10-12 against an image built from
this tree, with `checkpoint.prisma.io` resolved to a listener on an internal
network:

| How the container ran | Result |
|---|---|
| Read-only, as in the bundle | No connection |
| Writable, for example a plain `docker run` | A TLS ClientHello for `checkpoint.prisma.io` at start |
| Writable, with `CHECKPOINT_DISABLE=1` | No connection |

An operator who runs the image any other way should set
`CHECKPOINT_DISABLE=1`. Setting it in the image itself is still to do.

### Secrets

`.env` holds `POSTGRES_PASSWORD` and `STOKY_SECRET`. `STOKY_SECRET` signs sessions, keys the
security log's account tags and encrypts each authenticator's TOTP secret
(D148). Backup codes are hashes, not encrypted, so it does not reach them
(D149). Both reach the containers as environment variables:

- the database password in `db`'s environment and inside the app's
  `DATABASE_URL`;
- `STOKY_SECRET` in the app's environment. The Compose file passes it
  through without requiring it; the application refuses to start without a
  usable one and names the variable.

Measured, `docker inspect` of a container prints its environment. Plain
`docker compose config` printed both secrets of a filled-in `.env`, while
`docker compose config --quiet` printed nothing. Reading either takes access
to the Docker daemon, which is root on the host. The application starts no
helper processes that would inherit the environment: OCR runs in-process.

They are not mounted as files, because files would help less than it seems.
Prisma reads `DATABASE_URL` from the environment, so `POSTGRES_PASSWORD_FILE`
on `db` alone would leave the same password in the app's environment. Moving
it properly needs an entrypoint that builds the URL from a mounted file, plus
`_FILE` support for `STOKY_SECRET`. Anyone who can read a container's
environment, as root or as code running inside it, can also read a file
mounted into it. What remains is accidental disclosure: pasting `inspect` or
`config` output into an issue. [Troubleshooting](docs/INSTALL.md#troubleshooting)
warns against that. Backups copy `.env` in plaintext beside the database dump,
and the backup instructions say to
[encrypt them](docs/INSTALL.md#backup-and-restore).

**Rotating `STOKY_SECRET`** does three things at once, and the
[installation guide](docs/INSTALL.md#rotating-stoky_secret) lists them before
the command:

- everyone is signed out, native clients included, because every cookie and
  bearer token is signed with it;
- every account tag in the security log changes, so a filter written for one
  account stops matching its older lines;
- every authenticator becomes unreadable: a sign-in answers
  `TWO_FACTOR_UNREADABLE`, and the person's way back is a backup code and
  then turning two-step verification off and on again, which needs only the
  password, or the operator removing it.

Passwords, passkeys and backup codes are unaffected: backup codes are
stored as hashes, which no secret goes into (D149), and a passkey is a public
key (D151). **Better Auth's versioned secrets are not
adopted** beyond the single version-1 entry the instance is given (PROGRESS
D135, D148): keeping old enrolments readable through a rotation would need a
second variable holding every retired value until each enrolment was redone,
and version numbers the operator keeps stable by hand, which the owner's
condition — "only if trivial" — rules out. Every ciphertext already carries
Better Auth's `$ba$1$` envelope, so adopting versions later is additive.

### Keys `next build` writes into the image

`next build` generates keys of its own and writes them into the standalone
output, which the Dockerfile copies into the image
(`COPY --from=builder /app/.next/standalone ./`). The image is public, so every
installation of a release shares these values and anybody who pulls it can read
them. Measured on a standalone build of 2026-10-12:
`.next/server/server-reference-manifest.json` holds a 44-character base64
`encryptionKey` (32 bytes), and `.next/prerender-manifest.json` holds
`previewModeId`, `previewModeSigningKey` and `previewModeEncryptionKey`. None of
them protects anything in this application. The reasons are below, so that the
change that would make one matter is recognised when it is proposed (security
review 2026-10-12, CWE-321):

- **The Server Action key encrypts the variables an inline function closes
  over:** an inline `"use server"` function, whose closed-over values go to the
  browser as ciphertext and are trusted when they come back, and an inline
  `"use cache"` function, whose closed-over values are encrypted with the same
  key (`decryptActionBoundArgs` in
  `node_modules/next/dist/server/use-cache/use-cache-wrapper.js`). With a public
  key that ciphertext is neither secret nor tamper-proof. Arguments attached
  with `.bind()` are not encrypted at all: React serialises them into the page
  as they are (`$$bound`), so a bound value is readable and replaceable by
  whoever submits the form, whatever the key. Neither exists. The three
  actions (`src/lib/auth/actions.ts`, `src/lib/i18n/cookies.ts`,
  `src/lib/landing/choose.ts`) are modules whose first statement is
  `"use server"`, called with ordinary arguments that each action checks like
  any other request, and nothing in `src/` uses `use cache`.
  `src/__tests__/unit/server-actions.test.ts` parses everything under `src/`
  that ships and goes red on a `"use server"` anywhere but a module's first
  statement, and on `.bind(` applied to an action imported directly from a
  `"use server"` module (a re-export or an alias is not followed). Before
  allowing a closure, set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` per
  installation: Next reads it before the manifest's key
  (`node_modules/next/dist/server/app-render/encryption-utils.js`), and it must
  be base64 of 16, 24 or 32 bytes (`openssl rand -base64 32`). Set it at
  runtime only. A value set in the Dockerfile would be baked into the public
  image again. Before allowing `.bind()`, have the action re-check the bound
  value as untrusted input; no key helps there. Next's own guide also advises
  against relying on that encryption to keep a value from the client
  (`node_modules/next/dist/docs/01-app/02-guides/data-security.md`).
- **The preview keys sign and encrypt draft mode's cookies.** Nothing in
  `src/` calls `draftMode()`, so a forged draft-mode cookie switches nothing on.
- **`previewModeId` is also the on-demand revalidation secret.** A request
  carrying `x-prerender-revalidate: <previewModeId>` is treated as a request to
  regenerate a prerendered route (`checkIsOnDemandRevalidate`,
  `node_modules/next/dist/server/api-utils/index.js`). The build prerenders 27
  routes. Under `cacheComponents` 26 of them are partially static shells and
  one is the static web manifest, none with a revalidation interval, and
  nothing in `src/` uses `use cache`, `unstable_cache` or a `revalidate`
  export. (The one `revalidatePath`, in `choose.ts`, is the action refreshing
  its own page.) A forced regeneration therefore produces the same shell
  again. This was read in Next's code and the build manifest, not exercised
  against a running server. Unlike the action key, this one cannot be replaced
  at runtime: the Node server reads it only from
  `.next/server/preview-props.json` (the same three values, also in the
  image), and `__NEXT_PREVIEW_MODE_ID` is read only by the edge runtime.
  Accepted while that holds. Adopting `use cache`, ISR or draft mode makes forced
  regeneration a real cost and reopens this.

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
If the hostname has an AAAA record, read
[Clients on IPv6](docs/INSTALL.md#clients-on-ipv6) first.

### Where to run it

Restrict this alpha to trusted testers through your network or an authenticating
proxy. The [security review](docs/SECURITY_REVIEW.md) has run and the password
policy includes common-password/identity checks; neither makes this a stable
release. The bundled automatic certificate flow needs a hostname and inbound
TCP 443. LAN/VPN deployments need their own trusted TLS configuration.
Plain HTTP to another machine is tolerated for testing, not supported: it sends
every password and session cookie in cleartext, and the app logs a warning at
start-up for each `STOKY_URLS` entry that is such an address (and does not
start when it is not set). Nor does it have passkeys, which need the first
entry to be https with a domain name. For TLS without a
public hostname, use your own proxy — listing its https address in `STOKY_URLS`
address and forwarding `X-Forwarded-Proto` and `X-Forwarded-For` — or
`tailscale serve` ([local bootstrap](docs/LOCAL_BOOTSTRAP.md), way 4).
An instance open to the internet needs a per-address connection cap in front
of Traefik, which the bundle cannot provide: see "One address can hold
Traefik's connections open" above.
If a CDN sits in front of it, give it no rule that caches everything or
overrides the origin's `Cache-Control`: `/api/trpc` marks every answer
`no-store`, and a cache told to ignore that would serve one household's data
to another.

### Keep it updated

Use exact release tags and follow the target release notes and
[upgrade/rollback procedure](docs/INSTALL.md#upgrade-and-rollback). Pulling alone
does not replace running containers; `docker compose up -d --wait` does.
Do not automatically follow `latest` for an alpha installation.

The bundle's PostgreSQL, Valkey and Traefik are pinned by digest, so pulling
does not update them either: a fix to one of them reaches an installation in
the Stoky release that refreshes its pin. Take new releases for those fixes as
well as for the app's.

Trivy checks images before publication for fixable CRITICAL/HIGH findings,
and a release's exact digest again before its version tag exists. The newest
published release's images — the application and its three services — are
re-scanned weekly with the same gate, and a finding there is fixed by a new
release, never in place. That covers only the newest release, only what
Trivy can see, and only what was known that week: a clean scan is not an
assurance about vulnerabilities disclosed since. Updates require a newly built
image, not an in-place package upgrade inside a running container.

### Back up your data

Preserve a PostgreSQL dump, the uploads volume, the exact Compose file and `.env`
together. The [backup and restore commands](docs/INSTALL.md#backup-and-restore)
stop app writes during the copy and restore into an empty installation. Keep
backups off the host and verify restoration before relying on them. JSON export
is not a substitute for a database-and-images backup.

A backup holds `.env`, every account's password hash and every receipt, in
plaintext unless you encrypt it: encrypt it before it leaves the host (the
guide shows `age` and GnuPG), and keep it on a rotation you choose. What it
contains, and what a backup keeps after the instance has deleted it, is in
[*What an instance holds*](#what-an-instance-holds-and-for-how-long).

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
needs no account and relies on `SHA256SUMS` for the release files and, for the
image, on the digest those files name (on the exact version tag alone up to
`v0.1.0-alpha.3`); the attestation is the check that the image behind it was
built here. Releases after `v0.1.0-alpha.3` attest their installation files
too, checked the same way ([the guide's optional
step](docs/INSTALL.md#optional-check-who-published-the-files)).

From `v0.1.0-alpha.3` on, **a missing attestation or a failed verification means
do not run the image**: report it as a [vulnerability](#reporting-a-vulnerability).
`v0.1.0-alpha.1` and `v0.1.0-alpha.2` were built while the repository was private
and carry no attestation, so for them the command fails with `HTTP 404` from the
attestations API; upgrade off them rather than treat that as normal.

Images from `master` are tagged `sha-<full-commit-sha>`, and only a push to
`master` or of a `v*` tag publishes: a pull request or a manual dispatch, on any
branch, is verified and publishes nothing. A release tag's build is
pushed as `candidate-<version>` and gains the exact version tag only after the
install smoke passes on that digest; it never rewrites the `sha-` tag. The
attestation is bound to the digest, not the tag, so the version tag verifies with
the provenance of the tag run that built it. `latest` is the development channel
from `master`. Pinning to a digest or to an exact version tag rather than `latest`
is the safer choice for a deployment you want to be reproducible, and of the two
only the digest cannot be moved: release bundles after `v0.1.0-alpha.3` name it.

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
