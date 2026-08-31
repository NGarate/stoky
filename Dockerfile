# Multi-stage Dockerfile for Stoky.
#
# The production target is what people self-host, so it is treated as the
# security boundary: no build toolchain, no package manager fetching code at
# start-up, no root, and a health check the orchestrator can act on.
#
# The base image is pinned by tag rather than digest on purpose. A digest would
# freeze the Alpine security updates that arrive in node:24-alpine rebuilds; the
# Trivy gate in CI is what catches a base image that has gone stale.

# ----------------------------------------------------------------- bun --
#
# Declared first because every stage below needs it: Bun is the package manager
# now as well as the test runner. Pinned to a version rather than to
# `1-alpine`, because a floating tag would change the installer *and* the test
# runner underneath a green suite.
#
# This pin is the version of record. The host may have another — it had 1.3.14
# when this landed — and that is the point of installing in the image: neither
# the answer a suite gives nor the tree an install resolves should depend on
# whose laptop asked.
FROM oven/bun:1.4.0-alpine AS bun

# ---------------------------------------------------------------- deps --
FROM node:24-alpine AS deps
# argon2 and @swc/core compile native bindings, so the toolchain is needed here.
# It stays in this stage and never reaches production. libstdc++ because Bun
# links against it and the Node Alpine image does not carry it.
RUN apk add --no-cache libc6-compat python3 make g++ libstdc++
WORKDIR /app
# Node stays the base even though Bun does the installing, because the install
# scripts are Node programs: argon2 runs `node-gyp-build`, prisma and
# @prisma/client run `node` postinstalls, @parcel/watcher builds from source.
# An `oven/bun` base here would break all four at once, and quietly — Bun skips
# a script it cannot run rather than failing.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
# `--frozen-lockfile` for the reason pnpm had it: a build free to rewrite the
# lockfile is a build that can ship a tree nobody resolved. The lifecycle
# scripts those four packages need are allowed by `trustedDependencies` in
# package.json — Bun blocks them by default, exactly as pnpm did.
RUN bun install --frozen-lockfile

# ----------------------------------------------------------- development --
#
# The image people actually develop in. It is the production base with the
# test runner added, and that ordering is the point: the runtime here is Node,
# exactly as it is in production, because Next's standalone output is started
# with `node server.js`. Bun is a *tool* this repository uses — to install and
# to run tests — not a runtime it adopts. Basing this stage on `oven/bun` would
# have the dev server running under Bun and the deployed one under Node, which
# is a wider gap than the one containerising development is meant to close.
FROM node:24-alpine AS development
WORKDIR /app
# libstdc++ because Bun links against it and the Node Alpine image does not
# carry it. git because three tests ask the repository about itself — whether
# the OCR worker is tracked, and whether `.gitignore` excludes it — and a
# suite that cannot answer that question in the container it now runs in is a
# suite with a hole in it.
RUN apk add --no-cache libstdc++ git
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
# `bunx` too, and as a link rather than a second 74 MB copy — the oven image
# ships it as one to the same binary. It is not decoration: this is the image
# the `test` CI job runs `scripts/ci-in-image.sh` in, and that script invokes
# `bunx prisma migrate deploy` because prisma is a binary rather than a script.
# Without this line the job dies at `sh: bunx: not found`, exit 127 — measured,
# which is how it was found, because the production image needs no `bunx` and
# building that one proved nothing about this one.
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The Prisma client is generated, not installed: `deps` runs `bun install`,
# which leaves `@prisma/client` uninitialised. Without this every suite that
# imports it fails on "did not initialize yet" — measured, three unit files
# before this line existed.
RUN bun run db:generate
ENV NODE_ENV=development
EXPOSE 3000
# `bun run dev`, never `bun dev`: `bun <name>` would look for a file, and
# `bun test` — the shape this invites — is Bun's own runner, which would sweep
# the integration suite with no database up instead of running the script.
CMD ["bun", "run", "dev"]

# --------------------------------------------------------------- builder --
FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libstdc++
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Both run under Node, not Bun: `bun run` executes the binary in node_modules/
# .bin, and those carry a `#!/usr/bin/env node` shebang. The runtime that
# builds the artefact stays the runtime that serves it.
RUN bun run db:generate
RUN bun run build

