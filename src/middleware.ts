import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy nonce.
 *
 * A static `script-src 'self'` looks strict but breaks the app: Next serves
 * inline bootstrap scripts, the browser blocks them, the page never hydrates,
 * and the login form silently falls back to a native submit. Adding
 * 'unsafe-inline' to make that go away would leave a header that reads as
 * protection while allowing exactly the injection CSP exists to stop.
 *
 * So the nonce is generated here, per request, and handed to Next through the
 * request headers — Next reads the CSP header, finds the nonce, and stamps it
 * onto the scripts it emits. 'strict-dynamic' lets those trusted scripts load
 * the chunk graph without every chunk needing its own entry.
 */
function buildCsp(nonce: string, isDev: boolean): string {
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
    "object-src 'none'",
    "base-uri 'self'",
    // Matters now that the auth forms have a no-JS POST fallback: it stops the
    // credentials being posted anywhere but here.
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildCsp(nonce, isDev);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next looks for the nonce on the *request* CSP header when rendering.
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the image optimiser, which are served
    // straight from disk and gain nothing from a per-request nonce.
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
