import { test, expect, type APIResponse } from "@playwright/test";

/**
 * Every security header, asserted on a real response from the artefact that
 * ships (`docs/SECURITY_REVIEW.md` §8, finding 12).
 *
 * **The review found this whole layer verified by reading.** `csp.test.ts`
 * exercises `buildCsp()` in isolation and never touches a response;
 * `middleware-device.test.ts` asserts the header on the middleware's return
 * value, which is the function's output rather than what a browser receives.
 * Nothing anywhere named `X-Frame-Options`, HSTS or the other four. A header
 * that is configured and not delivered looks exactly like a header that is
 * delivered, right up until somebody checks.
 *
 * It has to be here rather than in a cheaper tier for two reasons. `headers()`
 * in `next.config.ts` is applied by the server, so only a served response can
 * show it. And the production CSP differs from the development one — no
 * `unsafe-eval`, and `upgrade-insecure-requests` keyed on transport — so a dev
 * server would assert the wrong policy. The browser suite serves the standalone
 * production build, which is the thing the Docker image runs.
 *
 * `request` rather than `page`, deliberately: this is about the response, and a
 * page navigation would make the assertions depend on rendering succeeding.
 */

/** What `next.config.ts` promises on every route. */
const STATIC_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-permitted-cross-domain-policies": "none",
};

function headerOf(response: APIResponse, name: string): string {
  return response.headers()[name] ?? "";
}

test.describe("the headers a response actually carries", () => {
  test("every configured security header reaches a page", async ({ request }) => {
    const response = await request.get("/login");
    expect(response.status()).toBe(200);

    for (const [name, value] of Object.entries(STATIC_HEADERS)) {
      expect(
        headerOf(response, name),
        `${name} is configured in next.config.ts and must be delivered`,
      ).toBe(value);
    }
  });

  test("they reach the tRPC route too, not only pages", async ({ request }) => {
    // The config's source is `/:path*`, which is every route including the API.
    // Worth pinning: an API response is the one most likely to be fetched from
    // somewhere else, and `X-Content-Type-Options` is what stops a JSON reply
    // being sniffed as something executable.
    const response = await request.get("/api/health");

    expect(headerOf(response, "x-content-type-options")).toBe("nosniff");
    expect(headerOf(response, "x-frame-options")).toBe("DENY");
  });

  test("does not announce what it is built with", async ({ request }) => {
    // `poweredByHeader: false`. The version banner tells an attacker which
    // advisories to try.
    const response = await request.get("/login");

    expect(headerOf(response, "x-powered-by")).toBe("");
  });
});

test.describe("the Content-Security-Policy, as production serves it", () => {
  test("is present, and its nonce is different on every request", async ({
    request,
  }) => {
    // The whole value of `strict-dynamic` with a nonce is that the number is
    // unguessable and changes per request. This is also what the root layout
    // blocks for under Cache Components — `instant = false` exists so the nonce
    // survives, and a prerendered shell would bake one in. If these two ever
    // match, that trade has silently been lost.
    const first = await request.get("/login");
    const second = await request.get("/login");

    const nonceOf = (response: APIResponse) =>
      /'nonce-([a-f0-9]+)'/.exec(headerOf(response, "content-security-policy"))?.[1];

    expect(nonceOf(first)).toMatch(/^[a-f0-9]{32}$/);
    expect(nonceOf(second)).toMatch(/^[a-f0-9]{32}$/);
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  test("carries the directives production depends on", async ({ request }) => {
    const csp = headerOf(await request.get("/login"), "content-security-policy");

    // `strict-dynamic`, so a script the nonce admits can load its own chunks
    // without every chunk needing to be listed.
    expect(csp).toContain("strict-dynamic");
    // Named explicitly rather than left to `default-src`, because the service
    // worker is the one script with no page to inherit a policy from.
    expect(csp).toContain("worker-src");
    expect(csp).toContain("child-src");
    // Clickjacking, in the modern spelling as well as the legacy header above.
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain("base-uri");
    expect(csp).toContain("form-action");
  });

  test("does not allow eval in production", async ({ request }) => {
    // Development needs it and production must not have it, which is exactly
    // the difference a dev-server test would miss.
    const csp = headerOf(await request.get("/login"), "content-security-policy");

    expect(csp).not.toContain("unsafe-eval");
  });

  test("upgrades insecure requests only when it was reached over https", async ({
    request,
  }) => {
    // The suite serves over plain http on a loopback address, which is the
    // LAN-install case. A blanket `upgrade-insecure-requests` here is the
    // defect that shipped once already: it upgraded every fetch to https on a
    // plain-http install, and a Safari user got a rendered page whose every
    // tRPC call died.
    const csp = headerOf(await request.get("/login"), "content-security-policy");

    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

test.describe("the service worker's own policy", () => {
  test("is its own, and is not cached", async ({ request }) => {
    // A nonce'd page policy applied to the worker becomes the *worker's*
    // policy, and the worker has no page to inherit from — so `/sw.js` is
    // excluded from the middleware matcher and given its own in the config.
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);

    const csp = headerOf(response, "content-security-policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    // No nonce: the middleware does not run for this path, and a nonce here
    // would mean it had started to.
    expect(csp).not.toContain("nonce-");

    // A worker that outlives a deploy serves a stale shell with no error, which
    // is one of the worse failures available here.
    expect(headerOf(response, "cache-control")).toContain("no-cache");
  });
});
