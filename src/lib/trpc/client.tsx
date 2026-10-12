"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  TRPCClientError,
  loggerLink,
  unstable_httpBatchStreamLink,
} from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState } from "react";
import SuperJSON from "superjson";
import { seedOnlineManager } from "@/lib/offline/onlineManager";
import { MAX_TRPC_BATCH_SIZE } from "@/lib/trpc/batch";
import type { AppRouter } from "@/server/trpc/router";

export const api = createTRPCReact<AppRouter>();

function getUrl() {
  const base =
    typeof window !== "undefined"
      ? ""
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
  return `${base}/api/trpc`;
}

/**
 * Seeded at module scope, before any query client exists.
 *
 * `onlineManager` is a module singleton, so this has to run once and early —
 * an effect would leave the first render of the first screen answering from a
 * guess. It is a no-op on the server, which is where module scope would
 * otherwise be a hazard.
 */
seedOnlineManager();

export function TRPCProvider(
  props: Readonly<{ children: React.ReactNode }>,
) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            /**
             * Do not retry what the server has already answered definitively.
             *
             * The default is three retries with backoff, which is right for a
             * dropped connection and wrong for every refusal: an account with
             * no household would sit on a skeleton for about seven seconds
             * before being told it can create one, and a KITCHEN account would
             * spend four requests being refused four times. Retrying a
             * FORBIDDEN also means a control that cannot work hammers the
             * server on every render.
             *
             * 5xx and transport failures still retry, twice.
             */
            retry: (failureCount, error) => {
              if (error instanceof TRPCClientError) {
                const status = error.data?.httpStatus;
                if (typeof status === "number" && status >= 400 && status < 500) {
                  return false;
                }
              }
              return failureCount < 2;
            },
            /**
             * Explicit, and the alternative is worse than it looks.
             *
             * `"online"` is the default, but stating it here is the difference
             * between a screen that shows "nothing saved yet" and one that
             * shows a failure: a paused query reports `fetchStatus: "paused"`,
             * which `RouteState` has a branch for. `"always"` would fire three
             * doomed requests per query per mount against the predicate above
             * and land every screen in `error` instead.
             */
            networkMode: "online",
            refetchOnReconnect: true,
          },
          mutations: {
            // The same, for the same reason. A mutation fired with no signal
            // must not burn attempts against a server it cannot reach — the
            // queue owns retrying, and it knows what a refusal means.
            networkMode: "online",
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) => {
            if (process.env.NODE_ENV === "development") return true;
            if (op.direction === "down" && op.result instanceof Error) return true;
            return false;
          },
        }),
        unstable_httpBatchStreamLink({
          transformer: SuperJSON,
          url: getUrl(),
          // The server refuses a longer batch outright; this splits one into
          // several requests first (`src/lib/trpc/batch.ts`).
          maxItems: MAX_TRPC_BATCH_SIZE,
          headers() {
            return {
              "x-trpc-source": "react",
            };
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  );
}