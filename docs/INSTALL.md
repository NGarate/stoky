# Install Stoky with Docker Compose

This guide is for **v0.1.0-alpha.4**, a testing release. Keep backups;
alpha upgrades can change the database and may require manual migration steps.
For development from source, use [Local Bootstrap](LOCAL_BOOTSTRAP.md).

The installation follows the [Immich Compose guide](https://docs.immich.app/install/docker-compose/):
download the release's Compose file and environment template, configure them,
then start the containers. Stoky's bundle includes PostgreSQL, Valkey and the
app, which answers plain HTTP on one port. **TLS is your reverse proxy's**:
Traefik, Caddy, nginx, `tailscale serve`, or whatever already answers on port
443 for your other services. [Your proxy](#4-your-proxy) has an example for
each. You do not need Git, Node.js, Bun or a local build.

## Requirements

- A Linux **x86-64 / amd64** Docker host. ARM images are not published for this alpha.
- Docker Engine and **Docker Compose 2.23.1 or newer** (`docker compose version`).
  Use the Compose plugin (`docker compose`), not the legacy Python binary.
- A starting allocation of **2 CPU cores and 4 GiB RAM**, plus disk space for
  images, PostgreSQL, uploaded receipts and backups. This is a planning allowance,
  not a measured minimum. OCR performance depends on the host and photographs.
- **A reverse proxy that serves HTTPS**, on this host or another, and a
  hostname for Stoky that it answers — preferably a dedicated subdomain such
  as `stoky.example.com`, for the reason given under `DOMAIN` in step 2. The
  bundle ships no proxy and asks for no certificate, so it needs neither port
  80 nor 443 and no public DNS of its own. Stoky is meant to be used over
  HTTPS only: browsers give the camera, offline use and passkeys to a trusted
  HTTPS origin alone, and the session cookie is `Secure`.
- `curl`, `openssl`, `sha256sum` and a text editor. No GitHub account is needed:
  the release files and the image download anonymously.

Registration is closed after the first
account. The person who installs Stoky registers first and becomes the owner of
the household; everyone else is added by them from **Configuración → Personas
del hogar**. An installation is one household. `STOKY_REGISTRATION=closed`
in `.env` closes registration to everyone, the first account included (step 2). This is
still an alpha: restrict access to people you trust at your network or proxy
boundary, and read [Security](../SECURITY.md) before deployment.

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
verifies every one against `SHA256SUMS`, and creates `.env`, readable only
by you, from `example.env` with both secrets generated. It changes no value that
is already set, never replaces an installed file that differs (that is an
upgrade, below), and **never starts anything**: you review `.env` and start
Stoky yourself in step 3. Running it again is safe.

```bash
STOKY_RELEASE=v0.1.0-alpha.4
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
`bash install.sh`; that catches a
replaced one too. The `--proto` and
`--tlsv1.2` flags keep every hop on HTTPS with TLS 1.2 or later, GitHub's
redirect included. `install.sh` passes
`--proto-redir '=https' --tlsv1.2` to its own downloads. The script installs
the release it came with. Continue with step 2: only `DOMAIN` is left.

### By hand

Download the exact alpha by its tag. Prereleases are not available through
GitHub's `releases/latest/download` URL.

```bash
STOKY_RELEASE=v0.1.0-alpha.4
for asset in docker-compose.yml example.env SHA256SUMS; do
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location \
    --output "$asset" \
    "https://github.com/NGarate/stoky/releases/download/${STOKY_RELEASE}/${asset}"
done
grep -E '  (docker-compose\.yml|example\.env)$' SHA256SUMS | sha256sum -c
cp example.env .env
chmod 600 .env
```

`sha256sum -c` must print `OK` for both files. Take the Compose and
environment files from the release, never from `master`: `master` may
already describe the next release. Checksums detect damaged/mismatched files;
they are not a separate signature of the publisher, which the
[attestation below](#optional-check-who-published-the-files) is. They also fix the image: the Compose file names it by
digest as well as tag (`…:${STOKY_VERSION}@sha256:…`), so a tag moved on the
registry later does not change what you pull. To check who built that image,
see [Verifying an image's provenance](../SECURITY.md#verifying-an-images-provenance).

### Optional: check who published the files

`SHA256SUMS` comes from the same release as the files it covers, so a writer who
replaced a file could replace its checksum line too. A release also carries
a signed provenance attestation for each installation
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
A missing attestation or a failed verification
means do not install those files; report it as a
[vulnerability](../SECURITY.md#reporting-a-vulnerability).

## 2. Configure `.env`

If you used the install script, the two secrets are already in `.env`: fill in
`DOMAIN` and review the rest. By hand, generate **two
different** random values:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Open `.env` in your editor and fill in:

| Setting | Value |
|---|---|
| `STOKY_VERSION` | Keep `v0.1.0-alpha.4` for this release |
| `DOMAIN` | The hostname your proxy serves Stoky at, alone, for example `stoky.example.com`; no scheme or path |
| `POSTGRES_PASSWORD` | The first generated hex value |
| `STOKY_SECRET` | The second generated hex value |

`.env` also carries
`STOKY_REGISTRATION`, which decides who may create an account at `/register`:

| Value | Who may register |
|---|---|
| `first-user` (the default) | Only the first account. After that, a household admin adds people from **Configuración → Personas del hogar** |
| `closed` | Nobody. People are only added by an admin |

When registration is closed, `/register` shows no form. It says that
registration is closed, asks the visitor to have whoever runs their household
add them, and links back to sign-in. With `first-user` that page replaces the
form as soon as the first account exists.

An unknown value, such as `open` or `true`, stops the app starting, with the
reason in `docker compose logs app`; it never opens registration. To change it
later, edit `.env` and run `docker compose up -d --wait` again.

`OCR_WORKERS` is how many of a receipt's readings run at once. Every photo is
read six ways and the reading the others agree with is kept. Each worker is a
thread with its own copy of the OCR model, about 120 MB, and one core.

| Value | Six readings of one long receipt, measured on an 8-core host |
|---|---|
| `1` | about 38 s |
| `2` | about 21 s |
| `3` (the default) | about 16 s |

Past three it hardly gets faster. The application container is limited to
2 GiB, which three hold; `1` or `2` suit a host short of memory or cores. A
value that is not a positive whole number means `3`, and more than the host's
processors means as many as it has. It is read when the app starts, so apply
a change with `docker compose up -d --wait`.

`STOKY_BIND` and `STOKY_PORT` are where Stoky answers on this host: every
IPv4 address it has, port `3000`, unless you set them. It is plain HTTP,
meant for your proxy and for nobody else.

| Setting | Unset | Set it when |
|---|---|---|
| `STOKY_BIND` | `0.0.0.0`: every IPv4 address of this host | The proxy runs on this host: `STOKY_BIND=127.0.0.1`, and only programs on this host reach the port. Or to one address of this host, to keep the port off its other networks |
| `STOKY_PORT` | `3000` | Something else on this host already uses 3000 |

Left unset the port answers the whole network, which a proxy on another
machine needs; [Your proxy](#a-proxy-on-another-machine) says how to close it
to everything but that machine.

`STOKY_TRUSTED_PROXIES` is whose `X-Forwarded-For` and `X-Forwarded-Proto`
Stoky believes: your proxy's address as Stoky sees it, or several addresses
and CIDR ranges separated by commas. [Your proxy](#4-your-proxy) says what
that address is for each arrangement, and it is rarely `127.0.0.1`. Until you
set it Stoky believes nobody. It works, but it counts every visitor as the
proxy: the whole household shares one budget of 5 sign-in attempts per 15
minutes, and the log names the proxy for everyone. Keep it as narrow as the
proxy itself, because every address in it can choose the address it is
counted by. A value that is neither an address nor a range stops the app
starting, with a `[proxy] refusing to start:` line in
`docker compose logs app`.

Use hex for the database password: it is inserted into a connection URL without
percent-encoding. Do not reuse the development `.env.example`. Rotating the
session secret signs everybody out, changes every account tag in the
security log and makes every authenticator app unreadable (see
[Rotating `STOKY_SECRET`](#rotating-stoky_secret)). An `.env` from
v0.1.0-alpha.3 or earlier may still call it `NEXTAUTH_SECRET`, which is no
longer read: rename the key to `STOKY_SECRET` and keep its value.

The bundle derives `DATABASE_URL`, `VALKEY_URL` and the instance's address
itself, so you do not edit them; the address is `https://` and `DOMAIN`, the
name your proxy serves. Outside the bundle — a source install — set
`STOKY_URLS` to every address people type, comma-separated, the
canonical one first, for example
`STOKY_URLS="http://stoky.lan:3000,http://192.168.1.10:3000"`. List only
addresses that reach this instance: every one is trusted to sign a browser in.
The first is canonical: the session cookie is `Secure` only when it is https,
and **passkeys work only at the first address**. A passkey is registered for
that address's host and cannot be used or added at any other listed address,
where people sign in with the password; changing the first entry later
orphans every passkey, and each person signs in with the password and adds a
new one. Passkeys need the first address to be https with a domain name (or
`http://localhost`): at an IP address, or plain HTTP to another machine,
browsers offer none and Stoky does not either.
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
with `includeSubDomains`. On `stoky.example.com`
that covers only the hosts beneath it. On an apex such as `example.com`, every
browser that opens Stoky then refuses plain `http://` for **every** host under
that domain — a router, a NAS, another service — for two years, and changing
`DOMAIN` afterwards does not release it. It does not send `preload`: listing
a domain in the browsers' built-in HSTS lists is close to permanent and covers
the whole domain, so it is left to the domain's owner, at their own proxy.

PostgreSQL uses its password setting **only when creating a new data volume**.
Editing `POSTGRES_PASSWORD` later does not rotate the database password; it
breaks the application's connection until the stored password agrees.

## 3. Start

```bash
docker compose config --quiet
docker compose pull
docker compose up -d --wait --wait-timeout 180
docker compose ps
docker compose logs --tail=100 app
curl --fail --show-error http://127.0.0.1:3000/api/health
```

`config --quiet` rejects missing settings without printing your credentials.
The application applies the included database migrations before starting;
there is no manual Prisma command and no demo account to seed. The health
endpoint checks both PostgreSQL and Valkey; use your own port in place of
`3000` if you set `STOKY_PORT`.

Stoky now answers plain HTTP on that port, and nothing else is published: the
database and the cache stay on an internal network, and the application runs
as a non-root user with a read-only filesystem. Named volumes preserve the
database, uploads and cache across container replacement.

**Do not register over this port.** With `first-user`, whoever reaches
`/register` first becomes the owner of the installation, and until the port is
bound to `127.0.0.1` or firewalled that is anyone on your network. Go on to
step 4 now.

## 4. Your proxy

Put your reverse proxy in front of that port. Whichever it is, it has four
things to do:

1. **Serve `https://DOMAIN`** with a certificate browsers trust, send plain
   `http://` there, and serve Stoky for that name only, not as the site for
   every [name it does not know](#names-your-proxy-does-not-know).
2. **Pass on the `Host` it was asked for.** Stoky refuses the forms that work
   without JavaScript when the name it is asked for is not the one in the
   browser's address bar.
3. **Say who the client is.** Set `X-Forwarded-For` to the address that
   connected to the proxy, and `X-Forwarded-Proto` to `https`. Adding to an
   `X-Forwarded-For` the client sent is fine; passing the client's own header
   on untouched is not, because Stoky will believe it.
4. **Let a receipt through**: a request body of up to 15 MiB.

Then tell Stoky which address the proxy's requests come from, in `.env`, and
apply it with `docker compose up -d --wait`:

```bash
STOKY_TRUSTED_PROXIES=172.20.0.1
```

Stoky believes `X-Forwarded-For` from that address and from no other. Which
address it is depends on where the proxy runs, because Stoky sees the address
a connection arrives from, and Docker changes that:

| The proxy runs | It forwards to | Stoky sees it arrive from | Set |
|---|---|---|---|
| On this host (Caddy, nginx, `tailscale serve`) | `127.0.0.1:3000` | The gateway of the bundle's `web` network, **not** `127.0.0.1` | `STOKY_BIND=127.0.0.1`, and that gateway |
| In a container on this host (Traefik in Docker) | Stoky's container, port 3000, over a Docker network both are on | The proxy container's address on that network | `STOKY_BIND=127.0.0.1`, and that address or the network's range |
| On another machine | This host's address, port 3000 | That machine's address | That address, and a firewall rule so that nothing else reaches port 3000 |
| In a Kubernetes cluster (an Ingress controller) | Stoky's Service, port 3000 | The controller pod's address | The range the controller's pods get, and a NetworkPolicy |

The first two rows were measured on Docker Engine 29 with this bundle
(2026-11-13). The third is how Docker forwards a published port; it was
measured from this host's own LAN address, not from a second machine. The
fourth is from Kubernetes' documentation and was not run on a cluster.

Any other proxy is one of these rows by where it runs: Nginx Proxy Manager
and SWAG are nginx in a container, and a `cloudflared` tunnel is a proxy on
this host or in a container with a CDN in front of it. None of those was run
against this bundle; [Check it](#check-it) tells you whether yours does the
four things.

### A proxy on this host

Stoky sees a connection to `127.0.0.1:3000` arrive from the gateway of its
`web` network:

```bash
docker network inspect stoky-release_web --format '{{(index .IPAM.Config 0).Gateway}}'
```

Put what that prints (`172.20.0.1`, say) in `STOKY_TRUSTED_PROXIES`, **and set
`STOKY_BIND=127.0.0.1`**. The two belong together. That gateway is also the
address of everything else on this host that reaches the published port, such
as a container on another Docker network. Bound to `127.0.0.1`, the port is
reached by programs on this host and by nothing else.

Docker picks the network's range when it creates the network, and may pick
another after `docker compose down`. To choose it yourself, create
`docker-compose.override.yml` beside the Compose file. Compose reads it on
every command, and neither a release nor `install.sh` ever writes or replaces
it:

```yaml
networks:
  web:
    ipam:
      config:
        - subnet: 172.31.253.0/24
```

The gateway is then `172.31.253.1`. Docker does not change an existing
network, so apply it with `docker compose down` and
`docker compose up -d --wait`; `down` without `-v` keeps your data. Choose a
range nothing else on your network uses.

**Caddy** needs two lines. It obtains the certificate and redirects plain
HTTP by itself and, measured with Caddy 2.11 in front of this bundle, passes
`Host` on, sets `X-Forwarded-For` and `X-Forwarded-Proto`, discards an
`X-Forwarded-For` the client sent, and lets a 2 MB body through:

```caddy
stoky.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

**nginx** does none of the four by default, so every line here is needed
(measured with nginx 1.31):

```nginx
server {
    listen 443 ssl;
    server_name stoky.example.com;
    ssl_certificate     /etc/letsencrypt/live/stoky.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stoky.example.com/privkey.pem;

    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name stoky.example.com;
    return 308 https://$host$request_uri;
}
```

Measured without them: with no `X-Forwarded-For` line nginx passes on whatever
the client sent, and Stoky, trusting nginx, logged a forged address as the
client; with no `client_max_body_size` a 2 MB receipt was refused with 413;
with no `Host` line Stoky is asked for `127.0.0.1:3000` and answers the
no-JavaScript forms with 500.

**`tailscale serve`** gives a tailnet-only HTTPS address with a real
certificate and nothing open to the internet:

```bash
tailscale serve --bg 3000
tailscale serve status      # https://my-machine.tail1234.ts.net (tailnet only)
```

`DOMAIN` is that name, without `https://`. Enable **MagicDNS** and **HTTPS
Certificates** for the tailnet first ([Local Bootstrap](LOCAL_BOOTSTRAP.md),
way 4, has the steps). It forwards to `127.0.0.1`, so it is a proxy on this
host like the two above. Tailscale's source says it passes `Host` on and sets
`X-Forwarded-For` to the device's tailnet address, replacing what the client
sent, and `X-Forwarded-Proto` to `https` (read on 2026-11-13; not measured
against this bundle).

### A proxy in a container

A container cannot reach this host's `127.0.0.1`. Put Stoky on the proxy's
Docker network instead, in `docker-compose.override.yml`. With **Traefik**
and its Docker provider, the labels go in the same file:

```yaml
services:
  app:
    networks:
      - proxy
    labels:
      traefik.enable: "true"
      traefik.docker.network: proxy
      traefik.http.routers.stoky.rule: Host(`stoky.example.com`)
      traefik.http.routers.stoky.entrypoints: websecure
      traefik.http.routers.stoky.tls.certresolver: letsencrypt
      traefik.http.services.stoky.loadbalancer.server.port: "3000"

networks:
  proxy:
    external: true
```

`proxy`, `websecure` and `letsencrypt` are whatever your Traefik calls its
network, its HTTPS entry point and its certificate resolver. Traefik passes
`Host` on and replaces an `X-Forwarded-For` the client sent with the address
it saw (measured with Traefik 3.7). A Caddy or nginx container works the same
way without the labels, forwarding to `stoky-release-app-1:3000`.

Stoky sees the proxy arrive from its address on that network. Docker assigns
it, so either give the proxy a fixed `ipv4_address` there and trust that, or
trust the network's range:

```bash
docker network inspect proxy --format '{{(index .IPAM.Config 0).Subnet}}'
```

The range trusts every container on that network, so each of them could
choose the address Stoky counts it by. It also holds that network's gateway,
and with Stoky on the proxy's network Docker delivered the published port's
traffic from that gateway (measured 2026-11-13): with the range trusted,
whatever reaches the published port chooses its address too. A fixed address
for the proxy trusts neither. Set `STOKY_BIND=127.0.0.1` here in either
case: the proxy no longer uses the published port, and nothing else should.

### A proxy on another machine

Leave `STOKY_BIND` unset, or set it to the one address of this host that the
proxy reaches it by (a LAN or VPN address), which keeps the port off the
host's other networks. `STOKY_TRUSTED_PROXIES` is the proxy machine's
address.

Everything else that can reach that address and port reaches Stoky over
plain HTTP, past your proxy, so close the port to all but the proxy machine.
A `ufw` rule on this host does not do it:
[Docker's documentation](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw)
says traffic to a published port is diverted before it reaches `ufw`'s
rules. Put the rule where that page says, or on the router or the network
between the two machines, and test it from a third device.
The network between proxy and Stoky carries every password and session
cookie unencrypted, so keep it one you trust.

### Names your proxy does not know

Stoky answers whatever `Host` it is asked for, so serving it for `DOMAIN`
only is the proxy's job. Asked for another name, for its own name with
another `Host`, and for the bare address, in front of this bundle
(2026-11-13):

| Proxy | A name it was not given | To do |
|---|---|---|
| Caddy 2.11, one site block | No certificate, so no connection; an empty answer of its own when only `Host` differs | Nothing |
| Traefik 3.7, one `Host()` rule | Its own `404 page not found` | Nothing |
| nginx 1.31, the two blocks above | **Stoky**, for every name and for the bare address: the first `server` is the default one | Add the block below |
| A Kubernetes Ingress | The controller's default backend (not run on a cluster) | Give every rule a `host:` |

For nginx, add a default server that closes the connection. Measured with
it: the three requests above got no answer, and its own name still got Stoky.

```nginx
server {
    listen 443 ssl default_server;
    listen 80 default_server;
    ssl_reject_handshake on;
    return 444;
}
```

### On Kubernetes, behind an Ingress

Stoky ships no manifests and no chart. The bundle's `docker-compose.yml` is
the reference for the three containers, their environment, their volumes and
their limits; `STOKY_BIND` and `STOKY_PORT` belong to Compose and mean
nothing here. This section is written from Kubernetes' documentation and was
**not run on a cluster** (2026-11-13). What takes their place:

- **A `ClusterIP` Service** for Stoky, and for PostgreSQL and Valkey. No
  `NodePort`, `LoadBalancer` or `hostPort` on any of the three: the Ingress
  controller is the only way in.
- **An Ingress with your name and a TLS secret**, every rule with a `host:`.
- **`STOKY_URLS=https://stoky.example.com`** in the pod's environment. The
  bundle derives it from `DOMAIN`; here you set it.
- **`STOKY_TRUSTED_PROXIES`** set to the range the controller's pods get
  their addresses from: the cluster's pod range, or the nodes' range for a
  controller on the host network. A pod's address changes when it is
  replaced, so one address will not do.
- **A NetworkPolicy** that lets only the controller's namespace reach Stoky's
  pod. Without it every pod in that range is a trusted proxy and can choose
  the address Stoky counts it by. It needs a network plugin that enforces
  policies.
- **Probes** on `GET /api/health`, port 3000, for readiness and liveness.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: stoky
spec:
  selector:
    app: stoky
  ports:
    - port: 3000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: stoky
spec:
  tls:
    - hosts: [stoky.example.com]
      secretName: stoky-tls
  rules:
    - host: stoky.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: stoky
                port:
                  number: 3000
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: stoky-from-ingress-only
spec:
  podSelector:
    matchLabels:
      app: stoky
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress
      ports:
        - port: 3000
```

`ingress` is the namespace your controller runs in, and `stoky-tls` the
secret holding the certificate. Two things belong to the controller, not to
Stoky:

- **The client's address.** Behind a `LoadBalancer` or `NodePort` Service
  with the default `externalTrafficPolicy: Cluster`, the controller sees a
  node's address for every client, and Stoky counts the whole household as
  one. Set `externalTrafficPolicy: Local` on the controller's Service.
- **The size of a receipt.** ingress-nginx refuses a body over 1 MB unless
  the Ingress carries `nginx.ingress.kubernetes.io/proxy-body-size: 16m`.

[Check it](#check-it) applies unchanged, with `kubectl logs` in place of
`docker compose logs app`.

### A CDN in front of the proxy

Stoky reads `X-Forwarded-For` from the right and stops at the first address
that is not in `STOKY_TRUSTED_PROXIES`. With a CDN in front of your proxy that
address is the CDN's edge, and every visitor shares its budget, until the
CDN's ranges are in the list as well. Give the CDN no rule that caches
everything or overrides `Cache-Control`.

### Check it

```bash
docker compose logs app | grep -F '[proxy]' | tail -n 1
```

says which addresses this start believes. Then sign in once with a wrong
password from a phone on mobile data, with Wi-Fi off, and look at the address
Stoky counted:

```bash
docker compose logs app | grep auth.signin.failed | tail -n 1
```

The `address` in that line must be the phone's own: its public address, or
its tailnet address behind `tailscale serve`. If it is your
proxy's, or a Docker gateway such as `172.20.0.1`, `STOKY_TRUSTED_PROXIES` is
not the address Stoky sees the proxy at: that address is the one the line
shows.

Last, check the whole front door from **another network**: a laptop on a
phone's hotspot will do. The repository keeps a script for it, which needs
only bash and curl:

```bash
STOKY_RELEASE=v0.1.0-alpha.4
curl --proto '=https' --tlsv1.2 --fail --location --output smoke-proxy.sh \
  "https://raw.githubusercontent.com/NGarate/stoky/${STOKY_RELEASE}/scripts/smoke-proxy.sh"
less smoke-proxy.sh      # read what you are about to run; q to quit
bash smoke-proxy.sh --live stoky.example.com
```

It checks that plain `http://` does not serve Stoky, that `https://` reaches
it with a certificate that machine trusts and with Stoky's security headers
intact, and that a forged `X-Forwarded-For` buys nothing: it signs in wrongly,
forging a new address each time, until Stoky refuses it. It ends with
`Proxy smoke: OK`, or with the one thing to fix. **For up to 15 minutes
afterwards nobody can sign in from the address it ran from**, which is the
other reason to run it from somewhere else.

## 5. Register and check

**Register straight away**, at `https://YOUR_DOMAIN/register`. With
`first-user`, whoever gets there first becomes the owner of this installation,
and a hostname is public from the moment a public certificate is issued for
it: certificates are published in Certificate Transparency logs, which people
watch for new hosts. Create your account and provide a household name. If
`/register` says registration is closed on a new installation, somebody else
registered first. Remove the installation with `docker compose down -v`, which
deletes its data volumes (only on an installation with no data you want to
keep), and start step 3 again.

Sign in, add a product, record stock, and upload a JPEG, PNG or WebP receipt.
Review recognized lines before applying them. Add other household members through
**Configuración → Personas del hogar**: an installation is one household,
and nobody else can register once you have.

A session ends after fifteen minutes unused, a day after sign-in however much
it is used, or when somebody ends it — *Authentication* in
[SECURITY.md](../SECURITY.md) says why — unless **Mantener la sesión
iniciada** was ticked at sign-in: then it ends after ninety days unused or a
year after sign-in. **Sign the kitchen tablet in with that box ticked**, or it
asks for the password after every fifteen idle minutes; the box is unticked by
default.

```bash
curl --fail --show-error https://YOUR_DOMAIN/api/health
```

The health check in step 3 says the containers are up. This one says DNS, your
proxy and its certificate work as well. Camera access and offline service
workers require a trusted HTTPS origin.

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

Every container logs through Docker's
`json-file` driver, capped at five files of 10 MB each: at most 50 MB on disk
per container, about 150 MB for the three. Docker's own default keeps
everything, and anyone who can reach the instance can add lines to the app's
security log, so the cap is what stops logs from filling the disk.
Older lines are discarded as new ones arrive, so how far back the logs
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
```

Check it with `docker compose config --quiet`, keep it with your backups, and
apply it with `docker compose up -d --wait`;
`docker inspect --format '{{.HostConfig.LogConfig.Type}}' stoky-release-app-1`
then names the driver in use. Plain `docker compose config` would show the
override too, but it prints your database password and session secret with
it. Upgrades replace the Compose file, not the override, so it stays in
place.

The app's log records client addresses and account ids, and the database's log
records an email address that was added twice (SECURITY.md,
[*What an instance holds*](../SECURITY.md#what-an-instance-holds-and-for-how-long)).
Remove them before you share log lines with anybody.

## A forgotten password

There is no email, so there is no reset link. A household admin sets a new password for anyone else in the
household from **Configuración → Personas del hogar → Cambiar su contraseña**;
every session that person had ends, and they change the password from
**Configuración** once signed in. Only an owner can do this for an owner.

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
DELETE FROM "Verification"
WHERE identifier LIKE '2fa-%'
  AND value = (SELECT id FROM "User" WHERE email = lower(:'email'));
COMMIT;
SQL
unset STOKY_HASH
```

`psql` must answer `UPDATE 1` to the update, and `DELETE` with the number of
sessions it ended, which may be 0, then the number of two-step sign-ins in
progress it ended, usually 0; `UPDATE 0` means no account has that
address. The hash is kept in the
account's `credential` row of the `Account` table, which is where sign-in reads
it, and each session is a row of `Session`.
The password is read without echo and passed on standard input, so it stays out
of your shell history and the process list; `IFS=` keeps any leading or
trailing space in it, which a plain `read` would drop and sign-in would not. The hash is made by the
application's own Argon2id library with its own parameters. Both statements
run in one transaction, so the new password never stands without the others,
which delete every session the account had and any sign-in waiting for its
authenticator code, as a reset from the application does. This path skips the application's password rules: choose at
least 12 characters that do not contain your name or address.

## A lost authenticator

An account can ask for a code from an
authenticator app after its password (two-step verification), set up by each
person — the kitchen's shared account included — from **Configuración →
Seguridad y acceso → Verificación en dos pasos**. Somebody who
has lost the phone with the app signs in with one of the backup codes they
were given when they set it up, then turns it off and on again there, which
sets up the new phone and gives them new codes.

If they have no backup code either, **a household admin removes it** from
**Configuración → Personas del hogar**: "Quitar la verificación en dos pasos"
on that person's row, confirmed with the admin's own password. It signs the
person out on every device, and they then sign in with their password alone
and set it up again. An admin cannot remove an owner's; another owner can.
The action is recorded in the security log as `auth.twofactor.removed`.

Only when nobody in the application can — a household's sole owner, with no
backup code — remove two-step verification in the database, so the
password alone signs them in. Run this in the installation directory,
replacing the address with the person's:

```bash
docker compose exec -T db psql -U stoky -d stoky -v ON_ERROR_STOP=1 \
  -v email='person@example.com' <<'SQL'
BEGIN;
DELETE FROM "TwoFactor"
WHERE "userId" = (SELECT id FROM "User" WHERE email = lower(:'email'));
UPDATE "User"
SET "twoFactorEnabled" = false,
    "updatedAt" = now() AT TIME ZONE 'UTC'
WHERE email = lower(:'email');
DELETE FROM "Session"
WHERE "userId" = (SELECT id FROM "User" WHERE email = lower(:'email'));
DELETE FROM "Verification"
WHERE identifier LIKE '2fa-%'
  AND value = (SELECT id FROM "User" WHERE email = lower(:'email'));
COMMIT;
SQL
```

`psql` must answer `DELETE 1` and then `UPDATE 1`; `UPDATE 0` means no account
has that address, and `DELETE 0` first means it had no authenticator. The
last two statements sign the account out everywhere and end any sign-in
waiting for a code, because whoever has the lost phone may have used it. Ask
the person to set two-step verification up again once they are in. Do this
only for somebody whose identity you are sure of: it leaves their password as
the only thing protecting the account.

## Rotating `STOKY_SECRET`

`STOKY_SECRET` signs every session and encrypts every authenticator secret
(not the backup codes, which are hashes, nor passkeys, which are public keys),
so replacing it is not only a new value. A new value:

- **signs everybody out**, phones and the kitchen screen included: every
  cookie and native token was signed with the old one;
- **changes every account tag in the security log**, so lines written before
  and after cannot be matched to the same account by tag;
- **makes every authenticator unreadable**. A person with two-step
  verification is told at sign-in that the server can no longer check their
  app. Their way in is one of their backup codes, which are stored as hashes
  rather than encrypted and so still work; once in, they turn two-step
  verification off and on again in **Configuración → Seguridad y acceso**,
  which sets up the app with a new secret and
  gives them new codes. Somebody without a backup code needs
  [A lost authenticator](#a-lost-authenticator).

Passwords, passkeys and backup codes are not affected. Old values are not kept: Stoky reads one secret,
so there is no way to rotate without these consequences. Rotate when the
secret may have leaked, not on a schedule. To do it, generate a new value with
`openssl rand -hex 32`, replace `STOKY_SECRET` in `.env`, and run
`docker compose up -d --wait`.

## Somebody keeps being told to wait

Sign-in allows 10 attempts per account every 15 minutes, counted before the
password is checked, so once they are spent even the right password is refused.
The person is told "Demasiados intentos
con esta cuenta. Espera unos minutos; si se repite, avisa a quien administra tu
hogar."
A browser that has signed in to that
account before has 5 of its own and is not affected; a new phone, a private
window or a browser whose cookies were cleared shares the 10 with everyone
else. So, after updating from a release without this, does every browser until
its first sign-in since.
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

An address like `172.18.0.1` in those lines, or your proxy's own, is not a
person: see [Your proxy](#4-your-proxy) and
[Clients on IPv6](#clients-on-ipv6).

## Clients on IPv6

A Docker network is IPv4-only unless it is told otherwise. A client that
connects over IPv6 (most mobile networks, and any connection your AAAA record
attracts) to a port **a container publishes** on such a network is handed over
by Docker's userland proxy, and the container sees the network's gateway, an
address like `172.18.0.1`, instead of the client.

Whether that touches you depends on where your proxy runs:

- **A proxy installed on this host** (Caddy, nginx, `tailscale serve`) accepts
  the connection itself and sees the client's own address. There is nothing to
  do: Stoky's own port is published on IPv4 only, so no IPv6 client reaches
  it past the proxy (measured 2026-11-13: `[::1]` was refused with
  `STOKY_BIND` unset).
- **A proxy in a container** sees the gateway for every IPv6 client and tells
  Stoky so. Every IPv6 client then shares one budget: 5 sign-in attempts per
  15 minutes and 3 registrations per hour. One of them spending it makes the
  rest wait, and the security log shows the gateway for all of them. IPv4
  clients and people already signed in are not affected.

For a proxy in a container, choose one:

- **Publish only an A record**, with no AAAA. Every client connects over IPv4
  and is counted by its own address.
- **Accept the shared budget**, for a small household.
- **Give the proxy's network IPv6**, in the proxy's own Compose file: the
  network its container publishes ports 80 and 443 on. This needs Docker
  Engine 27 or newer (`docker version --format '{{.Server.Version}}'`), IPv6
  enabled on the host (`cat /proc/sys/net/ipv6/conf/all/disable_ipv6` prints
  `0`), and `ip6tables` not set to `false` in `/etc/docker/daemon.json`. From
  Engine 27 Docker gives such a network an IPv6 range of its own and forwards
  it with ip6tables, so the client's address arrives intact:

  ```yaml
  networks:
    proxy:
      enable_ipv6: true
  ```

  Docker does not change an existing network, so it has to be removed and
  created again. On an older Engine or a host without IPv6 the network cannot
  be created and nothing on it starts: take the line out again.

Stoky counts an IPv6 client by its
/64, the smallest block an internet provider gives one connection. Devices in one home share a budget, as they do
behind one IPv4 router, and nobody gets a fresh budget by changing address
inside their /64.

To see which case you are in, sign in once with a wrong password from a device
on IPv6, for example a phone on mobile data with Wi-Fi off, then run:

```bash
docker compose logs app | grep auth.signin.failed | tail -n 1
docker network inspect proxy --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}'
```

with the proxy's network in place of `proxy`. If the `address` in the first
line is one of the gateways the second prints, IPv6 clients are sharing. An
address with colons that is not a gateway is the device's own. A dotted
address that is not a gateway means the device used IPv4; try another one.

## Deleting somebody's account

Removing a person from **Personas del hogar** deletes their account — name,
address, password hash, passkeys, authenticator, the start screen they chose on
each device and their offline replay records — and signs them out on every
device at once. That is how somebody who asks to be erased is erased; steps 3
and 4 below still apply. The application does not remove the household's last
owner: to erase that account, delete it in the database. Run these in the
installation directory, replacing the address with the person's:

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
   offline replay records go together or not at all. The account's password hash, in its `credential` row of the
   `Account` table, goes with it too: the database deletes that row along with
   the account, so the statement does not name it, and so do its sessions: a
   browser signed in to it is signed out on its next request. Its
   authenticator secret and backup codes, if it set up two-step verification,
   go the same way, and so do its passkeys. A sign-in waiting for its code is a `Verification` row
   that names the deleted `id`; it expires within ten minutes and can no
   longer become a session.
3. The receipts the person uploaded belong to the household and stay, with
   their photographs on the `uploads` volume. To remove those photographs too,
   put the `id` from step 1 in place of `the-id`. For somebody removed in the
   application, it is the `targetUserId` of their removal's line,
   `docker compose logs app | grep '"reason":"removed"'`:

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
- **Backups and logs.** Backups taken before the deletion still hold the
  account and the photographs until you delete them. The app's log keeps the
  account's `id` and the addresses it signed in from until rotation removes
  them ([Logs](#logs)).

The address is free again afterwards. An admin can add it to the household
again, as a new account with nothing of the old one.

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
cp .env docker-compose.yml "$STOKY_BACKUP/"
docker compose up -d --wait app
```

If you wrote a `docker-compose.override.yml`, copy it too. The directory holds `.env` (the database password and the session secret), every
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
taken. Your proxy's configuration and certificates are not part of it: they
are the proxy's to back up.

**Test restoration on an empty installation on another host**, using the same
release and the saved `.env` and Compose file. These commands assume its database and
uploads are empty and the backup files have been copied into its directory.

```bash
docker compose pull
docker compose up -d --wait db cache
docker compose exec -T db pg_restore -U stoky -d stoky \
  --exit-on-error --no-owner < database.dump
docker compose run --rm --no-deps -T --entrypoint tar app \
  -C /app/uploads -xzf - < uploads.tar.gz
docker compose exec -T db psql -U stoky -d stoky -c 'DELETE FROM "Session";'
docker compose up -d --wait --wait-timeout 180
```

The `DELETE` ends every session the backup carried. A restored instance is a new
place to sign in to, and a cookie lifted from the old one must not open it.
Sign in and check inventory and a receipt image. Restoring over existing data is
not covered by these commands. Never delete the original volumes to test a backup.

## Upgrade and rollback

When the new Compose file changes a service's configuration, `up -d` recreates
that container and deletes its old log files with it; the first release that
rotates logs changes every one. Save the logs you need before upgrading, for
example `docker compose logs --no-color --timestamps > logs-before-upgrade.txt`.

Read the target release's notes first. Back up the current installation, download
the target release's assets **into a separate directory**, and verify their
checksums and, with the GitHub CLI, [who published
them](#optional-check-who-published-the-files), with `STOKY_RELEASE` set to the
target tag. Compare `example.env` with your `.env`; preserve your secrets. Replace
the installed Compose file with that release's and set `STOKY_VERSION` to
its exact tag. The Compose file is what selects the image: it names it by digest, Docker pulls that digest whatever tag
`STOKY_VERSION` gives, and changing `STOKY_VERSION` alone changes nothing. Then:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d --wait --wait-timeout 180
```

Confirm health, sign-in and your data. Automatic alpha updates are not supported.
Migrations run automatically and are not automatically reversible: a rollback may
require restoring **both** the pre-upgrade database and uploads into an empty
installation with the previous image and configuration. A rollback takes the
previous release's Compose file, not only its tag, and returning to the previous
image is not by itself a guaranteed rollback.

**What an upgrade needs beyond these steps is in the target release's notes**,
under *Cómo actualizar*: a setting renamed or added (as a diff of `.env`),
everybody signing in again, or a migration after which the previous release
can no longer start against the upgraded database, so that returning to it
needs the pre-upgrade backup. Those depend on the version you come from, so
this guide, which describes one release, does not repeat them. The new
release's `install.sh` adds every missing setting to `.env`, but only once `example.env` and
`SHA256SUMS` have been replaced along with the Compose file:
against the previous release's copies it stops before it reaches `.env`.

PostgreSQL and Valkey change only with a Stoky release. The Compose
file names each of them by exact version and by digest
(`valkey/valkey:8.1.11-alpine@sha256:…`), so `docker compose pull` fetches the build
the release was tested with, not whatever the tag names that day. Their
security fixes reach you by upgrading to the release that carries them. Within
one major version (PostgreSQL 18, Valkey 8) an update keeps the stored data
format and needs no data migration; a release that changes a major version
says so, and what to do, in its notes.

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

A migration that changed nothing before failing is recovered in place. Read the
`P3018` reason in `docker compose logs app` and fix what it names. Then clear
the recorded failure, putting the migration's name in place of `the-migration`:

```bash
docker compose run --rm --no-deps --entrypoint bun app \
  /opt/prisma/node_modules/prisma/build/index.js migrate resolve \
  --rolled-back the-migration \
  --schema=/app/prisma/schema.prisma
```

and start again: `docker compose up -d --wait --wait-timeout 180`. If it may
have changed part of the database, roll back instead, as [Upgrade and rollback](#upgrade-and-rollback)
describes: restore the backup taken before the upgrade into an empty installation
of the previous release. Restoring it under the new release only runs the same
migration again.

## Troubleshooting

| Symptom | Check |
|---|---|
| Release download returns 404 | Exact alpha tag; the stable `latest` URL excludes prereleases |
| Image pull says `denied` or `unauthorized` | Exact tag in `STOKY_VERSION`; stale saved credentials for `ghcr.io` are sent even to a public image, so try `docker logout ghcr.io` |
| `no matching manifest` | This alpha publishes Linux amd64 only |
| `docker compose up` says port 3000 is already allocated | Something else on this host uses it: set `STOKY_PORT` to a free one, and point your proxy there |
| The proxy answers 502 or `Bad Gateway` | It cannot reach Stoky: `curl http://127.0.0.1:3000/api/health` on this host, then the address and port the proxy forwards to. A proxy in a container cannot reach `127.0.0.1` of the host; see [Your proxy](#4-your-proxy) |
| App exits with `[proxy] refusing to start:` | The line names the `STOKY_TRUSTED_PROXIES` entry that is neither an address nor a CIDR range |
| Everybody is told to wait at sign-in at once, or the log shows one address for everyone | Stoky is counting the proxy, not the people: `STOKY_TRUSTED_PROXIES` is unset or is not the address Stoky sees the proxy at. See [Check it](#check-it) |
| A receipt photo will not upload, and the proxy's log shows 413 | The proxy's body limit is below 15 MiB (nginx: `client_max_body_size`) |
| A page's buttons do nothing without JavaScript, and the app logs `Invalid Server Actions request` | The proxy is not passing the `Host` it was asked for (nginx: `proxy_set_header Host $host`) |
| `P1000` / database authentication | Password differs from the one stored when the volume was initialized; changing `.env` is not rotation |
| App is unhealthy | `docker compose logs --tail=100 app db cache`; migrations, database connectivity and Valkey |
| App keeps restarting and its log says `P3018` or `P3009` | A migration failed; see [A migration stops the upgrade](#a-migration-stops-the-upgrade) before restarting again |
| TLS error / certificate not issued | That is your proxy's: its logs, its DNS records and its port 443. Stoky answers plain HTTP and asks for no certificate |
| Sign-in unavailable | Valkey must be healthy; authentication rate limiting fails closed |
| App exits with `[auth] refusing to start:` | The line names the setting to fix — `STOKY_SECRET` unset, the example value or too short; `STOKY_URLS` unset, an entry that is not a bare address, or an https first entry beside plain-HTTP network addresses; `BETTER_AUTH_TRUSTED_ORIGINS` set, or `BETTER_AUTH_TELEMETRY` on. See step 2 |
| Sign-in refused with 403 `INVALID_ORIGIN` or `MISSING_OR_NULL_ORIGIN` (the form says the service is unavailable; the app's log says `Invalid origin`) | The browser is at an address `STOKY_URLS` does not list, or a proxy strips `Origin`. Add the address people use to `STOKY_URLS` — only one that reaches this instance — or sign in at a listed one. The bundle lists only `https://` and `DOMAIN`, the name your proxy serves. In development, `DEV_ALLOWED_ORIGIN` hosts are trusted too |
| People on IPv6, often on mobile data, are told to wait at sign-in | Behind a proxy in a container, IPv6 clients share the Docker gateway's budget; see [Clients on IPv6](#clients-on-ipv6) |
| The right password is told to wait for minutes, again and again | The account's shared attempts are being spent; see [Somebody keeps being told to wait](#somebody-keeps-being-told-to-wait) |
| Somebody forgot their password | An admin sets a new one from **Personas del hogar**; a sole owner's is set in the database, see [A forgotten password](#a-forgotten-password) |
| Somebody lost the phone with their authenticator app, or is told at sign-in that the server can no longer check it | A backup code signs them in; without one, a household admin removes it from **Personas del hogar** — see [A lost authenticator](#a-lost-authenticator). Everybody told so at once means `STOKY_SECRET` changed; see [Rotating `STOKY_SECRET`](#rotating-stoky_secret) |
| Turning two-step verification on or off, or asking for new recovery codes, says there have been too many tries | Five wrong passwords from one session, or twenty across the account, within 15 minutes; the screen can be used again once that window ends. Wrong passwords are on the log as `auth.reauth.refused` with `"via":"two-factor"` — many of them from a session the person does not recognise means somebody else has it: end it from **Tus dispositivos** |
| The authenticator app does not take the QR code | Type the key shown under the code into the app instead, or, on the phone that has the app, use the link beside it. The phone's clock must be right to within a minute |
| Somebody asks to be erased | An admin removes them from **Personas del hogar**, which deletes the account; the last owner's is deleted in the database. See [Deleting somebody's account](#deleting-somebodys-account) |
| `/register` says registration is closed, with no form | Expected once an account exists with `first-user`, or always with `closed`; an admin adds people from **Configuración → Personas del hogar**. See `STOKY_REGISTRATION` in step 2 |
| App exits with `refusing to start: STOKY_REGISTRATION` | The value is not `first-user` or `closed` (`open` is not accepted: an installation is one household); fix `.env`, or remove the line for `first-user` |
| Upload refused | JPEG/PNG/WebP/HEIC only, maximum 10 MiB |
| A scanned code always opens the empty product form | Open Food Facts is not being asked: the app needs outbound HTTPS to `world.openfoodfacts.org`, Valkey must be healthy (a lookup that cannot be counted is not sent), and each account may send 60 lookups an hour for codes this instance has not looked up recently — past that the scan page says so. This bundle does not pass `RATE_LIMIT_PRODUCT_LOOKUP_*` to the app, so the default applies |
| Empty inventory after moving directory | Check `-p`, `COMPOSE_PROJECT_NAME` and volume names before creating or deleting anything |

Report the release tag, image digest, command and redacted error through
[GitHub issues](https://github.com/NGarate/stoky/issues). Do not attach `.env`,
database dumps, session cookies or unredacted receipt photos.

**Never share the output of `docker inspect` or of `docker compose config`
without `--quiet`.** The secrets reach the containers as environment variables,
and both commands print them: the database password, which is also in
`DATABASE_URL`, and `STOKY_SECRET`, which signs every session. Remove client
addresses and email addresses from log lines before you share them as well.

A security problem is not an issue: report it through the private form in
[Reporting a vulnerability](../SECURITY.md#reporting-a-vulnerability), which
also says what to do when the form is not offered. Every installation runs the
same image, so a public report reaches everyone before a fix does.
