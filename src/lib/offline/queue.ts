import { createStore, type StoreApi } from "zustand/vanilla";
import { newOpId } from "./ids";
import { backoffDelay } from "./backoff";
import {
  MAX_ATTEMPTS,
  classifyMutationError,
  receivedResponse,
} from "./classify";
import { createQueueStorage, type QueueStorage } from "./storage";

/**
 * The queue of changes made without a signal.
 *
 * **A `zustand` store rather than React state**, and `REDESIGN_PLAN.md` §5.7
 * states the case: this is read by four unrelated surfaces, written from
 * outside React by the `online` event, a backoff timer and another tab, and it
 * outlives every component that reads it. A context would re-render every
 * consumer on every change to any entry.
 *
 * It is `zustand/vanilla` rather than the React binding, which buys the thing
 * that matters for testing: the whole state machine below runs with no DOM and
 * no renderer, so it is tested at the static tier in milliseconds instead of
 * through a component. The React binding is one `useStore` call in the
 * provider.
 *
 * **Persist, then attempt, then persist.** Never send first. A change that was
 * sent but not recorded is a change that gets sent again on reload with a new
 * key — which is a double-apply the idempotency work cannot catch, because the
 * two carry different keys.
 */

/** The procedures a queued shop can carry. */
export type ReplayablePath =
  | "shopping.addItem"
  | "shopping.updateItem"
  | "shopping.removeItem"
  | "inventory.addStock"
  | "inventory.consumeStock"
  | "product.resolveScan";

/**
 * What the interface calls a change, as a catalogue key and its values.
 *
 * **Never a rendered sentence.** A queue composed in Spanish and reviewed after
 * a language switch would otherwise read half in each, and §5.6's rule is that
 * no string lands in a component — which includes strings that land in storage
 * on their way to one.
 */
export interface OpLabel {
  key: string;
  values?: Record<string, string | number>;
}

export interface QueuedOp {
  /** The idempotency key. Minted once, kept across every attempt. */
  id: string;
  path: ReplayablePath;
  /** The procedure input, without the envelope. */
  input: Record<string, unknown>;
  /** The household in force when this was composed. */
  householdId: string;
  label: OpLabel;
  createdAt: Date;
  /** Attempts that reached a server. Transport failures are not strikes. */
  attempts: number;
  /**
   * The undo window: not eligible to send until this many milliseconds after
   * `createdAt`. This is what the kitchen's «Deshacer» stands on — undo means
   * cancelling the queued change (D57), which is only an affordance while the
   * change is still queued, and an immediate drain empties the queue in one
   * round-trip. Measured from `createdAt`, so a change restored from storage
   * after a reload owes no second wait.
   *
   * Without the hold, "while it is still in the queue" was one network
   * round-trip online — the undo flashed for a single render and was gone,
   * which is no undo at all. How long it is follows the person's snackbar
   * preference: `undoHoldMs()` in `src/lib/snackbar-duration.ts`.
   */
  holdMs?: number;
}

/**
 * Why a change is not going to be sent again.
 *
 * `needs-reconciliation` is not a failure. Stock has a floor, so two people who
 * each use the last unit cannot both be right — but the second one *did* take
 * the milk, and only a person who can see the shelf knows what is actually
 * there. §5.5.3: allow and reconcile, never discard.
 *
 * `needs-review` is the same shape for T7: a barcode scanned offline that Open
 * Food Facts cannot name is not a failed scan, it is one waiting for a person
 * to name it. Both sit in `failed` because the drain is done with them, and
 * both are surfaced as a question rather than an error.
 */
export type FailureReason =
  | "needs-reconciliation"
  | "needs-review"
  | "wrong-household"
  | "refused"
  | "gone"
  | "invalid"
  | "exhausted";

export interface FailedOp extends QueuedOp {
  reason: FailureReason;
}

export interface QueueState {
  pending: QueuedOp[];
  failed: FailedOp[];
  /** `needs-signin` stops the drain and keeps everything. */
  status: "idle" | "sending" | "needs-signin";
  /** Set when the last enqueue was refused for want of room. */
  full: boolean;
  /**
   * Whether what is on the device has been read yet.
   *
   * The store starts empty and `hydrate()` fills it, which happens in an
   * effect — so for the first paint an unread queue and an empty one are the
   * same object. Everything downstream then says "all saved", because that is
   * what no pending changes means. It is the wrong answer rather than an early
   * one: somebody who has three unsent changes is told, briefly, that they have
   * none.
   *
   * Consumers that report the queue's state to a person must say nothing until
   * this is true. It is also the only honest signal a test has for "the client
   * is live", which matters more under a streamed shell: quiet, painted and
   * hydrated stop coinciding.
   */
  hydrated: boolean;
}

