import {
  httpLink,
  loggerLink,
  splitLink,
  unstable_httpBatchStreamLink,
  type TRPCLink,
} from "@trpc/client";
import SuperJSON from "@/lib/superjson";
import { MAX_TRPC_BATCH_SIZE } from "@/lib/trpc/batch";
import type { AppRouter } from "@/server/trpc/router";

/**
 * The procedures whose answer sets a cookie, and so must not be streamed.
 *
 * `auth.changePassword` rotates this device's session (PROGRESS D144): Better
 * Auth sets the new cookie while the resolver runs. A streamed answer has
 * already sent its headers by then — tRPC writes them as soon as the batch
 * starts, before any procedure has finished — so the cookie would never
 * leave, and the browser would go on presenting the token whose row the
 * change just deleted: signed out, by the change meant to keep it in. A plain
 * `httpLink` request is answered whole, headers after the resolver.
 */
export const UNSTREAMED_PATHS: ReadonlySet<string> = new Set([
  "auth.changePassword",
]);

export interface LinkOptions {
  /** Where tRPC is served: `/api/trpc`, absolute on the server. */
  url: string;
  /** For tests; the browser's own `fetch` otherwise. */
  fetch?: typeof fetch;
}

/**
 * The browser client's links, in one place so a test can build them.
 *
 * Every call but the ones above goes through the streaming batch link, split
 * at the size the server accepts (`src/lib/trpc/batch.ts`). The two send the
 * same transformer and the same headers, so the server cannot tell them apart
 * except by the batching.
 */
export function trpcLinks({ url, fetch }: LinkOptions): TRPCLink<AppRouter>[] {
  const headers = () => ({ "x-trpc-source": "react" });
  return [
    loggerLink({
      enabled: (op) => {
        if (process.env.NODE_ENV === "development") return true;
        if (op.direction === "down" && op.result instanceof Error) return true;
        return false;
      },
    }),
    splitLink({
      condition: (op) => UNSTREAMED_PATHS.has(op.path),
      true: httpLink({ transformer: SuperJSON, url, headers, fetch }),
      false: unstable_httpBatchStreamLink({
        transformer: SuperJSON,
        url,
        // The server refuses a longer batch outright; this splits one into
        // several requests first (`src/lib/trpc/batch.ts`).
        maxItems: MAX_TRPC_BATCH_SIZE,
        headers,
        fetch,
      }),
    }),
  ];
}
