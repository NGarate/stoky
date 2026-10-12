import type { AnyTRPCRouter, inferRouterContext } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Session } from "next-auth";
import { retryAfterSeconds } from "@/server/trpc/throttle";

/**
 * The tRPC HTTP endpoint, built from its parts so it can be run without Next.
 *
 * `src/app/api/trpc/[trpc]/route.ts` only wires the application's router,
 * Auth.js and the context into this. Everything the endpoint decides about a
 * request — and the guards that decide before tRPC sees one — lives here,
 * where a unit test can reach it with a plain `Request`, a small router and a
 * stubbed session: no Next server, no Postgres, no Valkey. Written inside the
 * route module, the same logic could only be exercised through a running
 * server, which is why the `Retry-After` header had no test that sent a
 * request.
 */
export interface TrpcHandlerOptions<TRouter extends AnyTRPCRouter> {
  router: TRouter;
  /** The caller's session — `auth()` in the application, a stub in tests. */
  getSession: () => Promise<Session | null>;
  createContext: (opts: {
    session: Session | null;
    headers: Headers;
  }) => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;
}

export function createTrpcHandler<TRouter extends AnyTRPCRouter>({
  router,
  getSession,
  createContext,
}: TrpcHandlerOptions<TRouter>): (req: Request) => Promise<Response> {
  return async (req) => {
    const session = await getSession();

    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router,
      createContext: () => createContext({ session, headers: req.headers }),
      /**
       * `Retry-After` on a throttled response — RFC 9110 §10.2.3.
       *
       * **Not on the sign-in path**, which never produces a 429 at all:
       * Auth.js answers a refused credentials callback with a redirect to
       * `/login?error=…`, and §10.2.3 is about a status this can attach to.
       * That path says it in words instead.
       */
      responseMeta: ({ errors }) => {
        const seconds = retryAfterSeconds(errors);
        return seconds === null ? {} : { headers: { "retry-after": String(seconds) } };
      },
    });
  };
}
