import { NextResponse, type NextRequest } from "next/server";

import { buildCsp } from "@/lib/csp";

/**
 * Per-request Content-Security-Policy nonce.
 *
 * The nonce is generated here, per request, and handed to Next through the
 * request headers — Next reads the CSP header, finds the nonce, and stamps it
 * onto the scripts it emits. The directives themselves live in `@/lib/csp` so
 * they can be asserted without standing up a request.
 */
export function middleware(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = crypto.randomUUID().replaceAll("-", "");
  // `upgrade-insecure-requests` is keyed on how this request actually
  // travelled: behind Traefik that is the x-forwarded-proto header TLS
  // termination writes; served directly it is the URL's own scheme. A client
  // forging the header against a plain-http install only upgrades — and so
  // breaks — its own requests, which is the harmless direction.
  const isHttps =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:";
  const csp = buildCsp(nonce, isDev, isHttps);

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
    // Everything except static assets, the image optimiser and the service
    // worker. The first two are served straight from disk and gain nothing
    // from a per-request nonce. `sw.js` is excluded for a stronger reason: a
    // nonce'd page policy applied to the worker script becomes the *worker's*
    // own policy, and the worker has no page to inherit from. Its policy is
    // set in next.config.ts instead.
    {
      source: "/((?!_next/static|_next/image|favicon.ico|sw\\.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
