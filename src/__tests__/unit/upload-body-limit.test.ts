import { describe, it, expect } from "bun:test";
import nextConfig from "../../../next.config";
import { MAX_TRPC_BODY_BYTES } from "@/server/http/body-limit";
import {
  MAX_RECEIPT_BASE64_LENGTH,
  MAX_RECEIPT_BYTES,
} from "@/lib/validations/receipt";

/**
 * The request-body ceiling has to be larger than the largest receipt.
 *
 * These two numbers live in different files and neither mentions the other at
 * runtime: `MAX_RECEIPT_BYTES` says what a photograph may weigh, and
 * `next.config.ts` says how large a request body Next will carry. Between them
 * sits base64, which adds a third.
 *
 * They were out of agreement, and the way that showed is worth recording
 * because nothing went red. Next caps a body at `proxyClientMaxBodySize`
 * whenever a middleware is configured — this application's matcher covers
 * `/api/trpc` — and the 10 MiB default is *below* the 13.98 MB that a 10 MB
 * photograph becomes on the wire. Measured against a running server: a body of
 * 10,000,080 bytes parsed and a body of 10,485,840 came back as `JSON Parse
 * error: Unterminated string`. Setting the option to 32 MiB moved the
 * threshold to exactly 32 MiB, which is what identified the cause rather than
 * a suspect.
 *
 * So an upload between about 7.5 MiB and the documented 10 MB failed with a
 * parser's error message, and the router's own size check was unreachable —
 * to trip it a body must be bigger than a body that gets truncated first.
 *
 * A comment in either file would have been true and would not have failed.
 */

/** The effective config, after the next-intl plugin has wrapped it. */
const bodyLimit = (
  nextConfig as { experimental?: { proxyClientMaxBodySize?: number } }
).experimental?.proxyClientMaxBodySize;

describe("what a request body may weigh", () => {
  it("is set explicitly, because the default is too small for the feature", () => {
    // Deleting the option is the regression this catches: it restores a 10 MiB
    // default that silently truncates a legitimate upload.
    expect(bodyLimit).toBeDefined();
  });

  it("leaves room for the largest photograph the product documents", () => {
    expect(bodyLimit).toBeGreaterThan(MAX_RECEIPT_BASE64_LENGTH);
  });

  it("leaves room for the JSON around it too", () => {
    // The base64 is a field in a superjson envelope, not the whole body. The
    // margin is small on purpose — see the next test.
    const envelope = 4096;
    expect(bodyLimit).toBeGreaterThan(MAX_RECEIPT_BASE64_LENGTH + envelope);
  });

  it("is not larger than the feature needs", () => {
    // This is the ceiling on what an unauthenticated caller can make the
    // server hold while it parses — `auth.register` is public and the body is
    // read before any procedure runs. Raising it is a security decision, so it
    // should require changing a test rather than only a config line.
    expect(bodyLimit).toBeLessThan(MAX_RECEIPT_BASE64_LENGTH * 2);
  });

  it("is the number the tRPC route enforces itself", () => {
    // The proxy's cap does not apply to a request labelled a prefetch, so the
    // route bounds the body too (`src/server/http/body-limit.ts`). Two
    // numbers would be two answers to what an upload may weigh: a route limit
    // below the proxy's refuses an upload the proxy let through, and one
    // above it is a ceiling only the prefetch label can reach.
    expect(bodyLimit).toBe(MAX_TRPC_BODY_BYTES);
  });
});

describe("the base64 arithmetic the ceiling is derived from", () => {
  it("matches what encoding actually produces", () => {
    // `Math.ceil(n / 3) * 4` is the claim. Asserted against a real encode
    // rather than restated, because getting it wrong by one rounding step is
    // how the ceiling ends up just under what it needs to be — which is the
    // whole defect this file exists for, in miniature.
    const encoded = Buffer.alloc(MAX_RECEIPT_BYTES).toString("base64");

    expect(encoded.length).toBe(MAX_RECEIPT_BASE64_LENGTH);
  });

  it("is bigger than the file it encodes, which is the point", () => {
    expect(MAX_RECEIPT_BASE64_LENGTH).toBeGreaterThan(MAX_RECEIPT_BYTES);
  });
});
