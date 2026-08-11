"use server";

import { signOut } from "@/lib/auth";

/**
 * End the session.
 *
 * A Server Action rather than `next-auth/react`'s `signOut`, because there is
 * no `SessionProvider` in this application — the dashboard layout awaits
 * `auth()` on the server and hands down what the client needs. Adding a
 * provider for one button would be a lot of plumbing for a redirect.
 *
 * Unauthenticated by nature and safe to be: all it can do is clear the
 * caller's own cookie. Someone who is not signed in gets a redirect to a page
 * they can already reach.
 */
// react-doctor-disable-next-line react-doctor/server-auth-actions
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
