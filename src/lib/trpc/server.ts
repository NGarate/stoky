import "server-only";

import { createTRPCContext } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/router";
import { auth } from "@/lib/auth";

/**
 * Server-side tRPC caller for Server Components
 */
export const api = async () => {
  const session = await auth();

  const caller = appRouter.createCaller(
    await createTRPCContext({ session })
  );

  return caller;
};

// Export typed API for convenience
export type ServerAPI = Awaited<ReturnType<typeof api>>;
