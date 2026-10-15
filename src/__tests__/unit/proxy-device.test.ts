import { describe, it, expect } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { DEVICE_ID_COOKIE, isDeviceId } from "@/lib/device";

/**
 * The proxy's half of Journey 8: minting the device id, and — the part
 * that is easy to get wrong and impossible to notice — making it readable by
 * the render that follows on the very same request.
 *
 * Next carries the proxy's view of the request to the render in
 * `x-middleware-request-*` headers, and the render's `cookies()` reads those.
 * So a device id set only on the *response* would reach the browser and be
 * invisible to the render that needed it, and the symptom would be a first
 * visit decided as though the device were unknown — on every first visit, and
 * never afterwards, which is the hardest kind of bug to catch by using the
 * application.
 */

const KNOWN = "6ba7b810-9dad-4d11-80b4-00c04fd430c8";

/** The cookie header the render will see, as Next forwards it. */
function forwardedCookie(response: Response): string {
  return response.headers.get("x-middleware-request-cookie") ?? "";
}

function setCookie(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

describe("a device with no id yet", () => {
  it("is given one the render can already read", () => {
    const response = proxy(new NextRequest("https://example.test/"));

    const forwarded = forwardedCookie(response);
    const value = /stoky_device=([^;]+)/.exec(forwarded)?.[1];

    expect(isDeviceId(value)).toBe(true);
    // And the same one goes to the browser, or the next request mints another
    // and no device is ever the same device twice.
    expect(setCookie(response)).toContain(`${DEVICE_ID_COOKIE}=${value}`);
  });

  it("is sent a cookie no script can read and no other site can trigger", () => {
    const header = setCookie(proxy(new NextRequest("https://example.test/")));

    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=lax");
    expect(header).toContain("Path=/");
    // A year, so "asked once, then remembered" survives a browser restart.
    expect(header).toContain("Max-Age=31536000");
  });

  it("marks the cookie Secure over https and not over plain http", () => {
    // The same reasoning as `upgrade-insecure-requests` beside it: this
    // project is reachable over plain http on a LAN, and a Secure cookie there
    // is one the browser silently refuses to store — which would mint a new
    // device on every single request.
    expect(setCookie(proxy(new NextRequest("https://example.test/")))).toContain(
      "Secure",
    );
    expect(
      setCookie(proxy(new NextRequest("http://192.168.8.20/"))),
    ).not.toContain("Secure");
  });
});

describe("a device that already has one", () => {
  function withCookie(value: string): NextRequest {
    const request = new NextRequest("https://example.test/");
    request.cookies.set(DEVICE_ID_COOKIE, value);
    return request;
  }

  it("keeps it, and is not sent it again", () => {
    const response = proxy(withCookie(KNOWN));

    expect(forwardedCookie(response)).toContain(`${DEVICE_ID_COOKIE}=${KNOWN}`);
    // Re-setting an unchanged cookie would slide its expiry on every request,
    // so a device would be remembered a year after its *last* visit rather
    // than a year after its first.
    expect(setCookie(response)).not.toContain(DEVICE_ID_COOKIE);
  });

  it("replaces a value it did not mint", () => {
    // The value is attacker-controlled and becomes half of a database key.
    const response = proxy(withCookie("'; drop table \"User\"; --"));

    const value = /stoky_device=([^;]+)/.exec(forwardedCookie(response))?.[1];
    expect(isDeviceId(value)).toBe(true);
    expect(setCookie(response)).toContain(DEVICE_ID_COOKIE);
  });
});

describe("a request that renders nothing", () => {
  // Under Better Auth a request carrying any cookie is treated as a browser's
  // and refused without an Origin, which a native client never sends (the
  // spike measured 403 MISSING_OR_NULL_ORIGIN). A device id injected here
  // would be that cookie. And iOS's URLSession stores and replays whatever a
  // response sets, so a Set-Cookie on a bearer call would quietly make a
  // token client a cookie client.

  it("mints nothing for the auth API", () => {
    const response = proxy(
      new NextRequest("https://example.test/api/auth/sign-in/email", {
        method: "POST",
      }),
    );

    expect(forwardedCookie(response)).not.toContain(DEVICE_ID_COOKIE);
    expect(setCookie(response)).not.toContain(DEVICE_ID_COOKIE);
  });

  it("mints nothing for a bearer request, whatever the scheme's case", () => {
    for (const scheme of ["Bearer", "bearer"]) {
      const response = proxy(
        new NextRequest("https://example.test/api/trpc/inventory.list", {
          headers: { authorization: `${scheme} abc.def` },
        }),
      );

      expect(forwardedCookie(response)).not.toContain(DEVICE_ID_COOKIE);
      expect(setCookie(response)).not.toContain(DEVICE_ID_COOKIE);
    }
  });

  it("still forwards an id the browser did send to the auth API", () => {
    // The sign-in it posts is charged to this device's own budget only if
    // the route can read the id the login page minted.
    const request = new NextRequest(
      "https://example.test/api/auth/sign-in/email",
      { method: "POST" },
    );
    request.cookies.set(DEVICE_ID_COOKIE, KNOWN);
    const response = proxy(request);

    expect(forwardedCookie(response)).toContain(`${DEVICE_ID_COOKIE}=${KNOWN}`);
    expect(setCookie(response)).not.toContain(DEVICE_ID_COOKIE);
  });

  it("still mints for the login page, and for paths that only look alike", () => {
    // The page is where a browser gets its id before it ever posts; and the
    // prefix keeps its slash, so a sibling such as /api/authors is a render
    // like any other. A non-bearer Authorization does not count either.
    for (const request of [
      new NextRequest("https://example.test/login"),
      new NextRequest("https://example.test/api/authors"),
      new NextRequest("https://example.test/login", {
        headers: { authorization: "Basic dTpw" },
      }),
    ]) {
      const response = proxy(request);
      const value = /stoky_device=([^;]+)/.exec(forwardedCookie(response))?.[1];

      expect(isDeviceId(value)).toBe(true);
      expect(setCookie(response)).toContain(`${DEVICE_ID_COOKIE}=${value}`);
    }
  });
});

describe("what it did not stop doing", () => {
  it("still mints a per-request CSP nonce", () => {
    // The device id shares this function with the nonce, and the nonce is what
    // stops the login form being a dead page. Regressing it while adding a
    // cookie is exactly the accident worth pinning.
    const first = proxy(new NextRequest("https://example.test/"));
    const second = proxy(new NextRequest("https://example.test/"));

    const nonceOf = (r: Response) =>
      r.headers.get("x-middleware-request-x-nonce") ?? "";

    expect(nonceOf(first)).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    expect(first.headers.get("content-security-policy")).toContain(
      `'nonce-${nonceOf(first)}'`,
    );
  });

  it("still sets the policy on the requests it mints nothing for", () => {
    // The matcher did not change, so the auth API and bearer calls keep
    // their CSP; only the cookie is skipped.
    const response = proxy(
      new NextRequest("https://example.test/api/auth/get-session"),
    );

    expect(response.headers.get("content-security-policy")).toContain(
      "default-src",
    );
  });
});
