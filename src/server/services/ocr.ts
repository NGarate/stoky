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
export function workerOptions(): { langPath?: string; cachePath?: string; gzip?: boolean } {
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

const ocrWorker = sharedWorker<Worker>(() =>
  createWorker("spa", undefined, workerOptions()),
);

export async function processReceiptOcr(receiptId: string): Promise<string> {
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

    const worker = await ocrWorker.get();
    const {
      data: { text },
    } = await worker.recognize(imageBuffer);

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
