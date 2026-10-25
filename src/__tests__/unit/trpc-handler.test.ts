import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AppSession } from "@/lib/auth/session";
import { z } from "zod";
import { MAX_TRPC_BATCH_SIZE } from "@/lib/trpc/batch";
import { MAX_TRPC_BODY_BYTES } from "@/server/http/body-limit";
import { createTrpcHandler } from "@/server/http/trpc-handler";
import { ThrottledError } from "@/server/trpc/throttle";
import {
  createTRPCContext,
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";

/**
 * The tRPC endpoint as a browser meets it: a `Request` in, a `Response` out,
 * through the same function `src/app/api/trpc/[trpc]/route.ts` exports.
 *
 * The router is a stand-in and the session a stub, so nothing here needs Next,
 * Postgres or Valkey. What is real is everything between the request and the
 * procedure — the handler, the context the application builds, and the
 * application's own middleware stack.
 */

const SIGNED_IN: AppSession = {
  user: { id: "user-1", email: "u@example.com", name: "U", role: "MEMBER" },
  expires: "2099-01-01T00:00:00.000Z",
  expiresKind: "idle",
  sessionId: "session-under-test",
};

/** How many times `touch` has run in the current test. */
let touches = 0;

const router = createTRPCRouter({
  throttled: publicProcedure.query(() => {
    // The shape `enforceRateLimit` throws.
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many uploads",
      cause: new ThrottledError(42),
    });
  }),
  missing: publicProcedure.query(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
  }),
  whoami: protectedProcedure.query(({ ctx }) => ctx.session.user.id),
  forwardedFor: publicProcedure.query(
    ({ ctx }) => ctx.headers?.get("x-forwarded-for") ?? null,
  ),
  // Public, like `auth.register`: what an address with no account can reach.
  echo: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(({ input }) => input.name),
  // No input, as the mutation that ended every session had before it
  // declared `z.void()`: nothing for a form's body to fail, so only the
  // handler can refuse it.
  touch: publicProcedure.mutation(() => {
    touches++;
    return "touched";
  }),
});

function handlerFor(session: AppSession | null, onSession?: () => void) {
  return createTrpcHandler({
    router,
    getSession: async () => {
      onSession?.();
      return session;
    },
    createContext: createTRPCContext,
  });
}

function get(path: string, headers?: HeadersInit): Request {
  return new Request(`http://localhost/api/trpc/${path}`, { headers });
}

async function resultOf(response: Response): Promise<unknown> {
  const body = (await response.json()) as {
    result: { data: { json: unknown } };
  };
  return body.result.data.json;
}

let consoleWarn: ReturnType<typeof spyOn>;

beforeEach(() => {
  touches = 0;
  // The security-event log line for every 401 and 429 below.
  consoleWarn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleWarn.mockRestore();
});

