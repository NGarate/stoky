import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * The port is configurable because `reuseExistingServer` will happily adopt
 * whatever is already listening. If an unrelated process holds the port, the
 * whole suite runs against that other application and reports a wall of
 * confusing failures rather than a port conflict. Set PLAYWRIGHT_PORT to a free
 * port when 3000 is taken.
 */
const PORT = process.env.PLAYWRIGHT_PORT ?? "3000";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * The suites that sweep viewports and themes internally.
 *
 * Each of these already loops over three viewport tiers, and `accessibility`
 * over two themes as well — 90 tests from one file. Running them on five
 * browser projects asks the same question five times and multiplies the whole
 * matrix to 775 tests and roughly an hour and three quarters, which is long
 * enough that a healthy run and a hung one look identical from outside.
 *
 * They run on chromium only. The engine-dependent questions — does the layout
 * hold, does focus behave, does the page overflow — are answered across all
 * five by `critical-paths`, `dynamic-routes` and `location-picker`, which
 * measure geometry and interaction rather than sweeping tiers.
 *
 * `screen-reader` is on this list for a harder reason: it reads the tree over
 * the Chrome DevTools Protocol, which does not exist elsewhere.
 */
const CHROMIUM_ONLY = [
  "**/accessibility.spec.ts",
  "**/a11y-aaa.spec.ts",
  "**/a11y-structure.spec.ts",
  "**/screen-reader.spec.ts",
];

/**
 * How many browsers the one dev server can feed.
 *
 * Measured, not set to the core count. `next dev` renders on a single Node
 * process, so past a point the workers queue on it: on this 8-core machine the
 * full matrix took 5.7 minutes at four, 5.4 at six and 5.4 again at eight. Past
 * four the wall clock stops improving and the dev server starts losing: at eight
 * two tests went red, and at six `/inventory` sat on its loading skeleton until
 * the fifteen-second action timeout ran out. Neither is a defect the suite
 * found; both are the suite outrunning the one server it is pointed at, which is
 * a slower way of learning nothing.
 *
 * So four, which is the last point that is both fast and honest. CI gets two,
 * which is a judgement rather than a measurement: `ubuntu-latest` has four cores
 * and has to run the dev server on them too.
 */
const WORKERS = Number(process.env.PLAYWRIGHT_WORKERS) || (process.env.CI ? 2 : 4);

export default defineConfig({
  testDir: "./e2e",
  /**
   * Whole files in parallel, tests within a file in order.
   *
   * The suite writes: `critical-paths` registers accounts, and `screen-reader`
   * adds a stock movement and confirms a receipt line. What made the old
   * `workers: 1` necessary was that every signed-in test also *registered*
   * against the shared database, so any two tests could collide. They no longer
   * do — they reuse one session (`e2e/session.ts`) — and what is left writes to
   * rows nothing else counts.
   *
   * `fullyParallel` stays off deliberately, because it is a claim about every
   * file and only five of the seven can make it. The five that read and write
   * nothing — `accessibility`, `a11y-aaa`, `a11y-structure`, `dynamic-routes`,
   * `location-picker` — say so for themselves with `describe.configure({ mode:
   * "parallel" })`, which matters because `accessibility` alone is the longest
   * thing in the suite and pinning it to one worker makes it the critical path.
   * The two writers, `critical-paths` and `screen-reader`, stay whole in one
   * worker: their tests build on each other within the file.
   */
  fullyParallel: false,
  workers: WORKERS,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",

  /**
   * Every timeout here is set explicitly rather than left to a default, because
   * this project has already lost a thirty-minute run to a dev server that had
   * wedged at 100% CPU: Playwright sat in `webServer` waiting for a URL that was
   * never going to answer, and the run looked identical to a slow one. A suite
   * with no ceiling cannot tell you it is in trouble.
   */

  // Per test. The slowest honest test is an axe audit on a data-driven route,
  // which is a navigation, a tRPC round trip and the audit itself — well under
  // 30s. 60 leaves room for a cold Next compile on first hit without letting a
  // genuinely hung test sit there.
  timeout: 60_000,

  // Per `expect`. The default is 5s, which is fine for an assertion but too
  // short for the web-first assertions that wait on a route change.
  expect: { timeout: 10_000 },

  // Nine minutes, inside the ten every test job in CI is held to. Playwright
  // fails first and names the test it was sitting on; a job killed by the runner
  // leaves no report and no trace.
  //
  // Seven was the first attempt and it was too tight. The matrix runs in 5.5
  // minutes on an eight-core machine at four workers; CI has four cores, runs
  // the dev server on them too, and retries failures twice. Seven leaves that
  // almost no room, and a ceiling that fails runs which still meet the contract
  // teaches people to raise the ceiling. Nine holds the contract and only fires
  // on a suite that has genuinely stopped meeting it.
  //
  // The budget is the point: verification this slow stops being run, and the run
  // fails when it regresses past it rather than quietly getting slower.
  globalTimeout: 9 * 60_000,

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // A click or a fill that cannot resolve should fail as itself rather than
    // consuming the whole test budget and reporting a timeout with no subject.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    /**
     * Signs in once and writes the cookies the signed-in suites reuse. Every
     * browser project depends on it, so it runs first and its failure stops the
     * matrix rather than being reported five times as "not signed in".
     */
    {
      name: "setup",
      testMatch: /session\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: CHROMIUM_ONLY,
      dependencies: ["setup"],
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: CHROMIUM_ONLY,
      dependencies: ["setup"],
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
      testIgnore: CHROMIUM_ONLY,
      dependencies: ["setup"],
    },
    {
      name: "Mobile Safari",
      use: { ...devices["iPhone 12"] },
      testIgnore: CHROMIUM_ONLY,
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // A cold `next dev` compile is slow; a wedged one never answers at all. Two
    // minutes tells the two apart and reports the port instead of hanging.
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
