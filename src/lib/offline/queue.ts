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

/** The five procedures a queued shop can carry. */
export type ReplayablePath =
  | "shopping.addItem"
  | "shopping.updateItem"
  | "shopping.removeItem"
  | "inventory.addStock"
  | "inventory.consumeStock";

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
}

/**
 * Why a change is not going to be sent again.
 *
 * `needs-reconciliation` is not a failure. Stock has a floor, so two people who
 * each use the last unit cannot both be right — but the second one *did* take
 * the milk, and only a person who can see the shelf knows what is actually
 * there. §5.5.3: allow and reconcile, never discard.
 */
export type FailureReason =
  | "needs-reconciliation"
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
}

export interface EnqueueInput {
  path: ReplayablePath;
  input: Record<string, unknown>;
  label: OpLabel;
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
  getState(): QueueState;
  subscribe(listener: (state: QueueState) => void): () => void;
  enqueue(op: EnqueueInput): EnqueueResult;
  drain(): Promise<void>;
  /** Put a failed change back at the tail, with its strikes cleared. */
  retry(id: string): void;
  /** Give up on a failed change deliberately. */
  discard(id: string): void;
  /** Sign-out: this account's changes leave the device. */
  purgeAll(): void;
  /** How long to wait before the next attempt, or null when there is nothing. */
  nextDelayMs(): number | null;
}

const EMPTY: QueueState = {
  pending: [],
  failed: [],
  status: "idle",
  full: false,
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
    case "permanent":
      return "refused";
    default:
      return null;
  }
}

export function openWriteQueue(options: WriteQueueOptions): WriteQueue {
  const {
    userId,
    householdId,
    send,
    storage = createQueueStorage(),
    now = () => new Date(),
    random = Math.random,
  } = options;

  const restored = storage.read(userId);
  const store = createStore<QueueState>(() => ({
    ...EMPTY,
    ...(isPersisted(restored)
      ? { pending: restored.pending, failed: restored.failed }
      : {}),
  }));

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

  let draining = false;

  return {
    store,
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),

    enqueue({ path, input, label }) {
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
      };

      commit((current) => ({
        ...current,
        pending: [...current.pending, op],
        full: false,
      }));

      return { ok: true, id: op.id };
    },

    async drain() {
      if (draining) return;
      if (store.getState().status === "needs-signin") return;
      if (store.getState().pending.length === 0) return;

      draining = true;
      commit((state) => ({ ...state, status: "sending" }));

      try {
        // One at a time, in order. `consumeStock` refuses when the quantity
        // exceeds what is available, and what is available depends on the
        // queued writes in front of it — so order is correctness, not tidiness.
        while (store.getState().pending.length > 0) {
          const op = store.getState().pending[0] as QueuedOp;

          if (op.householdId !== householdId) {
            // Composed in one household and drained in another. The server
            // would derive the household from the session and write this into
            // the wrong one.
            failHead(op, "wrong-household");
            continue;
          }

          try {
            await send(op);
            commit((state) => ({
              ...state,
              pending: state.pending.filter((entry) => entry.id !== op.id),
            }));
          } catch (error) {
            if (classifyMutationError(error, op.path) === "auth") {
              // Keep everything. This is the likeliest end of a real shop.
              commit((state) => ({ ...state, status: "needs-signin" }));
              return;
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
            return;
          }
        }
      } finally {
        draining = false;
        commit((state) => ({
          ...state,
          status: state.status === "sending" ? "idle" : state.status,
        }));
      }
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
      commit((state) => ({
        ...state,
        failed: state.failed.filter((entry) => entry.id !== id),
      }));
    },

    purgeAll() {
      store.setState(EMPTY, true);
      storage.clear(userId);
    },

    nextDelayMs() {
      const head = store.getState().pending[0];
      return head ? backoffDelay(head.attempts, random) : null;
    },
  };
}
