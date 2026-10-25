/**
 * Whether the demo seed may run in this environment.
 *
 * The seed creates `demo@stoky.local` as an OWNER with a password the README
 * publishes, and it deletes the demo account's household first. On a database
 * real people use, the first is a default credential (CWE-1392) and the second
 * is data loss, so a production environment is refused outright. There is no
 * override: a demo instance is a development database with a public address,
 * and the honest way to run one is without `NODE_ENV=production`.
 *
 * A module of its own because importing `seed.ts` runs the seed — a test of the
 * guard has to be able to reach it without touching a database.
 *
 * Returns the reason for refusing, or null when the seed may run.
 */
export function demoSeedRefusal(
  env: Record<string, string | undefined>,
): string | null {
  // Trimmed and lower-cased: a refusal that a stray space or a capital letter
  // walks past is not a refusal. Next itself only honours the exact value, but
  // nothing here is harmed by refusing more readily than it does.
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv !== "production") return null;

  return (
    "Refusing to seed: NODE_ENV is production. The demo seed creates " +
    "demo@stoky.local with a published password and deletes that account's " +
    "household first; it is for development and test databases only."
  );
}
