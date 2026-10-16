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
 * **`proxy`, not `middleware`.** Next 16 renamed the convention and deprecates
 * the old filename with a build warning; the function has to be named for the
 * file it lives in, or Next refuses it. Nothing else about it changed — the
 * `config.matcher` below is unchanged, and the request headers Next carries to
 * the render are still `x-middleware-request-*`, which is why the tests that
 * read them did not move with it.
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
 * A request that renders nothing — the auth API, a bearer call — is never
 * given one; the comment at the mint says why.
 */
export function proxy(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = crypto.randomUUID().replaceAll("-", "");

  // Before the headers are copied below, because writing to `request.cookies`
  // rewrites the cookie header — and it is that copy the render reads. Set it
  // afterwards and this request sees no device id, so every first visit would
  // be decided as though the device were unknown, and only the first.
  //
  // Never minted for the auth API or for a bearer request. Neither renders
  // anything, so a fresh id buys the request itself nothing: a device is
  // known only once a sign-in has recorded the id it already had, and a
  // just-minted one never has been. (It did buy a client that keeps cookies
  // something later: its sign-in recorded the minted id, so its next one had
  // a budget of its own. A client that never renders a page now stays on the
  // shared account budget — SECURITY.md, known devices.) What a minted cookie
  // *does* do there is harmful. A native
  // client sends no cookies and no Origin; Better Auth treats a request that
  // carries a cookie as a browser's and refuses it without an Origin (403
  // MISSING_OR_NULL_ORIGIN, measured in the spike), so the cookie this
  // function injected would be the one that refused it. And a Set-Cookie on
  // a bearer-authenticated tRPC response is stored and replayed by iOS's
  // URLSession, turning a token client into a cookie client behind its back.
  // A valid id the client did send is still forwarded: a browser posting its
  // sign-in is exactly the request that should be charged to its own budget,
  // and leaving the header untouched is what forwards it. An invalid one is
  // left as it came too: every reader validates it (`deviceIdFromHeaders`),
  // and replacing it would hand Better Auth a cookie the client never sent.
  const existing = request.cookies.get(DEVICE_ID_COOKIE)?.value;
  const minted =
    isDeviceId(existing) || isAuthOrBearer(request) ? undefined : mintDeviceId();
  if (minted) request.cookies.set(DEVICE_ID_COOKIE, minted);

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

  // Only when it was actually minted here. Re-setting an unchanged cookie on every
  // request costs a `Set-Cookie` on every response and, more to the point,
  // slides its expiry constantly — so a device would be remembered a year
  // after its *last* visit rather than a year after its first, which is not
  // what a year was chosen to mean.
  if (minted) {
    response.cookies.set(DEVICE_ID_COOKIE, minted, {
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

/**
 * A request no device id should be minted for: the auth API, which only a
 * page that has already been rendered (and so already minted one) or a
 * native client ever calls, and anything presenting a bearer token, which is
 * a native client by definition. The prefix keeps its trailing slash so
 * `/api/authors` would not match; the scheme is case-insensitive (RFC 9110
 * §11.1), and `\s` after it means `Bearer` alone, with no token, still is not
 * a bearer request.
 */
function isAuthOrBearer(request: NextRequest): boolean {
  return (
    request.nextUrl.pathname.startsWith("/api/auth/") ||
    /^Bearer\s/i.test(request.headers.get("authorization") ?? "")
  );
}

export const config = {
  matcher: [
    // Everything except the build's static assets, the app icons and the
    // service worker. Each exclusion is anchored to exactly what it is for,
    // because only a file that exists is served from disk:
    // any other path, `/icons/x`, `/icons/x.png` or `/sw.jsx`, falls through
    // to the app's not-found render — a full HTML document on this origin,
    // which until 2026-10-12 the old prefix exclusions sent out with no
    // policy at all (SECURITY_REVIEW §8). So the icons are named one by one:
    // a pattern such as `icons/*.png` would still skip the proxy for a name
    // that is not there. `proxy-matcher.test.ts` goes red when a file in
    // `public/icons/` is missing from this list. `_next/static/` stays a
    // prefix because Next answers a miss there with plain text, never the
    // app. There is no `favicon.ico`, so it is not excluded: a top-level
    // visit to it is a render like any other, and the browser's own icon
    // fetch is answered with plain text anyway (`Sec-Fetch-Dest: image`).
    //
    // `/_next/image` is not excluded any more. The optimiser is switched off
    // (`images.unoptimized` in next.config.ts), and Next answers the route
    // with that same not-found document, so it needs the policy like any
    // other miss (SECURITY_REVIEW §8).
    //
    // The icons gain nothing from a per-request nonce. `sw.js` is excluded
    // for a stronger reason: a nonce'd page policy applied to the worker
    // script becomes the *worker's* own policy, and the worker has no page to
    // inherit from. Its policy is set in next.config.ts
    // instead. `$` is the end of the pathname: Next compiles this source into
    // a regexp tested against the pathname alone, with no query string.
    {
      source:
        "/((?!_next/static/|icons/(?:icon\\.svg|icon-maskable\\.svg|icon-192\\.png|icon-512\\.png|icon-maskable-512\\.png|apple-touch-icon\\.png)$|sw\\.js$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
