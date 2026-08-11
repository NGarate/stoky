# Multi-stage Dockerfile for Stoky.
#
# The production target is what people self-host, so it is treated as the
# security boundary: no build toolchain, no package manager fetching code at
# start-up, no root, and a health check the orchestrator can act on.
#
# The base image is pinned by tag rather than digest on purpose. A digest would
# freeze the Alpine security updates that arrive in node:24-alpine rebuilds; the
# Trivy gate in CI is what catches a base image that has gone stale.

# ---------------------------------------------------------------- deps --
FROM node:24-alpine AS deps
# argon2 and @swc/core compile native bindings, so the toolchain is needed here.
# It stays in this stage and never reaches production.
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
# corepack honours the packageManager field, so the build uses the same pnpm
# version as the lockfile instead of whatever `npm i -g pnpm` resolves today.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile --trust-lockfile

# ----------------------------------------------------------- development --
FROM node:24-alpine AS development
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=development
EXPOSE 3000
CMD ["corepack", "pnpm", "dev"]

# --------------------------------------------------------------- builder --
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack pnpm prisma generate
RUN corepack pnpm build

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
# `cp -rL` dereferences the pnpm symlinks, so the staged tree is self-contained;
# the directory name keeps its version so the production COPY below lands it
# exactly where the standalone output's symlinks already point.
RUN mkdir -p /opt/ocr && cp -rL /app/node_modules/.pnpm/tesseract.js@*/ /opt/ocr/

ARG TESSDATA_SPA_SHA256=6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464
RUN mkdir -p /app/tessdata \
    && wget -q -O /app/tessdata/spa.traineddata \
       https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/spa.traineddata \
    && echo "${TESSDATA_SPA_SHA256}  /app/tessdata/spa.traineddata" | sha256sum -c -

# ------------------------------------------------------------ production --
FROM node:24-alpine AS production
WORKDIR /app
RUN apk add --no-cache dumb-init
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

# The complete tesseract.js staged above, replacing the partial copy tracing
# produced (OCR-2). The traced tree has to go first: it holds *symlinks* where
# the staged tree has real directories, and COPY cannot overwrite one with the
# other — the build fails with "cannot copy to non-directory".
RUN rm -rf /app/node_modules/.pnpm/tesseract.js@*
# Into `.pnpm/`, so the version-named directory inside `/opt/ocr` lands where
# the standalone output's own symlinks already point.
COPY --from=builder /opt/ocr/ ./node_modules/.pnpm/
# Build-time assertions on the two files whose absence broke scanning: the
# worker's own `require('..')` target, and the WASM engine. A wrong path here
# must fail the build, not the first scan of a deployed household.
RUN test -f /app/node_modules/.pnpm/tesseract.js@*/node_modules/tesseract.js/src/worker-script/index.js \
    && test -d /app/node_modules/.pnpm/tesseract.js@*/node_modules/tesseract.js-core

# The entrypoint runs `prisma migrate deploy`. Previously it did so through
# `npx`, with no prisma package in the image — which meant every container
# start downloaded an unpinned CLI from the network before touching the
# database. That fails on an air-gapped host and is code execution fetched at
# runtime on every other one. Install it at build time, at the version the
# lockfile already resolved.
# Installed into its own prefix rather than /app: installing alongside the
# application's package.json makes npm resolve the entire dependency tree,
# peer conflicts and all, which fails.
RUN PRISMA_VERSION="$(node -p "require('/app/package.json').dependencies.prisma.replace(/[^0-9.]/g,'')")" \
    && mkdir -p /opt/prisma \
    && cd /opt/prisma \
    && npm init -y > /dev/null \
    && npm install --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
    && npm cache clean --force

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
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000
USER node

# dumb-init reaps zombies and forwards signals, so the container stops promptly.
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "/opt/prisma/node_modules/.bin/prisma migrate deploy --schema=/app/prisma/schema.prisma && node server.js"]
