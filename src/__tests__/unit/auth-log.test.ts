import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Prisma } from "@prisma/client";
import { APIError } from "better-auth/api";
import { logEndpointError } from "@/lib/auth/instance";

/**
 * What Better Auth's router writes when an endpoint throws — `onAPIError`'s
 * `onError`, which is `logEndpointError`.
 *
 * The Prisma adapter rethrows the client's errors as they are, and a
 * validation error's message is the whole call, argument values included
 * (`unit/log-error.test.ts`). This line must say which call failed without
 * them. The message below has the shape Prisma 6.19.3 gives a failing
 * `session.create`, the token among its arguments.
 */

let errors: ReturnType<typeof spyOn<Console, "error">>;

beforeEach(() => {
  errors = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
});

function logged(): string {
  return errors.mock.calls.flat().map(String).join("\n");
}

describe("logEndpointError", () => {
  it("does not write the arguments of a Prisma call to the log", () => {
    logEndpointError(
      new Prisma.PrismaClientValidationError(
        [
          "",
          "Invalid `prisma.session.create()` invocation:",
          "",
          "{",
          "  data: {",
          '    token: "MARKERTOKEN",',
          '    userId: "maria.garcia@example.com",',
          '    expiresAt: "not a date"',
          "               ~~~~~~~~~~~~",
          "  }",
          "}",
          "",
          "Invalid value for argument `expiresAt`: premature end of input. Expected ISO-8601 DateTime.",
        ].join("\n"),
        { clientVersion: "6.19.3" },
      ),
    );

    const line = logged();
    expect(line).not.toContain("MARKERTOKEN");
    expect(line).not.toContain("maria.garcia@example.com");
    // What is left still says which call failed, and why.
    expect(line).toContain("[auth] error PrismaClientValidationError (Prisma 6.19.3)");
    expect(line).toContain("Invalid `prisma.session.create()` invocation");
    expect(line).toContain("Invalid value for argument `expiresAt`");
    expect(errors).toHaveBeenCalledTimes(1);
    expect(line).not.toContain("\n");
  });

  it("writes anything else's name and message, on one bounded line", () => {
    logEndpointError(new Error(`the cache\nanswered ${"x".repeat(400)}`));

    const line = logged();
    expect(line.startsWith("[auth] error Error: the cache answered xxx")).toBe(true);
    expect(line.length).toBeLessThanOrEqual("[auth] error ".length + 300);
  });

  it("writes nothing for a refusal", () => {
    logEndpointError(new APIError("UNAUTHORIZED", { message: "Invalid password" }));

    expect(errors).not.toHaveBeenCalled();
  });
});
