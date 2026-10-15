import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Reading the session is request data, and `auth()` says so.
 *
 * Cache Components makes Next attempt a prerender of every route. A caller of
 * `auth()` can never be prerendered — NextAuth reaches `crypto.getRandomValues()`
 * — so Next aborts by throwing. Node consumed that rejection; Bun, the runtime
 * since `b81102d`, reports it: one per request per route, 1612 in a suite run
 * (`ISSUES.md` RUNTIME-1). No response was ever wrong. The log was, and the log
 * is what this project has instead of error tracking.
 *
 * `src/lib/auth.ts` answers it once, with `await connection()` before it
 * delegates. The two assertions below are the two ways that can be undone: the
 * declaration can be dropped or reordered, and the seam can be bypassed.
 *
 * The first is a behavioural test rather than a scan for the word. Outside a
 * request scope **both** shapes throw — that is not the signal. They throw
 * *differently*: with the declaration first, Next refuses at `connection`;
 * without it, NextAuth gets as far as `headers`. Which name is in the message
 * is therefore proof of ordering, which is the property that matters and the
 * one a regex cannot see.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("auth() declares itself dynamic", () => {
  it("refuses at connection(), not at headers(), which is the ordering", async () => {
    const { auth } = await import("@/lib/auth");

    const error: unknown = await auth().then(
      () => null,
      (thrown: unknown) => thrown,
    );
    const message = error instanceof Error ? error.message : String(error);

    expect(message).toContain("`connection` was called outside a request scope");
  });
});

describe("the seam is the only door to the session", () => {
  it("scans something, so the check below is not vacuous", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it("finds nobody importing auth straight out of next-auth", () => {
    // `src/lib/auth.ts` is the one file allowed to — it is where the wrapper
    // is built. Anywhere else means a call site that prerenders again.
    const seam = join(SRC, "lib", "auth.ts");
    const offenders = sourceFiles(SRC)
      .filter((path) => path !== seam)
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return source
          .split("\n")
          .some(
            (line) =>
              line.includes('from "next-auth"') &&
              /\bauth\b/.test(line.slice(0, line.indexOf("from"))),
          );
      })
      .map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });
});

/**
 * Only the auth seam knows which library signs the session.
 *
 * Everything else reads `AppSession` (`src/lib/auth/session.ts`), so replacing
 * the library changes `src/lib/auth.ts`, `src/lib/auth/` and the type
 * augmentation in `src/types/`, and not the twenty files that used to import
 * next-auth's `Session` for a type annotation. This scans tests as well as
 * the application, because most of those twenty were tests.
 *
 * It matches the package root only. `next-auth/react`, the browser's sign-in
 * call, is a different seam, held by the next describe.
 */
describe("only the auth seam imports next-auth", () => {
  // An import or re-export statement, which may span lines, naming the
  // package root — not a string that mentions it, as this file does.
  const NEXT_AUTH_ROOT = /^\s*(?:import|export)\b[^;]*?\bfrom\s+["']next-auth["']/m;

  function allFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) allFiles(path, found);
      else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
    }
    return found;
  }

  const allowed = (path: string): boolean => {
    const rel = relative(SRC, path);
    return (
      rel === join("lib", "auth.ts") ||
      rel.startsWith(join("lib", "auth") + "/") ||
      rel.startsWith("types/") ||
      // These two test next-auth's own configuration in `src/lib/auth.ts` —
      // its error classes and its callbacks — and go when that does.
      rel === join("__tests__", "unit", "auth-logger.test.ts") ||
      rel === join("__tests__", "unit", "auth.session.test.ts")
    );
  };

  it("scans the tests too, so the check covers where the imports were", () => {
    const scanned = allFiles(SRC).map((path) => relative(SRC, path));
    expect(scanned).toContain(join("__tests__", "integration", "routers.test.ts"));
    expect(scanned).toContain(join("server", "trpc", "trpc.ts"));
  });

  it("finds no import of next-auth outside src/lib/auth*, src/types and its own tests", () => {
    const offenders = allFiles(SRC)
      .filter((path) => !allowed(path))
      .filter((path) => NEXT_AUTH_ROOT.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });
});

/**
 * Only `src/lib/auth/client.ts` speaks to the auth library from the browser.
 *
 * The login form, the registration form and the session keep-alive called
 * next-auth directly, so the swap would have rewritten three components and
 * the tests that mocked a package they did not own. They call the module now,
 * and this keeps a fourth from going round it — which is how the swap would
 * find a caller it did not know about. Tests are scanned too, and a
 * `mock.module` of the package counts: a component test mocks
 * `@/lib/auth/client`, completely (D50), not the library underneath it.
 */
describe("only the browser auth module reaches next-auth/react", () => {
  const CLIENT_LIBRARY =
    /\bfrom\s+["']next-auth\/react["']|\bimport\s*\(\s*["']next-auth\/react["']|\bmock\.module\(\s*["']next-auth\/react["']/;

  function everyFile(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) everyFile(path, found);
      else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
    }
    return found;
  }

  it("is what the module itself imports, so the pattern can match", () => {
    // Without this, a pattern that matched nothing would pass the scan below.
    const client = readFileSync(join(SRC, "lib", "auth", "client.ts"), "utf8");
    expect(CLIENT_LIBRARY.test(client)).toBe(true);
  });

  it("finds no other file that imports or mocks it", () => {
    const offenders = everyFile(SRC)
      .map((path) => relative(SRC, path))
      .filter((rel) => rel !== join("lib", "auth", "client.ts"))
      .filter((rel) => CLIENT_LIBRARY.test(readFileSync(join(SRC, rel), "utf8")));

    expect(offenders).toEqual([]);
  });
});

describe("/offline blocks rather than attempting a prerender it cannot have", () => {
  it("exports instant = false", async () => {
    const page = await import("@/app/offline/page");

    // Read off the module, not out of the file: what Next honours is the
    // export, and a comment saying so is not one.
    expect(page.instant).toBe(false);
  });
});
