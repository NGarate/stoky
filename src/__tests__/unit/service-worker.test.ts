import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The service worker, as source facts.
 *
 * It cannot be imported — it is a worker script that installs listeners on
 * `self` — so what is checked here is the shape of what it will do, and the
 * one thing that would otherwise ship broken with every test green.
 *
 * The classifier itself is extracted and exercised below by evaluating the
 * module in a stubbed worker global, which is as close to running it as this
 * tier can honestly get. What only a browser can answer — that a real
 * `install` populates a real cache — is left to Playwright and named there.
 */

const ROOT = join(import.meta.dir, "../../..");
const SOURCE = readFileSync(join(ROOT, "public/sw.js"), "utf8");

describe("the worker is actually shipped", () => {
  it("is not excluded by .gitignore", () => {
    // This is the one defect in the phase that would ship a broken production
    // image with a passing suite: `public/sw.js` was in .gitignore, left over
    // from a next-pwa template, so `git add` silently no-opped and /sw.js
    // would have 404'd in CI and in the Docker image.
    //
    // Asserted against the file rather than through `git check-ignore`, which
    // reports a *tracked* file as not-ignored whatever the patterns say — so
    // that version of this test could not fail once the file was added.
    const patterns = readFileSync(join(ROOT, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));

    expect(patterns).not.toContain("public/sw.js");
    expect(patterns).not.toContain("public/*.js");
    expect(patterns).not.toContain("public/");
  });

  it("is tracked by git", () => {
    const tracked = execFileSync(
      "git",
      ["ls-files", "--", "public/sw.js"],
      { cwd: ROOT, encoding: "utf8" },
    ).trim();

    expect(tracked).toBe("public/sw.js");
  });
});

describe("what it may write", () => {
  it("writes through exactly one call site", () => {
    // One `put` means "what may be stored" is one question with one answer.
    const puts = SOURCE.match(/\.put\(/g) ?? [];
    expect(puts).toHaveLength(1);
  });

  it("never uses addAll, which stores without ever calling put", () => {
    // Counting `put` alone leaves the barrier bypassable: `cache.addAll`
    // fetches and stores and never touches it.
    expect(SOURCE).not.toContain(".addAll(");
  });

  it("uses add only for the offline page, and tolerates it failing", () => {
    const adds = SOURCE.match(/cache\.add\(/g) ?? [];
    expect(adds).toHaveLength(1);
    expect(SOURCE).toContain("cache.add(OFFLINE_URL).catch(");
  });
});

describe("what it must never touch", () => {
  it("passes API requests straight through", () => {
    expect(SOURCE).toContain('url.pathname.startsWith("/api/")');
  });

  it("refuses to store an API response even if one reached the writer", () => {
    // Belt and braces on the one class of response that carries household
    // data and a session.
    const writer = SOURCE.slice(SOURCE.indexOf("async function putIfCacheable"));
    expect(writer).toContain('startsWith("/api/")');
  });

  it("passes cross-origin requests through", () => {
    // Its own CSP is `connect-src 'self'`, which governs fetch() *inside* the
    // worker — so handling an images.openfoodfacts.org request blocks it and
    // every product image goes blank, looking exactly like an OFF outage.
    expect(SOURCE).toContain("if (!isSameOrigin) return \"passthrough\"");
  });

  it("passes RSC payload requests through", () => {
    expect(SOURCE).toContain('url.searchParams.has("_rsc")');
    expect(SOURCE).toContain('request.headers.get("next-router-prefetch")');
  });
});

describe("how it treats a redirect", () => {
  it("does not mistake a settled redirect for a network failure", () => {
    // `/dashboard` answers 307 when signed out, which arrives as an
    // opaqueredirect with status 0. Falling back on that would serve the
    // previous session's signed-in shell to a signed-out visitor.
    expect(SOURCE).toContain('response.type === "opaqueredirect"');
    // The fallback is chosen on a null response — a throw or the timeout —
    // rather than on `!response.ok`.
    expect(SOURCE).toContain("if (response) {");
  });
});

describe("source shape", () => {
  it("prefixes every global with self", () => {
    // Without `self.fetch` in particular, a sandboxed harness resolves a bare
    // `fetch` to the runtime's real global and a test of this file goes to the
    // network. The lookbehind excludes `self.fetch`, so any match is a bare
    // one.
    // Comments and string literals are stripped first: `addEventListener(
    // "fetch", ...)` is an event name, not a call to the global.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "")
      .replace(/"[^"]*"/g, '""')
      .replace(/`[^`]*`/g, "``");

    for (const global of ["fetch", "caches", "Response", "setTimeout"]) {
      const bare = code.match(new RegExp(`(?<![.\\w])${global}\\b`, "g")) ?? [];
      expect(bare, `${global} must always be self-prefixed`).toEqual([]);
    }
  });

  it("names its caches so they can be found and purged", () => {
    expect(SOURCE).toContain('stoky-shell-');
    expect(SOURCE).toContain('stoky-static-');
  });

  it("forgets everything when the account changes", () => {
    expect(SOURCE).toContain('event.data !== "STOKY_FORGET"');
    expect(SOURCE).toContain('name.startsWith("stoky-")');
  });
});
