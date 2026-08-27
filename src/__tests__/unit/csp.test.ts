import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCsp } from "@/lib/csp";

/**
 * The policy, and the three pieces that only work together.
 *
 * Each is inert alone, which is why they land in one commit and are checked in
 * one file: a `worker-src` directive with a matcher that still stamps the
 * page's nonce policy onto `/sw.js` does nothing, and a `/sw.js` header entry
 * without the matcher change is overwritten by the middleware.
 */

const DEV = buildCsp("abc123", true, false);
const PROD = buildCsp("abc123", false, true);

describe("upgrade-insecure-requests follows the deployment's transport", () => {
  it("is present when production is actually served over https", () => {
    expect(buildCsp("abc123", false, true)).toContain(
      "upgrade-insecure-requests",
    );
  });

  it("is absent on a plain-http production deployment", () => {
    // WebKit upgrades subresource fetches even on localhost and LAN hosts,
    // where Blink and Gecko exempt them — so on an http-only install every
    // tRPC call becomes an https request against a server with no TLS, and
    // the application dies with "Load failed" while the page itself renders.
    // Found by the browser suite the day it started driving the standalone
    // build (2026-08-17); a real Safari on a LAN install hits the same wall.
    expect(buildCsp("abc123", false, false)).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  it("is never present in development", () => {
    expect(buildCsp("abc123", true, true)).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("the service worker's directives", () => {
  it("names worker-src and child-src in both environments", () => {
    for (const policy of [DEV, PROD]) {
      expect(policy).toContain("worker-src 'self'");
      expect(policy).toContain("child-src 'self'");
    }
  });

  it("keeps them even though default-src would cover it today", () => {
    // `worker-src` falls back through `child-src` to `default-src`, so this is
    // redundant right now. The day someone tightens `default-src` to 'none' —
    // the correct instinct — offline would stop working with no error that
    // points anywhere near here.
    expect(PROD).toContain("default-src 'self'");
  });
});

describe("what the worker must not weaken", () => {
  it("keeps strict-dynamic on scripts", () => {
    expect(PROD).toContain("'strict-dynamic'");
  });

  it("never allows unsafe-inline scripts", () => {
    for (const policy of [DEV, PROD]) {
      const scriptSrc = policy
        .split("; ")
        .find((directive) => directive.startsWith("script-src ")) as string;
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    }
  });

  it("allows eval only in development", () => {
    expect(DEV).toContain("'unsafe-eval'");
    expect(PROD).not.toContain("'unsafe-eval'");
  });

  it("carries the nonce it was given", () => {
    expect(buildCsp("deadbeef", false, true)).toContain("'nonce-deadbeef'");
  });
});

describe("the middleware's matcher", () => {
  const source = readFileSync(
    join(import.meta.dir, "../../proxy.ts"),
    "utf8",
  );

  it("leaves /sw.js alone", () => {
    // This is the half that makes the other half do anything. A nonce'd page
    // policy applied to the worker script becomes the *worker's* own policy,
    // and the worker has no page to inherit from.
    expect(source).toContain("sw\\\\.js");
  });

  it("still covers ordinary routes", () => {
    expect(source).toContain("_next/static");
    expect(source).toContain("_next/image");
  });

  it("takes its directives from the shared module", () => {
    // Two copies of a policy is how one of them silently stops matching.
    expect(source).toContain('from "@/lib/csp"');
  });
});

describe("the worker's own response headers", () => {
  const config = readFileSync(
    join(import.meta.dir, "../../../next.config.ts"),
    "utf8",
  );

  it("gives /sw.js a policy of its own", () => {
    expect(config).toContain('source: "/sw.js"');
    expect(config).toContain("default-src 'none'; script-src 'self'");
  });

  it("does not let a worker outlive a deploy", () => {
    // A stale worker serving a stale shell is one of the worse failures here:
    // the user sees an old application and nothing tells them.
    expect(config).toContain('value: "no-cache"');
  });
});
