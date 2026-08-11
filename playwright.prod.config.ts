import { defineConfig, devices } from "@playwright/test";

/**
 * The suite that needs a real production build.
 *
 * Separate from `playwright.config.ts` rather than a project inside it, for one
 * reason: that config is held to a five-minute `globalTimeout`, and a
 * `next build` is roughly a minute before a single test runs. Folding this in
 * would either blow the budget or force it up — and a budget raised to
 * accommodate the thing that broke it is not a budget.
 *
 * What lives here is anything whose subject is the *deployed* artefact rather
 * than the application's behaviour. Today that is the service worker, which
 * `registerServiceWorker` declines to register unless `NODE_ENV` is
 * `production`, so no test in the ordinary suite has ever executed it.
 *
 * Run with `pnpm test:e2e:sw`.
 */
const PORT = process.env.PLAYWRIGHT_PROD_PORT ?? "3200";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /(.*\.prod\.spec\.ts|seed\.setup\.ts)/,

  // One worker. A service worker is per origin, and two tests installing,
  // claiming and clearing caches on the same origin at once would be testing
  // each other rather than the worker.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",

  // Generous where the ordinary suite is tight: an install-and-activate cycle
  // plus an offline navigation is genuinely slower than a page assertion, and
  // this suite is small enough that a loose per-test ceiling costs nothing.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalTimeout: 8 * 60_000,

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Every test starts with no worker and no caches, which is the state a
    // first-time visitor is in — and the state the previous test was not.
    serviceWorkers: "allow",
  },

  projects: [
    /**
     * The demo household, because one of these tests signs in as it.
     *
     * Its own project rather than a `beforeAll` for the same reason as in the
     * ordinary config: a failure here reads as "seeding failed" instead of
     * "sign-in failed", which is a much shorter walk to the cause.
     */
    {
      name: "seed",
      testMatch: /seed\.setup\.ts/,
    },
    {
      name: "chromium",
      // The suites, and not the seed step — which the top-level `testMatch` has
      // to admit for the project above, and which this project would otherwise
      // collect and run a second time.
      testMatch: /.*\.prod\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["seed"],
    },
  ],

  /**
   * A real build, served the way the image serves it.
   *
   * **`node .next/standalone/server.js`, not `next start`.** `next.config.ts`
   * sets `output: "standalone"`, and `next start` says so itself when you try:
   * "does not work with output: standalone configuration". The Dockerfile's
   * `CMD` runs the standalone server, so that is the artefact worth pointing a
   * browser at — testing `next start` would be testing a server that is never
   * deployed.
   *
   * The two `cp` lines are what the Dockerfile does with `COPY --from=builder`:
   * the standalone output deliberately excludes `.next/static` and `public/`,
   * because in an image they are separate layers. Without them the worker
   * caches nothing, since there are no chunks to serve.
   *
   * `reuseExistingServer` is off, unlike in the ordinary config: adopting
   * whatever is on the port would defeat the entire purpose, since the thing
   * under test is that *this build* registers a worker. A stale dev server
   * there would report a passing suite for an application that never registers
   * one at all.
   */
  webServer: {
    command:
      "pnpm build" +
      " && cp -r .next/static .next/standalone/.next/static" +
      " && cp -r public .next/standalone/public" +
      " && node .next/standalone/server.js",
    url: BASE_URL,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      PORT,
      // A real secret, because `src/lib/auth/secret.ts` refuses to serve in
      // production with the example one — which is the point of that guard, and
      // means this suite has to supply a genuine value rather than inherit a
      // developer's placeholder. Not a secret in any meaningful sense: it signs
      // sessions for a server that exists for ninety seconds.
      NEXTAUTH_SECRET: "playwright-production-suite-secret-not-a-real-one-0001",
      // Must match the address the tests use, or Auth.js compares it against
      // the Host header and refuses. That comparison is why this suite exists.
      NEXTAUTH_URL: BASE_URL,
    },
    // A cold `next build` on a slow machine, plus server start.
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
