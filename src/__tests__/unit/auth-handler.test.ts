import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { DEVICE_ID_COOKIE, mintDeviceId } from "@/lib/device";
import {
  RateLimitUnavailableError,
  loginRateLimit,
  type RateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit";
import type { SignInLimiter } from "@/lib/auth/sign-in-policy";
import { MAX_AUTH_BODY_BYTES } from "@/server/http/body-limit";
import {
  ALLOWED_AUTH_ENDPOINTS,
  handleAuthRequest,
  type AuthEndpointHandler,
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
  it("is the five this application uses", () => {
    expect([...ALLOWED_AUTH_ENDPOINTS].sort()).toEqual([
      "GET /error",
      "GET /get-session",
      "GET /ok",
      "POST /sign-in/email",
      "POST /sign-out",
    ]);
  });

  it("answers anything else 404 without reaching Better Auth", async () => {
    const { handler, handle } = fakeHandler();
    const { limiter } = fakeLimiter();

    for (const request of [
      post("/sign-up/email", "{}"),
      post("/change-password", "{}"),
      post("/revoke-sessions", "{}"),
      new Request(`${BASE}/list-sessions`),
      // The same endpoints by another method or spelling.
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
      rememberMe: false,
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
