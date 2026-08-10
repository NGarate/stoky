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