/**
 * The threads heavy image work runs on (`prepare-worker.ts`), and the only
 * way to them.
 *
 * Preparing a photograph for OCR is JavaScript loops over every pixel, and
 * decoding a HEIC upload is libheif's WebAssembly; on the server's thread
 * they held it for up to 2.5 s and 0.9 s at a time, during which it answered
 * nobody. They run on worker threads instead, and the server's thread only
 * waits for them.
 *
 * **A thread per lane**, so that storing an upload never waits behind a
 * receipt being read, whose pixel loops hold their thread for seconds. Each
 * is started on first use and again after it fails, and lets the process
 * exit while idle.
 */
import { Worker as Thread } from "node:worker_threads";
import { InvalidInputError, UpstreamError } from "./errors";
import type {
  Prepared,
  PreparationReply,
  PreparationRequest,
} from "./prepare-worker";

/** Which thread: uploads being stored, or receipts being read. */
export type Lane = "upload" | "ocr";

/** Requests a thread has not answered yet, by id. */
type Waiting = Map<
  number,
  { resolve: (reply: Prepared) => void; reject: (error: Error) => void }
>;

/** Each lane's thread, while there is one. */
const threads = new Map<Lane, { thread: Thread; waiting: Waiting }>();
let nextRequest = 0;

/**
 * `request` answered by `lane`'s thread. What `transfer` names is handed
 * over rather than copied, and is unusable here after.
 *
 * A thread that dies fails what it was asked; the next request starts a new
 * one. An image the preparation cannot work with comes back as the
 * `InvalidInputError` it was; anything else that goes wrong over there is an
 * `UpstreamError` here, the thread being something this service depends on.
 */
export function onImageThread(
  lane: Lane,
  request: DistributiveOmit<PreparationRequest, "id">,
  transfer: ArrayBuffer[] = [],
): Promise<Prepared> {
  let running = threads.get(lane);
  if (!running) {
    const thread = new Thread(new URL("./prepare-worker.ts", import.meta.url));
    const waiting: Waiting = new Map();
    const fail = (error: Error) => {
      for (const { reject } of waiting.values()) reject(error);
      waiting.clear();
      if (threads.get(lane)?.thread === thread) threads.delete(lane);
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
      fail(new UpstreamError(`The image thread stopped (${code})`)),
    );
    running = { thread, waiting };
    threads.set(lane, running);
  }
  const { thread, waiting } = running;
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

/** What a step answered with, which must be there. */
export function sent<K extends keyof Prepared>(
  reply: Prepared,
  what: K,
): NonNullable<Prepared[K]> {
  const value = reply[what];
  // Not `!value`: an empty reading and no articles are answers.
  if (value === undefined) {
    throw new UpstreamError(`The image thread sent no ${what} back`);
  }
  return value as NonNullable<Prepared[K]>;
}

/** Bytes the thread sent, as a `Buffer` over the same memory. */
export const asBuffer = (png: Uint8Array) =>
  Buffer.from(png.buffer, png.byteOffset, png.byteLength);

/**
 * `reencodeAsJpeg` (`image.ts`) on the upload lane's thread: what an
 * upload is stored as.
 */
export async function reencodedAsJpeg(image: Buffer): Promise<Buffer> {
  const [jpeg] = sent(
    await onImageThread("upload", { step: "reencode", image }),
    "images",
  );
  if (!jpeg) throw new UpstreamError("The image thread sent no JPEG back");
  return asBuffer(jpeg);
}

/** Stops every lane's thread; the next request starts a new one. */
export async function stopImageThreads(): Promise<void> {
  const running = [...threads.values()];
  threads.clear();
  await Promise.all(running.map(({ thread }) => thread.terminate()));
}
