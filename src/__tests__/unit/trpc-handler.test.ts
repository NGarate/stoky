import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
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
});

function handlerFor(session: Session | null) {
  return createTrpcHandler({
    router,
    getSession: async () => session,
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
