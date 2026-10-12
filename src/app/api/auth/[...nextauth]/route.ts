import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { MAX_AUTH_BODY_BYTES, initWithBody, readBodyWithin } from "@/server/http/body-limit";

export const { GET } = handlers;

/**
 * Auth.js's POST, with the body bounded before Auth.js reads it.
 *
 * Every POST here is a small form — sign-in, sign-out, the CSRF token with
 * it — and none of it needs an account to send, so an unbounded body is
 * memory any address can ask for. The proxy's cap does not cover a request
 * labelled a prefetch (`src/server/http/body-limit.ts`), so the route bounds
 * it itself. Auth.js then gets a request with the same method, URL and
 * headers and the bytes already read: its CSRF check and form parsing are its
 * own and unchanged.
 */
export async function POST(incoming: NextRequest): Promise<Response> {
  const read = await readBodyWithin(incoming, MAX_AUTH_BODY_BYTES);
  if (!read.ok) return read.response;

  return handlers.POST(new NextRequest(incoming.url, initWithBody(incoming, read.body)));
}
