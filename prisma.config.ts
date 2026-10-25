import fs from "node:fs";
import path from "node:path";
import type { PrismaConfig } from "prisma/config";

/**
 * Prisma configuration.
 *
 * Replaced the `prisma` key in package.json, which Prisma 7 removed. It also
 * carries the database URL for the CLI, and ships in the production image,
 * where the entrypoint's `migrate deploy` reads it.
 *
 * **A plain object with a type-only import, not `defineConfig()`.** The
 * production image runs the CLI from /opt/prisma against this file in /app,
 * whose node_modules is Next's standalone trace and has no `prisma` package:
 * a value import of `prisma/config` would not resolve there, and the
 * container would stop before migrating. `defineConfig` only returns its
 * argument; `satisfies` keeps the checking it gave.
 *
 * The presence of this file makes the Prisma CLI skip its automatic .env
 * loading ("Prisma config detected, skipping environment variable loading"),
 * so the file has to load it itself. Node's loadEnvFile never overrides
 * variables already set, so CI-provided values still win over .env.
 */
if (fs.existsSync(".env")) {
  process.loadEnvFile(".env");
}

// Where Migrate connects, which Prisma 7 no longer reads from the schema.
// Conditional rather than Prisma's `env()`, which throws when the variable is
// unset: `prisma generate` needs no database and runs in the image build with
// none, while `migrate deploy` without one still refuses, naming the URL.
const url = process.env.DATABASE_URL;

export default {
  schema: path.join("prisma", "schema.prisma"),
  ...(url ? { datasource: { url } } : {}),
  migrations: {
    // Bun runs the TypeScript seed directly, with no build step.
    seed: "bun run prisma/seed.ts",
  },
} satisfies PrismaConfig;
