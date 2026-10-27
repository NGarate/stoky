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
 * The same server, named `localhost`: the one address passkeys can be tested
 * at (PROGRESS D151).
 *
 * A passkey belongs to a relying party named by a host, and **WebAuthn does
 * not take an IP address as that name** (docs/TEST_SETUP.md), so at 127.0.0.1
 * the server registers no passkey plugin at all
 * (`src/lib/auth/passkeys.ts`) and the browser could not use one if it did.
 * `localhost` is a name, and a secure context over plain http. So the
 * server lists it first in `STOKY_URLS` (below), making it the canonical
 * address and the relying party, and lists `BASE_URL` second, which keeps
 * 127.0.0.1 a trusted origin for everything else in the suite. Only the
 * canonical entry decides anything else — the cookie's `Secure` flag — and
 * both are plain http, so the rest of the suite sees the server it always
 * did.
 *
 * Only the `passkeys` project goes to this address, with Chromium told that
 * `localhost` is 127.0.0.1: the IPv6-first resolution `BASE_URL`'s comment
 * describes (STATUS trap 8) would otherwise come back for the one project
 * that cannot avoid the name. The suite as a whole stays on 127.0.0.1.
 */
const PASSKEY_URL = `http://localhost:${PORT}`;

/**
 * Whether the server this run talks to is the one `webServer` starts, which
 * is the only one known to list `PASSKEY_URL` first. A `PLAYWRIGHT_BASE_URL`
 * naming anything else — another port, another machine — is a server whose
 * `STOKY_URLS` this file does not set, so the passkeys project is left out
 * rather than reported failing against a configuration it never had.
 */
const PASSKEYS_TESTABLE = (() => {
  const base = new URL(BASE_URL);
  return (
    base.port === PORT && ["127.0.0.1", "localhost"].includes(base.hostname)
  );
})();

/**
 * The specs that sign in with a passkey, run by the `passkeys` project and
 * by no other.
 */
const PASSKEY_SPECS = ["**/passkeys.spec.ts"];

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
const WORKERS =
  Number(process.env.PLAYWRIGHT_WORKERS) || (process.env.CI ? 2 : 4);

export default defineConfig({
  testDir: "./e2e",
  /**
   * Every test, in parallel. Each is one happy path that brings its own data:
   * it registers its own account, or works in the seeded household on rows no
   * other test reads.
   */
  fullyParallel: true,
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

  // Per test. The slowest is a two-step sign-in in a second browser, well
  // under 30s. 60 leaves room for a cold first hit without letting a
  // genuinely hung test sit there.
  timeout: 60_000,

  // Per `expect`. The default is 5s, which is fine for an assertion but too
  // short for the web-first assertions that wait on a route change.
  expect: { timeout: 10_000 },

  // The budget, enforced. A suite that gets slower without anyone noticing is
  // one that stops being run, so the ceiling is the contract rather than a
  // safety net: the run fails when it regresses past it.
  //
  // Five minutes locally, where twelve tests take under one at four workers —
  // the headroom is the production build, which `webServer` makes inside this
  // budget. Nine in CI: two workers on four cores that also run the server,
  // and two retries on any failure, inside the ten minutes every CI test job
  // is held to.
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
   * One engine. Each test is a business flow — tRPC and Prisma behind a form —
   * and a business flow does not change because the engine did.
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
     * Signs in once and writes the cookies the signed-in suites reuse. The
     * signed-in tests depend on it, so its failure is reported once rather than
     * as each of them "not signed in".
     */
    {
      name: "setup",
      testMatch: /session\.setup\.ts/,
      dependencies: ["seed"],
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: PASSKEY_SPECS,
      dependencies: ["setup"],
    },
    /**
     * Chromium at `localhost`, for the passkey specs alone (`PASSKEY_URL`).
     * Chromium because its DevTools protocol has a virtual authenticator, the
     * only way a browser here can hold a passkey; and one engine because
     * whether a server accepts a passkey has one engine's answer. Its spec
     * registers its own account, so it needs the seeded database and not the
     * shared session.
     */
    ...(PASSKEYS_TESTABLE
      ? [
          {
            name: "passkeys",
            testMatch: PASSKEY_SPECS,
            use: {
              ...devices["Desktop Chrome"],
              baseURL: PASSKEY_URL,
              launchOptions: {
                args: ["--host-resolver-rules=MAP localhost 127.0.0.1"],
              },
            },
            dependencies: ["seed"],
          },
        ]
      : []),
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
      STOKY_SECRET: "playwright-suite-secret-not-a-real-one-0001",
      // Must list every address the tests use: Better Auth accepts a sign-in
      // from a cookie-bearing browser only at a listed origin
      // (src/lib/auth/public-url.ts). `localhost` first, as the canonical
      // address passkeys belong to (`PASSKEY_URL`); 127.0.0.1, where the rest
      // of the suite runs, second. The first entry also decides the cookie's
      // Secure flag, and both are plain http, so that is unchanged.
      // A server the passkeys project is not run against keeps the one entry.
      STOKY_URLS:
        PASSKEYS_TESTABLE && PASSKEY_URL !== BASE_URL
          ? `${PASSKEY_URL},${BASE_URL}`
          : BASE_URL,
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
      // And the known-device one, which takes over from it once a browser has
      // signed in to that account: a spec that signs in twice in one context
      // is one browser counted on its own five per window.
      RATE_LIMIT_LOGIN_DEVICE_ATTEMPTS: "10000",
      // And the Open Food Facts lookup meter, for the same shared-account
      // reason: every worker scans as the demo user, so the whole matrix
      // spends one per-account budget of 60 new codes an hour, and repeated
      // runs within the hour spend it again. The meter itself is proven in
      // `src/__tests__/integration/resolveScan.test.ts`.
      RATE_LIMIT_PRODUCT_LOOKUP_ATTEMPTS: "10000",
      // Adding a member is counted per admin account, and the suite signs in
      // as one seeded account, so every worker would share one counter. No
      // spec adds people today; one that does should not find the budget
      // spent by the specs that ran before it.
      RATE_LIMIT_ADD_MEMBER_ATTEMPTS: "10000",
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
