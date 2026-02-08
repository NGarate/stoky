"use client";

import { api, TRPCProvider as TRPCClientProvider } from "@/lib/trpc/client";

export { api };
export const TRPCProvider = TRPCClientProvider;
