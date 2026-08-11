import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { retryAfterSeconds } from "@/server/trpc/throttle";

/**
 * `Retry-After` on a throttled response — RFC 9110 §10.2.3.
 *
 * **Not on the sign-in path**, which never produces a 429 at all: Auth.js
 * answers a refused credentials callback with a redirect to `/login?error=…`,
 * and §10.2.3 is about a status this can attach to. That path says it in words
 * instead.
 */

const handler = async (req: NextRequest) => {
  const session = await auth();

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ session, headers: req.headers }),
    responseMeta: ({ errors }) => {
      const seconds = retryAfterSeconds(errors);
      return seconds === null ? {} : { headers: { "retry-after": String(seconds) } };
    },
  });
};

export { handler as GET, handler as POST };
