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

describe("/offline blocks rather than attempting a prerender it cannot have", () => {
  it("exports instant = false", async () => {
    const page = await import("@/app/offline/page");

    // Read off the module, not out of the file: what Next honours is the
    // export, and a comment saying so is not one.
    expect(page.instant).toBe(false);
  });
});
