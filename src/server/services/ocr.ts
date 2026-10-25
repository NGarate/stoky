import { createWorker, type Worker } from "tesseract.js";
import { prisma } from "@/lib/prisma";
import { ReceiptStatus } from "@prisma/client";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { InvalidInputError, NotFoundError } from "./errors";
import { readImageMetadata } from "./image";

/**
 * Where the Spanish traineddata is read from — ISSUES.md OCR-1.
 *
 * `createWorker("spa")` with no `langPath` fetches the model from jsdelivr on
 * first use and caches it in the working directory. The production image
 * carries neither the file nor a writable working directory: its root
 * filesystem is read-only, with only `/tmp` and the Next cache on tmpfs. So the
 * first receipt scan on a fresh container needed outbound internet *and*
 * somewhere to write 3 MB — two failures on an air-gapped install, one
 * everywhere else.
 *
 * The same class of defect as the Prisma CLI that `npx` used to fetch at
 * container start, and missed for the same reason: nothing exercised this path
 * in a production image.
 *
 * A local directory rather than a URL, which is what tesseract.js uses to
 * decide between reading a file and fetching one.
 */

/** The directory a baked-in model would be in, or null if there is not one. */
export function tessdataDirectory(): string | null {
  const configured = process.env.TESSDATA_PATH ?? process.cwd();
  return existsSync(join(configured, "spa.traineddata")) ? configured : null;
}

/**
 * The options that keep OCR off the network — when there is a model to use.
 *
 * **Empty when there is not**, which is the case that keeps development
 * working. Pointing `langPath` at a directory with no `spa.traineddata` in it
 * does not make tesseract.js fall back to the CDN; it throws. A developer who
 * has never run OCR has no file, and turning "downloads 3 MB once" into "OCR is
 * broken" would be trading a production defect for a local one.
 *
 * The image sets `TESSDATA_PATH` and bakes the file in, so there the answer is
 * always the local path.
 *
 * Separated from the worker so it can be asserted without standing up a
 * worker, which spawns a thread and loads the whole model — not something a
 * test should do to check a string.
 */
export function workerOptions(): {
  langPath?: string;
  cachePath?: string;
  gzip?: boolean;
} {
  const directory = tessdataDirectory();
  if (!directory) return {};

  return {
    langPath: directory,
    // Where tesseract.js would *write* a model it downloaded. Pointed at the
    // same directory so that if it ever does, it does not try to write into a
    // read-only root and fail silently on every scan.
    cachePath: directory,
    // The baked file is uncompressed. Left at its default of `true`,
    // tesseract.js looks for `spa.traineddata.gz` and finds nothing.
    gzip: false,
  };
}

/**
 * One worker, created on first use and shared — including by the first uses
 * that arrive together.
 *
 * This held the *worker* and checked it before awaiting `createWorker`, so two
 * receipts whose OCR started before the first worker had finished loading
 * (it spawns a thread and reads the model) each saw none and each created
 * one. The second assignment won and the first worker was never terminated —
 * a thread and a loaded model leaked per race, for the life of the process.
 * Holding the *promise* means the second caller awaits the first one's worker.
 *
 * A creation that fails is forgotten, so the next scan tries again rather
 * than every later scan inheriting the rejection.
 *
 * A factory rather than module state so the race can be tested without
 * standing up tesseract.
 */
export function sharedWorker<W extends { terminate(): Promise<unknown> }>(
  create: () => Promise<W>,
): { get(): Promise<W>; terminate(): Promise<void> } {
  let pending: Promise<W> | null = null;

  return {
    get() {
      pending ??= create().catch((error: unknown) => {
        pending = null;
        throw error;
      });
      return pending;
    },
    async terminate() {
      const current = pending;
      if (!current) return;
      pending = null;
      // A creation that failed has nothing to terminate.
      const worker = await current.catch(() => null);
      await worker?.terminate();
    },
  };
}

/** How long one recognition may take before its worker is replaced. */
export const DEFAULT_OCR_TIMEOUT_MS = 120_000;

/**
 * The longest delay `setTimeout` honours. Past it the runtime warns
 * (TimeoutOverflowWarning) and fires after 1 ms, so a value meant as "wait
 * for days" would fail every scan at once.
 */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * `OCR_TIMEOUT_MS` when it is a positive whole number of milliseconds a timer
 * can hold, the default otherwise — an unset, empty or mistyped value must not
 * turn the bound off, and one too large for a timer must not turn it into 1 ms.
 */
export function ocrTimeoutMs(configured = process.env.OCR_TIMEOUT_MS): number {
  const value = Number(configured);
  return Number.isInteger(value) && value > 0 && value <= MAX_TIMER_MS
    ? value
    : DEFAULT_OCR_TIMEOUT_MS;
}

