/**
 * Gives every `bun test` process the environment Next's server modules are
 * written for, before any of them is evaluated (ISSUES TEST-11).
 *
 * `next start` and `next dev` load `node-environment-baseline` first, and it
 * installs `globalThis.AsyncLocalStorage`, which Bun does not provide. Next's
 * `app-render/async-local-storage.js` reads that global once, when it is
 * evaluated, and without it hands out stand-ins whose `run` and `exit` throw.
 * A test process loads Next's modules in whatever order its files happen to
 * run in, so without this preload the first file to import `next/headers` or
 * `next/server` decided, for every file after it, whether Next's request
 * storage worked — and once Next's `console` patch was also loaded, whether
 * `console.log` did. `src/__tests__/unit/next-environment.test.ts` is the check.
 *
 * Loaded through `bunfig.toml` `[test] preload`, so it applies to every suite
 * and to a single file run alone, as the server's own order does.
 */
import "next/dist/server/node-environment-baseline";
