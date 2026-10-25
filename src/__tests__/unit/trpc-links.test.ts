import { describe, it, expect, spyOn } from "bun:test";
import { createTRPCClient } from "@trpc/client";
import SuperJSON from "superjson";
import { trpcLinks } from "@/lib/trpc/links";
import type { AppRouter } from "@/server/trpc/router";

/**
 * Which link a call leaves by, measured at the `fetch` it makes.
 *
 * `auth.changePassword` rotates this device's session, and the new cookie
 * reaches the browser only if the answer's headers are written after the
 * resolver ran (PROGRESS D144). A streamed batch writes them first, so the
 * password change goes by `httpLink` and everything else keeps streaming.
 * `e2e/password-change.spec.ts` is the proof that the cookie arrives; this is
 * the proof of which request carries it, and it needs no server.
 *
 * Told apart by what each link puts on the wire: the streaming batch link
 * asks for `?batch=1` and says `trpc-accept: application/jsonl`; `httpLink`
 * sends neither.
 */

interface Sent {
  url: string;
  accept: string | null;
}

function clientRecording(): {
  client: ReturnType<typeof createTRPCClient<AppRouter>>;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({ url: String(input), accept: headers.get("trpc-accept") });
    // A tRPC answer for one call, in the transformer's shape; the streaming
    // link reads it as a failure, which is all the second test needs.
    return new Response(
      JSON.stringify({
        result: { data: SuperJSON.serialize({ success: true }) },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const client = createTRPCClient<AppRouter>({
    links: trpcLinks({ url: "http://localhost/api/trpc", fetch: fakeFetch }),
  });
  return { client, sent };
}

describe("the browser client's links", () => {
  it("sends the password change unbatched and unstreamed", async () => {
    const { client, sent } = clientRecording();

    const answer = await client.auth.changePassword.mutate({
      currentPassword: "cocina despensa nevera",
      newPassword: "tarro de garbanzos azul",
    });

    expect(answer).toEqual({ success: true });
    expect(sent).toHaveLength(1);
    const [only] = sent;
    expect(new URL(only?.url ?? "").pathname).toBe(
      "/api/trpc/auth.changePassword",
    );
    expect(new URL(only?.url ?? "").searchParams.has("batch")).toBe(false);
    expect(only?.accept).toBeNull();
  });

  it("streams every other call, in a batch", async () => {
    // The control: without it the test above would pass with every call
    // unstreamed, which loses the batching the screens depend on.
    const { client, sent } = clientRecording();

    // The fake answer is not a stream, so the call fails and the logger link
    // reports it; quietened, since the request is what is under test.
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    try {
      await client.auth.endSessions
        .mutate({ currentPassword: "cocina despensa nevera", scope: "all" })
        .catch(() => {});
    } finally {
      quiet.mockRestore();
    }

    expect(sent).toHaveLength(1);
    const [only] = sent;
    expect(new URL(only?.url ?? "").pathname).toBe(
      "/api/trpc/auth.endSessions",
    );
    expect(new URL(only?.url ?? "").searchParams.get("batch")).toBe("1");
    expect(only?.accept).toBe("application/jsonl");
  });
});