type RecognisingWorker = {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

/**
 * Recognition with a time limit, one image at a time.
 *
 * **Why a limit.** `recognize` had none, and there is one worker. An image
 * Tesseract cannot finish — the security audit measured 49 MP of noise still
 * running after 200 s and 12 MP of noise taking 131 s — held that worker, and
 * every receipt queued behind it waited, for as long as it took or for ever.
 *
 * **Why termination.** tesseract.js has no way to cancel a recognition in
 * progress, so giving up on the promise alone would leave the thread working
 * on the image and the next receipt queued behind it. The only remedy is
 * `terminate()`, after which the shared worker is gone and the next receipt
 * loads a fresh one. The receipt that ran out of time throws, and
 * `processReceiptOcr` marks it FAILED.
 *
 * **Why one at a time.** tesseract.js runs a worker's jobs in order, and its
 * `terminate()` neither finishes nor rejects the ones still queued: their
 * promises never settle (`createWorker.js`, 6.0.1). Handing a second image to
 * the worker while the first runs would therefore start the second one's
 * clock while it waits, and strand it for good when the first one's timeout
 * kills the worker. Queuing here instead means the limit measures one
 * recognition, not the backlog in front of it, and that a terminated worker
 * has nothing else in it.
 *
 * A factory, like `sharedWorker`, so a worker that never answers can be
 * tested without standing up tesseract.
 */
export function timedRecogniser<W extends RecognisingWorker>(
  worker: { get(): Promise<W>; terminate(): Promise<void> },
  timeoutMs: () => number = ocrTimeoutMs,
): (image: Buffer) => Promise<string> {
  let queue: Promise<unknown> = Promise.resolve();

  async function recogniseOne(image: Buffer): Promise<string> {
    // Loading the model is outside the limit: it is the same for every
    // image, and a load that fails rejects on its own.
    const current = await worker.get();
    const limit = timeoutMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        // The image is what cannot be worked with in the time a scan gets;
        // nothing outside failed, and nobody is waiting on a status code —
        // `processReceiptAsync` logs this message as the reason.
        reject(new InvalidInputError(`OCR did not finish within ${limit} ms`));
      }, limit);
    });

    try {
      const {
        data: { text },
      } = await Promise.race([current.recognize(image), expired]);
      return text;
    } catch (error) {
      // Before the next image is let through, so it gets a fresh worker
      // rather than the one still busy with this image.
      if (timedOut) await worker.terminate();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return (image) => {
    const run = queue.then(() => recogniseOne(image));
    // The next image waits for this one to end, however it ends.
    queue = run.catch(() => undefined);
    return run;
  };
}

const ocrWorker = sharedWorker<Worker>(() =>
  createWorker("spa", undefined, workerOptions()),
);

const recogniseWithTesseract = timedRecogniser(ocrWorker);

/**
 * Reads the receipt's photograph and moves it to PARSED with the text — or to
 * FAILED.
 *
 * **No text is a failure.** A photograph of nothing legible (a blank page, the
 * back of the ticket, a blur) used to reach PARSED with `rawOcrText` empty.
 * The step after this one only parses when there is text, so the receipt sat
 * at PARSED for ever: not failed, so the upload screen offered no retry, and
 * still polling, because PARSED is a state it waits on. FAILED is the state
 * that screen can say something about.
 *
 * @param recognise The OCR engine. A parameter so the pipeline around it can
 *   be tested without loading tesseract; callers leave it out.
 */
export async function processReceiptOcr(
  receiptId: string,
  recognise: (image: Buffer) => Promise<string> = recogniseWithTesseract,
): Promise<string> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
  });

  if (!receipt) {
    throw new NotFoundError("Receipt not found");
  }

  try {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { status: ReceiptStatus.PROCESSING },
    });

    const fs = await import("node:fs");
    const imageBuffer = await fs.promises.readFile(receipt.imagePath);
    if (imageBuffer.length === 0) {
      throw new InvalidInputError("Empty image file");
    }

    // Validate image before passing it to OCR to avoid worker-level crashes.
    //
    // Bounded in pixels as well as bytes, for the reason the module states.
    // Checked here rather than trusted from upstream because this path also
    // runs on a re-processed receipt, where the bytes came off disk rather
    // than through the procedure that checked them.
    await readImageMetadata(imageBuffer);

    const text = await recognise(imageBuffer);
    if (text.trim().length === 0) {
      throw new InvalidInputError("No text recognised in the image");
    }

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        rawOcrText: text,
        status: ReceiptStatus.PARSED,
        processedAt: new Date(),
      },
    });

    return text;
  } catch (error) {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { status: ReceiptStatus.FAILED },
    });
    throw error;
  }
}

export async function terminateWorker(): Promise<void> {
  await ocrWorker.terminate();
}
