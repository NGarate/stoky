import { createWorker, type Worker } from "tesseract.js";
import { prisma } from "@/lib/prisma";
import { ReceiptStatus } from "@/generated/prisma/client";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { InvalidInputError, NotFoundError } from "./errors";
import { parseReceiptText } from "./receiptParser";
import { MAX_PIXELS, cropImage, findPaper, readImageMetadata } from "./image";

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
  recognize(
    image: Buffer,
    options?: Record<string, unknown>,
  ): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

/** What one recognition is asked for: Tesseract's options and parameters. */
export type RecogniseOptions = Record<string, string | boolean>;

/** The OCR engine, as the pipeline sees it: an image and options in, text out. */
export type Recognise = (
  image: Buffer,
  options?: RecogniseOptions,
) => Promise<string>;

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
): Recognise {
  let queue: Promise<unknown> = Promise.resolve();

  async function recogniseOne(
    image: Buffer,
    options: RecogniseOptions = {},
  ): Promise<string> {
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
      } = await Promise.race([current.recognize(image, options), expired]);
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

  return (image, options) => {
    const run = queue.then(() => recogniseOne(image, options));
    // The next image waits for this one to end, however it ends.
    queue = run.catch(() => undefined);
    return run;
  };
}

/**
 * Text narrower than this many pixels across the ticket is upscaled to it.
 *
 * Tesseract's model is trained on text about 30 pixels high, and a phone
 * photograph of a long ticket leaves its lines at half that: the whole ticket
 * fits the frame by being small. Upscaling does not add detail, but it lets
 * Tesseract's own binarisation keep the strokes it would otherwise merge.
 */
export const OCR_MIN_WIDTH = 1400;

/** Upscaling stops here, whatever the width says: Tesseract's memory is per pixel. */
const OCR_MAX_PIXELS = 20_000_000;

/**
 * One way of reading a photograph: how it is prepared, and what Tesseract is
 * asked to do with it.
 */
export interface OcrPass {
  /** Upscale a narrow ticket to `OCR_MIN_WIDTH` and drop its colour. */
  enlarge: boolean;
  options: RecogniseOptions;
}

/**
 * The readings tried on every photograph; the most consistent one is kept
 * (`bestReading`).
 *
 * Two, because no single way of reading wins on every ticket. Both straighten
 * the image first (`rotateAuto`): a phone photograph is rarely square to the
 * ticket, and Tesseract reads a line that drifts a few degrees as two.
 *
 * - The first enlarges and greys the ticket and binarises it with Sauvola
 *   (`thresholding_method: 2`), which picks the black/white cut per
 *   neighbourhood: a shadow across half the ticket or a fold that catches the
 *   light loses the text in the darker half under one cut for the page.
 * - The second reads the ticket as photographed, with Tesseract's one global
 *   cut (Otsu). It wins where Sauvola turns a faded or textured background
 *   into specks.
 *
 * Measured over 77 receipt photographs — 29 real tickets from eleven chains
 * and 48 degraded copies of them — against what a person read off each: the
 * parse score (articles with the right name and price, total, date, shop)
 * went from 37% with the photograph as it was to 43.5% with the first pass
 * alone and 49.7% with both. A third pass added under one point; the larger
 * `tessdata_best` model scored lower than the shipped `tessdata_fast`.
 */
export const OCR_PASSES: readonly OcrPass[] = [
  { enlarge: true, options: { rotateAuto: true, thresholding_method: "2" } },
  { enlarge: false, options: { rotateAuto: true, thresholding_method: "0" } },
];

/**
 * The photograph as Tesseract should see it for `pass`: the ticket alone
 * and, when the pass asks, grey and wide enough to read.
 *
 * Cropped to the paper (`findPaper`) because the table around a ticket is
 * read as text. The stored photograph is not changed — this is what is
 * handed to the OCR, every time it runs.
 */
