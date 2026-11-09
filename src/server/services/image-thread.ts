/**
 * The thread heavy image work runs on (`prepare-worker.ts`), and the only
 * way to it.
 *
 * Preparing a photograph for OCR is JavaScript loops over every pixel that
 * held the server's thread for up to 2.5 s at a time, during which it
 * answered nobody. It runs on a worker thread instead, and the server's
 * thread only waits for it: started on first use and again after it fails,
 * and letting the process exit while idle.
 */
import { Worker as Thread } from "node:worker_threads";
import { InvalidInputError, UpstreamError } from "./errors";
import type {
  Prepared,
  PreparationReply,
  PreparationRequest,
} from "./prepare-worker";

/** Requests the preparation thread has not answered yet, by id. */
type Waiting = Map<
  number,
  { resolve: (reply: Prepared) => void; reject: (error: Error) => void }
>;

/** The thread the preparation's pixel work runs on, while there is one. */
let preparationThread: { thread: Thread; waiting: Waiting } | null = null;
let nextRequest = 0;

/**
 * `request` answered by the preparation thread (`prepare-worker.ts`), which
 * is started on first use and again after it fails.
 *
 * A thread that dies fails what it was asked; the next request starts a new
 * one. An image the preparation cannot work with comes back as the
 * `InvalidInputError` it was; anything else that goes wrong over there is an
 * `UpstreamError` here, the thread being something this service depends on.
 */
export function onImageThread(
  request: DistributiveOmit<PreparationRequest, "id">,
  transfer: ArrayBuffer[] = [],
): Promise<Prepared> {
  if (!preparationThread) {
    const thread = new Thread(new URL("./prepare-worker.ts", import.meta.url));
    const waiting: Waiting = new Map();
    const fail = (error: Error) => {
      for (const { reject } of waiting.values()) reject(error);
      waiting.clear();
      if (preparationThread?.thread === thread) preparationThread = null;
    };
    thread.on("message", (reply: PreparationReply) => {
      const asked = waiting.get(reply.id);
      waiting.delete(reply.id);
      // Idle, the thread must not keep the process alive.
      if (waiting.size === 0) thread.unref();
      if (!asked) return;
      if ("error" in reply) {
        asked.reject(
          reply.error.name === "InvalidInputError"
            ? new InvalidInputError(reply.error.message)
            : new UpstreamError(reply.error.message),
        );
      } else {
        asked.resolve(reply);
      }
    });
    thread.on("error", fail);
    thread.on("exit", (code) =>
      fail(new UpstreamError(`The image preparation thread stopped (${code})`)),
    );
    preparationThread = { thread, waiting };
  }
  const { thread, waiting } = preparationThread;
  const id = nextRequest++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    thread.ref();
    thread.postMessage({ ...request, id }, transfer);
  });
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** What a preparation step answered with, which must be there. */
export function sent<K extends keyof Prepared>(
  reply: Prepared,
  what: K,
): NonNullable<Prepared[K]> {
  const value = reply[what];
  if (!value) {
    throw new UpstreamError(`The preparation thread sent no ${what} back`);
  }
  return value;
}

/** Bytes the thread sent, as a `Buffer` over the same memory. */
export const asBuffer = (png: Uint8Array) =>
  Buffer.from(png.buffer, png.byteOffset, png.byteLength);

/** Stops the thread; the next request starts a new one. */
export async function stopImageThread(): Promise<void> {
  const running = preparationThread;
  preparationThread = null;
  await running?.thread.terminate();
}