export interface EnqueueInput {
  path: ReplayablePath;
  input: Record<string, unknown>;
  label: OpLabel;
  /** See {@link QueuedOp.holdMs}. Omitted means eligible immediately. */
  holdMs?: number;
}

export type EnqueueResult =
  | { ok: true; id: string }
  | { ok: false; reason: "full" };

/** Sends one operation. Rejects with whatever the transport produced. */
export type SendOperation = (op: QueuedOp) => Promise<unknown>;

export interface WriteQueueOptions {
  userId: string;
  householdId: string;
  send: SendOperation;
  storage?: QueueStorage;
  now?: () => Date;
  random?: () => number;
}

export interface WriteQueue {
  store: StoreApi<QueueState>;
  /** Load what is on the device. Call once, after mount. */
  hydrate(): void;
  getState(): QueueState;
  subscribe(listener: (state: QueueState) => void): () => void;
  enqueue(op: EnqueueInput): EnqueueResult;
  /**
   * Send what can be sent, in order. Resolves with **how many changes this
   * drain sent** — zero when another drain was already running, when the
   * session has expired, or when the head is still held.
   *
   * The count is what tells the caller whether the server changed. Comparing
   * the pending length before and after could not: one change sent and
   * another queued meanwhile leaves the length where it was.
   */
  drain(): Promise<number>;
  /**
   * Take back a change that has not been sent yet.
   *
   * This is what undo means for a stock movement. Writing a compensating
   * `addStock` would record that the household *acquired* something it never
   * did — a fabricated event indistinguishable from a real one to everything
   * downstream. Removing the queued row leaves no trace because nothing
   * happened.
   *
   * Returns false when it is too late: the change has already been sent, or is
   * being sent right now.
   */
  cancel(id: string): boolean;

  /**
   * How long this change can still be taken back, in milliseconds.
   *
   * Zero for anything that cannot: a change with no hold, one whose window
   * has closed, one already in flight, one that was never here. The caller
   * therefore needs no second question — a positive number means `cancel`
   * would work now and for that long, which is exactly what an undo
   * affordance must know before it offers itself.
   *
   * `nextDelayMs` answers a neighbouring question and cannot serve this one:
   * it looks only at the head, because it exists to tell the drain timer when
   * to wake. A held change sitting second in the queue is undoable and is not
   * the head.
   */
  holdRemainingMs(id: string): number;

  /** Put a failed change back at the tail, with its strikes cleared. */
  retry(id: string): void;
  /**
   * Give up on a failed change deliberately.
   *
   * Returns what it removed — `null` when it held nothing by that id — so
   * the discard can be undone with `restore` (§7 rule 3: undo, not confirm).
   */
  discard(id: string): FailedOp | null;
  /**
   * Put a discarded change back, as it was and where it was: same id, same
   * reason, same place in the list. A no-op when it is already back.
   */
  restore(op: FailedOp): void;
  /** Sign-out: this account's changes leave the device. */
  purgeAll(): void;
  /**
   * The household changes are composed in, as the server now reports it.
   *
   * The queue was opened with the household in the session token, and a
   * token is not refreshed when the account creates or joins a household
   * mid-session. An account that created its household this session stamped
   * every change with "" — and after signing in again, with the real
   * household in the token, every one of them was refused as
   * "wrong-household", for ever.
   *
   * Those changes are bound here, to the first household the client learns
   * of, and persisted that way. "" is not a wildcard: the server derives the
   * household from the session at send time, so a blank change still queued
   * after the account had left that household and joined another would have
   * been written into the second.
   */
  setHousehold(id: string): void;
  /** How long to wait before the next attempt, or null when there is nothing. */
  nextDelayMs(): number | null;
}

const EMPTY: QueueState = {
  pending: [],
  failed: [],
  status: "idle",
  full: false,
  hydrated: false,
};

/** Only the parts worth keeping between visits. `status` is per-session. */
interface PersistedQueue {
  pending: QueuedOp[];
  failed: FailedOp[];
}

function isPersisted(value: unknown): value is PersistedQueue {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as PersistedQueue).pending) &&
    Array.isArray((value as PersistedQueue).failed)
  );
}

/** How many unsent changes one account may hold before new ones are refused. */
export const MAX_PENDING = 200;

/** Map a send failure to why the change is not going to be sent again. */
function reasonFor(error: unknown, path: ReplayablePath): FailureReason | null {
  switch (classifyMutationError(error, path)) {
    case "reconcile":
      return "needs-reconciliation";
    case "review":
      return "needs-review";
    case "permanent":
      return "refused";
    default:
      return null;
  }
}

