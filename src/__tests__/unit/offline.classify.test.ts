import { describe, it, expect } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import {
  classifyMutationError,
  httpStatusOf,
  receivedResponse,
} from "@/lib/offline/classify";

/**
 * The decision that loses a shop if it is wrong.
 *
 * Each row here is a way somebody's afternoon disappears: a 401 treated as
 * permanent discards the whole queue, a transport failure counted as a strike
 * exhausts it on bad wifi, and a stock conflict reported as "did not save"
 * throws away a real event rather than asking about it.
 */

/** A refusal shaped the way tRPC delivers one to the browser. */
function refusal(httpStatus: number): TRPCClientError<never> {
  const error = new TRPCClientError<never>("refused");
  Object.defineProperty(error, "data", { value: { httpStatus } });
  return error;
}

describe("httpStatusOf", () => {
  it("reads the status tRPC attached", () => {
    expect(httpStatusOf(refusal(409))).toBe(409);
  });

  it("is null when the request never reached a server", () => {
    expect(httpStatusOf(new TypeError("Failed to fetch"))).toBeNull();
    expect(httpStatusOf(new SyntaxError("Unexpected token <"))).toBeNull();
    expect(httpStatusOf(undefined)).toBeNull();
  });

  it("is null for a tRPC error carrying no status", () => {
    expect(httpStatusOf(new TRPCClientError("no data"))).toBeNull();
  });
});

describe("receivedResponse", () => {
  it("is false for a dropped connection", () => {
    // A request that never arrived is a wait, not a strike. Counting it means
    // two minutes of bad supermarket wifi exhausts a genuine shop.
    expect(receivedResponse(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("is false for a captive portal serving HTML the parser choked on", () => {
    expect(receivedResponse(new SyntaxError("Unexpected token <"))).toBe(false);
  });

  it("is true once a server has answered, even to refuse", () => {
    expect(receivedResponse(refusal(403))).toBe(true);
  });
});

describe("classifyMutationError", () => {
  const path = "shopping.updateItem";

  it("calls a request that never arrived transient", () => {
    expect(classifyMutationError(new TypeError("Failed to fetch"), path)).toBe(
      "transient",
    );
  });

  it("never mistakes a captive portal for success", () => {
    expect(
      classifyMutationError(new SyntaxError("Unexpected token <"), path),
    ).toBe("transient");
  });

  for (const status of [500, 502, 503, 504]) {
    it(`calls ${status} transient`, () => {
      expect(classifyMutationError(refusal(status), path)).toBe("transient");
    });
  }

  for (const status of [408, 425, 429]) {
    it(`calls ${status} transient`, () => {
      expect(classifyMutationError(refusal(status), path)).toBe("transient");
    });
  }

  it("calls 401 auth, not permanent", () => {
    // The most consequential row. A session lasts fifteen idle minutes and slides only
    // on activity; a phone in aeroplane mode makes no requests. Reconnect after
    // a twenty-minute shop is a 401 by construction, and a rule that drops
    // permanent 4xx would discard the entire shop at that moment.
    expect(classifyMutationError(refusal(401), path)).toBe("auth");
  });

  for (const status of [400, 403, 404, 412, 422]) {
    it(`calls ${status} permanent`, () => {
      expect(classifyMutationError(refusal(status), path)).toBe("permanent");
    });
  }
});

describe("a refused consumption", () => {
  it("asks to be reconciled rather than reported as a failure", () => {
    // Stock has a floor. Two people who each use the last unit cannot both be
    // right, and the second is refused — but they *did* take the milk, so the
    // change is a question for a person, not a failure to announce.
    expect(classifyMutationError(refusal(409), "inventory.consumeStock")).toBe(
      "reconcile",
    );
  });

  it("is the only conflict that means that", () => {
    // A CONFLICT from the replay layer — a record belonging to another
    // household, a swept claim — is a genuine refusal with nothing to
    // reconcile. Adding stock has no ceiling and so cannot conflict this way.
    for (const other of [
      "shopping.updateItem",
      "shopping.addItem",
      "shopping.removeItem",
      "inventory.addStock",
    ]) {
      expect(classifyMutationError(refusal(409), other)).toBe("permanent");
    }
  });

  it("still defers to the session when both could apply", () => {
    // A 401 on a consume is a sign-in problem, not a stock disagreement.
    expect(classifyMutationError(refusal(401), "inventory.consumeStock")).toBe(
      "auth",
    );
  });
});

describe("an unresolvable offline scan", () => {
  it("asks for review rather than being reported as gone", () => {
    // T7: a barcode Open Food Facts cannot name comes back NOT_FOUND, but the
    // person scanned something real — so it is a question, not a dead 404.
    expect(classifyMutationError(refusal(404), "product.resolveScan")).toBe(
      "review",
    );
  });

  it("is the only 404 that means that", () => {
    // A NOT_FOUND on any other queued write is a genuine "gone" — a row
    // deleted out from under a queued edit — with nothing to review.
    for (const other of [
      "shopping.updateItem",
      "shopping.removeItem",
      "inventory.consumeStock",
    ]) {
      expect(classifyMutationError(refusal(404), other)).toBe("permanent");
    }
  });

  it("still defers to the session on a 401", () => {
    expect(classifyMutationError(refusal(401), "product.resolveScan")).toBe(
      "auth",
    );
  });

  it("asks for review when the account's lookup budget is spent", () => {
    // `productLookupRateLimit` lasts an hour; the queue gives up after eight
    // attempts at most thirty seconds apart and does not read Retry-After. As
    // "transient" the scan held every queued change behind it for minutes and
    // then ended as "not saved" — online the same 429 opens the form.
    expect(classifyMutationError(refusal(429), "product.resolveScan")).toBe(
      "review",
    );
  });

  it("is the only 429 that means that", () => {
    for (const other of [
      "shopping.updateItem",
      "shopping.addItem",
      "inventory.consumeStock",
    ]) {
      expect(classifyMutationError(refusal(429), other)).toBe("transient");
    }
  });
});