# The Spanish OCR model, fetched once here rather than at runtime — ISSUES.md
# OCR-1. `createWorker("spa")` with no `langPath` downloads this from jsdelivr
# on first use and caches it in the working directory, which in the production
# stage is a read-only filesystem: two failures on an air-gapped install, and
# one on every other. Same class of defect as the Prisma CLI that `npx` used to
# fetch at container start.
#
# Pinned to a tag rather than a branch, and checksummed, because this is 3.3 MB
# of executable model data entering the image from the internet — the project
# already scans with Trivy and attests provenance, so an unpinned `curl | tee`
# would be the weakest link in a chain it takes seriously.
#
# From `tessdata_fast` (2.3 MB), **not** what tesseract.js downloads by default.
# Its default is `@tesseract.js-data/spa/4.0.0`, which is 8.3 MB compressed and
# over 12 MB on disk because it carries the legacy engine's data as well. For
# printed receipt text the fast LSTM model is the one Tesseract itself
# recommends, and 12 MB is a tenth of this image for accuracy nothing here
# measures — see the commit for what that means and does not mean.
# The whole of tesseract.js, staged with its dependencies made real — ISSUES.md
# OCR-2. Next's output tracing copies only what static analysis can see, and
# this package's runtime is invisible to it: the worker is spawned as a thread
# by path, that thread `require`s its way to files nothing imports by name, and
# the WASM engine (`tesseract.js-core`) is loaded the same way. The traced
# image carried 3 of the package's 10 dependency entries, so every scan died
# with `Cannot find module` — receipt scanning simply did not work when
# deployed. `outputFileTracingIncludes` was tried and did not take.
#
# Under pnpm this was a single `cp -rL` of `.pnpm/tesseract.js@*/`, which worked
# by a property of that layout: the directory held the package plus symlinks to
# its dependencies, so dereferencing recursively produced the whole closure for
# free. Bun's layout is flat and has no `.pnpm/`, so the closure is *computed*
# here rather than copied.
#
# Thirteen packages, not the nine tesseract.js declares: `node-fetch` pulls
# `tr46`, `webidl-conversions` and `whatwg-url`. Those three are exactly what a
# hand-written list loses — and losing them reproduces OCR-2, which is invisible
# until a deployed household scans a receipt. Hence the walk, and hence the
# throw: a dependency Bun did not hoist fails the build here rather than
# shipping a tree that is quietly missing it.
RUN mkdir -p /opt/ocr \
    && node -e "const fs=require('fs'),p=require('path'),r='/app/node_modules',s=new Set();(function v(n){if(s.has(n))return;s.add(n);const f=p.join(r,n,'package.json');if(!fs.existsSync(f))throw new Error('not hoisted, OCR closure incomplete: '+n);for(const d of Object.keys(JSON.parse(fs.readFileSync(f,'utf8')).dependencies||{}))v(d)})('tesseract.js');console.log([...s].join('\n'))" > /tmp/ocr-closure \
    && cd /app/node_modules \
    && while read -r d; do cp -rL "$d" /opt/ocr/; done < /tmp/ocr-closure

ARG TESSDATA_SPA_SHA256=6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464
RUN mkdir -p /app/tessdata \
    && wget -q -O /app/tessdata/spa.traineddata \
       https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/spa.traineddata \
    && echo "${TESSDATA_SPA_SHA256}  /app/tessdata/spa.traineddata" | sha256sum -c -

# ------------------------------------------------------------ production --
FROM node:24-alpine AS production
WORKDIR /app
# `apk upgrade` before anything else, and it is not belt and braces.
#
# The base image is rebuilt on its own schedule, so between a distro fixing a
# package and Docker publishing a new `node:24-alpine` there is a window where
# every build of this image ships the vulnerable version. Trivy fails the build
# on HIGH, so that window is not a theoretical exposure — it is a red trunk that
# cannot publish, which is how it was found: CVE-2026-14456 in libcrypto3 and
# libssl3, fixed in 3.5.8-r0 while the base still carried 3.5.7-r0.
#
# Upgrading the whole index rather than naming the two packages, because naming
# them fixes this advisory and leaves the next one to be discovered the same
# way. `--no-cache` keeps the index out of the layer.
RUN apk upgrade --no-cache && apk add --no-cache dumb-init libstdc++
# The same shape as `development`: Node base, Bun on top. Those two diverging
# is what this project spent an evening paying for, so they are kept identical
# rather than each optimised alone.
#
# Bun is the runtime here — see the `CMD` — because the image pipeline uses
# `Bun.Image`, and it uses `Bun.Image` because `sharp` is a native N-API module
# that Next's standalone output cannot load under Bun. The base stays
# `node:24-alpine` rather than becoming `oven/bun`: nothing else in this stage
# would change, and a base swap is its own question. It costs 71 MB.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
# Read by `tessdataPath()` in `src/server/services/ocr.ts`. Without it the OCR
# worker falls back to `process.cwd()`, finds nothing, and downloads.
COPY --from=builder /app/tessdata ./tessdata
ENV TESSDATA_PATH=/app/tessdata