describe("a throttled call", () => {
  it("answers 429 and says when to come back", async () => {
    const response = await handlerFor(SIGNED_IN)(get("throttled"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
  });

  it("is the only refusal that carries Retry-After", async () => {
    // A header on every error would tell a caller to retry a request that
    // will never succeed.
    const response = await handlerFor(SIGNED_IN)(get("missing"));

    expect(response.status).toBe(404);
    expect(response.headers.get("retry-after")).toBeNull();
  });
});

describe("the session", () => {
  it("refuses a protected procedure with 401 when there is none", async () => {
    const response = await handlerFor(null)(get("whoami"));

    expect(response.status).toBe(401);
  });

  it("reaches the procedure when there is one", async () => {
    const response = await handlerFor(SIGNED_IN)(get("whoami"));

    expect(response.status).toBe(200);
    expect(await resultOf(response)).toBe("user-1");
  });
});

describe("the request headers", () => {
  it("reach the context, where the rate limiter reads the address", async () => {
    const response = await handlerFor(null)(
      get("forwardedFor", { "x-forwarded-for": "203.0.113.7" }),
    );

    expect(await resultOf(response)).toBe("203.0.113.7");
  });
});

describe("the request body", () => {
  /** A body of `total` bytes in 1 MiB chunks, with no declared length. */
  function chunked(total: number): ReadableStream<Uint8Array> {
    const chunk = new Uint8Array(1024 * 1024).fill(0x41);
    let sent = 0;
    return new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (sent >= total) {
            controller.close();
            return;
          }
          const size = Math.min(chunk.byteLength, total - sent);
          controller.enqueue(
            size === chunk.byteLength ? chunk : chunk.subarray(0, size),
          );
          sent += size;
        },
      },
      { highWaterMark: 0 },
    );
  }

  function post(path: string, body: BodyInit, headers?: HeadersInit): Request {
    return new Request(`http://localhost/api/trpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  }

  it("over the declared limit is refused with 413 before the session is looked up", async () => {
    // The order is the point: an unauthenticated caller must not be able to
    // make the server do anything on the strength of a body it will refuse.
    let sessionLookups = 0;
    const response = await handlerFor(
      null,
      () => sessionLookups++,
    )(
      post("echo", "{}", { "content-length": String(MAX_TRPC_BODY_BYTES + 1) }),
    );

    expect(response.status).toBe(413);
    expect(sessionLookups).toBe(0);
  });

  it("is refused at one byte over the limit when it declares no length", async () => {
    // What a prefetch-labelled, chunked POST looks like once the proxy's cap
    // is out of the way: nothing to check but the bytes themselves.
    const response = await handlerFor(null)(
      post("echo", chunked(MAX_TRPC_BODY_BYTES + 1)),
    );

    expect(response.status).toBe(413);
  });

  it("at the limit reaches tRPC, which judges it as it always did", async () => {
    // Not 413: a body of exactly the limit is allowed through, and what
    // refuses this one is the JSON parser, as it would without the bound.
    const response = await handlerFor(null)(
      post("echo", chunked(MAX_TRPC_BODY_BYTES)),
    );

    expect(response.status).toBe(400);
  });

  it("reaches the procedure intact when it is an ordinary one", async () => {
    const response = await handlerFor(null)(
      post("echo", JSON.stringify({ json: { name: "Leche" } })),
    );

    expect(response.status).toBe(200);
    expect(await resultOf(response)).toBe("Leche");
  });
});

describe("a batch", () => {
  /** `count` calls to `path` in one batched GET, the way the link sends them. */
  function batchOf(path: string, count: number): Request {
    const paths = Array.from({ length: count }, () => path).join(",");
    return new Request(`http://localhost/api/trpc/${paths}?batch=1`);
  }

  it("one call longer than the limit is refused whole, before any procedure runs", async () => {
    // The shape of the amplification: anonymous, every call a protected one,
    // so each would otherwise be refused separately and logged separately.
    const response = await handlerFor(null)(
      batchOf("whoami", MAX_TRPC_BATCH_SIZE + 1),
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(
      "Batch call exceeds maximum size",
    );
    // No procedure ran, so no call was refused and none was logged.
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("is refused the same way as a POST, without its inputs being read", async () => {
    // Mutations batch too, and a mutation is where a per-call cost can be a
    // password hash. The body is not JSON: it is never parsed.
    const paths = Array.from(
      { length: MAX_TRPC_BATCH_SIZE + 1 },
      () => "echo",
    ).join(",");
    const response = await handlerFor(null)(
      new Request(`http://localhost/api/trpc/${paths}?batch=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(
      "Batch call exceeds maximum size",
    );
  });

  it("at the limit runs every call", async () => {
    const response = await handlerFor(SIGNED_IN)(
      batchOf("whoami", MAX_TRPC_BATCH_SIZE),
    );

    expect(response.status).toBe(200);
    const results = (await response.json()) as {
      result: { data: { json: unknown } };
    }[];
    expect(results).toHaveLength(MAX_TRPC_BATCH_SIZE);
    expect(results.every((r) => r.result.data.json === "user-1")).toBe(true);
  });

  it("writes one refusal line for an anonymous caller, however many calls it held", async () => {
    // 1.8 KB of URL used to write a hundred access.denied lines; a few thousand
    // such requests rotated the bundle's 50 MB of app log, sign-in failures
    // and all. One line still says it happened, from where, and for what.
    const response = await handlerFor(null)(
      batchOf("whoami", MAX_TRPC_BATCH_SIZE),
    );

    expect(response.status).toBe(401);
    const lines = consoleWarn.mock.calls.map((call: unknown[]) =>
      JSON.parse(String(call[0])),
    );
    expect(lines).toEqual([
      expect.objectContaining({
        event: "access.denied",
        code: "UNAUTHORIZED",
        path: "whoami",
      }),
    ]);
  });

  it("bounds the line per request, not for ever", async () => {
    // A second request is a second event and keeps its line.
    await handlerFor(null)(batchOf("whoami", 3));
    await handlerFor(null)(batchOf("whoami", 3));

    expect(consoleWarn).toHaveBeenCalledTimes(2);
  });

  it("still writes every refusal of a signed-in caller", async () => {
    // Throttled calls under an account name it, and each can be a different
    // thing it reached for; they are not collapsed.
    await handlerFor(SIGNED_IN)(batchOf("throttled", 3));

    expect(consoleWarn).toHaveBeenCalledTimes(3);
  });

  it("is split by the browser client at the same number", () => {
    // Without `maxItems` the link batches every call in a tick into one
    // request, and a screen that mounted more than the limit would lose all of
    // them to the 400 above. Read from source: the link's options are not
    // observable from outside a rendered provider.
    // The links live in their own module since the password change needed a
    // second one (`src/lib/trpc/links.ts`, D144).
    const client = readFileSync(
      join(import.meta.dir, "../../lib/trpc/links.ts"),
      "utf8",
    );

    expect(client).toContain('from "@/lib/trpc/batch"');
    expect(client).toMatch(
      /httpBatchStreamLink\(\{[^]*?maxItems: MAX_TRPC_BATCH_SIZE,[^]*?\}\)/,
    );
  });
});

describe("who sent the request, and in what form", () => {
  /** A POST to the input-less `touch`, as a page would send it. */
  function touch(
    headers: Record<string, string>,
    body: BodyInit = "{}",
  ): Request {
    return new Request("http://localhost/api/trpc/touch", {
      method: "POST",
      headers,
      body,
    });
  }

  /** What an HTML form on a sibling subdomain sends. */
  function formPost(headers: Record<string, string> = {}): Request {
    const form = new FormData();
    form.set("anything", "1");
    // The Request sets the multipart content type and boundary from the body.
    return new Request("http://localhost/api/trpc/touch", {
      method: "POST",
      headers,
      body: form,
    });
  }

  /** The security-log lines written so far, parsed. */
  function loggedEvents(): Record<string, string>[] {
    return consoleWarn.mock.calls.map((call: unknown[]) =>
      JSON.parse(String(call[0])),
    );
  }

  it("is the case: tRPC on its own runs a mutation that arrives as a form", async () => {
    // The control. Without it, the refusal below is equally explained by a
    // form never having reached a procedure in the first place.
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: formPost(),
      router,
      createContext: () =>
        createTRPCContext({ session: null, headers: new Headers() }),
    });

    expect(response.status).toBe(200);
    expect(touches).toBe(1);
  });

  it("refuses a form with 415, and nothing runs or is looked up", async () => {
    let sessionLookups = 0;
    const response = await handlerFor(
      SIGNED_IN,
      () => sessionLookups++,
    )(formPost());

    expect(response.status).toBe(415);
    expect(touches).toBe(0);
    expect(sessionLookups).toBe(0);
  });

  it("refuses the other type tRPC would accept, a raw byte stream", async () => {
    // Not text/plain: tRPC refuses that with 415 by itself, so a test of it
    // would pass with this guard deleted.
    const response = await handlerFor(SIGNED_IN)(
      touch({ "content-type": "application/octet-stream" }),
    );

    expect(response.status).toBe(415);
    expect(touches).toBe(0);
  });

  it("accepts JSON with a charset, which is still JSON", async () => {
    const response = await handlerFor(SIGNED_IN)(
      touch({ "content-type": "application/json; charset=utf-8" }),
    );

    expect(response.status).toBe(200);
    expect(touches).toBe(1);
  });

  for (const site of ["same-site", "cross-site"]) {
    it(`refuses JSON a browser says came from a ${site} page with 403, and logs it`, async () => {
      // same-site is the case SameSite=Lax lets through with the cookie: a
      // sibling subdomain under the operator's own domain.
      let sessionLookups = 0;
      const response = await handlerFor(
        SIGNED_IN,
        () => sessionLookups++,
      )(touch({ "content-type": "application/json", "sec-fetch-site": site }));

      expect(response.status).toBe(403);
      expect(touches).toBe(0);
      expect(sessionLookups).toBe(0);
      expect(loggedEvents()).toEqual([
        expect.objectContaining({
          event: "access.denied",
          reason: "cross-site",
          code: "FORBIDDEN",
          fetchSite: site,
          path: "touch",
        }),
      ]);
    });
  }

  it("refuses a cross-site query too, not only a mutation", async () => {
    const response = await handlerFor(SIGNED_IN)(
      get("whoami", { "sec-fetch-site": "cross-site" }),
    );

    expect(response.status).toBe(403);
  });

  for (const [label, headers] of [
    ["same-origin", { "sec-fetch-site": "same-origin" }],
    ["none, a request the person started", { "sec-fetch-site": "none" }],
    ["absent, as from curl or a native client", {}],
  ] as const) {
    it(`runs the procedure when Sec-Fetch-Site is ${label}`, async () => {
      const response = await handlerFor(SIGNED_IN)(
        touch({ "content-type": "application/json", ...headers }),
      );

      expect(response.status).toBe(200);
      expect(await resultOf(response)).toBe("touched");
      expect(touches).toBe(1);
      expect(consoleWarn).not.toHaveBeenCalled();
    });
  }

  it("runs a native client's bearer call, which carries no Fetch Metadata and no cookie", async () => {
    // What the iOS app sends (D142): the session in Authorization, nothing a
    // browser adds. The session itself is the stub's; what is pinned here is
    // that nothing in front of the procedure turns the request away.
    let sessionLookups = 0;
    const response = await handlerFor(
      SIGNED_IN,
      () => sessionLookups++,
    )(
      touch({
        "content-type": "application/json",
        authorization: "Bearer token.signature",
      }),
    );

    expect(response.status).toBe(200);
    expect(touches).toBe(1);
    expect(sessionLookups).toBe(1);
  });

  it("refuses a cross-site request that carries the session cookie with 403", async () => {
    // The case the bearer path must not open: a browser's cookie, sent by a
    // page on another site.
    let sessionLookups = 0;
    const response = await handlerFor(
      SIGNED_IN,
      () => sessionLookups++,
    )(
      touch({
        "content-type": "application/json",
        cookie: "stoky.session_token=token.signature",
        "sec-fetch-site": "cross-site",
      }),
    );

    expect(response.status).toBe(403);
    expect(touches).toBe(0);
    expect(sessionLookups).toBe(0);
  });
});

describe("every response", () => {
  /**
   * One of each kind of answer the endpoint gives, from tRPC and from the
   * guards in front of it. A shared cache that stored any of them would hand
   * it to whoever asked for the same URL next: a household's data, or a
   * refusal meant for somebody else.
   */
  const answers: [
    label: string,
    send: () => Promise<Response>,
    status: number,
  ][] = [
    ["a query's data", () => handlerFor(SIGNED_IN)(get("whoami")), 200],
    [
      // What the browser's link asks for: the response is a stream, and its
      // headers are fixed before the first line of it is written.
      "a streamed batch",
      () =>
        handlerFor(SIGNED_IN)(
          get("whoami,whoami?batch=1", { "trpc-accept": "application/jsonl" }),
        ),
      200,
    ],
    [
      "a mutation's result",
      () =>
        handlerFor(SIGNED_IN)(
          new Request("http://localhost/api/trpc/touch", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
        ),
      200,
    ],
    [
      "an error from a procedure",
      () => handlerFor(SIGNED_IN)(get("missing")),
      404,
    ],
    [
      "a refusal for want of a session",
      () => handlerFor(null)(get("whoami")),
      401,
    ],
    ["a throttled call", () => handlerFor(SIGNED_IN)(get("throttled")), 429],
    [
      "a batch over the limit",
      () =>
        handlerFor(null)(
          get(
            `${Array.from({ length: MAX_TRPC_BATCH_SIZE + 1 }, () => "whoami").join(",")}?batch=1`,
          ),
        ),
      400,
    ],
    [
      "a cross-site refusal",
      () =>
        handlerFor(SIGNED_IN)(
          get("whoami", { "sec-fetch-site": "cross-site" }),
        ),
      403,
    ],
    [
      "a refusal of a body that is not JSON",
      () =>
        handlerFor(SIGNED_IN)(
          new Request("http://localhost/api/trpc/touch", {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: "{}",
          }),
        ),
      415,
    ],
    [
      "a refusal of a body over the limit",
      () =>
        handlerFor(null)(
          new Request("http://localhost/api/trpc/echo", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": String(MAX_TRPC_BODY_BYTES + 1),
            },
            body: "{}",
          }),
        ),
      413,
    ],
  ];

  for (const [label, send, status] of answers) {
    it(`is marked no-store: ${label}`, async () => {
      const response = await send();

      // The status first, so a case that stopped being the answer it names
      // cannot pass on the header alone.
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  }

  it("keeps Retry-After beside it on a throttled call", async () => {
    // The header is set on the response tRPC built, not on a new one, so
    // nothing responseMeta put there is lost.
    const response = await handlerFor(SIGNED_IN)(get("throttled"));

    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
