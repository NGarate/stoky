import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Reading the session is request data, and `auth()` says so.
 *
 * Cache Components makes Next attempt a prerender of every route. A caller of
 * `auth()` can never be prerendered — the session is in the request's cookies
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
 * without it, the read gets as far as `headers`. Which name is in the message
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

/**
 * Only the auth seam reaches Better Auth.
 *
 * Everything else reads `AppSession` through `auth()` or `readSession`
 * (`src/lib/auth.ts`), so the next replacement of the library changes
 * `src/lib/auth.ts`, `src/lib/auth/`, the auth route and its handler, and not
 * the files that only want to know who is signed in. A direct `getAuth()`
 * elsewhere is also a session read that skips `connection()`, which is the
 * prerender defect above.
 *
 * Application code only: tests may build the instance to inspect it.
 */
describe("only the auth seam reaches Better Auth", () => {
  // An import or re-export of the package or one of its scoped packages, or
  // of `getAuth` — not a string that mentions them, as this file does.
  const BETTER_AUTH =
    /^\s*(?:import|export)\b[^;]*?\bfrom\s+["'](?:better-auth|@better-auth\/[^"']+)(?:\/[^"']*)?["']|^\s*import\b[^;]*\bgetAuth\b[^;]*from/m;

  const allowed = (rel: string): boolean =>
    rel === join("lib", "auth.ts") ||
    rel.startsWith(join("lib", "auth") + "/") ||
    rel.startsWith(join("app", "api", "auth") + "/") ||
    rel === join("server", "http", "auth-handler.ts");

  it("matches the instance's own imports, so the pattern can match", () => {
    const instance = readFileSync(join(SRC, "lib", "auth", "instance.ts"), "utf8");
    expect(BETTER_AUTH.test(instance)).toBe(true);
  });

  it("scans something, so the check below is not vacuous", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it("finds no import of Better Auth or getAuth outside the seam", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path))
      .filter((rel) => !allowed(rel))
      .filter((rel) => BETTER_AUTH.test(readFileSync(join(SRC, rel), "utf8")));

    expect(offenders).toEqual([]);
  });
});

/**
 * Only `src/lib/auth/client.ts` calls the auth API from the browser.
 *
 * The login form, the registration form and the session keep-alive used to
 * call the auth library directly, so replacing it would have rewritten three
 * components and the tests that mocked a package they did not own. They call
 * the module now, and this keeps a fourth from going round it — a fetch of
 * `/api/auth/` or an import of Better Auth's browser client anywhere else.
 * Tests are scanned too, and a `mock.module` of the client package counts: a
 * component test mocks `@/lib/auth/client`, completely (D50), not what is
 * underneath it.
 */
describe("only the browser auth module calls the auth API", () => {
  const CLIENT_CALL =
    /\bfetch\w*\(\s*["'`]\/api\/auth\/|\bfrom\s+["']better-auth\/(?:client|react)["']|\bmock\.module\(\s*["']better-auth/;

  function everyFile(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) everyFile(path, found);
      else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
    }
    return found;
  }

  it("is what the module itself does, so the pattern can match", () => {
    // Without this, a pattern that matched nothing would pass the scan below.
    const client = readFileSync(join(SRC, "lib", "auth", "client.ts"), "utf8");
    expect(CLIENT_CALL.test(client)).toBe(true);
  });

  it("finds no other file that calls it, imports a client for it or mocks one", () => {
    const offenders = everyFile(SRC)
      .map((path) => relative(SRC, path))
      .filter((rel) => rel !== join("lib", "auth", "client.ts"))
      .filter((rel) => CLIENT_CALL.test(readFileSync(join(SRC, rel), "utf8")));

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
