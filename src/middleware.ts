import { NextResponse, type NextRequest } from "next/server";

import { buildCsp } from "@/lib/csp";
import {
  DEVICE_ID_COOKIE,
  DEVICE_ID_MAX_AGE_S,
  isDeviceId,
  mintDeviceId,
} from "@/lib/device";

/**
 * Per-request Content-Security-Policy nonce, and the device's own identifier.
 *
 * The nonce is generated here, per request, and handed to Next through the
 * request headers — Next reads the CSP header, finds the nonce, and stamps it
 * onto the scripts it emits. The directives themselves live in `@/lib/csp` so
 * they can be asserted without standing up a request.
 *
 * The device id is minted here for one reason: **this is the only place that
 * can both set a cookie and let the render that follows read it.** A server
 * component cannot set cookies, and a client component setting one would put
 * the value out of reach of the render that needs it — which is the whole
 * point, since it decides which screen a person lands on. See `@/lib/device`.
 */
export function middleware(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = crypto.randomUUID().replaceAll("-", "");

  // Before the headers are copied below, because writing to `request.cookies`
  // rewrites the cookie header — and it is that copy the render reads. Set it
  // afterwards and this request sees no device id, so every first visit would
  // be decided as though the device were unknown, and only the first.
  const existing = request.cookies.get(DEVICE_ID_COOKIE)?.value;
  const deviceId = isDeviceId(existing) ? existing : mintDeviceId();
  const isNewDevice = deviceId !== existing;
  if (isNewDevice) request.cookies.set(DEVICE_ID_COOKIE, deviceId);

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

  // Only when it was actually minted. Re-setting an unchanged cookie on every
  // request costs a `Set-Cookie` on every response and, more to the point,
  // slides its expiry constantly — so a device would be remembered a year
  // after its *last* visit rather than a year after its first, which is not
  // what a year was chosen to mean.
  if (isNewDevice) {
    response.cookies.set(DEVICE_ID_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: "lax",
      // A Secure cookie on a plain-http LAN install is one the browser
      // silently refuses to store, which would mint a new device on every
      // request. Same reasoning as the directive above.
      secure: isHttps,
      path: "/",
      maxAge: DEVICE_ID_MAX_AGE_S,
    });
  }

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
