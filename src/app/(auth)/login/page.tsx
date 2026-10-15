import { LoginForm } from "@/components/session/LoginForm";
import { ShellCacheGuard } from "@/components/session/ShellCacheGuard";
import type { JSX } from "react";

/**
 * `/login`: the sign-in form, and the cleanup a device gets on arriving here.
 *
 * A server component rendering a client form, as `/register` is, so that the
 * server can hand the form what only it knows — whether a passkey can be
 * offered at the host the page was served from — without a round trip after
 * the first paint. It reads no runtime input yet, so unlike `/register` it
 * neither calls `connection()` nor opts out of the shell: there is nothing for
 * a prerender to bake in. The first commit that reads the request here must
 * add both.
 */
export default function LoginPage(): JSX.Element {
  return (
    <>
      {/* Most sessions do not end at a sign-out control. An idle expiry, the
          ceiling, or another device ending this account's sessions all end it
          on the server, and the browser only finds out by being sent here,
          with nothing run on the client first. Signing out purges the device
          itself (`useEndSession`); this is the cleanup every other ending
          gets. */}
      <ShellCacheGuard userId={null} />
      <LoginForm />
    </>
  );
}
