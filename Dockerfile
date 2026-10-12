# Stoky uses Bun for dependency installation, builds, migrations and serving.
# The pinned upstream image includes a node-named symlink to Bun for third-party
# shebangs; no separate Node.js, npm or npx runtime is installed in any stage.
FROM oven/bun:1.4.0-alpine AS bun

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
RUN apk add --no-cache git bash openssl \
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

# Bundle the Spanish OCR model so receipt scanning needs no runtime download.
ARG TESSDATA_SPA_SHA256=6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464
RUN mkdir -p /app/tessdata \
    && wget -q -O /app/tessdata/spa.traineddata \
       https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/spa.traineddata \
    && echo "${TESSDATA_SPA_SHA256}  /app/tessdata/spa.traineddata" | sha256sum -c -

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
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tessdata ./tessdata
ENV TESSDATA_PATH=/app/tessdata

RUN rm -rf /app/node_modules/tesseract.js /app/node_modules/tesseract.js-core
COPY --from=builder /opt/ocr/ ./node_modules/
COPY --from=builder /opt/prisma/ /opt/prisma/
RUN test -f /app/node_modules/tesseract.js/src/worker-script/index.js \
    && test -d /app/node_modules/tesseract.js/node_modules/tesseract.js-core \
    && test -f /opt/prisma/node_modules/prisma/build/index.js

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
