# Multi-stage Dockerfile for Stoky
# Stage 1: Dependencies
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Stage 2: Development
FROM node:24-alpine AS development
WORKDIR /app
RUN npm install -g pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "dev"]

# Stage 3: Builder
FROM node:24-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN pnpm prisma generate
RUN pnpm build

# Stage 4: Production
FROM node:24-alpine AS production
WORKDIR /app
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create uploads directory
RUN mkdir -p /app/uploads/receipts

# Copy necessary files
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.pnpm/@prisma+client* ./node_modules/.pnpm/
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000
USER node

# Run migrations and start server
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
