import { auth } from "@/lib/auth";
import { createTrpcHandler } from "@/server/http/trpc-handler";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";

/**
 * Wiring only. What the endpoint does with a request is in
 * `src/server/http/trpc-handler.ts`, where it can be tested without Next.
 */
const handler = createTrpcHandler({
  router: appRouter,
  getSession: auth,
  createContext: createTRPCContext,
});

export { handler as GET, handler as POST };
