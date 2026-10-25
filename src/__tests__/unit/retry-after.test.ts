import { describe, it, expect } from "bun:test";
import { ThrottledError, retryAfterSeconds } from "@/server/trpc/throttle";

/**
 * RFC 9110 §10.2.3 — the number a refused caller needs, in the place a client
 * looks for it.
 *
 * The limiter has always computed the remaining TTL; it went into a Spanish
 * sentence and nowhere else, so anything that was not a person reading the
 * screen had to guess. A caller that guesses either hammers the endpoint or
 * waits far longer than it needs to, and the first is the thing the limit
 * exists to stop.
 */

describe("what gets a header", () => {
  it("finds the throttled error among others", () => {
    // tRPC batches: one request can carry several procedures, and the throttle
    // may not be the first thing that failed.
    const errors = [
      { cause: new Error("something else") },
      { cause: new ThrottledError(42) },
    ];

    expect(retryAfterSeconds(errors)).toBe(42);
  });

  it("says nothing when nothing was throttled", () => {
    // A header on every error response would tell a caller to retry a request
    // that will never succeed.
    expect(retryAfterSeconds([{ cause: new Error("not found") }])).toBeNull();
    expect(retryAfterSeconds([{}])).toBeNull();
    expect(retryAfterSeconds([])).toBeNull();
  });

  it("is not fooled by something that merely looks like one", () => {
    // The check is on the type, not on a duck-typed field, so an error whose
    // cause happens to carry a number cannot invent a wait.
    expect(
      retryAfterSeconds([{ cause: { retryAfterSeconds: 99 } }]),
    ).toBeNull();
  });
});

describe("the value itself", () => {
  it("rounds up, so the header never expires before the window does", () => {
    // Rounding down would tell a caller to come back while it is still
    // refused, which is one more refused request per refusal.
    expect(retryAfterSeconds([{ cause: new ThrottledError(0.2) }])).toBe(1);
    expect(retryAfterSeconds([{ cause: new ThrottledError(59.4) }])).toBe(60);
  });

  it("never says zero", () => {
    // `Retry-After: 0` reads as "go ahead now", which is the opposite of what
    // a refusal means.
    expect(retryAfterSeconds([{ cause: new ThrottledError(0) }])).toBe(1);
  });

  it("is an integer, because the header is delta-seconds", () => {
    const value = retryAfterSeconds([{ cause: new ThrottledError(12.7) }]);

    expect(Number.isInteger(value)).toBe(true);
  });
});
