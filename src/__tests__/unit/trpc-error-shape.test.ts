import { describe, it, expect, spyOn, afterEach } from "bun:test";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Prisma } from "@prisma/client";
import {
  INTERNAL_ERROR_MESSAGE,
  createTRPCContext,
  createTRPCRouter,
  publicProcedure,
} from "@/server/trpc/trpc";

/**
 * What a browser receives when a procedure fails — over HTTP, through the
 * same handler `src/app/api/trpc/[trpc]/route.ts` uses.
 *
 * `createCaller` cannot answer this: it throws the server-side error object,
 * message and all, and never builds the response shape. The leak was in the
 * shape, so the shape is what this reads.
 */

/** What a raw Prisma failure actually carries: the SQL and where it ran. */
const LEAKY = 'Invalid `prisma.$queryRaw()` invocation in /app/src/server/trpc/routers/product.ts:385 — SELECT * FROM "User" WHERE email = $1';

const router = createTRPCRouter({
  unexpected: publicProcedure.query(() => {
    throw new Error(LEAKY);
  }),
  refused: publicProcedure.query(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
  }),
  translated: publicProcedure.query(() => {
    // Translated by `domainErrors`, whose message the client is meant to see.
    throw new Prisma.PrismaClientKnownRequestError(LEAKY, {
      code: "P2025",
      clientVersion: "test",
    });
  }),
});

async function errorFrom(path: string): Promise<{ message: string; code: string }> {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}`),
    router,
    createContext: () => createTRPCContext({ session: null }),
  });
  const body = (await response.json()) as {
    error: { json: { message: string; data: { code: string } } };
  };
  return { message: body.error.json.message, code: body.error.json.data.code };
}

let consoleError: ReturnType<typeof spyOn> | null = null;

afterEach(() => {
  consoleError?.mockRestore();
  consoleError = null;
});

describe("the error a client receives", () => {
  it("does not carry an unexpected failure's own message", async () => {
    consoleError = spyOn(console, "error").mockImplementation(() => {});

    const error = await errorFrom("unexpected");

    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(error.message).not.toContain("SELECT");
    expect(error.message).not.toContain("/app/src");
  });

  it("writes the original to the server log instead", async () => {
    consoleError = spyOn(console, "error").mockImplementation(() => {});

    await errorFrom("unexpected");

    const logged = consoleError.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("unexpected");
    expect(logged).toContain("SELECT");
  });

  it("leaves a refusal a resolver worded for the client alone", async () => {
    // The screens map these messages to their own keys — "product not found"
    // picks errorNotFound — so rewriting them would break every one.
    expect(await errorFrom("refused")).toEqual({
      code: "NOT_FOUND",
      message: "Product not found",
    });
  });

  it("leaves a translated domain error alone", async () => {
    expect(await errorFrom("translated")).toEqual({
      code: "NOT_FOUND",
      message: "That no longer exists",
    });
  });
});
