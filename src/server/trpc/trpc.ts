import { initTRPC } from "@trpc/server";
import { cache } from "react";
import superjson from "superjson";
import type { Session } from "next-auth";

export const createTRPCContext = cache(
  async (opts: { session: Session | null }) => {
    return {
      session: opts.session,
    };
  },
);

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(
  t.middleware(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new Error("Unauthorized");
    }
    return next({
      ctx: {
        session: ctx.session,
      },
    });
  }),
);
