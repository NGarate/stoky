import { describe, it, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { proxyRuns } from "../utils/proxy-matcher";

/**
 * Which paths the proxy runs on — and so which responses carry the
 * Content-Security-Policy, because nothing else sets one for a page.
 *
 * The exclusions used to be unanchored prefixes (`icons/`, `sw\.js`,
 * `favicon.ico` with its dot unescaped), and only a file that exists is
 * served from disk. Every other path under them fell through to the app's
 * not-found render — a whole HTML document on this origin — with the proxy
 * skipped and no policy at all: `/icons/x`, `/sw.jsx`, `/faviconXico`
 * (SECURITY_REVIEW §8). The old `csp.test.ts` checks read the source for
 * substrings and passed on both versions.
 *
 * The icons are excluded by name, and every file in `public/icons/` is asked
 * for here, so adding one without naming it in the matcher goes red rather
 * than quietly sending it through the proxy.
 */

const ICONS = join(import.meta.dir, "..", "..", "..", "public", "icons");

describe("what the proxy leaves alone", () => {
  it.each([
    // The worker: a nonce'd page policy would become its own.
    "/sw.js",
    // The icons — every file in public/icons/, asked by name below.
    ...readdirSync(ICONS).map((name) => `/icons/${name}`),
    // The build's assets, and the optimiser (its query is not the pathname).
    "/_next/static/chunks/main.js",
    "/_next/image",
  ])("%s", (pathname) => {
    expect(proxyRuns(pathname)).toBe(false);
  });
});

describe("what the proxy covers that the old prefixes did not", () => {
  it.each([
    // An icon that does not exist is the app's not-found document.
    "/icons/does-not-exist",
    // Including one shaped like an icon: the exclusion names files, not a
    // pattern of them, because a pattern also matches the names that are not
    // there.
    "/icons/does-not-exist.png",
    "/icons/does-not-exist.svg",
    "/icons/icon-maskable-192.png",
    "/icons/a/b",
    "/icons/icon.svg.rsc",
    "/icons/..%2fdashboard",
    // Anything that only starts with the worker's name.
    "/sw.jsx",
    "/sw.js/anything",
    // There is no favicon.ico, so nothing about it is excluded.
    "/favicon.ico",
    "/faviconXico",
    "/_next/imagefoo",
  ])("%s", (pathname) => {
    expect(proxyRuns(pathname)).toBe(true);
  });
});

describe("what the proxy has always covered", () => {
  it.each(["/", "/login", "/inventory", "/api/trpc/auth.me", "/manifest.webmanifest"])(
    "%s",
    (pathname) => {
      expect(proxyRuns(pathname)).toBe(true);
    },
  );
});

describe("the prefetch labels, which are a separate decision", () => {
  // SECURITY_REVIEW §8 owns why these two are skipped and `sec-purpose` is
  // not. Pinned here only so anchoring the path cannot quietly drop them.
  it("skips a page labelled either way", () => {
    expect(proxyRuns("/inventory", { "next-router-prefetch": "1" })).toBe(false);
    expect(proxyRuns("/inventory", { purpose: "prefetch" })).toBe(false);
  });

  it("still runs on `sec-purpose`", () => {
    expect(proxyRuns("/inventory", { "sec-purpose": "prefetch" })).toBe(true);
  });
});
