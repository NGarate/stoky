import { describe, it, expect } from "bun:test";
import { initWithBody, readBodyWithin } from "@/server/http/body-limit";

/**
 * The bound the API routes put on a request body themselves, because the
 * proxy's cap does not apply to a request labelled a prefetch
 * (`docs/SECURITY_REVIEW.md` §8).
 *
 * The bodies are streams the test controls, so it can see how much of one was
 * read: a limit that reads everything and *then* refuses has already spent
 * the memory it was meant to protect.
 */

const LIMIT = 1024;

/** A stream of `chunks` chunks of `size` bytes, counting the ones pulled. */
function countedStream(chunks: number, size: number) {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (state.pulled === chunks) {
          controller.close();
          return;
        }
        state.pulled++;
        controller.enqueue(new Uint8Array(size).fill(0x41));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

function post(body: BodyInit | null, headers?: HeadersInit): Request {
  return new Request("http://localhost/api/trpc/x", { method: "POST", body, headers });
}

describe("a declared length over the limit", () => {
  it("is refused with 413 without a byte of the body read", async () => {
    const { stream, state } = countedStream(100, LIMIT);

    const read = await readBodyWithin(post(stream, { "content-length": String(LIMIT + 1) }), LIMIT);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.response.status).toBe(413);
    expect(state.pulled).toBe(0);
  });

  it("asks for the connection to be closed rather than drained", async () => {
    const read = await readBodyWithin(post("x", { "content-length": String(LIMIT * 10) }), LIMIT);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.response.headers.get("connection")).toBe("close");
  });
});

describe("a body that declares no length", () => {
  it("is refused at limit + 1 bytes", async () => {
    // A chunked request: the only way to know its size is to count it.
    const { stream } = countedStream(1, LIMIT + 1);

    const read = await readBodyWithin(post(stream), LIMIT);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.response.status).toBe(413);
  });

  it("stops reading at the first chunk past the limit", async () => {
    // Four chunks fit, the fifth crosses; the other 95 are never asked for.
    const { stream, state } = countedStream(100, LIMIT / 4);

    const read = await readBodyWithin(post(stream), LIMIT);

    expect(read.ok).toBe(false);
    expect(state.pulled).toBe(5);
  });

  it("is refused when it lies about its length", async () => {
    // A declared length is the caller's claim, not a measurement.
    const { stream } = countedStream(8, LIMIT / 2);

    const read = await readBodyWithin(post(stream, { "content-length": "10" }), LIMIT);

    expect(read.ok).toBe(false);
  });
});

describe("a body within the limit", () => {
  it("is read whole at exactly the limit", async () => {
    const { stream } = countedStream(4, LIMIT / 4);

    const read = await readBodyWithin(post(stream), LIMIT);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.body?.byteLength).toBe(LIMIT);
    expect(read.body?.every((byte) => byte === 0x41)).toBe(true);
  });

  it("keeps its bytes in order across chunks", async () => {
    const pieces = ['{"json":', '{"name":', '"Leche"}}'];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
        controller.close();
      },
    });

    const read = await readBodyWithin(post(stream), LIMIT);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(new TextDecoder().decode(read.body!)).toBe('{"json":{"name":"Leche"}}');
  });

  it("is null when there is none", async () => {
    const read = await readBodyWithin(new Request("http://localhost/x", { method: "POST" }), LIMIT);

    expect(read).toEqual({ ok: true, body: null });
  });
});

describe("the request rebuilt around a body already read", () => {
  it("keeps the method, headers and signal, states the length read and drops the chunked encoding", () => {
    const controller = new AbortController();
    const original = new Request("http://localhost/api/trpc/x", {
      method: "POST",
      headers: { "transfer-encoding": "chunked", "x-forwarded-for": "203.0.113.7" },
      body: "abc",
      signal: controller.signal,
    });

    const init = initWithBody(original, new Uint8Array(3));

    expect(init.method).toBe("POST");
    expect(init.headers.get("content-length")).toBe("3");
    expect(init.headers.get("transfer-encoding")).toBeNull();
    expect(init.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(init.signal).toBe(original.signal);
  });
});