export function openWriteQueue(options: WriteQueueOptions): WriteQueue {
  const {
    userId,
    send,
    storage = createQueueStorage(),
    now = () => new Date(),
    random = Math.random,
  } = options;

  /** See {@link WriteQueue.setHousehold}. */
  let householdId = options.householdId;

  /**
   * The store starts **empty**, and storage is read by `hydrate()`.
   *
   * Reading at construction is what a first version did, and it produced a
   * hydration mismatch that only a browser found: the server renders a queue
   * it cannot see (there is no `localStorage` there) and the client renders
   * one restored from disk, so React discards the tree and warns. Starting
   * empty makes the two agree, and the queue fills a tick later.
   */
  const store = createStore<QueueState>(() => ({ ...EMPTY }));

  function persist(state: QueueState): void {
    storage.write(userId, { pending: state.pending, failed: state.failed });
  }

  /** Every state change goes through here, so nothing can skip persistence. */
  function commit(next: (state: QueueState) => QueueState): void {
    const updated = next(store.getState());
    store.setState(updated, true);
    persist(updated);
  }

  /**
   * Move the head to `failed`, keeping its place in the record.
   *
   * The head advances on the same tick, which is what stops one refused change
   * blocking every change behind it — and it is *named* rather than dropped,
   * because the person made it and deserves to know it did not stick.
   */
  function failHead(op: QueuedOp, reason: FailureReason): void {
    commit((state) => ({
      ...state,
      pending: state.pending.filter((entry) => entry.id !== op.id),
      failed: [...state.failed, { ...op, reason }],
    }));
  }

  /**
   * Stamp the changes composed before any household was known with the one
   * that now is. A no-op, and no write, until there is one — or nothing to
   * stamp. See {@link WriteQueue.setHousehold}.
   */
  function bindUnstamped(): void {
    if (householdId === "") return;
    const state = store.getState();
    const blank = (op: QueuedOp) => op.householdId === "";
    if (!state.pending.some(blank) && !state.failed.some(blank)) return;

    const bind = <T extends QueuedOp>(op: T): T =>
      op.householdId === "" ? { ...op, householdId } : op;
    commit((current) => ({
      ...current,
      pending: current.pending.map(bind),
      failed: current.failed.map(bind),
    }));
  }

  let draining = false;
  /** The operation currently in flight, which cannot be taken back. */
  let inFlightId: string | null = null;
  /**
   * Where each discarded change stood in `failed`, so an undo puts it back in
   * its place rather than at the end of a list somebody is reading. Memory
   * only: an undo does not outlive the snackbar that offers it.
   */
  const discardedAt = new Map<string, number>();

  /** How much of the undo window is still open. Zero for a change without one. */
  function holdRemainingMs(op: QueuedOp): number {
    if (!op.holdMs) return 0;
    return Math.max(0, op.createdAt.getTime() + op.holdMs - now().getTime());
  }

  let hydrated = false;

  /**
   * Load what is on the device, once.
   *
   * Called from `enqueue` as well as from the provider's mount effect, and
   * that is not belt and braces: the first write persists the *whole* state,
   * so enqueueing before reading would overwrite the stored queue with a
   * fresh one holding a single change. Reading first makes the order the
   * caller happens to use irrelevant.
   */
  function hydrateOnce(): void {
    if (hydrated) return;
    hydrated = true;

    const restored = storage.read(userId);

    // The flag is set even when there was nothing to restore, and that is the
    // whole point: "read it, and it was empty" is a different claim from "have
    // not read it", and only the first one licenses saying everything is saved.
    if (!isPersisted(restored)) {
      store.setState((state) => ({ ...state, hydrated: true }), true);
      return;
    }

    // Merged rather than replaced, so a change made in between survives.
    store.setState(
      (state) => ({
        ...state,
        pending: [...restored.pending, ...state.pending],
        failed: [...restored.failed, ...state.failed],
        hydrated: true,
      }),
      true,
    );
    bindUnstamped();
  }

  return {
    store,
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
    hydrate: hydrateOnce,

    enqueue({ path, input, label, holdMs }) {
      hydrateOnce();
      const state = store.getState();

      if (state.pending.length >= MAX_PENDING) {
        // Refuse the newest rather than evicting the oldest: the oldest is the
        // one that has been waiting, and dropping it silently is the failure
        // the whole queue exists to prevent.
        commit((current) => ({ ...current, full: true }));
        return { ok: false, reason: "full" };
      }

      const op: QueuedOp = {
        id: newOpId(),
        path,
        input,
        householdId,
        label,
        createdAt: now(),
        attempts: 0,
        ...(holdMs !== undefined && { holdMs }),
      };

      commit((current) => ({
        ...current,
        pending: [...current.pending, op],
        full: false,
      }));

      return { ok: true, id: op.id };
    },

    async drain() {
      if (draining) return 0;
      if (store.getState().status === "needs-signin") return 0;
      if (store.getState().pending.length === 0) return 0;

      draining = true;
      let sent = 0;
      commit((state) => ({ ...state, status: "sending" }));

      try {
        // One at a time, in order. `consumeStock` refuses when the quantity
        // exceeds what is available, and what is available depends on the
        // queued writes in front of it — so order is correctness, not tidiness.
        while (store.getState().pending.length > 0) {
          const op = store.getState().pending[0] as QueuedOp;

          // Still inside its undo window. Stop rather than skip: order is
          // correctness (see above), so nothing may overtake a held head. The
          // provider's timer re-arms from `nextDelayMs` and drains when the
          // window closes.
          if (holdRemainingMs(op) > 0) return sent;

          // A change composed before any household was known was stamped ""
          // and has been bound to the first one since (`bindUnstamped`), so
          // the comparison is exact.
          if (op.householdId !== householdId) {
            // Composed in one household and drained in another. The server
            // would derive the household from the session and write this into
            // the wrong one.
            failHead(op, "wrong-household");
            continue;
          }

          try {
            inFlightId = op.id;
            await send(op);
            inFlightId = null;
            sent += 1;
            commit((state) => ({
              ...state,
              pending: state.pending.filter((entry) => entry.id !== op.id),
            }));
          } catch (error) {
            inFlightId = null;
            if (classifyMutationError(error, op.path) === "auth") {
              // Keep everything. This is the likeliest end of a real shop.
              commit((state) => ({ ...state, status: "needs-signin" }));
              return sent;
            }

            const reason = reasonFor(error, op.path);
            if (reason) {
              failHead(op, reason);
              continue;
            }

            const strike = receivedResponse(error) ? 1 : 0;
            const attempts = op.attempts + strike;

            if (attempts >= MAX_ATTEMPTS) {
              failHead(op, "exhausted");
              continue;
            }

            commit((state) => ({
              ...state,
              pending: state.pending.map((entry) =>
                entry.id === op.id ? { ...entry, attempts } : entry,
              ),
            }));
            return sent;
          }
        }
        return sent;
      } finally {
        draining = false;
        inFlightId = null;
        commit((state) => ({
          ...state,
          status: state.status === "sending" ? "idle" : state.status,
        }));
      }
    },

    cancel(id) {
      if (id === inFlightId) return false;
      const present = store
        .getState()
        .pending.some((entry) => entry.id === id);
      if (!present) return false;

      commit((state) => ({
        ...state,
        pending: state.pending.filter((entry) => entry.id !== id),
      }));
      return true;
    },

    setHousehold(id) {
      householdId = id;
      bindUnstamped();
    },

    holdRemainingMs(id) {
      // In flight is not undoable, whatever the clock says: `cancel` refuses
      // it, and an undo button that does nothing is worse than none.
      if (id === inFlightId) return 0;
      const op = store.getState().pending.find((entry) => entry.id === id);
      return op ? holdRemainingMs(op) : 0;
    },

    retry(id) {
      commit((state) => {
        const op = state.failed.find((entry) => entry.id === id);
        if (!op) return state;
        const { reason: _reason, ...rest } = op;
        return {
          ...state,
          failed: state.failed.filter((entry) => entry.id !== id),
          // Same id, so a change the server did in fact apply is recognised
          // rather than applied twice.
          pending: [...state.pending, { ...rest, attempts: 0 }],
        };
      });
    },

    discard(id) {
      const failed = store.getState().failed;
      const index = failed.findIndex((entry) => entry.id === id);
      const op = failed[index];
      if (!op) return null;

      discardedAt.set(id, index);
      commit((state) => ({
        ...state,
        failed: state.failed.filter((entry) => entry.id !== id),
      }));
      return op;
    },

    restore(op) {
      const { pending, failed } = store.getState();
      if ([...pending, ...failed].some((entry) => entry.id === op.id)) return;

      const index = discardedAt.get(op.id) ?? failed.length;
      discardedAt.delete(op.id);
      commit((state) => ({
        ...state,
        failed: [
          ...state.failed.slice(0, index),
          op,
          ...state.failed.slice(index),
        ],
      }));
    },

    purgeAll() {
      store.setState(EMPTY, true);
      storage.clear(userId);
    },

    nextDelayMs() {
      const head = store.getState().pending[0];
      if (!head) return null;
      // A head inside its undo window has never been attempted, so the wait
      // is the window itself, not a backoff.
      const held = holdRemainingMs(head);
      return held > 0 ? held : backoffDelay(head.attempts, random);
    },
  };
}
