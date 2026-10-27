import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import SuperJSON from "@/lib/superjson";
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
// Stock amounts now use individual units for dozens, and batch remainders
// can be unknown. Old persisted query results cannot describe this schema.
// 5 when quantities and money became `Decimal`: a cache from before holds
// plain numbers, and a component calling `.toNumber()` on one throws.
export const CACHE_VERSION = "5";

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
  // Its neighbour on every screen that shows expiry. Left out, the dashboard
  // and the inventory's expiry block had one answer offline and not the other,
  // and could not say whether anything had gone off.
  "inventory.getExpiredItems",
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

const READS_PREFIX = "stoky.reads.v1.";

/** One key per account. A shared tablet must not restore the wrong household. */
export function persistKey(userId: string): string {
  return `${READS_PREFIX}${userId}`;
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

/**
 * Keys forgotten since their persister was made.
 *
 * The persister's writes are throttled: a save queued just before sign-out
 * lands up to `throttleTime` later, *after* `forgetPersistedReads` removed the
 * key and after the subscription was dropped — unsubscribing stops new saves,
 * not the one already on a timer. Without this the account that just left
 * had its cached reads put back on the device a moment after it was told they
 * were gone.
 *
 * Module state, which dies with the page, and so does any timer it guards.
 */
const forgotten = new Set<string>();

/**
 * The account this device's shell was last opened for, written by
 * `ShellCacheGuard`: set on the way into the dashboard, removed at `/login`.
 */
export const SHELL_USER_KEY = "stoky.shell.user";

/**
 * A storage whose writes are dropped once the account has left the device.
 *
 * Two ways to have left, because `forgotten` is one tab's memory: a sign-out
 * in this tab, and the shell's owner key no longer naming this account — set
 * by another tab's sign-out or sign-in. Without the second, a tab still open
 * on the departed account refetched on focus, kept its data through the 401,
 * and wrote it back under that account until someone next reached `/login`.
 */
function refusingDeparted(
  storage: Storage | null,
  userId: string,
): Storage | null {
  if (storage === null) return null;
  return {
    getItem: (key: string) => storage.getItem(key),
    removeItem: (key: string) => storage.removeItem(key),
    setItem: (key: string, value: string) => {
      if (forgotten.has(key)) return;
      if (storage.getItem(SHELL_USER_KEY) !== userId) return;
      storage.setItem(key, value);
    },
  } as Storage;
}

export function createReadPersister(
  userId: string,
  seams: PersistSeams = {},
): Persister {
  // A new persister is the account signing in again; its writes are wanted.
  forgotten.delete(persistKey(userId));
  return createSyncStoragePersister({
    key: persistKey(userId),
    storage: refusingDeparted(
      seams.storage === undefined ? defaultStorage() : seams.storage,
      userId,
    ),
    throttleTime: seams.throttleTime ?? 1000,
    serialize: (client) => SuperJSON.stringify(client),
    deserialize: (cached) => SuperJSON.parse(cached),
  });
}

/** Forget one account's cached reads. Sign-out, `/login`, and change of account. */
export function forgetPersistedReads(
  userId: string,
  storage: Storage | null = defaultStorage(),
): void {
  forgotten.add(persistKey(userId));
  try {
    storage?.removeItem(persistKey(userId));
  } catch {
    // Nothing depends on this having worked; the cache expires anyway.
  }
}

/**
 * Forget every account's cached reads except `keep`'s — all of them for `null`.
 *
 * Forgetting only the account recorded as the last one here is not enough on
 * a device that already holds others: until the security review of 2026-10-12
 * nothing but an explicit sign-out removed a copy, so an install updated after
 * an account's session expired, or after a change of account, still holds that
 * account's copy under a key nobody remembers. A browser holds one session at
 * a time, so no other account's copy can be restored without that account
 * signing in — which is online, and refetches anyway — and the sweep costs no
 * offline open anything.
 *
 * Keys are collected before any is removed: removing while walking
 * `storage.key(i)` shifts the indices under the walk and skips every other one.
 */
export function forgetPersistedReadsExcept(
  keep: string | null,
  storage: Storage | null = defaultStorage(),
): void {
  if (storage === null) return;
  const others: string[] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key === null || !key.startsWith(READS_PREFIX)) continue;
      const userId = key.slice(READS_PREFIX.length);
      if (userId !== keep) others.push(userId);
    }
  } catch {
    // A storage that refuses to be listed cannot be swept; like the single
    // forget, this is best effort and nothing depends on it having worked.
    return;
  }
  for (const userId of others) forgetPersistedReads(userId, storage);
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

/**
 * Restore the device's copy, then ask the server anyway.
 *
 * The restore carries each query's original `dataUpdatedAt`, and the client's
 * `staleTime` is 30 seconds — so anything cached in the last half minute comes
 * back looking *fresh*, and TanStack Query does the right thing for fresh data,
 * which is not to ask. That is the wrong right thing here: this cache exists so
 * a screen opened with no signal shows what was last seen, and it must never
 * become a reason not to ask when there is signal.
 *
 * The failure it produced looked nothing like a cache: two items were added to
 * a shopping list, the queue drained, the database held both — and a reload
 * rendered "Lista vacía". What was on screen was a copy of the server from
 * before the adds, twenty seconds old and therefore "fresh".
 *
 * Invalidating after the restore keeps both halves. The cached answer paints
 * immediately, mounted queries refetch and correct it, and with no signal the
 * refetch pauses and the restored answer simply stays — which is the whole
 * point of having it.
 *
 * Shaped like `persistQueryClient`: the unsubscribe first, because it must
 * reach the caller synchronously — an account change has to stop the previous
 * account's writer before the next one's starts — and a promise second, which
 * settles once the restore *and* the invalidation have both happened. Nothing
 * in the application awaits it; it exists so a test can assert on the state
 * afterwards rather than sleeping and hoping.
 */
export function restoreThenRefresh(
  queryClient: QueryClient,
  options: ReturnType<typeof persistOptions>,
): [() => void, Promise<void>] {
  const [unsubscribe, restored] = persistQueryClient({
    queryClient,
    ...options,
  });

  const ready = restored.then(async () => {
    await queryClient.invalidateQueries();
  });

  return [unsubscribe, ready];
}

export type { QueryClient };
