import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { DEVICE_ID_COOKIE, mintDeviceId } from "@/lib/device";
import {
  RateLimitUnavailableError,
  loginRateLimit,
  passkeyOptionsRateLimit,
  type RateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit";
import type { SignInLimiter } from "@/lib/auth/sign-in-policy";
import { MAX_AUTH_BODY_BYTES } from "@/server/http/body-limit";
import {
  ALLOWED_AUTH_ENDPOINTS,
  handleAuthRequest,
  type AuthEndpointHandler,
  type SignInSessions,
} from "@/server/http/auth-handler";

/**
 * The auth API's policy, with Better Auth replaced by a fake handler and the
 * cache by a script.
 *
 * What is real is everything this application decides before and after Better
 * Auth: the allowlist, the bounds, the guards, the charge and its settling,
 * and what the response is allowed to carry. That Better Auth itself answers
 * the way the fake does is `integration/auth.surface.test.ts` and
 * `integration/session.policy.test.ts`, through the real route.
 */

const BASE = "http://localhost:3000/api/auth";
const ADDRESS = loginRateLimit().prefix;

type Call = [string, ...unknown[]];

function fakeLimiter(
  consume: Record<string, Partial<RateLimitResult> | Error> = {},
): { limiter: SignInLimiter; calls: Call[] } {
  const calls: Call[] = [];
  const limiter: SignInLimiter = {
    consume: async (limit: RateLimit, identifier: string) => {
      calls.push(["consume", limit.prefix, identifier]);
      const answer = consume[limit.prefix];
      if (answer instanceof Error) throw answer;
      return { allowed: true, remaining: 1, retryAfterSeconds: 0, window: 7, ...answer };
    },
    refund: async (limit, identifier, window) => {
      calls.push(["refund", limit.prefix, identifier, window]);
    },
    reset: async (limit, identifier) => {
      calls.push(["reset", limit.prefix, identifier]);
    },
    isKnownDevice: async () => false,
    rememberDevice: async (account, deviceId) => {
      calls.push(["rememberDevice", account, deviceId]);
    },
  };
  return { limiter, calls };
}

/** A handler that records what reached it and answers `answer`. */
function fakeHandler(answer: () => Response = () => Response.json({ ok: true })) {
  const seen: Request[] = [];
  const handle = mock(async (req: Request) => {
    seen.push(req);
    return answer();
  });
  return { handler: () => handle as AuthEndpointHandler, handle, seen };
}

function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
    body,
  });
}

const signedIn = () =>
  Response.json({ redirect: false, token: "raw-token", user: { id: "user-1", email: "a@b.es" } });

let securityLines: ReturnType<typeof spyOn<Console, "warn">>;
let errors: ReturnType<typeof spyOn<Console, "error">>;
beforeEach(() => {
  securityLines = spyOn(console, "warn").mockImplementation(() => {});
  errors = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  securityLines.mockRestore();
  errors.mockRestore();
});

