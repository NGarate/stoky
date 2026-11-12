# The reverse proxy leaves the bundle

**Decided by the owner, 2026-11-13.** The release bundle stops shipping
Traefik and follows Immich's shape: the bundle publishes the application's
HTTP port, the operator puts their own proxy in front (Traefik, Caddy, nginx,
`tailscale serve`…), the documentation carries an example for each, and the
application believes forwarded headers only from the proxies the operator
lists in `STOKY_TRUSTED_PROXIES` (Immich's `IMMICH_TRUSTED_PROXIES`).

Read `CLAUDE.md` first; everything there holds. This plan is written for an
agent starting with no context from the conversation that produced it.

---

## 1. Why

`deploy/docker-compose.yml` runs Traefik on ports 80 and 443 with its own
Let's Encrypt (TLS-ALPN). Anyone who already has a proxy, or Tailscale on 443,
has to fight the bundle: both ports must be free, and there is no supported
installation without Traefik. It also makes Stoky maintain, scan and refresh a
third service image: on 2026-11-12 `release:refresh-images` refused Traefik
because upstream's `v3` and `v3.7.18` name different indexes, and every
Traefik advisory becomes a Stoky release (alpha.3 shipped four HIGH).

What the bundled Traefik does today, and where each thing goes:

| Today in Traefik | After |
|---|---|
| TLS, certificates (ACME), TLS 1.2+ with AEAD suites (`deploy/traefik.yml`) | The operator's proxy |
| HSTS, `nosniff`, `frameDeny` (middleware `stoky-security`) | Already set by the app itself (`next.config.ts` `securityHeaders`, which says so). Nothing to move |
| `Host(DOMAIN)` router | The operator's proxy; see §6 on whether the app must check Host itself |
| The only published ports (`CLAUDE.md`, Security Constraints) | The app publishes 3000 |
| Writes the last hop of `X-Forwarded-For`, which the per-address rate limit trusts (`src/lib/rate-limit.ts`, `clientAddress`) | The operator's proxy writes it; **the app believes it only from an address in `STOKY_TRUSTED_PROXIES`** |

## 2. Decisions

Owner's (do not reopen):

- **No bundled proxy.** No optional Traefik profile, no second install path.
  One bundle: db, cache, app.
- **Immich's approach.** The port is published as a plain
  `${STOKY_PORT:-3000}:3000`; no proxy labels in the Compose file; an install
  section with an example per proxy.
- **Trusted proxies.** `STOKY_TRUSTED_PROXIES`: comma-separated addresses and
  CIDR ranges. Forwarded headers from any other peer are discarded.
- **No upgrade path, no shim** (pre-beta; the owner is the only
  installation). The release notes say what an existing installation must do.

Taken while planning; check with the owner if one proves wrong:

- **Default: trust nobody.** With `STOKY_TRUSTED_PROXIES` empty every
  forwarded header is dropped and the connecting address is the client. Behind
  an unlisted proxy that puts every visitor in the proxy's single rate-limit
  bucket: safe, visible, and the docs say how to fix it. Not Express's
  "loopback, link-local, private" preset: a LAN client of a published port
  arrives from a private address, so that preset would let anyone on the LAN
  pick their own address.
- **`DOMAIN` stays** (it derives `STOKY_URLS` as `https://${DOMAIN}`).
  **`ACME_EMAIL` goes.**
- **The CI release smoke talks to the app directly** (commit 3). The
  forwarded-header check moves to `scripts/smoke-proxy.sh --live`, which an
  operator runs against their own proxy (commit 4).

## 3. How trusted proxies work here — measured, not assumed

`next start` and the standalone `server.js` fill the forwarded headers in
`node_modules/next/dist/server/base-server.js` (~l.597–601, Next 16.4.3):

```js
req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress;
```

`??=`: Next writes the connecting address **only when the client sent no
`X-Forwarded-For`**. When one is present the socket address is never exposed
to route handlers or `src/proxy.ts` (there is no `NextRequest.ip`), so the
check cannot be written in the application's code. It has to run where the
socket is still visible: **in front of Next's request handler.**

So the production entry becomes ours. Read Next's guide on custom servers in
`node_modules/next/dist/docs/` before writing it (CLAUDE.md: this is not the
Next you know), and how the standalone `server.js` starts Next
(`.next/standalone/server.js` after a build: it sets the embedded config and
calls `startServer`). The entry:

1. Reads `STOKY_TRUSTED_PROXIES` once at start-up. An invalid entry refuses to
   start in production with a line naming it, as `STOKY_REGISTRATION` does
   (`src/lib/auth/registration.ts`, `assertKnownRegistrationMode`).
2. Per request, with `peer = req.socket.remoteAddress` (normalise
   `::ffff:a.b.c.d` to `a.b.c.d`):
   - peer not trusted → delete `X-Forwarded-For`, `X-Real-IP`,
     `X-Forwarded-Proto`, `X-Forwarded-Host` and `Forwarded`. Next then
     writes the peer as `X-Forwarded-For` and the real scheme.
   - peer trusted → walk `X-Forwarded-For` from the right, skipping trusted
     addresses; the first untrusted one is the client (a CDN in front of a
     trusted proxy works when the CDN's ranges are listed too). Replace the
     header with that one address and delete `X-Real-IP`. Keep
     `X-Forwarded-Proto`.
3. Hands the request to Next.

`clientAddress` in `rate-limit.ts` keeps reading the last hop. It now holds
exactly one address the entry chose, and the `X-Real-IP` fallback goes (the
entry deletes it). One place decides who the client is.

The decision is a pure function, `resolveClient(peer, headers, trusted)`, in
its own module with unit tests: untrusted peer with forged headers; trusted
peer appending; a chain through two trusted hops; an IPv4-mapped peer; CIDR
edges (`/32`, `/0`, the first and last address of a range); IPv6. Each one is
shown to fail by breaking the function.

## 4. The commits

Each one must build and pass its gates alone (CLAUDE.md). Work on a branch
`feat/proxy-outside-the-bundle-<date>` and open a PR; this is unattended work.

### Commit 1 — `feat(auth): believe forwarded headers only from STOKY_TRUSTED_PROXIES`

With Traefik still in the bundle, so the commit stands alone:

- The entry and `resolveClient` from §3; the Dockerfile's `CMD` and the
  `start` script run the entry instead of `server.js` / `next start`. Check
  that the image's posture tests (`image-posture.test.ts`) and the size
  budget still hold, and that the browser suite's server (it runs the
  production build) goes through the same entry.
- `clientAddress` drops the `X-Real-IP` fallback; its comment describes the
  entry instead of Traefik.
- `deploy/docker-compose.yml`: give the `traefik` network a fixed subnet
  (`ipam`) and set `STOKY_TRUSTED_PROXIES` on `app` to it, so the bundle
  keeps per-address limits until commit 3 removes Traefik.
- An integration test that starts the real entry on a free port and sends a
  forged `X-Forwarded-For` from loopback: untrusted, it is ignored; with
  `STOKY_TRUSTED_PROXIES=127.0.0.1`, it is believed. Break the entry and see
  it go red.
- Docs: `SECURITY.md` (what the app believes and from whom), `docs/INSTALL.md`
  (the variable), `.env.example` and `deploy/example.env`, and
  `docs/releases/NEXT.md` (es/en).

### Commit 2 — `fix(auth): refuse a Host the instance does not serve`, only if §6 says so

Only if the first check in §6 finds something that trusts `Host` or
`X-Forwarded-Host`. Otherwise skip it and record why in commit 3's message.

### Commit 3 — `feat(docker)!: leave TLS and the proxy to the operator`

The bundle change and everything that breaks without it, docs included
(CLAUDE.md rule 5).

- `deploy/docker-compose.yml`: delete the `traefik` service,
  `configs: traefik_dynamic`, the `letsencrypt` volume and the `traefik`
  network. `app` gets `ports: ["${STOKY_PORT:-3000}:3000"]` and
  `STOKY_TRUSTED_PROXIES: "${STOKY_TRUSTED_PROXIES:-}"`. **`stoky` is
  `internal: true`, and a container only on an internal network cannot
  publish a port**: give `app` a second, ordinary network and keep `db` and
  `cache` on `stoky` alone.
- Delete `deploy/traefik.yml`.
- `deploy/example.env`: drop `ACME_EMAIL`; add `STOKY_PORT` and
  `STOKY_TRUSTED_PROXIES`, commented, Spanish first.
- `deploy/install.sh`: `FILES` without `traefik.yml`; the `chmod` line; the
  `DOMAIN ACME_EMAIL` prompt loop and its help lines; the comment about
  Traefik reading files.
- Release tooling that lists the assets: `scripts/release-assets.sh` (~100,
  ~114), `scripts/release-verify-draft.sh` (`ASSETS`, `INSTALL_FILES`, the
  `ACME_EMAIL` sed ~396, the comment ~27), `.github/workflows/ci.yml`
  release-draft (~921, ~934).
- `ci.yml` release smoke (~849–861): `up -d --wait app`, the `logs` trap
  without `traefik`, and instead of `smoke-proxy.sh`: `/api/health` answers
  200 on the published port, and the security headers (HSTS, `nosniff`,
  `X-Frame-Options`, CSP) are on the response.
- `docker-compose.prod.yml`: its header comment.
- Comments naming Traefik as the deployment's proxy: `src/proxy.ts` (~70),
  `src/lib/csp.ts` (~61), `src/app/api/health/route.ts` (~28),
  `src/server/http/trpc-handler.ts` (~96), `next.config.ts` (~14, ~96).
- Tests that read the bundle (`grep -rln -i traefik src/__tests__`):
  `deployment.test.ts`, `install-script.test.ts`, `release-assets.test.ts`,
  `release-verify-draft.test.ts`, `ci-workflow.test.ts` (the Dependabot test
  listing the bundle's images becomes
  `["ghcr.io/ngarate/stoky/postgres", "valkey/valkey"]`),
  `image-posture.test.ts`, `scan-bundle-images.test.ts`,
  `release-refresh-images.test.ts` (`PINS.traefik = pinOf("traefik")` throws
  once the service is gone), `health.test.ts`, `release-notes.test.ts`,
  `release-prepare.test.ts`. Add to `deployment.test.ts`: `app` publishes
  only 3000, `db` and `cache` publish nothing and stay only on the internal
  network, and no service runs a traefik image.
- Docs:
  - `CLAUDE.md`, Security Constraints: "Only Traefik exposes ports" becomes
    "Only the app publishes a port. PostgreSQL and Valkey have none.
    Forwarded headers count only from `STOKY_TRUSTED_PROXIES`."
  - `docs/INSTALL.md`: requirements (no free 80/443, no ACME; a proxy with
    TLS in front); step 2 without `ACME_EMAIL`; a section "Your proxy", as
    Immich's reverse-proxy page: Traefik (labels in a
    `docker-compose.override.yml`, which Compose reads on its own and
    `install.sh` never touches, joining the proxy's network), Caddy
    (`reverse_proxy`), nginx (`proxy_set_header X-Forwarded-For
    $proxy_add_x_forwarded_for; X-Forwarded-Proto $scheme; Host $host;`) and
    `tailscale serve`. Each one says what to put in `STOKY_TRUSTED_PROXIES`,
    and the trap in §6 about a proxy on the same host. HSTS/apex warning
    (~244) stays.
  - `SECURITY.md`: the release-deployment section (PostgreSQL and Valkey
    pins only), the TLS and header paragraphs that describe Traefik, the
    alpha notice (~2920–2940), "One address can hold Traefik's connections
    open" (now the operator's proxy).
  - `README.md`, `docs/LOCAL_BOOTSTRAP.md` (way 4), `docs/RELEASING.md`
    (step 4 lists two service images; the smoke).
  - `docs/releases/NEXT.md`, es and en, in the CAUTION block: the bundle no
    longer includes Traefik or certificates; before upgrading, put a proxy
    with TLS in front of port 3000 and set `STOKY_TRUSTED_PROXIES` (link
    INSTALL's section); `docker compose up -d --remove-orphans` removes the
    old Traefik container, and the `letsencrypt` volume can be deleted.
    Remove the Traefik sentence from the security lines.

### Commit 4 — `build(docker): stop tracking a Traefik image the bundle no longer runs`

- `scripts/release-refresh-images.ts`: the `traefik` entry in
  `VERSION_SOURCES` and its comment; RELEASING's examples that name it.
- `.github/dependabot.yml`: the `traefik` ignore.
- `.github/workflows/rescan.yml`, `scripts/scan-bundle-images.sh`,
  `ci.yml` release-images: comments and lists that name Traefik.
- `docs/STATUS.md`: the traefik row and text counting three service images.
- What of `release-refresh-images.test.ts` still uses a Traefik fixture only
  because the script supported it.

### Commit 5 — `feat(docker): check your own proxy with smoke-proxy.sh --live`

`scripts/smoke-proxy.sh` today proves the bundled Traefik: redirect, TLS
suites, Host scoping, forwarded headers. It becomes the operator's check of
their proxy: `--live DOMAIN`, through public DNS, certificate verified. Keep
the security headers and **the forwarded-header check** (forged
`X-Forwarded-For` must not buy a fresh sign-in budget — it now also catches a
`STOKY_TRUSTED_PROXIES` that is too wide). Drop the TLS suite probes and
Traefik's refusal codes. Keep the warning that it spends a sign-in window for
the address it runs from. INSTALL's proxy section ends with running it from
another network. Fetch it from the tagged repository by URL rather than
making it a release asset.

## 5. Gates

Per commit: lint, typecheck, and the test files the commit touches. Every new
assertion is shown to fail by breaking the code it guards, running only its
file.

Before the push, once: `bun run verify:ci`. **Careful:** `verify:ci` and
`test:integration` start `docker-compose.dev.yml`, which recreates the
owner's dev database; ask the owner first, or run the affected suites against
side containers. Never the whole browser suite locally; CI's End-to-end job
runs it, and it matters here because commit 1 changes how the production
server starts. The release smoke only runs on a tag, which an agent never
creates (CLAUDE.md rule 6): prove the new smoke steps by bringing `deploy/` up
locally with a published `STOKY_VERSION` (the memory note on local bundle
smokes has the umask and port traps) and record what they printed.

## 6. Risks and things to check, not assume

- **Does anything rely on a Host-scoped router?** `docs/STATUS.md` (~1448)
  records that Auth.js's `trustHost: true` was safe *because* Traefik's
  `Host(...)` rule filtered Host. Better Auth replaced Auth.js (D135) with
  trusted origins from `STOKY_URLS`. Check whether Better Auth,
  `src/server/http/auth-handler.ts` or anything else builds URLs or decides
  from `Host` or `X-Forwarded-Host`. If something does, commit 2.
- **A proxy on the same host does not connect from 127.0.0.1.** A connection
  to a Docker-published port from the host goes through Docker's
  userland proxy or NAT, and the app may see the bridge gateway (e.g.
  `172.x.0.1`) as the peer. Measure what `req.socket.remoteAddress` is for a
  host proxy, for a proxy container on a shared network, and for a LAN client,
  and write the answer into the INSTALL examples. Getting this wrong is the
  difference between per-address limits and a trusted range that includes
  every LAN client.
- **Custom entry vs. Next's standalone server.** Whatever `server.js` sets up
  (the embedded config, `keepAliveTimeout`, graceful shutdown under
  `dumb-init`, the `hostname`/`port` it binds) must survive. Compare
  behaviour, not just a green suite: start both, send a request, stop them.
- **`X-Forwarded-Proto` from an untrusted peer is dropped**, so the CSP's
  `upgrade-insecure-requests` (`src/proxy.ts`) and the cookie's `Secure` see
  the real scheme. A trusted proxy that terminates TLS but does not send the
  header gets a policy without the directive: harmless, but the docs name the
  header.
- **`tailscale serve`**: check what it sends as `X-Forwarded-For` and
  `X-Forwarded-Proto`, and from which address it connects, before writing its
  example.
- **A CDN in front of the proxy**: the walk from the right needs the CDN's
  ranges in the list too, or every visitor shares the CDN edge's bucket. Say
  so in the docs; nothing to build.
