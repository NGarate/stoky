"use client";

import { useQueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { useEffect } from "react";
import { useComposer } from "./Composer";
import { forgetPersistedReads, persistOptions } from "@/lib/offline/persist";
import type { JSX } from "react";

/**
 * Keeps the last answer each screen showed, scoped to the account.
 *
 * Mounted inside the dashboard rather than at the root, because the root has
 * never known who is signed in and a shared tablet must not restore one
 * person's household under the next person's session.
 *
 * `persistQueryClient` returns an unsubscribe, which is called when the
 * account changes — so the previous account's cache stops being written to
 * before the next one's starts.
 */
export function ReadCache(): JSX.Element | null {
  const { userId } = useComposer();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const [unsubscribe] = persistQueryClient({
      queryClient,
      ...persistOptions(userId),
    });

    return unsubscribe;
  }, [queryClient, userId]);

  return null;
}

export { forgetPersistedReads };
