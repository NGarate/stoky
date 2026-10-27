import SuperJSON from "@/lib/superjson";

/**
 * Where unsent changes live between one visit and the next.
 *
 * **`localStorage`, not IndexedDB**, and the reason is testability rather than
 * taste. The runner here is Bun with happy-dom, and happy-dom has no
 * `indexedDB` at all — an IndexedDB queue's default binding could not be
 * exercised below the browser tier, so proving it would mean a new dependency
 * and a test of "our code works against a JS reimplementation of the spec".
 * `localStorage` is there, and the state machine on top is pure either way
 * because the `Storage` is injected.
 *
 * The sizing says this is not a close call: a measured full shop is tens of
 * kilobytes against a 5 MB budget.
 *
 * **What would reverse it:** anything binary entering the queue. A queued
 * receipt image would blow the budget immediately, and `localStorage` is
 * synchronous, so writing one would block the main thread on a phone. That is
 * why `receipt.upload` is not replayable, and there is a test in
 * `replayable.test.ts` that keeps it that way.
 *
 * **SuperJSON, not `JSON`.** `stockEntrySchema.expirationDate` is `z.date()`,
 * and `JSON.parse(JSON.stringify(new Date()))` is a string. A queue that
 * round-tripped through plain JSON would send a string to a `z.date()` and
 * earn a 400 manufactured by its own storage layer — visible only for products
 * with an expiry, and only after a reload.
 */

/** One key per account. A shared tablet must not mix two people's changes. */
export function queueKey(userId: string): string {
  return `stoky.queue.v1.${userId}`;
}

/**
 * The write budget for one account's queue.
 *
 * Well inside `localStorage`'s 5 MB, because the budget is not really about
 * space: it is the point at which refusing a new change is kinder than
 * accepting one that cannot be stored.
 */
export const MAX_BYTES = 256 * 1024;

export interface QueueStorage {
  read(userId: string): unknown;
  write(userId: string, value: unknown): boolean;
  clear(userId: string): void;
}

/** The browser's own storage, or null when there is none (SSR, or blocked). */
function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Reading `localStorage` throws outright in some privacy modes.
    return null;
  }
}

/**
 * A `QueueStorage` over a `Storage`.
 *
 * Every failure is swallowed and reported as "not stored" rather than thrown.
 * A queue whose persistence fails should degrade to an in-memory queue that
 * loses work on reload — bad — rather than throwing inside a click handler and
 * losing the change immediately, which is worse and looks like a broken app.
 */
export function createQueueStorage(
  backing: Storage | null = defaultStorage(),
): QueueStorage {
  return {
    read(userId) {
      if (!backing) return null;
      try {
        const raw = backing.getItem(queueKey(userId));
        return raw === null ? null : SuperJSON.parse(raw);
      } catch {
        // Corrupt or written by an older shape. Losing an unreadable queue is
        // better than refusing to start.
        return null;
      }
    },

    write(userId, value) {
      if (!backing) return false;
      let raw: string;
      try {
        raw = SuperJSON.stringify(value);
      } catch {
        return false;
      }

      // Checked before writing, because the browser's own quota error arrives
      // too late to tell the caller which change to refuse.
      if (raw.length > MAX_BYTES) return false;

      try {
        backing.setItem(queueKey(userId), raw);
        return true;
      } catch {
        return false;
      }
    },

    clear(userId) {
      if (!backing) return;
      try {
        backing.removeItem(queueKey(userId));
      } catch {
        // Nothing useful to do, and nothing depends on it having worked.
      }
    },
  };
}

/** An in-memory `QueueStorage`, for tests and for a browser that has none. */
export function createMemoryStorage(): QueueStorage {
  const store = new Map<string, string>();
  return {
    read(userId) {
      const raw = store.get(queueKey(userId));
      return raw === undefined ? null : SuperJSON.parse(raw);
    },
    write(userId, value) {
      const raw = SuperJSON.stringify(value);
      if (raw.length > MAX_BYTES) return false;
      store.set(queueKey(userId), raw);
      return true;
    },
    clear(userId) {
      store.delete(queueKey(userId));
    },
  };
}
