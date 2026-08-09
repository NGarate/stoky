import path from "node:path";

/**
 * The signed-in session, established once and reused.
 *
 * Every signed-in test used to sign in for itself: `goto("/login")`, a 1500ms
 * wait for hydration, two fills, a submit and a redirect — five to seven seconds
 * that proved nothing the test was about, repeated a few hundred times across
 * the matrix. That was the largest single cost in the suite.
 *
 * The `setup` project signs in once through the real form and writes the cookies
 * here; every signed-in suite declares `test.use({ storageState: SESSION_FILE })`
 * and starts already authenticated. Declared per suite rather than set on the
 * projects, so the default stays what Playwright's default is — signed out — and
 * being signed in is stated where it is true. The suites that are *about* signing
 * in (the login form, its refusals, the redirects for anonymous visitors) say
 * nothing and therefore get nothing.
 *
 * Under `.playwright/`, which is gitignored: these are real session cookies for
 * the demo account and they do not belong in the history.
 */
export const SESSION_FILE = path.join(
  process.cwd(),
  ".playwright/auth/demo.json",
);

/**
 * The seeded account. `prisma/seed.ts` creates it; the setup project fails with
 * that instruction if it cannot sign in.
 */
export const DEMO_EMAIL = "demo@stoky.local";
export const DEMO_PASSWORD = "Demo1234!";
