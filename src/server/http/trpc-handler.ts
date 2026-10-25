import type { AnyTRPCRouter, inferRouterContext } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AppSession } from "@/lib/auth/session";
import { MAX_TRPC_BATCH_SIZE } from "@/lib/trpc/batch";
import { retryAfterSeconds } from "@/server/trpc/throttle";
import {
  MAX_TRPC_BODY_BYTES,
  initWithBody,
  readBodyWithin,
} from "./body-limit";
import { refuseCrossSite, refuseNonJson } from "./request-guards";

/**
 * The tRPC HTTP endpoint, built from its parts so it can be run without Next.
 *
 * `src/app/api/trpc/[trpc]/route.ts` only wires the application's router,
 * the session read and the context into this. Everything the endpoint decides about a
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
  getSession: () => Promise<AppSession | null>;
  createContext: (opts: {
    session: AppSession | null;
    headers: Headers;
  }) => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;
}

export function createTrpcHandler<TRouter extends AnyTRPCRouter>({
  router,
  getSession,
  createContext,
}: TrpcHandlerOptions<TRouter>): (req: Request) => Promise<Response> {
  const answer = async (incoming: Request): Promise<Response> => {
    // Who sent it and in what form, before anything else: both are headers,
    // so refusing on them costs nothing, and a request that should not be here
    // has its body neither read nor held.
    const refused =
      refuseCrossSite(incoming, "/api/trpc") ?? refuseNonJson(incoming);
    if (refused) return refused;

    // Then the body, before the session or anything else costs a thing:
    // nothing in front of this route bounds it reliably (see body-limit.ts),
    // and tRPC would otherwise read all of it before any procedure, the rate
    // limiter included, could object. tRPC then reads the bytes already held
    // rather than the stream.
    let req = incoming;
    if (incoming.method !== "GET" && incoming.method !== "HEAD") {
      const read = await readBodyWithin(incoming, MAX_TRPC_BODY_BYTES);
      if (!read.ok) return read.response;
      req = new Request(incoming.url, initWithBody(incoming, read.body));
    }

    const session = await getSession();

    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router,
      createContext: () => createContext({ session, headers: req.headers }),
      // Checked against the path list before any input is parsed or any
      // procedure runs, so a longer batch costs a 400 and no call at all.
      // Why this number: `src/lib/trpc/batch.ts`.
      maxBatchSize: MAX_TRPC_BATCH_SIZE,
      /**
       * `Retry-After` on a throttled response — RFC 9110 §10.2.3.
       *
       * Sign-in is not here: it is the auth route
       * (`src/server/http/auth-handler.ts`), which answers a spent budget with
       * its own 429 and `Retry-After` from the same limiter.
       */
      responseMeta: ({ errors }) => {
        const seconds = retryAfterSeconds(errors);
        return seconds === null
          ? {}
          : { headers: { "retry-after": String(seconds) } };
      },
    });
  };

  return async (incoming) => withNoStore(await answer(incoming));
}

/**
 * `Cache-Control: no-store` on every response this endpoint gives — RFC 9111
 * §5.2.2.5.
 *
 * **Nothing else marks them.** tRPC sets no cache directive on its JSON, Next
 * sends a route handler's response as it is, and neither the config's
 * `headers()` nor Traefik adds one. A query is a GET carrying one household's
 * stock, prices, receipts and members, under a URL that is often the same for
 * every account (`input={}`) and a `Vary` that does not name the cookie. A
 * shared cache in front of the instance — a CDN rule that caches everything,
 * a caching reverse proxy — could store one person's answer and give it to the
 * next person who asks for that URL, signed in or not.
 *
 * **Here, at the one exit, rather than in `responseMeta`.** `responseMeta`
 * reaches only the responses tRPC builds; the 403, 415 and 413 above are built
 * before tRPC is called, and a refusal added later would have to remember the
 * header for itself. A cached refusal is wrong too: a 429 would be served to
 * people who were never throttled.
 *
 * **Offline reads do not depend on the HTTP cache**, so this costs them
 * nothing: TanStack Query persists them in client storage
 * (`src/lib/offline/`), and the service worker passes `/api/` straight through.
 */
function withNoStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}