export async function prepareForOcr(
  image: Buffer,
  pass: Pick<OcrPass, "enlarge"> = OCR_PASSES[0]!,
): Promise<Buffer> {
  const { width, height } = await readImageMetadata(image);
  if (!width || !height) return image;
  const paper = await findPaper(image, width, height);
  const source = paper ? await cropImage(image, paper) : image;
  const sourceWidth = paper?.width ?? width;
  const sourceHeight = paper?.height ?? height;

  let prepared = new Bun.Image(source, { maxPixels: MAX_PIXELS });
  if (pass.enlarge) {
    const scale = Math.max(
      1,
      Math.min(
        OCR_MIN_WIDTH / sourceWidth,
        Math.sqrt(OCR_MAX_PIXELS / (sourceWidth * sourceHeight)),
      ),
    );
    prepared = prepared
      .resize(Math.round(sourceWidth * scale))
      .modulate({ saturation: 0 });
  }
  return Buffer.from(await prepared.png().toBuffer());
}

/**
 * How believable a reading is, without knowing what the ticket says: how
 * many articles it yields, and whether they add up to the total it yields.
 *
 * A misread digit or a lost line breaks the sum, so of two readings of the
 * same ticket the one whose articles come to its total is almost always the
 * better one — and when neither does, the one with more articles.
 */
export function readingScore(text: string): number {
  const { items, totalAmount, discountAmount = 0 } = parseReceiptText(text);
  const count = items.length;
  if (!totalAmount || count === 0) return count;
  // Less the discounts the reading found: a correct reading of a ticket with
  // a `DTO -0,50` misses its total by exactly that, and a misread digit that
  // happened to close the gap used to beat it.
  const sum =
    items.reduce((total, item) => total + item.parsedPrice, 0) - discountAmount;
  const gap = Math.abs(sum - totalAmount) / totalAmount;
  const agreement = gap < 0.005 ? 3 : gap < 0.05 ? 1.5 : gap < 0.2 ? 0.5 : 0;
  return count * (1 + agreement);
}

/**
 * The reading `readingScore` believes most; the first of equals.
 *
 * **With a date from another reading when it has none.** The date is one
 * short line, and which pass reads it is close to chance; the score cannot
 * weigh it — a date bonus in `readingScore` chose worse readings. So the
 * first line of another reading that parses to a date on its own is added to
 * the end of the one kept. Measured over 111 photographs: two tickets gained
 * their date and no score fell.
 */
export function bestReading(readings: readonly string[]): string {
  let best = readings[0] ?? "";
  for (const reading of readings.slice(1)) {
    if (readingScore(reading) > readingScore(best)) best = reading;
  }
  if (parseReceiptText(best).purchaseDate) return best;
  for (const reading of readings) {
    if (reading === best) continue;
    const dated = reading
      .split("\n")
      .find((line) => parseReceiptText(line).purchaseDate);
    if (dated) return `${best}\n${dated}`;
  }
  return best;
}

/**
 * Every pass of `OCR_PASSES` over `image`, and the reading kept.
 *
 * **Upside down, only when nothing was read.** `rotateAuto` straightens a
 * ticket a few degrees off, not one photographed the wrong way up — an Eroski
 * ticket shot that way read as mirrored nonsense ("YLISIA NS dod SYIOVED")
 * and gave no article at all. Turning every photograph round would double the
 * time of every scan to rescue the rare one, so the passes are read again,
 * turned half a turn, only when the right way up yielded no article
 * (`readingScore` 0): an ordinary ticket pays nothing for it. Measured over
 * the 77 photographs above: 5 took the second round, and the Eroski ticket's
 * parse score went from 0 to 65%; no other score moved.
 */
export async function readReceiptPhoto(
  image: Buffer,
  recognise: Recognise,
): Promise<string> {
  const readings: string[] = [];
  for (const pass of OCR_PASSES) {
    readings.push(
      await recognise(await prepareForOcr(image, pass), pass.options),
    );
  }
  const upright = bestReading(readings);
  if (readingScore(upright) > 0) return upright;
  for (const pass of OCR_PASSES) {
    const turned = new Bun.Image(await prepareForOcr(image, pass), {
      maxPixels: MAX_PIXELS,
    }).rotate(180);
    readings.push(
      await recognise(Buffer.from(await turned.png().toBuffer()), pass.options),
    );
  }
  return bestReading(readings);
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
  recognise: Recognise = recogniseWithTesseract,
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

    const text = await readReceiptPhoto(imageBuffer, recognise);
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
