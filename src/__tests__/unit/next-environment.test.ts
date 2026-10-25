import { describe, it, expect } from "bun:test";
// First, and before anything of Next's that sets the environment up: this is
// how `auth-dynamic.test.ts` reaches it (through `@/lib/auth`), and the
// module that was being evaluated in run 39847700105 (ISSUES TEST-11).
import "next/headers";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

/**
 * Next's request storage is real in every test process, whatever loads first.
 *
 * Next's server modules expect `globalThis.AsyncLocalStorage` to exist before
 * any of them is evaluated: `next start` loads `node-environment-baseline`
 * ahead of everything, and `app-render/async-local-storage.js` decides once,
 * at evaluation, between the real storage and a stand-in whose `run` and
 * `exit` throw "Invariant: AsyncLocalStorage accessed in runtime where it is
 * not available". Bun has no such global. A test file that imports
 * `next/headers` or `next/server` before anything installs it fixes the
 * stand-in for the rest of the process, and a later file that loads
 * `node-environment` (the proxy matcher, through Next's build analysis)
 * patches `console` to call `workUnitAsyncStorage.exit` around every log —
 * after which every `console.log` in the process throws. That is how
 * `trpc-links.test.ts`, whose logger link logs every call when NODE_ENV is
 * development (the development image), failed in CI.
 *
 * The preload in `bunfig.toml` (`src/__tests__/setup/next-environment.ts`)
 * restores the order Next relies on. This file imports `next/headers` first
 * on purpose, so run alone without the preload it goes red.
 */
describe("Next's request storage in the test process", () => {
  it("is the platform's AsyncLocalStorage, installed before any Next module", () => {
    expect(
      typeof (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage,
    ).toBe("function");
  });

  it("lets a function run outside the unit store, as the patched console does", () => {
    // `node-environment-extensions/console-exit.js` wraps every console method
    // in exactly this call.
    expect(workUnitAsyncStorage.exit(() => "logged")).toBe("logged");
  });

  it("holds a store for the duration of a run", () => {
    const store = { route: "/kitchen" } as unknown as Parameters<
      typeof workAsyncStorage.run
    >[0];

    expect(workAsyncStorage.run(store, () => workAsyncStorage.getStore())).toBe(
      store,
    );
  });
});
