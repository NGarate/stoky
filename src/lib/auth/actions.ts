"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/instance";

/**
 * End the session.
 *
 * A Server Action, so it can clear the cookie: Better Auth deletes this
 * browser's session row and expires its cookies, and `nextCookies()`
 * (`src/lib/auth/instance.ts`) copies those Set-Cookie lines into the
 * action's response.
 *
 * Unauthenticated by nature and safe to be: all it can do is end the
 * caller's own session. Someone who is not signed in gets a redirect to a
 * page they can already reach.
 */
// react-doctor-disable-next-line react-doctor/server-auth-actions
export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
