import { headers } from "next/headers";
import { connection } from "next/server";
import { LoginForm } from "@/components/session/LoginForm";
import { ShellCacheGuard } from "@/components/session/ShellCacheGuard";
import { passkeyOfferedAt } from "@/lib/auth/passkeys";
import type { JSX } from "react";

/**
 * `/login`: the sign-in form, and the cleanup a device gets on arriving here.
 *
 * A server component rendering a client form, as `/register` is, so that the
 * server can hand the form what only it knows — whether a passkey can be
 * offered at the host the page was served from (`passkeyOfferedAt`, D151) —
 * without a round trip after the first paint.
 *
 * `connection()` first, and no shell, for `/register`'s reason: both inputs
 * belong to the request rather than the build. The `Host` header is the
 * request's, and `STOKY_URLS` is the running container's environment, not
 * the one `next build` saw — a prerender would bake in "no passkeys" for an
 * install that has them, or the reverse.
 */
export const instant = false;

export default async function LoginPage(): Promise<JSX.Element> {
  await connection();

  const passkeyOffered = passkeyOfferedAt((await headers()).get("host"));

  return (
    <>
      {/* Most sessions do not end at a sign-out control. An idle expiry, the
          ceiling, or another device ending this account's sessions all end it
          on the server, and the browser only finds out by being sent here,
          with nothing run on the client first. Signing out purges the device
          itself (`useEndSession`); this is the cleanup every other ending
          gets. */}
      <ShellCacheGuard userId={null} />
      <LoginForm passkeyOffered={passkeyOffered} />
    </>
  );
}