describe("which endpoints answer", () => {
  it("is the seventeen this application uses", () => {
    expect([...ALLOWED_AUTH_ENDPOINTS].sort()).toEqual([
      "GET /error",
      "GET /get-session",
      "GET /ok",
      "GET /passkey/generate-authenticate-options",
      "GET /passkey/generate-register-options",
      "GET /passkey/list-user-passkeys",
      "POST /passkey/delete-passkey",
      "POST /passkey/update-passkey",
      "POST /passkey/verify-authentication",
      "POST /passkey/verify-registration",
      "POST /sign-in/email",
      "POST /sign-out",
      "POST /two-factor/disable",
      "POST /two-factor/enable",
      "POST /two-factor/generate-backup-codes",
      "POST /two-factor/verify-backup-code",
      "POST /two-factor/verify-totp",
    ]);
  });

  it("answers anything else 404 without reaching Better Auth", async () => {
    const { handler, handle } = fakeHandler();
    const { limiter } = fakeLimiter();

    for (const request of [
      post("/sign-up/email", "{}"),
      post("/change-password", "{}"),
      post("/revoke-sessions", "{}"),
      // Two-step verification's secret, handed back to the session (D148),
      // and the rest of the plugin's paths, mounted over HTTP or not.
      post("/two-factor/get-totp-uri", "{}"),
      post("/two-factor/view-backup-codes", "{}"),
      post("/two-factor/send-otp", "{}"),
      post("/two-factor/verify-otp", "{}"),
      new Request(`${BASE}/list-sessions`),
      // The same endpoints by another method or spelling.
      post("/passkey/generate-authenticate-options", "{}"),
      new Request(`${BASE}/passkey/verify-authentication`),
      new Request(`${BASE}/sign-in/email`),
      post("/get-session", "{}"),
      post("/sign-in/email/", "{}"),
      post("//sign-in/email", "{}"),
      post("/sign-in%2Femail", "{}"),
      new Request("http://localhost:3000/api/authsign-out"),
    ]) {
      const response = await handleAuthRequest(request, { handler, limiter });
      expect(response.status, `${request.method} ${request.url}`).toBe(404);
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it("passes an allowed read through", async () => {
    const { handler, handle } = fakeHandler(() => Response.json(null));

    const response = await handleAuthRequest(new Request(`${BASE}/get-session`), { handler });

    expect(response.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the instance refuses its environment", async () => {
    const response = await handleAuthRequest(new Request(`${BASE}/get-session`), {
      handler: () => {
        throw new Error("[auth] unavailable: STOKY_URLS is not set.");
      },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AUTH_UNAVAILABLE" });
    expect(securityLines.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      '"event":"auth.unavailable"',
    );
  });
});

describe("what a POST must be", () => {
  it("is refused 403 when a browser says another site sent it", async () => {
    const { handler, handle } = fakeHandler();

    const response = await handleAuthRequest(
      post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x" }), {
        "sec-fetch-site": "cross-site",
      }),
      { handler, limiter: fakeLimiter().limiter },
    );

    expect(response.status).toBe(403);
    expect(handle).not.toHaveBeenCalled();
  });

  it("is refused 415 unless it is JSON, which no form can send", async () => {
    const { handler, handle } = fakeHandler();

    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const response = await handleAuthRequest(
        post("/sign-in/email", "email=a%40b.es&password=x", { "content-type": type }),
        { handler, limiter: fakeLimiter().limiter },
      );
      expect(response.status, type).toBe(415);
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it("is never cached, refusals included", async () => {
    const { handler } = fakeHandler();
    const refused = await handleAuthRequest(post("/nowhere", "{}"), { handler });
    const answered = await handleAuthRequest(new Request(`${BASE}/ok`), { handler });

    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(answered.headers.get("cache-control")).toBe("no-store");
  });
});

describe("a password sign-in", () => {
  it("reaches Better Auth as a trimmed, lower-cased address, a password and nothing else", async () => {
    const { handler, seen } = fakeHandler(signedIn);

    await handleAuthRequest(
      post(
        "/sign-in/email?callbackURL=https://evil.example",
        JSON.stringify({
          email: "  Ana@Example.COM ",
          password: " con espacios ",
          rememberMe: true,
          callbackURL: "https://evil.example",
        }),
      ),
      { handler, limiter: fakeLimiter().limiter },
    );

    expect(seen).toHaveLength(1);
    expect(await seen[0].json()).toEqual({
      email: "ana@example.com",
      password: " con espacios ",
      rememberMe: true,
    });
    expect(new URL(seen[0].url).search).toBe("");
    expect(seen[0].headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("is refused 429 with Retry-After when the address has no attempts left", async () => {
    const { handler, handle } = fakeHandler(signedIn);
    const { limiter } = fakeLimiter({ [ADDRESS]: { allowed: false, retryAfterSeconds: 437 } });

    const response = await handleAuthRequest(
      post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x" })),
      { handler, limiter },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("437");
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("is refused 503 without Retry-After when the limiter cannot be reached", async () => {
    const { handler, handle } = fakeHandler(signedIn);
    const { limiter } = fakeLimiter({ [ADDRESS]: new RateLimitUnavailableError(new Error("down")) });

    const response = await handleAuthRequest(
      post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x" })),
      { handler, limiter },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.json()).toMatchObject({ code: "AUTH_UNAVAILABLE" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("charges a body that is not JSON, and answers it without Better Auth", async () => {
    const { handler, handle } = fakeHandler(signedIn);
    const { limiter, calls } = fakeLimiter();

    const response = await handleAuthRequest(post("/sign-in/email", "{not json"), {
      handler,
      limiter,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(calls.filter(([what]) => what === "consume")).toEqual([
      ["consume", ADDRESS, "203.0.113.9"],
    ]);
    expect(handle).not.toHaveBeenCalled();
  });

  it("refunds the attempt and remembers the device when Better Auth lets it in", async () => {
    const deviceId = mintDeviceId();
    const { handler } = fakeHandler(signedIn);
    const { limiter, calls } = fakeLimiter();

    await handleAuthRequest(
      post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x" }), {
        cookie: `${DEVICE_ID_COOKIE}=${deviceId}`,
      }),
      { handler, limiter },
    );

    const kinds = calls.map(([what]) => what);
    expect(kinds).toContain("refund");
    expect(kinds).toContain("rememberDevice");
  });

  it("refunds nothing when Better Auth refuses the password", async () => {
    const { handler } = fakeHandler(() =>
      Response.json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 }),
    );
    const { limiter, calls } = fakeLimiter();

    const response = await handleAuthRequest(
      post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x" })),
      { handler, limiter },
    );

    expect(response.status).toBe(401);
    expect(calls.map(([what]) => what)).not.toContain("refund");
    // And it is on record as a failure, under the account's tag.
    const written = securityLines.mock.calls.map((call) => String(call[0])).join("\n");
    expect(written).toContain('"event":"auth.signin.failed"');
    expect(written).not.toContain("a@b.es");
  });
});

describe("remember-me", () => {
  const DONT_REMEMBER = "__Secure-stoky.dont_remember";
  const dontRememberCookie = async () => ({ name: DONT_REMEMBER, secure: true });

  async function signInWithBody(
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
    answer: () => Response = signedIn,
  ) {
    const { handler, seen } = fakeHandler(answer);
    const response = await handleAuthRequest(
      post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x", ...body }), headers),
      { handler, limiter: fakeLimiter().limiter, dontRememberCookie },
    );
    return { response, forwarded: seen[0] };
  }

  it("is true only for a body that says exactly true", async () => {
    // Better Auth reads a missing value as true: an unticked box, or a client
    // that never heard of it, must not become a ninety-day cookie.
    for (const [value, expected] of [
      [true, true],
      [undefined, false],
      [false, false],
      ["true", false],
      [1, false],
      ["on", false],
    ] as const) {
      const { forwarded } = await signInWithBody(value === undefined ? {} : { rememberMe: value });
      const label = JSON.stringify(value);
      expect((await forwarded.json()).rememberMe, label).toBe(expected);
      expect(forwarded.headers.get("x-stoky-remember"), label).toBe(expected ? "1" : "0");
    }
  });

  it("is said by the route, never by the client's own header", async () => {
    const { forwarded } = await signInWithBody({}, { "x-stoky-remember": "1" });
    expect(forwarded.headers.get("x-stoky-remember")).toBe("0");
  });

  it("never lets a client's header through on any other path", async () => {
    const { handler, seen } = fakeHandler();
    await handleAuthRequest(
      new Request(`${BASE}/get-session`, { headers: { "x-stoky-remember": "1" } }),
      { handler },
    );
    await handleAuthRequest(post("/sign-out", "{}", { "x-stoky-remember": "1" }), { handler });

    expect(seen).toHaveLength(2);
    for (const request of seen) expect(request.headers.get("x-stoky-remember")).toBeNull();
  });

  it("ticked, takes dont_remember out of what Better Auth reads, and nothing else", async () => {
    const { forwarded } = await signInWithBody(
      { rememberMe: true },
      { cookie: `stoky_device=abc; ${DONT_REMEMBER}=true.sig; odd; other=1` },
    );
    expect(forwarded.headers.get("cookie")).toBe("stoky_device=abc; odd; other=1");
  });

  it("ticked, with dont_remember the only cookie, sends none", async () => {
    const { forwarded } = await signInWithBody(
      { rememberMe: true },
      { cookie: `${DONT_REMEMBER}=true.sig` },
    );
    expect(forwarded.headers.get("cookie")).toBeNull();
  });

  it("ticked, expires dont_remember in the browser, as the instance names it", async () => {
    const { response } = await signInWithBody({ rememberMe: true });
    expect(response.headers.getSetCookie()).toContain(
      `${DONT_REMEMBER}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`,
    );
  });

  it("ticked on plain HTTP, expires it without Secure", async () => {
    const { handler } = fakeHandler(signedIn);
    const response = await handleAuthRequest(
      post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x", rememberMe: true })),
      {
        handler,
        limiter: fakeLimiter().limiter,
        dontRememberCookie: async () => ({ name: "stoky.dont_remember", secure: false }),
      },
    );
    expect(response.headers.getSetCookie()).toContain(
      "stoky.dont_remember=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    );
  });

  it("unticked, leaves the cookies alone both ways", async () => {
    const cookie = `stoky_device=abc; ${DONT_REMEMBER}=true.sig`;
    const { response, forwarded } = await signInWithBody({ rememberMe: false }, { cookie });
    expect(forwarded.headers.get("cookie")).toBe(cookie);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("ticked but refused, changes nothing in the browser", async () => {
    const { response } = await signInWithBody({ rememberMe: true }, {}, () =>
      Response.json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe("what a sign-in ends", () => {
  /** Sessions that record the order things happened in. */
  function fakeSessions(
    presented: { id: string; userId: string } | null = { id: "s-old", userId: "user-9" },
    tidy: (input: unknown) => Promise<unknown> = async () => 1,
  ) {
    const order: string[] = [];
    const tidied: unknown[] = [];
    const sessions: SignInSessions = {
      presented: async () => {
        order.push("presented");
        return presented;
      },
      tidy: async (input) => {
        order.push("tidy");
        tidied.push(input);
        return tidy(input);
      },
      end: async () => {
        order.push("end");
      },
    };
    return { sessions, order, tidied };
  }

  const signInRequest = () =>
    post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x" }), {
      cookie: "stoky.session_token=old",
    });

  it("reads the presented session before Better Auth answers, and tidies after with the raw token", async () => {
    const { sessions, order, tidied } = fakeSessions();
    const handle = mock(async () => {
      order.push("better-auth");
      return signedIn();
    });

    const response = await handleAuthRequest(signInRequest(), {
      handler: () => handle,
      limiter: fakeLimiter().limiter,
      sessions,
    });

    expect(order).toEqual(["presented", "better-auth", "tidy"]);
    expect(tidied).toEqual([
      { previous: { id: "s-old", userId: "user-9" }, userId: "user-1", newToken: "raw-token" },
    ]);
    // Read for the tidy, still never handed to the page.
    expect(JSON.stringify(await response.json())).not.toContain("raw-token");
  });

  it("finds the token inside the session when the answer carries it there", async () => {
    const { sessions, tidied } = fakeSessions(null);
    const { handler } = fakeHandler(() =>
      Response.json({ session: { token: "nested-token" }, user: { id: "user-1" } }),
    );

    await handleAuthRequest(signInRequest(), { handler, limiter: fakeLimiter().limiter, sessions });

    expect(tidied).toEqual([{ previous: null, userId: "user-1", newToken: "nested-token" }]);
  });

  it("ends nothing when Better Auth refuses the password", async () => {
    const { sessions, order } = fakeSessions();
    const { handler } = fakeHandler(() =>
      Response.json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 }),
    );

    await handleAuthRequest(signInRequest(), { handler, limiter: fakeLimiter().limiter, sessions });

    expect(order).not.toContain("tidy");
  });

  it("ends nothing when the answer issued no session", async () => {
    const { sessions, order } = fakeSessions();
    const { handler } = fakeHandler(() =>
      Response.json({ redirect: false, user: { id: "user-1" } }),
    );

    await handleAuthRequest(signInRequest(), { handler, limiter: fakeLimiter().limiter, sessions });

    expect(order).not.toContain("tidy");
  });

  it("reads nothing for a sign-in refused before Better Auth", async () => {
    const { sessions, order } = fakeSessions();
    const { limiter } = fakeLimiter({ [ADDRESS]: { allowed: false, retryAfterSeconds: 9 } });

    await handleAuthRequest(signInRequest(), { handler: fakeHandler(signedIn).handler, limiter, sessions });

    expect(order).toEqual([]);
  });

  it("still signs the person in when the tidy fails, and says so in the log", async () => {
    const { sessions } = fakeSessions(undefined, async () => {
      throw new Error("database went away");
    });
    const { handler } = fakeHandler(() => {
      const response = signedIn();
      response.headers.append("set-cookie", "stoky.session_token=new; Path=/; HttpOnly");
      return response;
    });

    const response = await handleAuthRequest(signInRequest(), {
      handler,
      limiter: fakeLimiter().limiter,
      sessions,
    });

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "sign-in tidy failed: Error: database went away",
    );
  });
});

describe("what an answer may carry", () => {
  it("never the session token, in the body or inside its session", async () => {
    const { handler } = fakeHandler(() =>
      Response.json({
        token: "top-level",
        session: { id: "s1", token: "nested", expiresAt: "2099-01-01T00:00:00.000Z" },
        user: { id: "user-1" },
      }),
    );

    const response = await handleAuthRequest(new Request(`${BASE}/get-session`), { handler });
    const body = (await response.json()) as Record<string, Record<string, unknown>>;

    expect(body.token).toBeUndefined();
    expect(body.session.token).toBeUndefined();
    expect(body.session.id).toBe("s1");
    expect(body.user.id).toBe("user-1");
  });

  it("never a bearer token in a header, to a request that carried a cookie", async () => {
    const { handler } = fakeHandler(
      () =>
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "set-auth-token": "signed-token",
            "access-control-expose-headers": "set-auth-token, x-other",
          },
        }),
    );

    const response = await handleAuthRequest(
      new Request(`${BASE}/get-session`, { headers: { cookie: "stoky.session_token=x" } }),
      { handler },
    );

    expect(response.headers.get("set-auth-token")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBe("x-other");
  });

  it("keeps every cookie Better Auth sets", async () => {
    const { handler } = fakeHandler(() => {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "stoky.session_token=a; Path=/; HttpOnly");
      headers.append("set-cookie", "stoky.dont_remember=b; Path=/; HttpOnly");
      return new Response(JSON.stringify({ user: { id: "user-1" } }), { headers });
    });

    const response = await handleAuthRequest(
      post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x" })),
      { handler, limiter: fakeLimiter().limiter },
    );

    expect(response.headers.getSetCookie()).toHaveLength(2);
  });
});

describe("the body bound", () => {
  /** A sign-out padded to exactly `size` bytes of JSON. */
  function signOutOf(size: number): Request {
    const unpadded = JSON.stringify({ pad: "" }).length;
    const body = JSON.stringify({ pad: "a".repeat(size - unpadded) });
    expect(body.length).toBe(size);
    return post("/sign-out", body);
  }

  it("lets a body of exactly the limit through", async () => {
    const { handler, handle } = fakeHandler();
    const response = await handleAuthRequest(signOutOf(MAX_AUTH_BODY_BYTES), { handler });
    expect(response.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("refuses one byte more with 413, unread by Better Auth", async () => {
    const { handler, handle } = fakeHandler();
    const response = await handleAuthRequest(signOutOf(MAX_AUTH_BODY_BYTES + 1), { handler });
    expect(response.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses a body over the limit that declares no length", async () => {
    const chunk = new Uint8Array(16 * 1024).fill(0x61);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Five 16 KiB chunks: 80 KiB, and nothing says so up front.
        if (sent++ === 5) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const { handler, handle } = fakeHandler();

    const response = await handleAuthRequest(
      new Request(`${BASE}/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      { handler, limiter: fakeLimiter().limiter },
    );

    expect(response.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("two-step verification", () => {
  const CHALLENGE = "stoky.two_factor";
  const SESSION = "stoky.session_token";
  const twoFactorCookies = async () => ({ challenge: CHALLENGE, session: SESSION });

  /** Sessions that record what the route asked of them. */
  function recordingSessions(presented: { id: string; userId: string } | null) {
    const asked: unknown[][] = [];
    const sessions: SignInSessions = {
      presented: async () => presented,
      tidy: async (input) => {
        asked.push(["tidy", input]);
      },
      end: async (previous, account) => {
        asked.push(["end", previous, account]);
      },
    };
    return { sessions, asked };
  }

  const events = () =>
    securityLines.mock.calls.flatMap((call) => {
      try {
        return [JSON.parse(String(call[0])) as Record<string, string>];
      } catch {
        return [];
      }
    });

  const challenged = () =>
    Response.json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] }, {
      headers: { "set-cookie": `${CHALLENGE}=abc.sig; Max-Age=600; Path=/; HttpOnly` },
    });

  /** Better Auth's answer to a code that signed somebody in. */
  const signedInByCode = () => {
    const response = Response.json({ token: "raw-token", user: { id: "user-1", email: "ana@example.com" } });
    response.headers.append("set-cookie", `${SESSION}=new.sig; Path=/; HttpOnly; SameSite=Lax`);
    response.headers.append("set-cookie", `${CHALLENGE}=; Max-Age=0; Path=/`);
    return response;
  };

  const code = (path: string, body: unknown, cookie = `${CHALLENGE}=abc.sig`) =>
    post(path, JSON.stringify(body), cookie ? { cookie } : {});

  describe("a password step that asks for a code", () => {
    it("settles the charge, ends the presented session and is logged as challenged", async () => {
      const { handler } = fakeHandler(challenged);
      const { limiter, calls } = fakeLimiter();
      const { sessions, asked } = recordingSessions({ id: "s-old", userId: "user-9" });

      const response = await handleAuthRequest(
        post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x" }), {
          cookie: `${SESSION}=old.sig`,
        }),
        { handler, limiter, sessions },
      );

      expect(response.status).toBe(200);
      const kinds = calls.map(([what]) => what);
      // The account counter cleared and the address refunded, as a sign-in.
      expect(kinds).toContain("reset");
      expect(kinds).toContain("refund");
      // But the browser is not a known device yet: it has not got in.
      expect(kinds).not.toContain("rememberDevice");
      expect(asked).toEqual([["end", { id: "s-old", userId: "user-9" }, expect.any(String)]]);
      const written = events().map((line) => line.event);
      expect(written).toContain("auth.signin.challenged");
      expect(written).not.toContain("auth.signin.succeeded");
      expect(written).not.toContain("auth.signin.failed");
    });

    it("ends nothing when the browser presented no session", async () => {
      const { sessions, asked } = recordingSessions(null);

      await handleAuthRequest(
        post("/sign-in/email", JSON.stringify({ email: "a@b.es", password: "x" })),
        { handler: fakeHandler(challenged).handler, limiter: fakeLimiter().limiter, sessions },
      );

      expect(asked).toEqual([]);
    });
  });

  describe("the second step", () => {
    it("reaches Better Auth with the code and nothing else", async () => {
      for (const path of ["/two-factor/verify-totp", "/two-factor/verify-backup-code"]) {
        const { handler, seen } = fakeHandler(signedInByCode);

        await handleAuthRequest(
          post(
            `${path}?callbackURL=https://evil.example`,
            JSON.stringify({ code: "123456", trustDevice: true, disableSession: true }),
            { cookie: `${CHALLENGE}=abc.sig`, "x-stoky-remember": "1" },
          ),
          { handler, limiter: fakeLimiter().limiter, twoFactorCookies },
        );

        expect(seen, path).toHaveLength(1);
        expect(await seen[0].json()).toEqual({ code: "123456" });
        expect(new URL(seen[0].url).search).toBe("");
        expect(seen[0].headers.get("x-stoky-remember")).toBeNull();
      }
    });

    it("is charged against the address alone", async () => {
      const { limiter, calls } = fakeLimiter();

      await handleAuthRequest(code("/two-factor/verify-totp", { code: "123456" }), {
        handler: fakeHandler(() => Response.json({ code: "INVALID_CODE" }, { status: 401 })).handler,
        limiter,
        twoFactorCookies,
      });

      expect(calls.filter(([what]) => what === "consume")).toEqual([
        ["consume", ADDRESS, "203.0.113.9"],
      ]);
    });

    it("is refused 429 before Better Auth when the address has no attempts left", async () => {
      const { handler, handle } = fakeHandler(signedInByCode);
      const { limiter } = fakeLimiter({ [ADDRESS]: { allowed: false, retryAfterSeconds: 12 } });

      const response = await handleAuthRequest(code("/two-factor/verify-totp", { code: "123456" }), {
        handler,
        limiter,
        twoFactorCookies,
      });

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("12");
      expect(handle).not.toHaveBeenCalled();
    });

    it("answers a body without a code 400, charged and without Better Auth", async () => {
      const { handler, handle } = fakeHandler(signedInByCode);
      const { limiter, calls } = fakeLimiter();

      for (const body of ["{not json", JSON.stringify({ code: 123456 }), JSON.stringify({})]) {
        const response = await handleAuthRequest(
          post("/two-factor/verify-totp", body, { cookie: `${CHALLENGE}=abc.sig` }),
          { handler, limiter, twoFactorCookies },
        );
        expect(response.status, body).toBe(400);
      }

      expect(handle).not.toHaveBeenCalled();
      expect(calls.filter(([what]) => what === "consume")).toHaveLength(3);
    });

    it("signs in when it carried the challenge and was answered with a session", async () => {
      for (const [path, method] of [
        ["/two-factor/verify-totp", "totp"],
        ["/two-factor/verify-backup-code", "backup-code"],
      ] as const) {
        securityLines.mockClear();
        const deviceId = mintDeviceId();
        const { limiter, calls } = fakeLimiter();
        const { sessions, asked } = recordingSessions(null);

        const response = await handleAuthRequest(
          code(path, { code: "123456" }, `${CHALLENGE}=abc.sig; ${DEVICE_ID_COOKIE}=${deviceId}`),
          { handler: fakeHandler(signedInByCode).handler, limiter, sessions, twoFactorCookies },
        );

        expect(response.status).toBe(200);
        expect(calls.filter(([what]) => what === "refund")).toEqual([
          ["refund", ADDRESS, "203.0.113.9", 7],
        ]);
        expect(calls.filter(([what]) => what === "rememberDevice")).toEqual([
          ["rememberDevice", expect.any(String), deviceId],
        ]);
        // The presented session ended at the password step; the tidy is the
        // account's expired rows and the cap, never the new session.
        expect(asked).toEqual([["tidy", { previous: null, userId: "user-1", newToken: "raw-token" }]]);
        expect(events().find((line) => line.event === "auth.signin.succeeded")).toMatchObject({
          userId: "user-1",
          method,
          address: "203.0.113.9",
        });
        // The token is read for the tidy and still never handed to the page.
        expect(JSON.stringify(await response.json())).not.toContain("raw-token");
        expect(securityLines.mock.calls.join("\n")).not.toContain("ana@example.com");
      }
    });

    it("is not a sign-in without the challenge cookie", async () => {
      const { limiter, calls } = fakeLimiter();
      const { sessions, asked } = recordingSessions(null);

      await handleAuthRequest(code("/two-factor/verify-totp", { code: "123456" }, ""), {
        handler: fakeHandler(signedInByCode).handler,
        limiter,
        sessions,
        twoFactorCookies,
      });

      expect(calls.map(([what]) => what)).not.toContain("refund");
      expect(asked).toEqual([]);
      expect(events().map((line) => line.event)).not.toContain("auth.signin.succeeded");
    });

    it("is not a sign-in when the answer sets no session cookie", async () => {
      const { limiter, calls } = fakeLimiter();
      const { sessions, asked } = recordingSessions(null);

      await handleAuthRequest(code("/two-factor/verify-totp", { code: "123456" }), {
        handler: fakeHandler(() =>
          Response.json({ token: "raw-token", user: { id: "user-1", email: "ana@example.com" } }),
        ).handler,
        limiter,
        sessions,
        twoFactorCookies,
      });

      expect(calls.map(([what]) => what)).not.toContain("refund");
      expect(asked).toEqual([]);
      expect(events().map((line) => line.event)).not.toContain("auth.signin.succeeded");
    });

    it("is an enrolment when a signed-in session's first code re-creates it", async () => {
      const { sessions, asked } = recordingSessions({ id: "s-1", userId: "user-1" });

      await handleAuthRequest(
        code("/two-factor/verify-totp", { code: "123456" }, `${SESSION}=old.sig`),
        { handler: fakeHandler(signedInByCode).handler, limiter: fakeLimiter().limiter, sessions, twoFactorCookies },
      );

      expect(asked).toEqual([]);
      const written = events();
      expect(written.find((line) => line.event === "auth.twofactor.enabled")).toMatchObject({
        userId: "user-1",
      });
      expect(written.map((line) => line.event)).not.toContain("auth.signin.succeeded");
    });

    it("logs a refused code as failed, a locked account as locked, and an unreadable secret once", async () => {
      const cases = [
        [401, "INVALID_CODE", "auth.twofactor.failed"],
        [401, "INVALID_BACKUP_CODE", "auth.twofactor.failed"],
        [400, "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", "auth.twofactor.failed"],
        [429, "ACCOUNT_TEMPORARILY_LOCKED", "auth.twofactor.locked"],
        [429, "TOO_MANY_WRONG_CODES", "auth.twofactor.locked"],
        [401, "TWO_FACTOR_UNREADABLE", null],
      ] as const;
      for (const [status, refusal, event] of cases) {
        securityLines.mockClear();

        const response = await handleAuthRequest(code("/two-factor/verify-totp", { code: "123456" }), {
          handler: fakeHandler(() => Response.json({ code: refusal }, { status })).handler,
          limiter: fakeLimiter().limiter,
          twoFactorCookies,
        });

        expect(response.status, refusal).toBe(status);
        const twoFactor = events().filter((line) => line.event.startsWith("auth.twofactor."));
        // The guard writes `unreadable` itself, inside Better Auth.
        expect(twoFactor, refusal).toEqual(event ? [expect.objectContaining({ event, code: refusal })] : []);
      }
    });
  });
});

describe("a change to two-step verification", () => {
  const PATHS = [
    "/two-factor/enable",
    "/two-factor/disable",
    "/two-factor/generate-backup-codes",
  ] as const;
  const REAUTH = "rl:reauth";
  const REAUTH_ACCOUNT = "rl:reauth-acct";
  const SESSION = { id: "s-kitchen", userId: "user-kitchen" };

  /** Sessions that present `presented` and are never asked to end anything. */
  function presenting(presented: { id: string; userId: string } | null): SignInSessions {
    return {
      presented: async () => presented,
      tidy: async () => {
        throw new Error("a change to two-step verification tidies nothing");
      },
      end: async () => {
        throw new Error("a change to two-step verification ends nothing");
      },
    };
  }

  const events = () =>
    securityLines.mock.calls.flatMap((call) => {
      try {
        return [JSON.parse(String(call[0])) as Record<string, string>];
      } catch {
        return [];
      }
    });

  const change = (path: string, body: unknown = { password: "cocina despensa" }) =>
    post(path, JSON.stringify(body), { cookie: "stoky.session_token=abc.sig" });

  it("reaches Better Auth with the password and nothing else", async () => {
    for (const path of PATHS) {
      const { handler, seen } = fakeHandler(() => Response.json({ status: true }));

      const response = await handleAuthRequest(
        change(path, { password: "cocina despensa", issuer: "Otro", method: "otp", trustDevice: true }),
        { handler, limiter: fakeLimiter().limiter, sessions: presenting(SESSION) },
      );

      expect(response.status, path).toBe(200);
      expect(seen, path).toHaveLength(1);
      expect(new URL(seen[0].url).pathname, path).toBe(`/api/auth${path}`);
      expect(await seen[0].json(), path).toEqual({ password: "cocina despensa" });
    }
  });

  it("is refused 401 without a session, uncharged and without Better Auth", async () => {
    const { handler, handle } = fakeHandler();
    const { limiter, calls } = fakeLimiter();

    for (const path of PATHS) {
      const response = await handleAuthRequest(change(path), {
        handler,
        limiter,
        sessions: presenting(null),
      });
      expect(response.status, path).toBe(401);
    }
    expect(handle).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("charges the session's and the account's re-entry budgets before Better Auth", async () => {
    const { limiter, calls } = fakeLimiter();
    const { handler } = fakeHandler(() => {
      // Charged by the time the password is looked at.
      expect(calls.map(([what, prefix]) => `${what} ${prefix}`)).toEqual([
        `consume ${REAUTH}`,
        `consume ${REAUTH_ACCOUNT}`,
      ]);
      return Response.json({ code: "INVALID_PASSWORD" }, { status: 400 });
    });

    await handleAuthRequest(change("/two-factor/enable"), {
      handler,
      limiter,
      sessions: presenting(SESSION),
    });

    expect(calls).toEqual([
      ["consume", REAUTH, SESSION.id],
      ["consume", REAUTH_ACCOUNT, SESSION.userId],
    ]);
  });

  it("is refused 429 with Retry-After when either budget is spent", async () => {
    for (const spent of [REAUTH, REAUTH_ACCOUNT]) {
      const { handler, handle } = fakeHandler();
      const { limiter } = fakeLimiter({ [spent]: { allowed: false, retryAfterSeconds: 42.2 } });

      const response = await handleAuthRequest(change("/two-factor/disable"), {
        handler,
        limiter,
        sessions: presenting(SESSION),
      });

      expect(response.status, spent).toBe(429);
      expect(response.headers.get("retry-after"), spent).toBe("43");
      expect(((await response.json()) as { code: string }).code, spent).toBe("REAUTH_RATE_LIMITED");
      expect(handle, spent).not.toHaveBeenCalled();
    }
  });

  it("is refused 503 when the limiter cannot be reached", async () => {
    const { handler, handle } = fakeHandler();
    const { limiter } = fakeLimiter({ [REAUTH]: new RateLimitUnavailableError(new Error("down")) });

    const response = await handleAuthRequest(change("/two-factor/enable"), {
      handler,
      limiter,
      sessions: presenting(SESSION),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(handle).not.toHaveBeenCalled();
  });

  it("answers a body without a password 400, charged and without Better Auth", async () => {
    const { handler, handle } = fakeHandler();
    const { limiter, calls } = fakeLimiter();

    const response = await handleAuthRequest(change("/two-factor/enable", { code: "123456" }), {
      handler,
      limiter,
      sessions: presenting(SESSION),
    });

    expect(response.status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
    expect(calls.map(([what]) => what)).toEqual(["consume", "consume"]);
  });

  it("gives the session's attempt back when the password was right, and only that one", async () => {
    const { limiter, calls } = fakeLimiter();

    await handleAuthRequest(change("/two-factor/generate-backup-codes"), {
      handler: fakeHandler(() => Response.json({ status: true, backupCodes: ["A"] })).handler,
      limiter,
      sessions: presenting(SESSION),
    });

    expect(calls.filter(([what]) => what === "refund")).toEqual([["refund", REAUTH, SESSION.id, 7]]);
  });

  it("logs a wrong password as a refused re-entry, and gives nothing back", async () => {
    for (const refusal of ["INVALID_PASSWORD", "PASSWORD_TOO_LONG"]) {
      securityLines.mockClear();
      const { limiter, calls } = fakeLimiter();

      const response = await handleAuthRequest(change("/two-factor/enable"), {
        handler: fakeHandler(() => Response.json({ code: refusal }, { status: 400 })).handler,
        limiter,
        sessions: presenting(SESSION),
      });

      expect(response.status, refusal).toBe(400);
      expect(calls.map(([what]) => what), refusal).not.toContain("refund");
      expect(events(), refusal).toEqual([
        expect.objectContaining({
          event: "auth.reauth.refused",
          userId: SESSION.userId,
          via: "two-factor",
          address: "203.0.113.9",
        }),
      ]);
    }
  });

  it("logs turning it off and new codes, and leaves turning it on to the first code", async () => {
    const cases = [
      ["/two-factor/disable", "auth.twofactor.disabled"],
      ["/two-factor/generate-backup-codes", "auth.twofactor.codes-regenerated"],
      ["/two-factor/enable", null],
    ] as const;
    for (const [path, event] of cases) {
      securityLines.mockClear();

      await handleAuthRequest(change(path), {
        handler: fakeHandler(() => Response.json({ status: true })).handler,
        limiter: fakeLimiter().limiter,
        sessions: presenting(SESSION),
      });

      expect(events(), path).toEqual(
        event ? [expect.objectContaining({ event, userId: SESSION.userId })] : [],
      );
    }
  });

  it("never logs a refusal that is not about the password as one", async () => {
    await handleAuthRequest(change("/two-factor/enable"), {
      handler: fakeHandler(() => Response.json({ code: "TOTP_ALREADY_ENABLED" }, { status: 400 })).handler,
      limiter: fakeLimiter().limiter,
      sessions: presenting(SESSION),
    });

    expect(events()).toEqual([]);
  });
});

describe("passkeys (D151)", () => {
  const DONT_REMEMBER = "stoky.dont_remember";
  const SESSION = "stoky.session_token";
  const dontRememberCookie = async () => ({ name: DONT_REMEMBER, secure: false });
  const OPTIONS = passkeyOptionsRateLimit().prefix;

  /** A WebAuthn answer, as the browser sends it; its content is Better Auth's to check. */
  const assertion = { id: "cred-1", rawId: "cred-1", type: "public-key", response: { signature: "sig" } };

  /** Better Auth's answer to a passkey that signed somebody in. */
  const signedInByPasskey = () => {
    const response = Response.json({
      session: { id: "s-new", token: "raw-token" },
      user: { id: "user-1", email: "ana@example.com" },
    });
    response.headers.append("set-cookie", `${SESSION}=raw-token.sig; Path=/; HttpOnly; SameSite=Lax`);
    return response;
  };

  const events = () =>
    securityLines.mock.calls.flatMap((call) => {
      try {
        return [JSON.parse(String(call[0])) as Record<string, string>];
      } catch {
        return [];
      }
    });

  function recordingSessions(presented: { id: string; userId: string } | null) {
    const asked: unknown[][] = [];
    const sessions: SignInSessions = {
      presented: async () => presented,
      tidy: async (input) => {
        asked.push(["tidy", input]);
      },
      end: async (previous, account) => {
        asked.push(["end", previous, account]);
      },
    };
    return { sessions, asked };
  }

  describe("the options of a sign-in", () => {
    it("are charged per address against a budget of their own, and take no query", async () => {
      const { handler, seen } = fakeHandler(() => Response.json({ challenge: "c" }));
      const { limiter, calls } = fakeLimiter();

      const response = await handleAuthRequest(
        new Request(`${BASE}/passkey/generate-authenticate-options?context=x`, {
          headers: { "x-forwarded-for": "203.0.113.9", "x-stoky-remember": "1" },
        }),
        { handler, limiter },
      );

      expect(response.status).toBe(200);
      // Not sign-in's own: nothing could give an options call back to it.
      expect(calls).toEqual([["consume", OPTIONS, "203.0.113.9"]]);
      expect(new URL(seen[0].url).search).toBe("");
      expect(seen[0].headers.get("x-stoky-remember")).toBeNull();
    });

    it("are refused 403 to another site, uncharged and without Better Auth", async () => {
      // An <img> on a page a household member visits is sent from the
      // household's own address: charged, thirty of them would keep everyone
      // there from signing in with a passkey for a quarter of an hour.
      for (const site of ["cross-site", "same-site"]) {
        const { handler, handle } = fakeHandler(() => Response.json({ challenge: "c" }));
        const { limiter, calls } = fakeLimiter();

        const response = await handleAuthRequest(
          new Request(`${BASE}/passkey/generate-authenticate-options`, {
            headers: { "x-forwarded-for": "203.0.113.9", "sec-fetch-site": site, "sec-fetch-dest": "image" },
          }),
          { handler, limiter },
        );

        expect(response.status, site).toBe(403);
        expect(calls, site).toEqual([]);
        expect(handle, site).not.toHaveBeenCalled();
      }
    });

    it("are answered to the page's own fetch, and to a client that sends no Fetch Metadata", async () => {
      for (const headers of [{ "sec-fetch-site": "same-origin" }, {}] as Record<string, string>[]) {
        const { handler } = fakeHandler(() => Response.json({ challenge: "c" }));
        const response = await handleAuthRequest(
          new Request(`${BASE}/passkey/generate-authenticate-options`, { headers }),
          { handler, limiter: fakeLimiter().limiter },
        );
        expect(response.status, JSON.stringify(headers)).toBe(200);
      }
    });

    it("are refused 429 with Retry-After when that budget is spent", async () => {
      const { handler, handle } = fakeHandler();
      const { limiter } = fakeLimiter({ [OPTIONS]: { allowed: false, retryAfterSeconds: 30 } });

      const response = await handleAuthRequest(
        new Request(`${BASE}/passkey/generate-authenticate-options`),
        { handler, limiter },
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("30");
      expect(handle).not.toHaveBeenCalled();
    });
  });

  describe("a sign-in", () => {
    const signIn = (body: unknown, headers: Record<string, string> = {}) =>
      post("/passkey/verify-authentication", JSON.stringify(body), headers);

    it("reaches Better Auth with the answer alone, the box said in the route's header", async () => {
      for (const [rememberMe, said] of [
        [true, "1"],
        [false, "0"],
        ["true", "0"],
        [undefined, "0"],
      ] as const) {
        const { handler, seen } = fakeHandler(signedInByPasskey);
        await handleAuthRequest(
          signIn({ response: assertion, rememberMe, createSession: true, callbackURL: "x" }, {
            "x-stoky-remember": "1",
          }),
          { handler, limiter: fakeLimiter().limiter, dontRememberCookie },
        );

        const label = JSON.stringify(rememberMe);
        expect(await seen[0].json(), label).toEqual({ response: assertion });
        expect(seen[0].headers.get("x-stoky-remember"), label).toBe(said);
      }
    });

    it("ticked, takes dont_remember out of the request and out of the browser", async () => {
      const { handler, seen } = fakeHandler(signedInByPasskey);
      const response = await handleAuthRequest(
        signIn({ response: assertion, rememberMe: true }, {
          cookie: `stoky_device=abc; ${DONT_REMEMBER}=true.sig`,
        }),
        { handler, limiter: fakeLimiter().limiter, dontRememberCookie },
      );

      expect(seen[0].headers.get("cookie")).toBe("stoky_device=abc");
      expect(response.headers.getSetCookie()).toContain(
        `${DONT_REMEMBER}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
      );
    });

    it("is charged against sign-in's address budget, and refused 429 before Better Auth", async () => {
      const { handler, handle } = fakeHandler(signedInByPasskey);
      const { limiter, calls } = fakeLimiter({ [ADDRESS]: { allowed: false, retryAfterSeconds: 9 } });

      const response = await handleAuthRequest(signIn({ response: assertion }), { handler, limiter });

      expect(calls.filter(([what]) => what === "consume")).toEqual([
        ["consume", ADDRESS, "203.0.113.9"],
      ]);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("9");
      expect(handle).not.toHaveBeenCalled();
    });

    it("answers a body without an answer 400, charged, logged and without Better Auth", async () => {
      const { handler, handle } = fakeHandler(signedInByPasskey);
      const { limiter, calls } = fakeLimiter();

      for (const body of ["{not json", JSON.stringify({}), JSON.stringify({ response: "x" }), JSON.stringify({ response: [] })]) {
        const response = await handleAuthRequest(post("/passkey/verify-authentication", body), {
          handler,
          limiter,
        });
        expect(response.status, body).toBe(400);
      }

      expect(handle).not.toHaveBeenCalled();
      expect(calls.filter(([what]) => what === "consume")).toHaveLength(4);
      expect(events().filter((line) => line.event === "auth.passkey.signin-failed")).toHaveLength(4);
    });

    it("is a sign-in when Better Auth issues a session: refunded, remembered, tidied, logged", async () => {
      const deviceId = mintDeviceId();
      const { limiter, calls } = fakeLimiter();
      const { sessions, asked } = recordingSessions({ id: "s-old", userId: "user-9" });

      const response = await handleAuthRequest(
        signIn({ response: assertion }, { cookie: `${DEVICE_ID_COOKIE}=${deviceId}; ${SESSION}=old` }),
        { handler: fakeHandler(signedInByPasskey).handler, limiter, sessions },
      );

      expect(response.status).toBe(200);
      expect(calls.filter(([what]) => what === "refund")).toEqual([
        ["refund", ADDRESS, "203.0.113.9", 7],
      ]);
      expect(calls.filter(([what]) => what === "rememberDevice")).toEqual([
        ["rememberDevice", expect.any(String), deviceId],
      ]);
      // The presented session ends, as at a password sign-in, and the new one never.
      expect(asked).toEqual([
        ["tidy", { previous: { id: "s-old", userId: "user-9" }, userId: "user-1", newToken: "raw-token" }],
      ]);
      expect(events().find((line) => line.event === "auth.signin.succeeded")).toMatchObject({
        userId: "user-1",
        method: "passkey",
        address: "203.0.113.9",
      });
      expect(JSON.stringify(await response.json())).not.toContain("raw-token");
      expect(securityLines.mock.calls.join("\n")).not.toContain("ana@example.com");
    });

    it("is logged as failed with Better Auth's code, refunds nothing and ends nothing", async () => {
      const { limiter, calls } = fakeLimiter();
      const { sessions, asked } = recordingSessions({ id: "s-old", userId: "user-9" });

      const response = await handleAuthRequest(signIn({ response: assertion }), {
        handler: fakeHandler(() =>
          Response.json({ code: "USER_VERIFICATION_REQUIRED" }, { status: 401 }),
        ).handler,
        limiter,
        sessions,
      });

      expect(response.status).toBe(401);
      expect(calls.map(([what]) => what)).toEqual(["consume"]);
      expect(asked).toEqual([]);
      expect(events().find((line) => line.event === "auth.passkey.signin-failed")).toMatchObject({
        code: "USER_VERIFICATION_REQUIRED",
        address: "203.0.113.9",
      });
      expect(events().map((line) => line.event)).not.toContain("auth.signin.succeeded");
    });
  });

  describe("a change to one's passkeys", () => {
    it("reaches Better Auth with each endpoint's own keys, never createSession", async () => {
      for (const [path, body, expected] of [
        [
          "/passkey/verify-registration",
          { response: { id: "c" }, name: "Móvil", createSession: true, context: "x" },
          { response: { id: "c" }, name: "Móvil" },
        ],
        ["/passkey/delete-passkey", { id: "pk-1", userId: "someone" }, { id: "pk-1" }],
        ["/passkey/update-passkey", { id: "pk-1", name: "Portátil", extra: 1 }, { id: "pk-1", name: "Portátil" }],
      ] as const) {
        const { handler, seen } = fakeHandler(() => Response.json({ status: true }));
        await handleAuthRequest(post(path, JSON.stringify(body)), { handler });
        expect(await seen[0].json(), path).toEqual(expected);
      }
    });

    it("answers a body that is not an object 400 without Better Auth", async () => {
      const { handler, handle } = fakeHandler();
      const response = await handleAuthRequest(post("/passkey/delete-passkey", "[1]"), { handler });
      expect(response.status).toBe(400);
      expect(handle).not.toHaveBeenCalled();
    });

    it("refuses a name too long, empty, not text or carrying control characters, 400 without Better Auth", async () => {
      // Better Auth only trims a name, and the column has no bound: without
      // this a session could store 64 KiB, or a right-to-left override, as a
      // row title.
      for (const path of ["/passkey/verify-registration", "/passkey/update-passkey"]) {
        for (const name of ["x".repeat(65), "   ", 7, "‮evil", "a\u0000b"]) {
          const { handler, handle } = fakeHandler(() => Response.json({ status: true }));
          const response = await handleAuthRequest(
            post(path, JSON.stringify({ id: "pk-1", response: { id: "c" }, name })),
            { handler },
          );
          const label = `${path} ${JSON.stringify(name).slice(0, 20)}`;
          expect(response.status, label).toBe(400);
          expect(handle, label).not.toHaveBeenCalled();
        }
      }
    });

    it("forwards a name of exactly the limit, trimmed, and a registration with none", async () => {
      const longest = "ñ".repeat(64);
      for (const [path, body, expected] of [
        ["/passkey/update-passkey", { id: "pk-1", name: `  ${longest} ` }, { id: "pk-1", name: longest }],
        ["/passkey/verify-registration", { response: { id: "c" } }, { response: { id: "c" } }],
      ] as const) {
        const { handler, seen } = fakeHandler(() => Response.json({ status: true }));
        const response = await handleAuthRequest(post(path, JSON.stringify(body)), { handler });
        expect(response.status, path).toBe(200);
        expect(await seen[0].json(), path).toEqual(expected);
      }
    });

    it("logs an added and a removed passkey with whose it was, and a refusal not at all", async () => {
      const { sessions } = recordingSessions({ id: "s-1", userId: "user-1" });
      for (const path of ["/passkey/verify-registration", "/passkey/delete-passkey"]) {
        await handleAuthRequest(post(path, JSON.stringify({ id: "pk-1", response: {} })), {
          handler: fakeHandler(() => Response.json({ status: true })).handler,
          sessions,
        });
        await handleAuthRequest(post(path, JSON.stringify({ id: "pk-1", response: {} })), {
          handler: fakeHandler(() =>
            Response.json({ code: "STEP_UP_REQUIRED" }, { status: 403 }),
          ).handler,
          sessions,
        });
      }

      expect(
        events()
          .filter((line) => line.event.startsWith("auth.passkey."))
          .map(({ event, userId }) => [event, userId]),
      ).toEqual([
        ["auth.passkey.added", "user-1"],
        ["auth.passkey.removed", "user-1"],
      ]);
    });

    it("forwards the registration options with the kind of authenticator and nothing else", async () => {
      const { handler, seen } = fakeHandler();
      await handleAuthRequest(
        new Request(
          `${BASE}/passkey/generate-register-options?authenticatorAttachment=platform&name=evil&context=x`,
        ),
        { handler },
      );
      expect(new URL(seen[0].url).search).toBe("?authenticatorAttachment=platform");
    });
  });
});
