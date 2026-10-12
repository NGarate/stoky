import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl, e2eValkeyUrl } from "./e2e/db-url";

/**
 * Playwright configuration.
 *
 * The port is configurable, and the default is 3100 rather than 3000 because
 * 3000 is routinely somebody's dev server. `reuseExistingServer` is off, so a
 * taken port fails loudly as a port conflict instead of the old failure mode —
 * silently adopting whatever was listening and reporting a wall of confusing
 * failures against the wrong application. Set PLAYWRIGHT_PORT when 3100 is
 * taken too.
 */
const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
/**
 * 127.0.0.1, never `localhost`. The standalone server binds IPv4 (`0.0.0.0`),
 * and `localhost` resolves to `::1` first in some stacks — WebKit's fetch does
 * it on this machine, and Node's own readiness probe can do it inside the CI
 * container — which turns into instant connection refusals against a server
 * that is up. Naming the address removes the whole class.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * The suites that sweep viewports and themes internally.
 *
 * Each of these already loops over three viewport tiers, and `accessibility`
 * over two themes as well — 90 tests from one file. Running them on five
 * browser projects asks the same question five times and multiplies the whole
 * matrix to 775 tests and roughly an hour and three quarters, which is long
 * enough that a healthy run and a hung one look identical from outside.
 *
 * They run on chromium only. The engine-dependent question they would ask a
 * second engine — does the layout hold at this width — is asked instead by
 * `dynamic-routes` and `location-picker` on Mobile Safari, which is one
 * engine's worth of layout coverage rather than four.
 *
 * `screen-reader` is on this list for a harder reason: it reads the tree over
 * the Chrome DevTools Protocol, which does not exist elsewhere.
 */
const CHROMIUM_ONLY = [
  "**/accessibility.spec.ts",
  "**/a11y-aaa.spec.ts",
  "**/a11y-structure.spec.ts",
  "**/screen-reader.spec.ts",
  // The two artefact suites, folded in from the deleted prod config now that
  // the whole suite serves the standalone build. Checks about the deployed
  // artefact, not about an engine — one engine's answer is the answer.
  "**/auth.prod.spec.ts",
  "**/service-worker.prod.spec.ts",
  // Whether the server refuses a token it already issued has one engine's
  // answer, and this one costs two browser contexts and two registrations to
  // ask. Running it five times would buy nothing.
  "**/session-revocation.spec.ts",
];

/**
 * The specs whose subject is layout rather than behaviour.
 *
 * These are the only ones a second engine can answer differently: whether a
 * page overflows sideways, and whether a fixed bar is painted over a control.
 * Everything else in the browser suite is a business flow, and a business flow
 * does not change because the engine did.
 */
