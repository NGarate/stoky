import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { AuthError, CredentialsSignin } from "next-auth";
import {
  AuthUnavailableSignin,
  RateLimitedSignin,
  authConfig,
} from "@/lib/auth";

/**
 * What Auth.js writes to the log when a request to it ends in an error.
 *
 * Through `authConfig.logger.error` rather than the function it names, so that
 * unhooking the logger from the configuration fails here too: the built-in one
 * is the multi-line output this exists to replace.
 */

/**
 * `@auth/core`'s own `MissingCSRF` (errors.js: an `AuthError` whose static
 * `type` is "MissingCSRF"), declared here because `next-auth` does not export
 * it and `@auth/core` is not a dependency of this project in its own right.
 */
class MissingCSRF extends AuthError {
  static type = "MissingCSRF";
}

let errorSpy: ReturnType<typeof spyOn<Console, "error">>;

beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

const logError = (error: Error) => authConfig.logger!.error!(error);

/** Everything written, one entry per physical line. */
const writtenLines = () =>
  errorSpy.mock.calls
    .map((args) => args.map(String).join(" "))
    .join("\n")
    .split("\n");

/** A V8/JSC stack frame: "    at fn (file:line:col)". */
const STACK_FRAME = /^\s+at /;

describe("Auth.js error logging", () => {
  it.each([
    ["a failed sign-in", () => new CredentialsSignin(), "CredentialsSignin"],
    ["a rate-limited sign-in", () => new RateLimitedSignin(), "CredentialsSignin"],
    [
      "a sign-in refused with Valkey down",
      () => new AuthUnavailableSignin(),
      "CredentialsSignin",
    ],
    ["a POST without its CSRF token", () => new MissingCSRF(), "MissingCSRF"],
  ])("writes %s as one line with no stack", (_, make, type) => {
    const error = make();
    // The precondition the assertion depends on: there is a stack to leave out.
    expect(error.stack).toMatch(/\n\s+at /);

    logError(error);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const lines = writtenLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`[auth][error]`);
    expect(lines[0]).toContain(`${type}: ${error.message}`);
  });

  it("keeps the stack of any other error", () => {
    const error = new Error("database unreachable");

    logError(error);

    const lines = writtenLines();
    expect(lines[0]).toContain("[auth][error]");
    expect(lines[0]).toContain("Error: database unreachable");
    expect(lines.some((line) => STACK_FRAME.test(line))).toBe(true);
  });

  it("keeps the cause and its stack for an Auth.js error that wraps one", () => {
    // The shape of a `CallbackRouteError`: `authorize` threw something that
    // was not an `AuthError`, and Auth.js wrapped it, the original as
    // `cause.err` beside the details (`@auth/core` errors.js, `AuthError`).
    const thrown = new Error("connection refused");
    const error = new AuthError("callback failed", {
      cause: { err: thrown, provider: "credentials" },
    });

    logError(error);

    const output = writtenLines().join("\n");
    expect(output).toContain("[auth][cause]");
    expect(output).toContain("connection refused");
    expect(output).toContain('"provider": "credentials"');
    expect(writtenLines().some((line) => STACK_FRAME.test(line))).toBe(true);
  });
});
