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

It needs a GitHub account, and so does the fallback below: no email address or
other channel is published for someone without one, which is a gap, not a
policy. Please do not open a public issue for a security problem, and do not
post details in a discussion or a pull request. The issue chooser carries the
same link (`.github/ISSUE_TEMPLATE/config.yml`) for anyone who starts there.

**If the form is not offered to you.** GitHub offers it to people outside the
project only while the repository's private vulnerability reporting setting is
on, and the Security tab then shows a **Report a vulnerability** button that
opens it. `gh api repos/NGarate/stoky/private-vulnerability-reporting` answers
`{"enabled":true}` when it is; on 2026-10-12 it answered `{"enabled":false}`,
and turning it on is a repository setting only the owner can change. If there
is no button, or the link does not open the form, open an ordinary
[issue](https://github.com/NGarate/stoky/issues/new) that says only that you
have a security report and asks for a private channel. Leave out every detail:
not the affected feature, the version, or the kind of weakness. A public issue
is read by everyone running the same image, and there is no way for us to patch
their servers first.

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
- `dumb-init` is PID 1, so signals are forwarded and zombies reaped.
- The Prisma CLI and its dependency tree are copied into `/opt/prisma` from
  the same frozen Bun installation used to build the application. There is
  no second package resolution or npm installation. Startup runs that bundled
  CLI through Bun and does not download packages or OCR language data.
- The native Prisma engines are the one install-time download that
  `bun.lock` does not cover: the trusted `@prisma/engines` postinstall fetches
  them from `binaries.prisma.sh` and checks them only against a `.sha256` from
  the same origin. The build checks them against SHA-256 values pinned in the
  `Dockerfile`, as it does the OCR model: the schema engine `migrate deploy`
  runs, and the three copies of the query engine, including the one in the
  standalone output that the server loads. It also fails if a native engine
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
  (`oven/bun:1.4.3-alpine@sha256:…`). A tag can be re-pushed and a digest
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
  PostgreSQL 16.15, Valkey 8.1.10, Traefik 3.7.14.
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
  HSTS (two years, `includeSubDomains`, `preload`), `nosniff` and `frameDeny`.
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
  its own requests.
  One honest caveat: `style-src` still includes `'unsafe-inline'`, because Next
  inlines critical CSS that cannot carry a nonce.
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
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Permitted-Cross-Domain-Policies: none`, HSTS, and a `Permissions-Policy`
  that allows `camera=(self)` for the barcode scanner and denies everything
  else.
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
  `src/__tests__/unit/trpc-handler.test.ts` checks each kind of answer;
  `e2e/security-headers.spec.ts` checks a signed-in streamed query and an
  anonymous 401 against the production build.

### Request bodies — `src/server/http/body-limit.ts`

- **The API routes bound a request body themselves**: 15 MiB for `/api/trpc`
  (a 10 MB receipt is 13.98 MB once base64'd into JSON) and 64 KiB for a POST to
  `/api/auth`, whose forms are a few hundred bytes. A declared
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

### Cross-site requests — `src/server/http/trpc-handler.ts`

- **The session cookie is `SameSite=Lax`** (Auth.js's default, not
  overridden), so a POST from another *site* carries no session. A sibling
  subdomain under the operator's own domain — a photo gallery at
  `photos.home.example` beside Stoky at `stoky.home.example` — is the same
  site, and Lax sends the cookie with its requests. Until 2026-10-12 that was
  the whole defence of `/api/trpc`, and tRPC accepts `multipart/form-data`,
  which a plain HTML form sends with no CORS preflight: a compromised sibling
  could post a form to `auth.revokeMySessions`, which took no input, and sign
  the household out of every device. Procedures with an input refuse a form
  body at validation; the three that took none did not.
- **Every mutation declares an input**, and the three that take nothing —
  `auth.revokeMySessions`, `auth.logout`, `shopping.generateFromLowStock` —
  declare `z.void()`, so a form body that got past the rule below would now
  fail validation there too, with 400 and nothing written. `z.void()` and not
  `z.object({})`, which a `FormData` satisfies. It does not refuse every JSON
  body: superjson reads only a body's `json` field, so `{}` or any object
  without one arrives as no input — the same-origin control in
  `e2e/request-guards.spec.ts` posts `{}` and revokes. The application's own
  call sends `{"json":null,"meta":{"values":["undefined"]}}`, which superjson
  reads back as `undefined`; a bare `{"json":null}` is `null`, and `z.void()`
  now refuses it with 400.
  `src/__tests__/unit/procedure-inputs.test.ts` walks the running router and
  names any mutation without an input parser; `integration/routers.test.ts`
  shows `revokeMySessions` refusing an object and a `FormData` before its
  write. The nine queries that take no input do not declare one: they write
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
- **`Origin` is deliberately not compared with `NEXTAUTH_URL`**: a plain-HTTP
  LAN install is reached at an address that URL does not name, and a strict
  comparison would lock it out.
- **The consequence:** a browser front-end on another origin cannot call this
  API. None exists. Server Actions are outside this route and carry Next's
  own `Origin` check; Auth.js's routes carry its own CSRF token.
- `src/__tests__/unit/trpc-handler.test.ts` shows tRPC alone running a
  mutation sent as a form, then the handler refusing it; `e2e/request-guards.spec.ts`
  sends a cross-site and a form-encoded `auth.revokeMySessions` with a real
  session against the production build, shows the session alive afterwards,
  and then sends the same request as `same-origin` to show it does revoke.

### Authentication — `src/lib/auth.ts`, `src/server/trpc/routers/auth.ts`

- Passwords are hashed with **Argon2id**, `memoryCost: 65536` (64 MiB) and
  `timeCost: 3`.
- Auth.js v5 with the credentials provider; sessions are JWTs with a 15-minute
  lifetime.
- Credentials are validated with a Zod schema before the database is touched,
  and `authorize` returns `null` for both an unknown email and a wrong password.

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
- `bun audit --audit-level moderate` runs as its own job and fails the build. It
  answers from `bun.lock` alone, so the job installs nothing.
- The image is built and **loaded locally, then scanned by Trivy before it is
  pushed** — scanning after publication would be the wrong order. Results are
  uploaded as SARIF, and a separate step fails the job on CRITICAL or HIGH
  findings (`ignore-unfixed: true`).
- **A release's version tag names only a scanned digest.** The scanned build is
  never pushed: the published image is a second build, and on a tag a clean
  one, so the two digests differ. `release-draft` scans the pushed digest from
  the registry with the same gate (Trivy 0.69.3 pinned, CRITICAL/HIGH,
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
  `packages: write` and runs `bun` beside its registry login. `latest` and `sha-`
  images still rebuild from the layer cache: they are the development channel,
  and an installation runs an exact version tag. `ci-workflow.test.ts` holds each
  setting. `v0.1.0-alpha.3` was assembled from that cache: in run
  `38178388250` every Dockerfile step of its publish build but the last was
  `CACHED`, and `release-draft` logged a cache hit for Bun.
- **The newest published release is re-scanned every week**
  (`.github/workflows/rescan.yml`, Mondays and by hand). It downloads that
  release's `docker-compose.yml` and scans every image Compose resolves from it
  — the application at its digest, PostgreSQL, Valkey and Traefik — with
  `release-draft`'s scanner and gate (Trivy 0.69.3, from the registry, no Actions
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
- **Four packages may run install scripts**: `argon2`, `prisma`,
  `@prisma/engines` and `@prisma/client` (`trustedDependencies` in
  `package.json`, which replaces Bun's default allow-list rather than extending
  it). A trusted script runs at install time with network access and, on a
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
  enforced, approval for every external contributor's fork run, squash-only
  merges, the two `v*` tag rulesets (`.github/rulesets/`) and Dependabot's
  branches left outside the branch ruleset live on GitHub, where a checkout
  cannot see them. `bun scripts/github-settings.ts check`
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
- **Every other tRPC procedure is unlimited**, so an authenticated account can
  still make as many ordinary calls as it likes. That is a smaller problem — it
  needs credentials first, and those calls read and write rows rather than
  start OCR or reach a third party — but it is not nothing on a shared
  household instance. It is not only reads, either:
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
  `RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS`, `RATE_LIMIT_REGISTER_ATTEMPTS`,
  `RATE_LIMIT_REGISTER_WINDOW_SECONDS`, `RATE_LIMIT_UPLOAD_ATTEMPTS`,
  `RATE_LIMIT_UPLOAD_WINDOW_SECONDS`, `RATE_LIMIT_PRODUCT_LOOKUP_ATTEMPTS` and
  `RATE_LIMIT_PRODUCT_LOOKUP_WINDOW_SECONDS`. Raising them raises the
  exposure; the browser suite raises them because it registers dozens of
  accounts per run and every worker signs in and scans as one demo account,
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
Docker collects: `docker compose logs app | jq 'select(.event ==
"access.denied")'` works with nothing installed. The events are
`auth.signin.failed`, `auth.signin.throttled`, `auth.unavailable`,
`access.denied` and `request.throttled`.

