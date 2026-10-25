/**
 * How much of a request body the API routes will hold, and the one function
 * that holds no more.
 *
 * **The route has to bound the body itself, because nothing in front of it
 * reliably does.** `experimental.proxyClientMaxBodySize` in `next.config.ts`
 * looks like the ceiling, and it is one only when the proxy runs: Next
 * applies it while cloning the body *for* the proxy. `src/proxy.ts`'s matcher
 * skips any request labelled `Purpose: prefetch` or `Next-Router-Prefetch`,
 * whatever its method, so one request header turned the cap off — and Bun's
 * `node:http` server accepts a body of any size (`maxRequestBodySize` is
 * `Number.MAX_SAFE_INTEGER`, and Next's standalone `server.js` offers no way
 * to change it). An unauthenticated, prefetch-labelled POST to
 * `auth.register` was read whole and JSON-parsed before the rate limiter
 * could refuse it (`docs/SECURITY_REVIEW.md` §8).
 *
 * The proxy cap stays, and these are the same number: an unlabelled request
 * is now bounded twice, a labelled one once, and none of them not at all.
 *
 * This module imports nothing, because `next.config.ts` imports it and a
 * config that drags in the server's dependency graph to read one number is a
 * worse trade than the duplication it saves.
 */

/**
 * The tRPC endpoint's ceiling: 15 MiB.
 *
 * Set by the largest thing a legitimate caller sends — a 10 MB receipt
 * photograph, which base64 inflates to 13.98 MB inside a JSON envelope
 * (`src/lib/validations/receipt.ts` has the measurements). Not a number to
 * raise casually: it is how much an unauthenticated caller can make the
 * server hold per request. `src/__tests__/unit/upload-body-limit.test.ts`
 * fails if it drops below what the upload needs, rises far above it, or
 * stops being the number the proxy uses too.
 */
export const MAX_TRPC_BODY_BYTES = 15 * 1024 * 1024;

/**
 * The auth API's ceiling: 64 KiB.
 *
 * What reaches `/api/auth` by POST is a small JSON body — an address and a
 * password of at most 128 characters — so a kilobyte is generous and 64 is not
 * a number anybody will meet by accident.
 */
export const MAX_AUTH_BODY_BYTES = 64 * 1024;

export type BodyWithin =
  | { ok: true; body: Uint8Array<ArrayBuffer> | null }
  | { ok: false; response: Response };

/**
 * Reads `req`'s body if it is at most `maxBytes`, or answers 413.
 *
 * - **A declared length over the limit is refused without reading a byte.**
 * - **Otherwise the bytes are counted as they arrive**, because a chunked
 *   request declares no length at all and a declared one is the caller's
 *   claim, not a measurement. The read stops at the first chunk past the
 *   limit, so the most it ever holds is `maxBytes` plus one chunk.
 *
 * The refusal carries `connection: close`: the client may still be sending
 * the rest, and closing is how the server avoids reading it to keep the
 * connection reusable.
 */
export async function readBodyWithin(
  req: Request,
  maxBytes: number,
): Promise<BodyWithin> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: payloadTooLarge(maxBytes) };
  }

  if (req.body === null) return { ok: true, body: null };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Not awaited: whatever the stream does on cancel is no reason to delay
      // the refusal, and a rejection here has nobody left to tell.
      reader.cancel().catch(() => {});
      return { ok: false, response: payloadTooLarge(maxBytes) };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

/**
 * What a request is rebuilt from once its body has been read: the same
 * method, headers and abort signal, and the bytes in place of the stream.
 *
 * The length is restated as what was actually read, and a chunked encoding is
 * dropped, because both described a stream that no longer exists. Plain data
 * rather than a `Request`, so a caller can build whichever request type it
 * needs from it.
 */
export function initWithBody(
  req: Request,
  body: Uint8Array<ArrayBuffer> | null,
): {
  method: string;
  headers: Headers;
  body: Uint8Array<ArrayBuffer> | null;
  signal: AbortSignal;
} {
  const headers = new Headers(req.headers);
  headers.delete("transfer-encoding");
  if (body === null) headers.delete("content-length");
  else headers.set("content-length", String(body.byteLength));
  return { method: req.method, headers, body, signal: req.signal };
}

function payloadTooLarge(maxBytes: number): Response {
  return new Response(`Request body larger than ${maxBytes} bytes`, {
    status: 413,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      connection: "close",
    },
  });
}
