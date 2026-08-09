import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma configuration.
 *
 * Replaces the `prisma` key in package.json, which Prisma 6 deprecates with a
 * warning on every command and removes in Prisma 7. Moving it now means the
 * eventual major upgrade is not also a config migration.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    // Bun runs the TypeScript seed directly, with no build step.
    seed: "bun run prisma/seed.ts",
  },
});