# The complete tesseract.js closure staged above, replacing the partial copy
# tracing produced (OCR-2). Straight into `node_modules/`, because Bun's layout
# and the standalone output's are both flat — the `.pnpm/` indirection this
# used to need is gone with pnpm.
#
# The traced tree still has to go first, for the reason it always did: COPY
# cannot overwrite a directory with a file or the reverse, and tracing may have
# left a partial one behind.
RUN rm -rf /app/node_modules/tesseract.js /app/node_modules/tesseract.js-core
COPY --from=builder /opt/ocr/ ./node_modules/
# Build-time assertions on the two files whose absence broke scanning: the
# worker's own `require('..')` target, and the WASM engine. A wrong path here
# must fail the build, not the first scan of a deployed household. The third
# line is new and is the one the flat layout makes necessary — `whatwg-url` is
# the deepest package in the closure, so its presence is what says the walk ran
# rather than a first level being copied.
RUN test -f /app/node_modules/tesseract.js/src/worker-script/index.js \
    && test -d /app/node_modules/tesseract.js-core \
    && test -d /app/node_modules/whatwg-url

# The entrypoint runs `prisma migrate deploy`. Previously it did so through
# `npx`, with no prisma package in the image — which meant every container
# start downloaded an unpinned CLI from the network before touching the
# database. That fails on an air-gapped host and is code execution fetched at
# runtime on every other one. Install it at build time, at the version the
# lockfile already resolved.
# Installed into its own prefix rather than /app: installing alongside the
# application's package.json makes npm resolve the entire dependency tree,
# peer conflicts and all, which fails.
# The overrides are security floors on this install's *transitive* tree. They
# were added while chasing scan findings that turned out to live in the base
# image's npm, not here — a fresh install of this tree does not even contain
# the flagged packages — but they stay, for the trap they do close: this RUN's
# text is its cache key, so the node_modules it produces in one month is still
# being shipped the next, and a CVE fixed upstream stays in the image until
# something changes this line. Floors, not pins: fresh resolves may go higher,
# never back below.
RUN PRISMA_VERSION="$(node -p "require('/app/package.json').dependencies.prisma.replace(/[^0-9.]/g,'')")" \
    && mkdir -p /opt/prisma \
    && cd /opt/prisma \
    && npm init -y > /dev/null \
    && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.overrides={tar:'>=7.5.19',undici:'>=6.27.0','ip-address':'>=10.3.1','brace-expansion':'>=5.0.9','deepmerge-ts':'>=8.0.0'};fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
    && npm install --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
    && npm cache clean --force \
    # npm's job in this image ends on the line above. The base image bundles it
    # with its own vendored dependency tree, and that tree is where every
    # CRITICAL/HIGH the scan gate has flagged actually lived — npm ships pinned
    # copies of tar, undici and friends that go stale on node's release
    # schedule, not this project's. Nothing at runtime uses it: the entrypoint
    # runs the Prisma binary directly and then `node server.js`. Removing it
    # deletes the findings at their source and takes a package manager out of a
    # shipped container, which is worth having on its own.
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Prove npm is actually gone, in the shape of the OCR-path assertions above: a
# build-time failure here beats shipping a package manager and its vendored
# advisories because a later edit reintroduced one. SECURITY_REVIEW §7's
# posture check, behavioural half; the text half is image-posture.test.ts.
RUN ! command -v npm && ! command -v npx \
    && test ! -d /usr/local/lib/node_modules/npm

# Receipt uploads are written by the app at runtime. The directory used to be
# created as root and then handed to an unprivileged user, so the first upload
# failed with EACCES. Create it with the right owner instead.
RUN mkdir -p /app/uploads/receipts && chown -R node:node /app/uploads

# Lets Docker and Compose restart a wedged container instead of leaving it
# listening but broken.
#
# `/api/health` rather than `/login`. A 200 from the login page proves the
# Node process is answering and nothing else — it renders with Postgres down
# and with Valkey down, and with Valkey down nobody can sign in at all, because
# the rate limiter fails closed. The health route checks both dependencies, so
# an instance that cannot do its job stops claiming it can.
#
# `start_period` is 30s rather than 20s to match: the first request now waits
# on Prisma's first connection, which the login page did not.
# `bun`, not `node`: this was the only Node process left in a *running*
# container, and the runtime the container actually depends on is the one it
# runs the server with. All three branches were checked under Bun rather than
# assumed — unreachable exits 1, a 200 exits 0, a 500 exits 1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000
USER node

# dumb-init reaps zombies and forwards signals, so the container stops promptly.
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "/opt/prisma/node_modules/.bin/prisma migrate deploy --schema=/app/prisma/schema.prisma && bun server.js"]
