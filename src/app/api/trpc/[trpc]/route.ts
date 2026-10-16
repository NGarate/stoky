import { headers } from "next/headers";
import { connection } from "next/server";
import { readSession } from "@/lib/auth";
import { createTrpcHandler } from "@/server/http/trpc-handler";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";

/**
 * Wiring only. What the endpoint does with a request is in
 * `src/server/http/trpc-handler.ts`, where it can be tested without Next.
 *
 * The session is read with `refresh: true`, letting Better Auth run its daily
 * refresh of a remembered session, and never sliding a browser session's
 * idle expiry: only `auth.session`, on real activity, does that
 * (`src/lib/auth/session-policy.ts`). A dashboard polling in the background
 * must not keep an unattended session alive.
 */
const handler = createTrpcHandler({
  router: appRouter,
  getSession: async () => {
    await connection();
    return readSession(await headers(), { refresh: true });
  },
  createContext: createTRPCContext,
});

export { handler as GET, handler as POST };
