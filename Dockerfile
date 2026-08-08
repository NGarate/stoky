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
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000
USER node

# dumb-init reaps zombies and forwards signals, so the container stops promptly.
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "/opt/prisma/node_modules/.bin/prisma migrate deploy --schema=/app/prisma/schema.prisma && node server.js"]
