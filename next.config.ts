import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { MAX_TRPC_BODY_BYTES } from "./src/server/http/body-limit";

const withNextIntl = createNextIntlPlugin();

// Security headers that do not vary per request.
//
// Content-Security-Policy is NOT here: it carries a per-request nonce and is set
// in src/proxy.ts. A static CSP strict enough to be worth having blocks
// Next's inline bootstrap scripts, which stops hydration and silently breaks the
// login form.
//
// Some of these are also set by Traefik in deploy/traefik.yml, but that
// only helps someone deploying behind that exact proxy. A self-hosted app runs
// behind whatever the operator already has, so the defaults belong in the app.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The barcode scanner is the only feature needing a device. Everything off.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Two years, matching the Traefik middleware. Only applies over HTTPS.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  // Cache Components (Next 16.3): dynamic by default, nothing cached unless it
  // asks with `use cache`, and Partial Prerendering as the default behaviour.
  cacheComponents: true,

  // One reusable shell prefetched per *route* rather than one request per link.
  // The 16.3 release calls this the second half of instant navigations.
  partialPrefetching: true,

  output: "standalone",

  experimental: {
    /**
     * Room for the largest receipt photograph, once base64 has inflated it.
     *
     * Next caps a request body at this value whenever a middleware is
     * configured, and `src/proxy.ts` matches every route including
     * `/api/trpc`. The default is 10 MiB, which is *below* the 13.98 MB a
     * 10 MB photograph becomes on the wire — so the documented limit could
     * not be reached and the router's own size check could never fire. See
     * `src/lib/validations/receipt.ts` for the measurements.
     *
     * **This is not the bound on what a caller can make the server hold**,
     * though it was described as one. Next applies it only while cloning the
     * body for the proxy, and the proxy's matcher skips any request labelled a
     * prefetch — one header, whatever the method. The bound that always holds
     * is in the API routes themselves (`src/server/http/body-limit.ts`), and
     * this is the same number, imported, so the two layers cannot disagree
     * about what a legitimate upload weighs. Over it, the proxy truncates and
     * the route answers 413. `upload-body-limit.test.ts` fails if the number
     * drops below what the feature needs or the two stop being one.
     */
    proxyClientMaxBodySize: MAX_TRPC_BODY_BYTES,
  },

  /**
   * Packages Next must not bundle into the server chunks.
   *
   * `tesseract.js` spawns a worker thread by absolute path. Bundled, that path
   * is resolved at build time and baked in as `/ROOT/node_modules/...` — a
   * placeholder that does not exist at runtime, so the first receipt scan in the
   * production image died with `Cannot find module` and took the OCR pass with
   * it. The file is in the image; only the path Next wrote down was wrong.
   *
   * Left external, it resolves from `node_modules` the ordinary way.
   *
   * **This is necessary and not sufficient.** With it the path is right and the
   * worker is found; the worker then fails its own `require('..')`, because
   * tracing copied `src/worker-script/node/` without `src/worker-script/index.js`.
   * Receipt scanning is still broken in the image — ISSUES.md OCR-2.
   *
   * Found by scanning a receipt inside the image, which is the one thing OCR-1
   * was closed without doing. The entry said so at the time; this is what that
   * caveat was hiding.
   */
  serverExternalPackages: ["tesseract.js"],

  /**
   * The Image Optimization endpoint is off: `/_next/image` answers 404.
   *
   * Nothing renders `next/image`, but that never made the endpoint
   * unreachable, though this file and a unit test both said so until
   * 2026-10-12. Next 16 registers `/_next/image` whatever the source imports,
   * and with the defaults it accepted any same-origin path with no query —
   * `/dashboard`, `/api/trpc/…` — and fetched it with an internal request
   * through the whole router: the proxy, the root layout, `auth()` and a
   * database lookup, for anyone, on a route no limit or test watched. When
   * the answer sniffed as a raster image it was sent back and cached under
   * `.next/cache/images`. Without `sharp` nothing failed: Next catches the
   * missing module and serves the original bytes (SECURITY_REVIEW §8).
   *
   * `unoptimized` is Next's one documented switch for this, and the only
   * condition besides a custom loader under which the server answers the
   * route with a 404 before reading a parameter. `next/image` would still
   * work with it, serving the source file as it is.
   */
  images: { unoptimized: true },

  /**
   * `sharp` is not shipped, because nothing can reach it.
   *
   * Next traces it into the standalone output whenever it is installed — 19 MB
   * of native image library — for one reason: the built-in Image Optimization
   * endpoint, `/_next/image`. That endpoint is switched off above, and since
   * the Bun migration the application no longer uses `sharp` itself: the
   * receipt pipeline is `Bun.Image`.
   *
   * The production target is treated as the security boundary, and a native
   * decoder sitting in it for a route that is switched off is surface with
   * no purpose. `sharp` stays installed for the test suite, which uses it to
   * build the decompression bomb that proves the pixel bound — a fixture
   * nobody should commit — and that is why it is a devDependency now.
   *
   * These patterns are flat because Bun's layout is. Under pnpm they read
   * `node_modules/.pnpm/**\/sharp/**`, and moving package managers without
   * rewriting them is not a no-op that leaves a stale comment behind — a
   * pattern that matches nothing excludes nothing. Measured on the first image
   * built after the move: `node_modules/@img` was back at **36.6 MB**, inside
   * the stage this project treats as its security boundary, with no route able
   * to reach it.
   *
   * The condition that makes this safe is asserted rather than remembered:
   * `src/__tests__/unit/next-image.test.ts` fails if `images.unoptimized` is
   * not `true`, and `e2e/security-headers.spec.ts` asks the production build
   * for `/_next/image` and expects the 404.
   */
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },


  // The React Compiler memoises what we would otherwise have to remember to
  // memoise. On in full mode rather than `annotation`, because opt-in
  // memoisation fails the same way manual memoisation does: the components
  // that need it are the ones nobody thought about.
  //
  // It runs as a Babel plugin, which is slower than the default Rust pipeline,
  // but Next uses an SWC pass first to apply it only to files that contain JSX
  // or hooks. Measured on this project rather than assumed — see STATUS.md.
  reactCompiler: true,

  // Applied to every route, including API and tRPC responses.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker's own policy and cache rules.
        //
        // `no-cache` rather than a max-age: a worker that outlives a deploy
        // serves a stale shell with no error, which is one of the worse
        // failures available here — the user sees an old application and
        // nothing tells them.
        //
        // No `Service-Worker-Allowed`: a script served from `/sw.js` already
        // has scope `/`. Stated because its absence looks like an oversight.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; script-src 'self'; connect-src 'self'",
          },
        ],
      },
    ];
  },

  // The version banner tells an attacker which advisories to try.
  poweredByHeader: false,

  // Hosts allowed to load dev assets. Without this, `next dev` answers 403 to
  // requests for /_next/static chunks from any origin other than localhost, so
  // the page renders but never hydrates — and the login form silently falls
  // back to a native GET. Affects development only; it has no effect on a
  // production build. Add the LAN address you use to test from other devices.
  allowedDevOrigins: [
    // Convenience for testing from a phone on the same network. Narrow this to
    // specific addresses if the network is not trusted.
    "192.168.8.*",
    // Machine-specific origins come from the environment, not the repository
    // (DEFERRED.md item 21: a developer's tailnet hostname does not belong in
    // git). Comma-separated in .env — the usual entries are a `tailscale
    // serve` hostname, the route that exists because the camera API only
    // lives in secure contexts and serve is the one HTTPS door a phone can
    // walk through without trusting a hand-made certificate, plus the tailnet
    // IPs the server is reached through over plain HTTP.
    ...(process.env.DEV_ALLOWED_ORIGIN ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ],
};

export default withNextIntl(nextConfig);
