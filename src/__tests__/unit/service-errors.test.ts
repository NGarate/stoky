import { describe, it, expect } from "bun:test";
import { TRPCError } from "@trpc/server";
import {
  InvalidInputError,
  NotFoundError,
  UpstreamError,
} from "@/server/services/errors";
import { translateServiceError } from "@/server/trpc/service-errors";
import { classifyMutationError } from "@/lib/offline/classify";
import { TRPCClientError } from "@trpc/client";
import {
  createTRPCRouter,
  createTRPCContext,
  publicProcedure,
} from "@/server/trpc/trpc";

/**
 * ISSUES.md DEBT-6 — a service's failure, in a code the client can act on.
 *
 * The reason this is not cosmetic is at the bottom of the file. Phase 4's queue
 * reads the HTTP status to decide whether to retry, `INTERNAL_SERVER_ERROR`
 * means transient, and a receipt that does not exist is never going to exist —
 * so the untranslated version spent eight attempts and rising backoff on it and
 * then reported "exhausted", which is a lie about what happened.
 */

describe("what each kind becomes", () => {
  it("turns a missing row into NOT_FOUND", () => {
    const translated = translateServiceError(
      new NotFoundError("Receipt not found"),
    );

    expect(translated?.code).toBe("NOT_FOUND");
  });

  it("turns unusable input into BAD_REQUEST", () => {
    // Not NOT_FOUND: the row is there and the caller can do something about it.
    const translated = translateServiceError(
      new InvalidInputError("Empty image file"),
    );

    expect(translated?.code).toBe("BAD_REQUEST");
  });

  it("turns an outside system's failure into BAD_GATEWAY", () => {
    // Nothing here is broken, and saying INTERNAL_SERVER_ERROR when Open Food
    // Facts is having a bad minute sends the operator looking in the wrong
    // place.
    const translated = translateServiceError(
      new UpstreamError("OFF answered 503", 503),
    );

    expect(translated?.code).toBe("BAD_GATEWAY");
  });

  it("keeps the original as the cause", () => {
    // The server log needs the message the service wrote; the client gets the
    // generic sentence.
    const original = new NotFoundError("Receipt item not found");

    expect(translateServiceError(original)?.cause).toBe(original);
  });
});

describe("what it leaves alone", () => {
  it("does not touch an ordinary error", () => {
    // A bug is a 500 and should stay one. Translating everything would hide
    // the failures that need fixing behind statuses that read as expected.
    expect(
      translateServiceError(new Error("undefined is not a function")),
    ).toBeNull();
    expect(translateServiceError(new TypeError("no"))).toBeNull();
  });

  it("does not touch a resolver's own refusal", () => {
    expect(
      translateServiceError(
        new TRPCError({ code: "FORBIDDEN", message: "no" }),
      ),
    ).toBeNull();
  });
});

describe("the middleware that applies it", () => {
  /**
   * A throwaway router, because the wiring is the half the translation itself
   * cannot prove.
   *
   * `translateServiceError` returning the right code says nothing about whether
   * anything calls it. In the application the services are reached through
   * resolvers that check the row exists first, so the escape this guards
   * against is a race — the receipt deleted between the router's read and the
   * service's — which is not reachable from a test on purpose. One procedure
   * that throws is.
   */
  const router = createTRPCRouter({
    missing: publicProcedure.query(() => {
      throw new NotFoundError("Receipt not found");
    }),
    upstream: publicProcedure.query(() => {
      throw new UpstreamError("Open Food Facts answered 503", 503);
    }),
    broken: publicProcedure.query(() => {
      throw new Error("undefined is not a function");
    }),
  });

  const call = async (procedure: "missing" | "upstream" | "broken") => {
    const caller = router.createCaller(
      await createTRPCContext({ session: null }),
    );
    try {
      await caller[procedure]();
    } catch (error) {
      return error as TRPCError;
    }
    throw new Error("expected it to throw");
  };

  it("translates a service error thrown from a resolver", async () => {
    expect((await call("missing")).code).toBe("NOT_FOUND");
  });

  it("translates an upstream failure too", async () => {
    expect((await call("upstream")).code).toBe("BAD_GATEWAY");
  });

  it("leaves a genuine bug as a server fault", async () => {
    // The line that keeps this from hiding the failures that need fixing.
    expect((await call("broken")).code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("what the write queue does with the result", () => {
  // The reason the translation exists at all, asserted against the real
  // classifier rather than described in a comment.

  it("stops retrying a receipt that does not exist", () => {
    const outcome = classify(new NotFoundError("Receipt not found"));

    expect(outcome).not.toBe("transient");
    expect(outcome).toBe("permanent");
  });

  it("would have retried it eight times untranslated", () => {
    // The behaviour before this change: no translation, so tRPC reports 500,
    // so the queue treats a permanent failure as worth retrying. This is the
    // assertion that makes the paragraph above checkable rather than a claim.
    expect(
      classifyMutationError(errorWithStatus(500), "receipt.parseReceipt"),
    ).toBe("transient");
  });

  it("keeps retrying when an outside system is at fault", () => {
    // The other direction: Open Food Facts having a bad minute *is* worth
    // coming back to.
    expect(classify(new UpstreamError("off", 503))).toBe("transient");
  });
});

/**
 * A refusal shaped the way tRPC delivers one to the browser.
 *
 * A plain object with the same fields will not do: `httpStatusOf` checks
 * `instanceof TRPCClientError` before it reads `data`, so a lookalike is
 * classified as "never reached a server" and every assertion below passes for
 * the wrong reason.
 */
function errorWithStatus(status: number): TRPCClientError<never> {
  const error = new TRPCClientError<never>("refused");
  Object.defineProperty(error, "data", { value: { httpStatus: status } });
  return error;
}

/** What the queue decides about a service error, end to end. */
function classify(error: unknown): string {
  const code = translateServiceError(error)?.code;
  const STATUS: Record<string, number> = {
    NOT_FOUND: 404,
    BAD_REQUEST: 400,
    BAD_GATEWAY: 502,
  };
  // `?? 500` is not a fallback for convenience: an untranslated error really
  // does reach the client as 500, which is the case the third test pins.
  return classifyMutationError(
    errorWithStatus(STATUS[code ?? ""] ?? 500),
    "receipt.parseReceipt",
  );
}
