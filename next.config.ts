import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// Security headers that do not vary per request.
//
// Content-Security-Policy is NOT here: it carries a per-request nonce and is set
// in src/middleware.ts. A static CSP strict enough to be worth having blocks
// Next's inline bootstrap scripts, which stops hydration and silently breaks the
// login form.
//
// Some of these are also set by Traefik in docker-compose.prod.yml, but that
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
  output: "standalone",

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
    // Tailscale. The hostname is what `tailscale serve` presents when it
    // proxies https://pop-os.<tailnet>.ts.net to this dev server — the route
    // that exists because the camera API only lives in secure contexts, and
    // serve is the one HTTPS door a phone can walk through without trusting a
    // hand-made certificate. The first IP is this machine's own address, since
    // that is the Host the browser requests over plain HTTP; the others are
    // other nodes on the tailnet, kept for when the server is reached through
    // them.
    "pop-os.fold-vibe.ts.net",
    "100.87.171.28",
    "100.80.50.6",
    "100.124.170.3",
  ],
};

export default withNextIntl(nextConfig);
