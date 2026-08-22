import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import SuperJSON from "superjson";
import type { Query, QueryClient } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";

/**
 * Keeping the last thing each screen showed, so opening the app without a
 * signal shows real data instead of "nothing saved yet".
 *
 * The write queue made a shop *composable* offline. This makes it *openable*:
 * before it, a phone taken out of a pocket in a basement showed the
 * paused-state panel on every screen, which is honest and useless.
 *
 * **Scoped to the account**, which is why this is set up inside the dashboard
 * rather than in the root provider. A shared kitchen tablet must not restore
 * one person's inventory under the next person's session, and the root layout
 * has never known who is signed in — the dashboard layout is the only place
 * that awaits `auth()`.
 *
 * The cost of that choice, stated: restoration happens after the first render
 * rather than before it, so a screen opened offline shows the "nothing saved"
 * panel for a moment before the cache arrives. Gating the first render on
 * restoration would mean persisting at the root, keyed by nobody.
 */

/**
 * Bump when a persisted query's *shape* changes.
 *
 * A deploy that changes what `getBuyList` returns leaves every device holding
 * a cache that is confidently wrong, and nothing about it looks stale. There
 * is no build id available to the client here that changes only when it should
 * — Next's `buildId` changes on every build, which would throw the cache away
 * on deploys that did not need it.
 */
// Bumped to 2 when `getStockOverview` stopped returning `nextCursor` and
// `stockEntries` and started returning `total`. A device restoring the older
// shape would hand the inventory page rows with no total to page by.
// 3 when `onListQuantity` joined the row. A commit-18-era cache has no such
// field, and `left + undefined < min` is `NaN < min`, which is false — so the
// kitchen's button would silently vanish for everyone holding one.
export const CACHE_VERSION = "3";

/**
 * The queries worth keeping between visits.
 *
 * Not everything: a cache is a copy of household data sitting on a device, so
 * the list is what a screen genuinely needs before it can show anything, and
 * nothing else. Receipts and prices are left out — they are not what somebody
 * opens the app in a shop or a kitchen to see.
 */
export const PERSISTED_QUERIES = new Set([
  "shopping.getBuyList",
  "shopping.getById",
  "shopping.list",
  "inventory.getStockOverview",
  "inventory.getExpiringItems",
  "product.list",
]);

/** The tRPC path a query key names, or null if it is not a tRPC query. */
export function queryPathOf(queryKey: readonly unknown[]): string | null {
  const head = queryKey[0];
  if (!Array.isArray(head)) return null;
  if (!head.every((part) => typeof part === "string")) return null;
  return head.join(".");
}

export function shouldPersist(query: Query): boolean {
  const path = queryPathOf(query.queryKey);
  return path !== null && PERSISTED_QUERIES.has(path);
}

/** One key per account. A shared tablet must not restore the wrong household. */
export function persistKey(userId: string): string {
  return `stoky.reads.v1.${userId}`;
}

/**
 * A persister over `localStorage`.
 *
 * `localStorage` rather than IndexedDB, for the reason the queue chose it:
 * happy-dom has no `indexedDB`, so an IndexedDB persister could not be
 * exercised below the browser tier at all. **What would reverse it** is size —
 * the whole origin gets about 5 MB and this shares it with the queue, so a
 * household large enough to approach that needs IndexedDB and an async
 * persister. `createSyncStoragePersister` throws nothing on a failed write; it
 * reports through `onError`, and a cache that cannot be written is a slower
 * app rather than a broken one.
 *
 * **SuperJSON, not `JSON`**, for the reason the queue needs it too: `Date`
 * crosses this boundary — `getExpiringItems` returns them — and plain JSON
 * turns them into strings, so a restored cache would hand components a string
 * where they expect a date and break on the first `.getTime()`.
 */
export interface PersistSeams {
  storage?: Storage | null;
  /**
   * How long writes are batched for.
   *
   * A second in the browser, because a screen settling fires several cache
   * changes and each one would otherwise serialise the whole allowlist
   * synchronously on the main thread. Zero in tests, so a save is observable
   * without waiting on a timer — an injected seam rather than a sleep, for the
   * reason STATUS.md trap 7 gives.
   */
  throttleTime?: number;
}

function defaultStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function createReadPersister(
  userId: string,
  seams: PersistSeams = {},
): Persister {
  return createSyncStoragePersister({
    key: persistKey(userId),
    storage: seams.storage === undefined ? defaultStorage() : seams.storage,
    throttleTime: seams.throttleTime ?? 1000,
    serialize: (client) => SuperJSON.stringify(client),
    deserialize: (cached) => SuperJSON.parse(cached),
  });
}

/** Forget one account's cached reads. Sign-out, and change of account. */
export function forgetPersistedReads(
  userId: string,
  storage: Storage | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(persistKey(userId));
  } catch {
    // Nothing depends on this having worked; the cache expires anyway.
  }
}

/** How long a restored answer is worth showing. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function persistOptions(userId: string, seams: PersistSeams = {}) {
  return {
    persister: createReadPersister(userId, seams),
    maxAge: MAX_AGE_MS,
    buster: `${CACHE_VERSION}:${userId}`,
    dehydrateOptions: {
      shouldDehydrateQuery: shouldPersist,
      /**
       * **Never persist mutations**, and this is not a preference.
       *
       * query-core's default is `mutation.state.isPaused`, and `networkMode`
       * is `"online"` — so a mutation fired with no signal is *paused*, not
       * failed. Persisting one means `resumePausedMutations` replays it on the
       * next visit, giving every offline write a second, uncontrolled path to
       * the server racing the queue's drain. The idempotency key would contain
       * the damage; the second path would still be untested, and nothing on
       * screen would know about it.
       */
      shouldDehydrateMutation: () => false,
    },
  } satisfies {
    persister: Persister;
    maxAge: number;
    buster: string;
    dehydrateOptions: {
      shouldDehydrateQuery: (query: Query) => boolean;
      shouldDehydrateMutation: () => boolean;
    };
  };
}

export type { QueryClient };
