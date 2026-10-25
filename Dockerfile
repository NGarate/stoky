# Stoky uses Bun for dependency installation, builds, migrations and serving.
# The pinned upstream image includes a node-named symlink to Bun for third-party
# shebangs; no separate Node.js, npm or npx runtime is installed in any stage.
# Pinned by the digest of the multi-platform index, because a tag can be
# re-pushed and a digest cannot; the tag is kept for readers and must name the
# same index (`docker buildx imagetools inspect oven/bun:<version>-alpine`).
FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS bun

FROM bun AS deps
USER root
WORKDIR /app
# Only package.json's trustedDependencies run install scripts, through Bun's
# compatibility link. argon2's node-gyp-build loads its shipped musl prebuild;
# the toolchain is only its fallback if none matches. Toolchains stay in this
# stage; production receives only built dependencies.
RUN apk add --no-cache libc6-compat python3 make g++ openssl
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM bun AS development
USER root
WORKDIR /app
# Fixtures execute Bash; Git inspects the intentionally mounted checkout.
# Trust exactly /app, not every repository. BUILD-2 pins this behavior.
# ssh-keygen is what Git signs and verifies an SSH-signed tag with, which
# the release-tag tests do for real.
RUN apk add --no-cache git bash openssl openssh-keygen \
    && git config --system --add safe.directory /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run db:generate
ENV NODE_ENV=development
EXPOSE 3000
CMD ["bun", "run", "dev"]

FROM bun AS builder
USER root
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run db:generate
RUN bun run build

# Next tracing cannot discover OCR worker/engine loads or the migration CLI.
# Stage their complete dependency trees from the frozen installation rather
# than downloading another, independently resolved CLI during the image build.
RUN bun scripts/stage-runtime-deps.ts tesseract.js /opt/ocr \
    && bun scripts/stage-runtime-deps.ts prisma /opt/prisma/node_modules

# Prisma's postinstall downloads the schema engine from binaries.prisma.sh and
# checks it only against a .sha256 from the same origin; bun.lock covers the npm
# tarballs, not this. Pin it as tessdata is, at the one path that ships:
# migrate deploy runs it. Prisma 7 has no query engine binary: the server
# queries through the pg driver adapter and a WebAssembly query compiler that
# arrives in the npm tarball. The count catches a native engine this does not
# name, the old query engine among them. A Prisma upgrade fails here until the
# value is refreshed (docs/RELEASING.md). amd64 only.
ARG PRISMA_SCHEMA_ENGINE_SHA256=c583d08ce5150fe39ff1d4a981c790e3eee8e1fbb432b80dba7606d74c1e56cf
RUN printf '%s  %s\n' \
      "${PRISMA_SCHEMA_ENGINE_SHA256}" /opt/prisma/node_modules/prisma/node_modules/@prisma/engines/schema-engine-linux-musl-openssl-3.0.x \
    | sha256sum -c - \
    && test "$(find /opt/prisma /app/.next/standalone \( -name 'schema-engine*' -o -name 'query-engine*' -o -name '*.so.node' \) | wc -l)" = 1

# Bundle the Spanish OCR model so receipt scanning needs no runtime download.
ARG TESSDATA_SPA_SHA256=6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464
RUN mkdir -p /app/tessdata \
    && wget -q -O /app/tessdata/spa.traineddata \
       https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/spa.traineddata \
    && echo "${TESSDATA_SPA_SHA256}  /app/tessdata/spa.traineddata" | sha256sum -c -

# COPY keeps the build context's modes, so a checkout made under umask 077 put
# root-owned 0600 files and 0700 directories into production, where bun cannot
# read them and the server dies with EACCES. Normalise everything production
# copies, last, so nothing written after it escapes: readable and traversable by
# all, writable by root alone, executables still executable. Not `go=rX`:
# BusyBox clears the bits before testing X, so it strips execute from files.
RUN chmod -R a+rX,go-w /app/.next/standalone /app/.next/static /app/public \
      /app/prisma /app/prisma.config.ts /app/package.json /app/tessdata \
      /opt/ocr /opt/prisma

FROM bun AS production
USER root
WORKDIR /app
# Pull patched Alpine packages when building; CI scans before publication.
RUN apk upgrade --no-cache && apk add --no-cache dumb-init openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Migrations need the schema and the migrations directory, nothing else in
# prisma/. The demo seed stays out: it hard-codes an OWNER with a password the
# README publishes, and nothing at runtime reads it. Two COPYs, because a
# directory source copies its contents, not itself.
COPY --from=builder /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /app/prisma/migrations ./prisma/migrations
# Where migrate deploy reads DATABASE_URL: Prisma 7 takes it from the config
# file only, and the CLI finds this one in the working directory.
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tessdata ./tessdata
ENV TESSDATA_PATH=/app/tessdata

RUN rm -rf /app/node_modules/tesseract.js /app/node_modules/tesseract.js-core
COPY --from=builder /opt/ocr/ ./node_modules/
COPY --from=builder /opt/prisma/ /opt/prisma/
RUN test -f /app/node_modules/tesseract.js/src/worker-script/index.js \
    && test -d /app/node_modules/tesseract.js/node_modules/tesseract.js-core \
    && test -f /opt/prisma/node_modules/prisma/build/index.js \
    && test -f /app/prisma/migrations/migration_lock.toml \
    && test -f /app/prisma.config.ts \
    && test ! -e /app/prisma/seed.ts

# Assert the apparent node command is Bun, not a second runtime. A missing
# migration engine or a reintroduced Node/npm installation fails the build.
RUN test "$(readlink -f "$(command -v node)")" = "$(readlink -f "$(command -v bun)")" \
    && node -e "if (!process.versions.bun) process.exit(1)" \
    && ! command -v npm && ! command -v npx \
    && bun /opt/prisma/node_modules/prisma/build/index.js --version

# bun has UID/GID 1000, matching the old node account: existing uploads remain
# writable across the runtime-image change without an ownership migration.
RUN test "$(id -u bun)" = 1000 && test "$(id -g bun)" = 1000 \
    && mkdir -p /app/uploads/receipts && chown -R bun:bun /app/uploads
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
EXPOSE 3000
USER bun
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "bun /opt/prisma/node_modules/prisma/build/index.js migrate deploy --schema=/app/prisma/schema.prisma && exec bun server.js"]