- **The release bundle rotates them; Docker alone does not.** Docker's default
  `json-file` driver has no size limit, and every throttled refusal writes a
  line, so an unauthenticated client could add to the log until the host disk
  filled and took PostgreSQL with it. Every service in `deploy/docker-compose.yml`
  therefore names `json-file` with `max-size: 10m` and `max-file: 5`: at most
  50 MB on disk per container. The cap is a size, not a period, so it is also
  what bounds how long the addresses and identifiers in the security log
  survive, and under a flood that is not long: the oldest file goes when a new
  one opens, and measured, 80 MiB of 71-byte lines left 23,412,327 bytes
  readable through `docker logs` (the JSON wrapping counts toward the cap). An
  operator who needs a longer record ships the logs elsewhere
  ([Install](docs/INSTALL.md#logs)). The driver is named next to its options
  because under a daemon-wide driver such as `journald` a bare `max-size` stops
  the container from starting.
  `src/__tests__/unit/deployment.test.ts` asserts the block on every service.

- **The access-control events come from tRPC middleware, not from the
  resolvers**, so a new router cannot forget to be audited. Every procedure
  logs UNAUTHORIZED, FORBIDDEN and TOO_MANY_REQUESTS, which come from three
  middlewares and two resolver checks (`assertMayActOnOwner` and the replay
  envelope's composer check). A cross-site request is refused before tRPC sees
  it, so no middleware runs for it; the route handler writes its
  `access.denied` line itself, with `reason: "cross-site"`.
- **A household lookup that misses is logged too**, as `access.denied` with
  `"code": "NOT_FOUND"` and `"reason": "not-found"` (ASVS V7.2.2). A resolver
  asked for another household's row answers NOT_FOUND exactly as it does for
  an id nobody has, so the browser learns nothing about which ids exist; the
  server does not run a second, unscoped read to tell the two apart, so it
  records both alike. **A not-found line is therefore not proof of a probe**
  — a row deleted on another device, or a stale link, writes one as well.
  What an operator looks for is a run of them from one account: `jq -r
  'select(.reason == "not-found") | .userId' | sort | uniq -c` over the app's
  log counts them per account. The line names the account, its household and
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
amplifier — the rate limiter bounds how often, not how much. The password was not
the only unbounded field on those endpoints: the address, the name and the
household name were bare strings too, and a failed sign-in wrote the address
it was given into the security log, whatever its length. All three are bounded
now, with every other input (see *Input validation* above).

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
and all 63 procedures are assigned, with `src/__tests__/unit/capabilities.test.ts`
pinning every one against the matrix rather than sampling, and failing when the
count in this sentence stops matching the router's. Membership and role
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
- Refusals are audit-logged, but there is no complete history of who changed what.
- Registration remains open to anyone who can reach the instance. Restrict access
  to trusted testers; there is no invitation-only switch.
- No account lockout, no password reset flow, no email verification, no
  two-factor authentication.
- No secret scanning or SAST in CI. `ci.yml` and the weekly `rescan.yml` are the
  only workflows; Trivy scans images, not the source. Secret scanning, push
  protection and CodeQL are repository settings instead (see *Supply chain*),
  and on 2026-10-12 all three were off.

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
