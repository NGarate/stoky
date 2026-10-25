import { toNextJsHandler } from "better-auth/next-js";
import { readSession } from "@/lib/auth";
import { getAuth } from "@/lib/auth/instance";
import { endPresentedSession, tidyAfterSignIn } from "@/lib/auth/sign-in-tidy";
import { prisma } from "@/lib/prisma";
import {
  handleAuthRequest,
  type AuthHandlerOptions,
} from "@/server/http/auth-handler";

/**
 * Wiring only. What the auth API does with a request — which endpoints it
 * answers, the limits, the guards on what it returns — is in
 * `src/server/http/auth-handler.ts`, where it can be tested without Next.
 *
 * `getAuth()` is called per request, not here: building the instance at
 * import would run during `next build`, which has no secret and no database.
 */
const options: AuthHandlerOptions = {
  handler: () => toNextJsHandler(getAuth()).POST,
  sessions: {
    // Without a refresh: reading the session being replaced must not move it.
    presented: async (headers) => {
      const session = await readSession(headers, { refresh: false });
      return session
        ? { id: session.sessionId, userId: session.user.id }
        : null;
    },
    tidy: (input) => tidyAfterSignIn(prisma, input),
    end: (previous, account) => endPresentedSession(prisma, previous, account),
  },
  // From the instance's own cookie table: the name is `__Secure-` prefixed
  // when the canonical address is https.
  dontRememberCookie: async () => {
    const cookie = (await getAuth().$context).authCookies.dontRememberToken;
    return { name: cookie.name, secure: cookie.attributes.secure === true };
  },
  // The same table: Better Auth's challenge cookie and the session cookie.
  twoFactorCookies: async () => {
    const context = await getAuth().$context;
    return {
      challenge: context.createAuthCookie("two_factor").name,
      session: context.authCookies.sessionToken.name,
    };
  },
};

export function GET(request: Request): Promise<Response> {
  return handleAuthRequest(request, options);
}

export function POST(request: Request): Promise<Response> {
  return handleAuthRequest(request, options);
}