const LAYOUT_SPECS = [
  "**/dynamic-routes.spec.ts",
  "**/location-picker.spec.ts",
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

  // The budget, enforced. A suite that gets slower without anyone noticing is
  // one that stops being run, so the ceiling is the contract rather than a
  // safety net: the run fails when it regresses past it.
  //
  // Five minutes locally, where it takes 2.9 at four workers — enough headroom
  // for a cold Next compile and a slow machine, tight enough that doubling the
  // suite fails here instead of in review. Nine in CI, which is not a weaker
  // contract but a different machine: two workers on four cores that are also
  // running the dev server, and two retries on any failure. Both stay inside
  // the ten minutes every CI test job is held to.
  //
  // It was nine everywhere when the suite ran 182 tests in 5.6 minutes. It runs
  // 89 in 2.9 now, and a ceiling three times the measurement is not a ceiling.
  globalTimeout: (process.env.CI ? 9 : 5) * 60_000,

  use: {
    baseURL: BASE_URL,
    /**
     * The production build registers `public/sw.js`, and a live worker makes
     * ordinary tests dishonest two ways at once: its 2,500 ms navigation race
     * serves the cached shell — or `/offline` — whenever a loaded machine is
     * slow, so an index page arrives with no rows and a test fails against a
     * fallback it was never meant to see; and its fetch interception unsettles
     * `networkidle` on WebKit. Measured, not feared: allowing it failed 9 of
     * 108 on the first standalone run, all in the two shapes above.
     *
     * So the ordinary suite blocks registration, which is exactly the state
     * these tests ran in when the server was `next dev` (the worker declines
     * to register outside production). The worker's own specs opt back in with
     * `test.use({ serviceWorkers: "allow" })`.
     */
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // A click or a fill that cannot resolve should fail as itself rather than
    // consuming the whole test budget and reporting a timeout with no subject.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  /**
   * One engine runs everything; the others run what only they can answer.
   *
   * The suite used to run every spec on five projects, which is 182 tests and
   * 1,098 seconds of processor time for 26 distinct behaviours. Duplicating a
   * login flow across five engines does not test five things — the flow is
   * tRPC and Prisma, and neither is rendered. What genuinely varies between
   * engines is layout, and what varies between projects is viewport, and those
   * are two axes the old matrix multiplied instead of separating.
   *
   * So: chromium is the reference and runs the lot. Mobile Safari runs the
   * layout specs, because WebKit at a phone width is the combination where
   * this project's layout defects have actually appeared — UI-5 was a page
   * 505px wide at 390, UI-6 was a picker painted under the bottom bar. Desktop
   * Firefox and WebKit run a four-test smoke set: register, sign in, write
   * something, and read a page in Spanish. If an engine breaks those, it has
   * broken enough to be worth knowing before anything subtler.
   *
   * Mobile Chrome is gone. It is Blink at 393px, and chromium already visits
   * every route at that width — the three a11y specs loop the tiers with
   * `setViewportSize`, and `dynamic-routes` checks overflow at all three. It
   * was an engine we already run at a width we already test.
   */
  projects: [
    /**
     * Restores the demo household before anything reads it. The suite writes —
     * confirming receipt lines, ticking items, consuming stock — and the
     * fixture is finite, so without this the suite works once and then reports
     * defects that are not there. See `e2e/seed.setup.ts`.
     */
    {
      name: "seed",
      testMatch: /seed\.setup\.ts/,
    },
    /**
     * Signs in once and writes the cookies the signed-in suites reuse. Every
     * browser project depends on it, so it runs first and its failure stops the
     * matrix rather than being reported five times as "not signed in".
     */
    {
      name: "setup",
      testMatch: /session\.setup\.ts/,
      dependencies: ["seed"],
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      // WebKit at a real phone viewport: the layout specs only.
      name: "Mobile Safari",
      use: { ...devices["iPhone 12"] },
      testMatch: LAYOUT_SPECS,
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: CHROMIUM_ONLY,
      grep: /@smoke/,
      dependencies: ["setup"],
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: CHROMIUM_ONLY,
      grep: /@smoke/,
      dependencies: ["setup"],
    },
  ],

  /**
   * A real production build, served the way the image serves it, on the
   * suite's own data.
   *
   * The dev server sat here until 2026-08-17, and cost three things at once:
   * the suite tested a server nobody deploys — which is how broken production
   * auth once shipped under green suites, since `next dev` applies neither
   * `trustHost` nor the production CSP (docs/STATUS.md) — it fought the
   * developer's own `bun run dev` for Next's per-directory single-instance lock,
   * which took a mid-run suite's server down for real that day, and it read
   * the developer's database. The standalone server takes no lock, reads
   * `stoky_e2e`, and is the artefact a self-hosted install actually runs.
   *
   * **`node .next/standalone/server.js`, not `next start`** — `next.config.ts`
   * sets `output: "standalone"` and `next start` refuses it. The two `cp`
   * lines are what the Dockerfile does with `COPY --from=builder`: standalone
   * output deliberately excludes `.next/static` and `public/`.
   *
   * `reuseExistingServer` is off everywhere now: adopting whatever holds the
   * port means testing a stale build, or somebody else's server entirely.
   */
  webServer: {
    command:
      "bun run build" +
      " && cp -r .next/static .next/standalone/.next/static" +
      " && cp -r public .next/standalone/public" +
      " && bun .next/standalone/server.js",
    url: BASE_URL,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      PORT,
      // The standalone server binds `process.env.HOSTNAME`. Docker exports
      // HOSTNAME as the container id inside container jobs, so without this
      // the server binds the container's own interface and the 127.0.0.1
      // readiness probe spins against a loopback nothing listens on — which
      // is exactly how CI died twice while the same suite ran green locally,
      // where HOSTNAME is a shell variable nobody exports.
      HOSTNAME: "0.0.0.0",
      // The suite's own database and cache — never the developer's. The
      // server is pointed here while `e2e/seed.setup.ts` migrates and seeds
      // the same URL; Prisma connects lazily, so the server can boot before
      // the database exists on a first run.
      DATABASE_URL: e2eDatabaseUrl(),
      VALKEY_URL: e2eValkeyUrl(),
      // `src/lib/auth/secret.ts` refuses production service with the example
      // secret — the point of that guard — so this suite supplies a genuine
      // value. Not a secret in any meaningful sense: it signs sessions for a
      // server that lives five minutes.
      NEXTAUTH_SECRET: "playwright-suite-secret-not-a-real-one-0001",
      // Must match the address the tests use, or Auth.js compares it against
      // the Host header and refuses — the comparison e2e/auth.prod.spec.ts
      // exists to keep working.
      NEXTAUTH_URL: BASE_URL,
      // The auth rate limiter (ISSUES.md CRITICAL-4) counts per IP, and every
      // browser project reaches the dev server without a proxy in front of it,
      // so the whole matrix shares one bucket. At the shipped limits — 5
      // sign-ins per 15 minutes, 3 registrations per hour — the suite would
      // spend most of a run locked out of a control it is not testing.
      //
      // Raised here rather than switched off, so the limiter still runs on
      // every request the suite makes and a crash in it still fails the suite.
      // The shipped defaults are asserted with the environment unset in
      // `src/__tests__/unit/rate-limit.test.ts`, and the counting itself is
      // proven against a real Valkey in the integration suite — so this
      // override cannot quietly become the product's behaviour.
      RATE_LIMIT_LOGIN_ATTEMPTS: "10000",
      RATE_LIMIT_REGISTER_ATTEMPTS: "10000",
      // And the per-account one, for a sharper reason than the two above: the
      // whole suite signs in as the *same* seeded demo user, so every worker
      // shares one account counter however many addresses they come from —
      // which is precisely what that limit is for.
      RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS: "10000",
      // And the Open Food Facts lookup meter, for the same shared-account
      // reason: every worker scans as the demo user, so the whole matrix
      // spends one per-account budget of 60 new codes an hour, and repeated
      // runs within the hour spend it again. The meter itself is proven in
      // `src/__tests__/integration/resolveScan.test.ts`.
      RATE_LIMIT_PRODUCT_LOOKUP_ATTEMPTS: "10000",
      // Production leaves registration `first-user` when this is unset
      // (`src/lib/auth/registration.ts`), and the seeded demo household is
      // already an account — so every spec that registers would be refused.
      // `open` is a shipped mode, not a test-only bypass; `first-user` and
      // `closed` are proven against a real database in the integration suite.
      STOKY_REGISTRATION: "open",
    },
    // A cold `next build` on a slow machine, plus server start. A wedged build
    // never answers at all; five minutes tells the two apart.
    timeout: 300_000,
    // Piped, not ignored: when the webServer times out in CI, the build's own
    // output is the only evidence of where those minutes went.
    stdout: "pipe",
    stderr: "pipe",
  },
});
