import { test, expect, type APIResponse } from "@playwright/test";
import { SESSION_FILE } from "./session";

/**
 * Every security header, asserted on a real response from the artefact that
 * ships (`docs/SECURITY_REVIEW.md` §8, finding 12).
 *
 * **The review found this whole layer verified by reading.** `csp.test.ts`
 * exercises `buildCsp()` in isolation and never touches a response;
 * `proxy-device.test.ts` asserts the header on the proxy's return
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
  "strict-transport-security": "max-age=63072000; includeSubDomains",
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

/**
 * `Cache-Control: no-store` on the tRPC route, as the server sends it.
 *
 * A query is a GET whose answer is one household's data, under a URL that is
 * often the same for every account, and nothing but the handler marks it: tRPC
 * sets no cache directive, Next sends a route handler's response as it is,
 * and neither `headers()` nor Traefik adds one. A shared cache in front of
 * the instance could otherwise store one person's answer and serve it to the
 * next. `trpc-handler.test.ts` covers every kind of answer; this proves the
 * header survives Next and reaches the wire. Not `/api/health`, which marks
 * itself and would pass whatever the tRPC route did.
 */
test.describe("the tRPC route is never stored", () => {
  const QUERY = `/api/trpc/location.list?batch=1&input=${encodeURIComponent("{}")}`;

  test.describe("signed in", () => {
    test.use({ storageState: SESSION_FILE });

    test("a household's data is marked no-store, streamed as the browser asks", async ({
      request,
    }) => {
      const response = await request.get(QUERY, {
        headers: { "trpc-accept": "application/jsonl" },
      });

      expect(response.status()).toBe(200);
      expect(headerOf(response, "cache-control")).toBe("no-store");
    });
  });

  test("so is the refusal an anonymous caller gets", async ({ request }) => {
    const response = await request.get(QUERY);

    expect(response.status()).toBe(401);
    expect(headerOf(response, "cache-control")).toBe("no-store");
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

  test("carries exactly the thirteen production directives, at their exact values", async ({
    request,
  }) => {
    // Split and matched exactly rather than by substring — `toContain
    // ("frame-ancestors")` passes just as happily on `frame-ancestors 'self'`,
    // which is the opposite policy. The name-only version of this test did
    // exactly that for five directives (SECURITY_REVIEW §8's "eight of the
    // thirteen unaudited"; seven, once counted).
    const csp = headerOf(await request.get("/login"), "content-security-policy");
    const directives = csp.split("; ");

    // Over plain http — this suite's transport — the transport-keyed
    // upgrade-insecure-requests is absent, so the count is thirteen. The
    // count is the one assertion that notices a directive silently added or
    // dropped, which no list of positives can.
    expect(directives).toHaveLength(13);

    expect(directives[0]).toBe("default-src 'self'");
    // Full shape, not just the nonce: 'self', a fresh 32-hex nonce,
    // 'strict-dynamic', and nothing else — so script-src can never quietly
    // gain 'unsafe-inline' or a host source.
    expect(directives[1]).toMatch(
      /^script-src 'self' 'nonce-[a-f0-9]{32}' 'strict-dynamic'$/,
    );
    // style-src's 'unsafe-inline' is the policy's one deliberate exception —
    // Next inlines critical CSS — pinned at exactly that so a third source
    // cannot arrive silently.
    expect(directives[2]).toBe("style-src 'self' 'unsafe-inline'");
    // The only remote origin images may come from.
    expect(directives[3]).toBe(
      "img-src 'self' data: blob: https://images.openfoodfacts.org",
    );
    expect(directives[4]).toBe("font-src 'self'");
    // Exact, which is what proves the dev tail (ws:, http://localhost:*)
    // never ships.
    expect(directives[5]).toBe(
      "connect-src 'self' https://world.openfoodfacts.org",
    );
    expect(directives[6]).toBe("media-src 'self'");
    // Named explicitly rather than left to `default-src`, because the service
    // worker is the one script with no page to inherit a policy from.
    expect(directives[7]).toBe("worker-src 'self'");
    expect(directives[8]).toBe("child-src 'self'");
    expect(directives[9]).toBe("object-src 'none'");
    // What stops a <base> injection re-pointing every relative script URL.
    expect(directives[10]).toBe("base-uri 'self'");
    expect(directives[11]).toBe("form-action 'self'");
    // Clickjacking in the modern spelling; must agree with the legacy
    // X-Frame-Options: DENY asserted above.
    expect(directives[12]).toBe("frame-ancestors 'none'");
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

test.describe("what a prefetch label cannot do", () => {
  // The proxy's matcher skips requests labelled `Purpose: prefetch` or
  // `Next-Router-Prefetch` (its `missing` clauses — Next's own documented
  // shape), and `proxyClientMaxBodySize` is applied only *because* the proxy
  // runs. So one header turned the body cap off, and Bun's server accepts a
  // body of any size: a labelled 16 MiB POST used to arrive whole. On the
  // authenticated upload, Zod's `.max` refused it after it was buffered; on
  // the public `auth.register`, it was buffered and JSON-parsed before the
  // rate limiter could refuse anything (SECURITY_REVIEW §8).
  //
  // The API routes now bound the body themselves (src/server/http/body-limit.ts),
  // so the label changes which layer refuses and not whether one does: 413
  // either way, from the route. Unlabelled, the proxy truncates the body and
  // the route still refuses on the length the request declared.
  const SIXTEEN_MIB = 16 * 1024 * 1024;

  test.describe("signed in", () => {
    test.use({ storageState: SESSION_FILE });

    test("an oversized upload is refused with 413, labelled a prefetch or not", async ({
      request,
    }) => {
      const oversized = JSON.stringify({
        json: { fileBase64: "A".repeat(SIXTEEN_MIB), mimeType: "image/png" },
      });

      const control = await request.post("/api/trpc/receipt.upload", {
        headers: { "content-type": "application/json" },
        data: oversized,
      });
      expect(control.status()).toBe(413);

      const labelled = await request.post("/api/trpc/receipt.upload", {
        headers: { "content-type": "application/json", purpose: "prefetch" },
        data: oversized,
      });
      expect(labelled.status()).toBe(413);
    });
  });

  test("an oversized registration from nobody is refused before anything reads it", async ({
    request,
  }) => {
    // Public, labelled, and invalid — no password — so that without the
    // route's bound it is read whole, parsed, and answered 400 by Zod, and it
    // can never create an account or spend the suite's registration budget.
    // 413 is the only answer that says the body was not held.
    const oversized = JSON.stringify({
      json: { email: "nadie@example.com", name: "A".repeat(SIXTEEN_MIB) },
    });

    const labelled = await request.post("/api/trpc/auth.register", {
      headers: { "content-type": "application/json", purpose: "prefetch" },
      data: oversized,
    });
    expect(labelled.status()).toBe(413);
  });

  test("an oversized sign-in from nobody is refused before Auth.js reads it", async ({
    request,
  }) => {
    // Auth.js's own route, with its own, smaller bound: every POST there is a
    // form of a few hundred bytes. Without the bound this is read whole and
    // answered with a redirect to a CSRF error.
    const labelled = await request.post("/api/auth/callback/credentials", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        purpose: "prefetch",
      },
      data: `email=nadie%40example.com&password=${"A".repeat(1024 * 1024)}`,
      maxRedirects: 0,
    });
    expect(labelled.status()).toBe(413);
  });
});

/**
 * What a document labelled a prefetch is served with, by which label.
 *
 * Three headers say "prefetch", and the proxy's matcher skips two of them
 * (SECURITY_REVIEW §8). `next-router-prefetch` is the router's RSC prefetch,
 * data merged into a page that already has its nonce. `Purpose: prefetch` is
 * the legacy spelling, and it can label a *document* request: that page is
 * rendered with no nonce, no `Content-Security-Policy` and no device cookie.
 * `Sec-Purpose` is the spelling browsers send today — measured in the pinned
 * Chromium, Firefox and WebKit, none sends `Purpose` — and the matcher's
 * `key: "purpose"` is the header's exact name, so it does not skip it.
 *
 * Each skipped document is harmless for a reason this block pins:
 *
 *   - `Purpose`: every page is a request-bound render (the root layout reads
 *     the nonce, `instant = false`) and Next sends it `no-store`. A
 *     `<link rel=prefetch>` result reaches the next navigation only through
 *     the HTTP cache, which keeps nothing `no-store` — measured: the click
 *     that followed was a fresh, unlabelled request in all three engines. If
 *     a page ever becomes cacheable — a prerenderable root shell, a
 *     `cache-control` set by hand — this goes red.
 *   - `Sec-Purpose`: the `no-store` argument does *not* cover it. Chromium's
 *     speculation-rules prefetch and prerender are navigational, and it
 *     showed a `no-store` page from either without asking again. They are
 *     safe only because they go through the proxy, which is what the second
 *     pair asserts: widen the matcher to `sec-purpose` and a prerendered page
 *     is shown to the person with no policy at all.
 */
function expectUnprotectedButNotStored(response: APIResponse) {
  expect(response.status()).toBe(200);

  // The skip, as measured: the proxy did not run, so nothing it adds is here.
  // If these ever start to arrive, the matcher changed and §8 is out of date.
  expect(headerOf(response, "content-security-policy")).toBe("");
  expect(headerOf(response, "set-cookie")).not.toContain("stoky_device=");

  // Why the skip is harmless.
  expect(headerOf(response, "cache-control")).toContain("no-store");
}

function expectThroughTheProxy(response: APIResponse) {
  expect(response.status()).toBe(200);
  expect(headerOf(response, "content-security-policy")).toMatch(
    /script-src 'self' 'nonce-[a-f0-9]{32}' 'strict-dynamic'/,
  );
}

test.describe("a document labelled a prefetch", () => {
  test("a public page labelled `Purpose` skips the proxy and is not stored", async ({
    request,
  }) => {
    const response = await request.get("/login", {
      headers: { purpose: "prefetch" },
      maxRedirects: 0,
    });

    expectUnprotectedButNotStored(response);
  });

  test("a public page labelled `Sec-Purpose` goes through the proxy", async ({
    request,
  }) => {
    for (const label of ["prefetch", "prefetch;prerender"]) {
      expectThroughTheProxy(
        await request.get("/login", {
          headers: { "sec-purpose": label },
          maxRedirects: 0,
        }),
      );
    }
  });

  test.describe("signed in", () => {
    test.use({ storageState: SESSION_FILE });

    // A signed-in route as well as a public one: the dashboard routes are
    // where a future performance change would be tempted to start caching.
    test("a dashboard page labelled `Purpose` skips the proxy and is not stored", async ({
      request,
    }) => {
      const response = await request.get("/inventory", {
        headers: { purpose: "prefetch" },
        maxRedirects: 0,
      });

      expectUnprotectedButNotStored(response);
    });

    test("a dashboard page labelled `Sec-Purpose` goes through the proxy", async ({
      request,
    }) => {
      for (const label of ["prefetch", "prefetch;prerender"]) {
        expectThroughTheProxy(
          await request.get("/inventory", {
            headers: { "sec-purpose": label },
            maxRedirects: 0,
          }),
        );
      }
    });
  });
});

test.describe("a page that is not there", () => {
  test("is the app's own document, so it carries the policy too", async ({
    request,
  }) => {
    // Only a file that exists is served from disk. Any other path renders the
    // app's not-found document — a full HTML page on this origin — and until
    // 2026-10-12 the matcher's exclusions were unanchored prefixes, so a link
    // to /icons/<anything> or /sw.js<anything> was that document with the
    // proxy skipped and no policy at all (SECURITY_REVIEW §8). A missing name
    // that merely looks like an icon is the same document, which is why the
    // icons are excluded by name. `proxy-matcher.test.ts` pins the path list;
    // this is what reaches the wire for three of them.
    for (const path of ["/icons/does-not-exist", "/icons/does-not-exist.png", "/sw.jsx"]) {
      const response = await request.get(path);

      expect(response.status(), path).toBe(404);
      expect(headerOf(response, "content-type"), path).toContain("text/html");
      expect(headerOf(response, "content-security-policy"), path).toMatch(
        /script-src 'self' 'nonce-[a-f0-9]{32}' 'strict-dynamic'/,
      );
    }
  });
});

test.describe("the image optimiser", () => {
  test("is not there, and its 404 is a page with the policy", async ({ request }) => {
    // Nothing renders `next/image`, and until 2026-10-12 the endpoint was
    // live anyway: it took any same-origin path, fetched it through the whole
    // router for an anonymous caller and sent back what sniffed as an image
    // (SECURITY_REVIEW §8). A real icon and parameters Next's own loader
    // accepts, so the only reason left for a refusal is the switch: with
    // `images.unoptimized` removed this is a 200 carrying the PNG.
    //
    // The 404 Next gives instead is the app's not-found document, so it must
    // carry the policy like any other miss. With the matcher still skipping
    // `/_next/image` it arrived with none — measured before the exclusion was
    // dropped.
    const response = await request.get("/_next/image?url=%2Ficons%2Ficon-192.png&w=64&q=75");

    expect(response.status()).toBe(404);
    expect(headerOf(response, "content-type")).toContain("text/html");
    expect(headerOf(response, "content-security-policy")).toMatch(
      /script-src 'self' 'nonce-[a-f0-9]{32}' 'strict-dynamic'/,
    );
  });
});

test.describe("the service worker's own policy", () => {
  test("is its own, and is not cached", async ({ request }) => {
    // A nonce'd page policy applied to the worker becomes the *worker's*
    // policy, and the worker has no page to inherit from — so `/sw.js` is
    // excluded from the proxy's matcher and given its own in the config.
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);

    const csp = headerOf(response, "content-security-policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    // No nonce: the proxy does not run for this path, and a nonce here
    // would mean it had started to.
    expect(csp).not.toContain("nonce-");

    // A worker that outlives a deploy serves a stale shell with no error, which
    // is one of the worse failures available here.
    expect(headerOf(response, "cache-control")).toContain("no-cache");
  });
});
