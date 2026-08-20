import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma configuration.
 *
 * Replaces the `prisma` key in package.json, which Prisma 6 deprecates with a
 * warning on every command and removes in Prisma 7. Moving it now means the
 * eventual major upgrade is not also a config migration.
 *
 * The presence of this file makes the Prisma CLI skip its automatic .env
 * loading ("Prisma config detected, skipping environment variable loading"),
 * so the file has to load it itself. Node's loadEnvFile never overrides
 * variables already set, so CI-provided values still win over .env.
 */
if (fs.existsSync(".env")) {
  process.loadEnvFile(".env");
}
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    // Bun runs the TypeScript seed directly, with no build step.
    seed: "bun run prisma/seed.ts",
  },
});
