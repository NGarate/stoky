/**
 * The browser suite's own database and cache, derived in one place.
 *
 * The suite seeds itself and *spends* the fixture, so it must never point at
 * the database a developer's `bun run dev` is using — on 2026-08-17 it reset the
 * demo household underneath the owner mid-test. The rule since: the suite owns
 * `stoky_e2e` (created and migrated by `e2e/seed.setup.ts`) and Valkey db
 * index 1, and the developer's data is out of reach by construction.
 *
 * CI sets E2E_DATABASE_URL / E2E_VALKEY_URL explicitly, because its services
 * are already scoped to the job and a rename inside them buys nothing.
 *
 * Imported by `playwright.config.ts` (the server's env) and `e2e/seed.setup.ts`
 * (migrate + seed), which is what keeps the two from disagreeing about which
 * database the suite is on.
 */

export function e2eDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.E2E_DATABASE_URL) return env.E2E_DATABASE_URL;
  if (!env.DATABASE_URL) {
    throw new Error(
      "The browser suite needs E2E_DATABASE_URL, or DATABASE_URL to derive one from. " +
        "Export the environment first: set -a; . ./.env; set +a",
    );
  }
  const url = new URL(env.DATABASE_URL);
  url.pathname = "/stoky_e2e";
  return url.toString();
}

export function e2eValkeyUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.E2E_VALKEY_URL) return env.E2E_VALKEY_URL;
  // Same fallback as src/lib/valkey.ts, moved onto its own db index.
  const base = env.VALKEY_URL ?? "redis://localhost:6379";
  const url = new URL(base);
  url.pathname = "/1";
  return url.toString();
}
