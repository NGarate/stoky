import type { AnyTRPCRouter, inferRouterContext } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Session } from "next-auth";
import { rateLimitIdentifier } from "@/lib/rate-limit";
import { logSecurityEvent } from "@/lib/security-log";
import { MAX_TRPC_BATCH_SIZE } from "@/lib/trpc/batch";
import { retryAfterSeconds } from "@/server/trpc/throttle";
import { MAX_TRPC_BODY_BYTES, initWithBody, readBodyWithin } from "./body-limit";

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
  const answer = async (incoming: Request): Promise<Response> => {
    // Who sent it and in what form, before anything else: both are headers,
    // so refusing on them costs nothing, and a request that should not be here
    // has its body neither read nor held.
    const refused = refuseCrossSite(incoming) ?? refuseNonJson(incoming);
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

/**
 * The `Sec-Fetch-Site` values a browser sends for a request this application
 * made itself (`same-origin`), or one the person started by typing or a
 * bookmark (`none`). `same-site` is the one that matters: SameSite=Lax sends
 * the session cookie with it, because a sibling subdomain is the same *site*.
 */
const OWN_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * 403 for a request a browser says another site sent — the Fetch Metadata
 * check of the OWASP CSRF Cheat Sheet.
 *
 * **A request with no `Sec-Fetch-Site` passes.** Every current browser engine
 * sends it — Safari was the last, in 16.4 — but only to an HTTPS origin or
 * localhost: on a plain-HTTP LAN install no browser sends it, and this check
 * does nothing there. What else sends none is curl, Playwright's `request`
 * fixture, a native client and an older browser, none of which a forging page
 * can make another person's browser be. Those requests are left to the
 * defences they always had: the session cookie's SameSite=Lax and the
 * JSON-only rule below, which is what protects a plain-HTTP install.
 *
 * **`Origin` is not compared with `NEXTAUTH_URL`.** A plain-HTTP LAN install
 * is reached as an address the configured URL does not name, and a strict
 * comparison would lock it out on upgrade for no gain over this header.
 */
function refuseCrossSite(req: Request): Response | null {
  const site = req.headers.get("sec-fetch-site");
  if (site === null || OWN_FETCH_SITES.has(site.trim().toLowerCase())) return null;

  logSecurityEvent("access.denied", {
    reason: "cross-site",
    code: "FORBIDDEN",
    // Both caller-supplied: bounded, so a refusal cannot be a long line.
    fetchSite: site.slice(0, 32),
    path: new URL(req.url).pathname.replace(/^\/api\/trpc\/?/, "").slice(0, 200),
    address: rateLimitIdentifier(req.headers),
  });
  return refusal(403, "Cross-site requests are refused");
}

/**
 * 415 for a body that is not `application/json`.
 *
 * tRPC itself also accepts `multipart/form-data` and
 * `application/octet-stream` on POST, and runs a mutation with whatever they
 * carry. Nothing in this application sends either — both links send JSON, and
 * a receipt photograph travels base64'd inside it — while a plain HTML form
 * can send multipart with no CORS preflight. A mutation that takes no input
 * therefore ran on a form post from any page that could get the cookie sent:
 * a sibling subdomain, which SameSite=Lax does not stop. `application/json` is
 * not a type a form can send, so a page on another origin cannot send it
 * without a preflight this application never answers.
 */
function refuseNonJson(req: Request): Response | null {
  if (req.method === "GET" || req.method === "HEAD") return null;

  const type = req.headers.get("content-type");
  const mediaType = type?.split(";")[0].trim().toLowerCase();
  if (mediaType === "application/json") return null;

  return refusal(415, "Only application/json is accepted");
}

function refusal(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
