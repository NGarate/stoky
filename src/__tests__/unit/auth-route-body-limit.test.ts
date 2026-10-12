import { describe, it, expect } from "bun:test";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/auth/[...nextauth]/route";
import { MAX_AUTH_BODY_BYTES } from "@/server/http/body-limit";

/**
 * `/api/auth` bounds a POST body itself, and Auth.js still gets the form.
 *
 * Through the route module the application serves, with Auth.js real: a
 * sign-out is the one POST that needs no database, and it exercises exactly
 * what rebuilding the request could break — the form parsed, the CSRF token
 * in it matched against the cookie in the headers.
 */

const ORIGIN = "http://localhost:3000";

/** A CSRF token and the cookie it is checked against, from Auth.js itself. */
async function csrf(): Promise<{ token: string; cookie: string }> {
  const response = await GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
  const { csrfToken } = (await response.json()) as { csrfToken: string };
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { token: csrfToken, cookie };
}

/** A valid sign-out form, padded to exactly `size` bytes. */
function signOutForm(token: string, size: number): string {
  const form = new URLSearchParams({ csrfToken: token, callbackUrl: `${ORIGIN}/despedida`, pad: "" });
  const unpadded = form.toString().length;
  form.set("pad", "a".repeat(size - unpadded));
  const body = form.toString();
  expect(body.length).toBe(size);
  return body;
}

function signOut(cookie: string, body: string): NextRequest {
  return new NextRequest(`${ORIGIN}/api/auth/signout`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie,
      // Auth.js answers with the redirect as JSON rather than a 302.
      "x-auth-return-redirect": "1",
    },
    body,
  });
}

describe("a POST to /api/auth", () => {
  it("of exactly the limit reaches Auth.js, form and CSRF check intact", async () => {
    const { token, cookie } = await csrf();

    const response = await POST(signOut(cookie, signOutForm(token, MAX_AUTH_BODY_BYTES)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: `${ORIGIN}/despedida` });
  });

  it("one byte over the limit is refused with 413", async () => {
    const { token, cookie } = await csrf();

    const response = await POST(signOut(cookie, signOutForm(token, MAX_AUTH_BODY_BYTES + 1)));

    expect(response.status).toBe(413);
  });

  it("over the limit with no declared length is refused with 413 too", async () => {
    const chunk = new Uint8Array(16 * 1024).fill(0x61);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Five 16 KiB chunks: 80 KiB, and nothing says so up front.
        if (sent++ === 5) controller.close();
        else controller.enqueue(chunk);
      },
    });

    const response = await POST(
      new NextRequest(`${ORIGIN}/api/auth/callback/credentials`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    );

    expect(response.status).toBe(413);
  });
});
