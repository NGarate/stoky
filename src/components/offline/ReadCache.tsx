"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useComposer } from "./Composer";
import { persistOptions, restoreThenRefresh } from "@/lib/offline/persist";
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
 *
 * **A restored answer is shown, never trusted.** The restore carries each
 * query's original `dataUpdatedAt`, and the client's `staleTime` is 30
 * seconds — so anything cached within the last half minute comes back looking
 * *fresh*, and TanStack Query does the correct thing for fresh data, which is
 * not to ask. That is the wrong correct thing here: this cache exists so a
 * screen opened with no signal shows what was last seen, and it must never
 * become a reason not to ask when there is signal.
 *
 * The failure it produced is worth keeping, because nothing about it looked
 * like a cache: two items were added to a shopping list, the queue drained,
 * the database had both — and a reload rendered "Lista vacía". The list on
 * screen was a copy of the server from before the adds, twenty seconds old and
 * therefore "fresh".
 *
 * So the restore is followed by an invalidation. Mounted queries refetch and
 * the screen corrects itself; with no signal the refetch pauses and the
 * restored answer stays up, which is exactly what it is for. This was a race
 * before Partial Prerendering and a certainty after it — a shell that renders
 * instantly lands the restore before the screen's own query has gone out — so
 * it is written down as a defect that timing merely revealed.
 */
export function ReadCache(): JSX.Element | null {
  const { userId } = useComposer();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const [unsubscribe] = restoreThenRefresh(
      queryClient,
      persistOptions(userId),
    );

    return unsubscribe;
  }, [queryClient, userId]);

  return null;
}
