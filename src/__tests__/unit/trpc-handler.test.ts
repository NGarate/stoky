import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { z } from "zod";
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

const SIGNED_IN: Session = {
  user: { id: "user-1", role: "MEMBER" },
  expires: "2099-01-01T00:00:00.000Z",
};

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
  forwardedFor: publicProcedure.query(({ ctx }) => ctx.headers?.get("x-forwarded-for") ?? null),
  // Public, like `auth.register`: what an address with no account can reach.
  echo: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(({ input }) => input.name),
});

function handlerFor(session: Session | null, onSession?: () => void) {
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
  const body = (await response.json()) as { result: { data: { json: unknown } } };
  return body.result.data.json;
}

let consoleWarn: ReturnType<typeof spyOn>;

beforeEach(() => {
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
    const response = await handlerFor(null)(get("forwardedFor", { "x-forwarded-for": "203.0.113.7" }));

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
          controller.enqueue(size === chunk.byteLength ? chunk : chunk.subarray(0, size));
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
    const response = await handlerFor(null, () => sessionLookups++)(
      post("echo", "{}", { "content-length": String(MAX_TRPC_BODY_BYTES + 1) }),
    );

    expect(response.status).toBe(413);
    expect(sessionLookups).toBe(0);
  });

  it("is refused at one byte over the limit when it declares no length", async () => {
    // What a prefetch-labelled, chunked POST looks like once the proxy's cap
    // is out of the way: nothing to check but the bytes themselves.
    const response = await handlerFor(null)(post("echo", chunked(MAX_TRPC_BODY_BYTES + 1)));

    expect(response.status).toBe(413);
  });

  it("at the limit reaches tRPC, which judges it as it always did", async () => {
    // Not 413: a body of exactly the limit is allowed through, and what
    // refuses this one is the JSON parser, as it would without the bound.
    const response = await handlerFor(null)(post("echo", chunked(MAX_TRPC_BODY_BYTES)));

    expect(response.status).toBe(400);
  });

  it("reaches the procedure intact when it is an ordinary one", async () => {
    const response = await handlerFor(null)(post("echo", JSON.stringify({ json: { name: "Leche" } })));

    expect(response.status).toBe(200);
    expect(await resultOf(response)).toBe("Leche");
  });
});
