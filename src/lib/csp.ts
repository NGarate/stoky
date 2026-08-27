/**
 * The Content-Security-Policy, in a module so it can be read by a test.
 *
 * It carries a per-request nonce and so cannot live in `next.config.ts` — a
 * static `script-src 'self'` looks strict and breaks the app, because Next
 * serves inline bootstrap scripts and the browser blocks them, the page never
 * hydrates, and the login form silently falls back to a native submit. Adding
 * `'unsafe-inline'` to make that go away leaves a header that reads as
 * protection while allowing exactly the injection CSP exists to stop.
 *
 * Extracted from `src/proxy.ts` so its directives are assertable without
 * standing up a request.
 */
export function buildCsp(
  nonce: string,
  isDev: boolean,
  isHttps: boolean,
): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' means modern browsers trust what the nonce'd script
    // loads. Dev needs 'unsafe-eval' for hot reloading; production does not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next inlines critical CSS, which cannot carry a nonce.
    "style-src 'self' 'unsafe-inline'",
    // Product images come from Open Food Facts. data:/blob: cover the receipt
    // preview, which is a FileReader URL before upload.
    "img-src 'self' data: blob: https://images.openfoodfacts.org",
    "font-src 'self'",
    `connect-src 'self' https://world.openfoodfacts.org${isDev ? " ws: http://localhost:*" : ""}`,
    "media-src 'self'",
    /**
     * The service worker.
     *
     * `worker-src` falls back through `child-src` to `default-src` — never to
     * `script-src` — so `default-src 'self'` already permits registration
     * today. Both are named anyway, because the day someone tightens
     * `default-src` to `'none'`, which is the correct instinct, offline would
     * stop working with no error that points here.
     */
    "worker-src 'self'",
    "child-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Matters now that the auth forms have a no-JS POST fallback: it stops the
    // credentials being posted anywhere but here.
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only where https actually exists. The directive rewrites every
    // subresource request to https://, and WebKit applies that even on
    // localhost and LAN hosts, where Blink and Gecko exempt them — so on a
    // plain-http self-hosted install (or the browser suite's standalone
    // server) every tRPC call became a TLS handshake against a server with
    // no TLS, and the application died on Safari while the page rendered.
    // Behind Traefik the request arrives as https and the directive stays.
    ...(!isDev && isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
