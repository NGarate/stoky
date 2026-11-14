import { createWorker, type Worker } from "tesseract.js";
import { prisma } from "@/lib/prisma";
import { ReceiptStatus } from "@/generated/prisma/client";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { InvalidInputError, NotFoundError } from "./errors";
import { type Grey, readImageMetadata } from "./image";
import {
  asBuffer,
  onImageThread,
  sent,
  stopImageThreads,
} from "./image-thread";
import type { Turn } from "./prepare-worker";
import type { Quad } from "@/lib/receipt-quad";
import { receiptQuadSchema } from "@/lib/validations/receipt";

export { bestReading } from "./reading-choice";

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
  ): Promise<{ data: { text: string; confidence?: number } }>;
  terminate(): Promise<unknown>;
};

/** What Tesseract made of one image: its text, and how sure it was (0–100). */
interface Reading {
  text: string;
  confidence: number;
}

/** What one recognition is asked for: Tesseract's options and parameters. */
export type RecogniseOptions = Record<string, string | boolean>;

/**
 * The OCR engine, as the pipeline sees it: an image and options in, text out.
 * `signal`, once aborted, means the receipt has failed: an image still
 * waiting for a worker is dropped rather than read.
 */
export type Recognise = (
  image: Buffer,
  options?: RecogniseOptions,
  signal?: AbortSignal,
) => Promise<string>;

/** How sure the OCR engine is of its reading of an image, 0–100; `signal` as for `Recognise`. */
export type Confidence = (
  image: Buffer,
  signal?: AbortSignal,
) => Promise<number>;

/** No opinion on any image: the orientation the proportions chose stands. */
const noConfidence: Confidence = async () => 0;

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
  const read = timedReader(worker, timeoutMs);
  return async (image, options) => (await read(image, options)).text;
}

/**
 * `timedRecogniser` with Tesseract's confidence as well as its text: what the
 * application's workers are, so that reading and judging an orientation
 * share one queue per worker.
 */
function timedReader<W extends RecognisingWorker>(
  worker: { get(): Promise<W>; terminate(): Promise<void> },
  timeoutMs: () => number = ocrTimeoutMs,
): (image: Buffer, options?: RecogniseOptions) => Promise<Reading> {
  let queue: Promise<unknown> = Promise.resolve();

  async function recogniseOne(
    image: Buffer,
    options: RecogniseOptions = {},
  ): Promise<Reading> {
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
        data: { text, confidence = 0 },
      } = await Promise.race([current.recognize(image, options), expired]);
      return { text, confidence };
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
 * Pixels across the ticket it is prepared at: the short side of a straightened
 * ticket, the width of a cropped one (which is only ever scaled up to it).
 *
 * Every number of the preparation was measured at this width, and so were
 * the readings, which are scaled from the ticket as prepared
 * (`OcrReading.scale`).
 */
export const OCR_TICKET_WIDTH = 1400;

/** One of the readings taken of every photograph. */
export interface OcrReading {
  /**
   * The prepared ticket's own width this reading is scaled to — not
   * `OCR_TICKET_WIDTH`'s, although a crop, never scaled down, can be wider.
   * Reading those at the 560–980 pixels the six were measured at was tried
   * on 2026-11-09: of the 41 bench photos three are wider, one read the
   * same, `0070` went from 0.65 to 0.75 and `mine1` from 0.95 to 0.55. Both
   * are whole frames the paper was not found in (ISSUES.md OCR-8), whose text
   * is small in the frame and is lost when the frame is shrunk to 560.
   */
  scale: number;
  /** Read with the ink thinned (`thinned`) rather than as it is. */
  thin: boolean;
}

/**
 * The readings taken of every photograph; the one the others agree with is
 * kept (`bestReading`).
 *
 * **Six, at three sizes, with the ink as it is and thinned.** Tesseract reads
 * the same ticket differently at different sizes and stroke widths, and a
 * misread digit is rarely misread the same way in all of them, so the
 * readings outvote each other's mistakes. All are smaller than the prepared
 * ticket: most tickets read best at 0.4–0.7 of `OCR_TICKET_WIDTH`, 560–980
 * pixels across. All use Sauvola (`thresholding_method: 2`), which picks the
 * black/white cut per neighbourhood; Otsu's single cut added nothing once
 * Sauvola was read at several sizes. `rotateAuto` straightens what is left of
 * a tilt.
 *
 * Measured on 10 real tickets prepared by `prepareForOcr`
 * (`test-tickets/bench`, `subsets.ts`), with every subset of 24 readings
 * scored and each size of subset also chosen on nine tickets and scored on the
 * tenth: 2 readings 0.82, 4 0.92, **6 0.945**, 8 0.93, all 24 0.90, against
 * 0.876 for the two whole-size passes this replaced. More readings let more
 * wrong ones agree. **Only on a prepared ticket**: on a plain crop the same six
 * scored 0.29 against 0.35 for two passes, losing faint text the flattening
 * restores. End to end, preparation and all, over those 10 tickets and 30
 * copies of them turned, darkened, shrunk and shadowed: 0.321 before (with
 * `tessdata_fast`), 0.929 now with the `best_int` model the image bakes and
 * the subsets were chosen with (0.891 with `tessdata_fast`). Re-measure when tickets are added: ten tickets
 * choose six, they do not prove it.
 */
// In this order, the one measured: `bestReading` keeps the first of equals,
// and the order decided the pharmacy ticket's (0.95 in it, 0.65 interleaved).
export const OCR_READINGS: readonly OcrReading[] = [false, true].flatMap(
  (thin) => [0.4, 0.6, 0.7].map((scale) => ({ scale, thin })),
);

/** What Tesseract is asked for each of `OCR_READINGS`. */
export const OCR_OPTIONS: RecogniseOptions = {
  rotateAuto: true,
  thresholding_method: "2",
  // The resolution the readings were measured at; left to guess, Tesseract
  // guesses differently at each size.
  user_defined_dpi: "300",
};

/** Confidences closer than this say nothing about which way up a ticket is. */
const ORIENTATION_MARGIN = 10;

/**
 * Which way up a standing ticket reads, from `bands`: its middle band turned
 * each `Turn`, as the preparation thread made them.
 *
 * - **Proportions pick the axis.** A ticket is longer than it is wide, so the
 *   thread has already stood one that was wider than tall.
 * - **Text picks which end is up**: of the ticket and its half-turn, the one
 *   whose middle band Tesseract reads with more confidence. Upside-down text
 *   reads as nonsense, and its confidence says so.
 * - **When that is a tie, the other axis is tried too**: a ticket close to
 *   square can fool the proportions, and only a clearly better confidence
 *   wins.
 *
 * Measured on 28 photographs turned a quarter or half a turn: 28 right.
 *
 * `sure` when the turn chosen read clearly better than half a turn from it.
 * When it did not — a faint or sparse middle, or no judge at all — the
 * caller reads the ticket half turned as well if nothing came of it.
 */
async function upright(
  bands: readonly Buffer[],
  confidence: Confidence,
  signal?: AbortSignal,
): Promise<{ turn: Turn; sure: boolean }> {
  const scores: number[] = [];
  const judge = async (turns: Turn[]) => {
    const judged = await Promise.all(
      turns.map((turn) => confidence(bands[turn]!, signal)),
    );
    turns.forEach((turn, i) => (scores[turn] = judged[i]!));
  };
  await judge([0, 2]);
  let best: Turn = scores[2]! > scores[0]! ? 2 : 0;
  if (Math.abs(scores[0]! - scores[2]!) < ORIENTATION_MARGIN) {
    await judge([1, 3]);
    let bestConfidence = scores[best]!;
    for (const across of [1, 3] as const) {
      if (scores[across]! > bestConfidence + ORIENTATION_MARGIN) {
        best = across;
        bestConfidence = scores[across]!;
      }
    }
  }
  return {
    turn: best,
    sure: scores[best]! - scores[(best + 2) % 4]! >= ORIENTATION_MARGIN,
  };
}

/** A prepared ticket, and whether its text said which way up it is. */
export interface PreparedTicket extends Grey {
  sure: boolean;
}

/**
 * The photograph as the readings start from: the ticket alone, square to the
 * frame, evenly lit, the right way up and with its lines straight. The stored
 * photograph is not changed — this is a copy, made every time OCR runs.
 *
 * 1. **Straightened** from the four corners a person framed (`quad`), or
 *    else from those found when they can be trusted
 *    (`straightenedTicket`), otherwise **cropped** to the paper, so the table
 *    around a ticket is not read as text. A crop wider than tall is taken on
 *    its side, so that the ticket's width is what is scaled.
 * 2. **Light flattened** (`flattenedLight`): shadows, folds and faint ink.
 * 3. **Turned upright** (`upright`), by its proportions and then by its text.
 * 4. **Lines straightened** when they curve (`dewarped`).
 *
 * Every step is the preparation thread's (`prepare-worker.ts`); this thread
 * only asks Tesseract about the middle bands it is sent. The images are
 * handed between the two, not copied.
 *
 * On 9 real tickets and 30 copies turned, darkened, shrunk and shadowed, the
 * parse score went from 27% with the crop alone to 89% with all four.
 */
export async function prepareForOcr(
  image: Buffer,
  confidence: Confidence = noConfidence,
  signal?: AbortSignal,
  quad?: Quad,
): Promise<PreparedTicket> {
  const ticket = await onImageThread("ocr", {
    step: "ticket",
    image,
    width: OCR_TICKET_WIDTH,
    quad,
  });
  const grey = sent(ticket, "grey");
  const { turn, sure } = await upright(
    sent(ticket, "images").map(asBuffer),
    confidence,
    signal,
  );
  // Handed over, not copied: nothing here needs the ticket again.
  const prepared = sent(
    await onImageThread("ocr", { step: "upright", grey, turn }, [
      grey.pixels.buffer as ArrayBuffer,
    ]),
    "grey",
  );
  return { ...prepared, sure };
}

/**
 * `prepared`, half turned when asked, read every way `OCR_READINGS` lists,
 * all at once. `prepared` goes to the preparation thread and back without
 * being copied: what comes back is it, and `prepared` itself is unusable.
 */
async function readEveryWay(
  prepared: Grey,
  recognise: Recognise,
  signal: AbortSignal,
  halfTurned = false,
): Promise<{ texts: string[]; prepared: Grey }> {
  const reply = await onImageThread(
    "ocr",
    { step: "readings", grey: prepared, halfTurned, readings: OCR_READINGS },
    [prepared.pixels.buffer as ArrayBuffer],
  );
  // In parallel: the recogniser spreads them over its workers.
  const texts = await Promise.all(
    sent(reply, "images").map((image) =>
      recognise(asBuffer(image), OCR_OPTIONS, signal),
    ),
  );
  return { texts, prepared: sent(reply, "grey") };
}

/**
 * The reading kept of `texts` (`bestReading`), and how many articles it
 * yields — chosen on the image thread: parsing six readings and the lines of
 * the others is up to 19 ms of the server's thread per receipt, measured.
 */
async function chosen(
  texts: string[],
): Promise<{ text: string; articles: number }> {
  const reply = await onImageThread("ocr", { step: "choose", readings: texts });
  return { text: sent(reply, "text"), articles: sent(reply, "articles") };
}

/**
 * Every reading of `OCR_READINGS` of the prepared photograph, and the one
 * kept.
 *
 * The preparation turns the ticket by its text (`upright`); `confidence` is
 * what judges that, and left out, the proportions alone decide. **When the
 * text did not say which way up and no article was read, it is read again
 * half turned**, and that reading kept if it yields articles: upside down is
 * the likeliest way to read nothing, and this is how an Eroski ticket went
 * from no article to 65% before the orientation was judged at all. Only
 * then: a ticket that was judged clearly is not read twice, and a blank
 * photograph is read twice only when the judge could not tell either.
 *
 * **One failure fails the receipt, at once.** When a reading throws or runs
 * out its time, the receipt is FAILED and its readings still waiting for a
 * worker are dropped, so the workers go on to the next receipt instead of
 * reading for a result nobody will use. A reading a worker has already
 * started runs to its end: tesseract.js cannot stop one short of replacing
 * the worker.
 */
export async function readReceiptPhoto(
  image: Buffer,
  recognise: Recognise,
  confidence: Confidence = noConfidence,
  quad?: Quad,
): Promise<string> {
  const failed = new AbortController();
  try {
    const prepared = await prepareForOcr(
      image,
      confidence,
      failed.signal,
      quad,
    );
    const first = await readEveryWay(prepared, recognise, failed.signal);
    const best = await chosen(first.texts);
    if (prepared.sure || best.articles > 0) return best.text;
    const turned = await chosen(
      (await readEveryWay(first.prepared, recognise, failed.signal, true))
        .texts,
    );
    return turned.articles > 0 ? turned.text : best.text;
  } finally {
    // After a success nothing is waiting; after a failure, this drops it.
    failed.abort();
  }
}

/**
 * The lines a person framed on the photograph (`quad`, in its proportions),
 * read on their own: the region straightened, then read every way
 * `OCR_READINGS` lists and the reading the others agree with kept, as a
 * whole ticket is. Not turned or flattened: the person framed it the right
 * way up, and flattening blanks dark ink near the edge (ISSUES OCR-11),
 * which in a few lines is all of it.
 */
export async function readFramedLines(
  image: Buffer,
  quad: Quad,
  recognise: Recognise = recogniseWithTesseract,
): Promise<string> {
  const failed = new AbortController();
  try {
    const region = sent(
      await onImageThread("ocr", {
        step: "region",
        image,
        quad,
        width: OCR_TICKET_WIDTH,
      }),
      "grey",
    );
    const { texts } = await readEveryWay(region, recognise, failed.signal);
    return (await chosen(texts)).text;
  } finally {
    failed.abort();
  }
}

/** Workers when `OCR_WORKERS` does not say otherwise. */
export const DEFAULT_OCR_WORKERS = 3;

/**
 * `OCR_WORKERS` when it is a positive whole number, the default otherwise;
 * never more than the processor can run at once.
 *
 * Each worker is a thread with its own copy of the model, about 120 MB, and
 * reads one image at a time. Measured with six readings of one long ticket on
 * an 8-core machine, with the model the image bakes: 1 worker 37.9 s, 2
 * 20.7 s, 3 15.7 s; past three, the slowest single reading is what is left.
 * Three by default, which the 2 GiB the release bundle gives the
 * application holds: the bench, reading with three, peaked at 995 MB.
 */
export function ocrWorkers(
  configured = process.env.OCR_WORKERS,
  processors = availableParallelism(),
): number {
  const value = Number(configured);
  const wanted =
    Number.isInteger(value) && value > 0 ? value : DEFAULT_OCR_WORKERS;
  return Math.max(1, Math.min(wanted, processors));
}

/**
 * One recogniser made of several: images wait in one queue, and each goes to
 * whichever recogniser is free when its turn comes.
 *
 * Handed out as they are taken, not as they arrive. Choosing a recogniser
 * when an image arrived — the one with the fewest in hand — left the images
 * behind a stuck one waiting out its whole time limit while the others sat
 * idle. Each still has its own time limit (`timedReader`), so an image's
 * clock starts when a worker starts it, and a worker that is replaced takes
 * nothing of the others' with it. The free one used last is used first: one
 * image at a time keeps to the first, and so starts one worker. An image whose
 * `signal` was aborted while it waited is refused when its turn comes, unread.
 */
export function pooledRecogniser<T = string>(
  recognisers: readonly ((
    image: Buffer,
    options?: RecogniseOptions,
  ) => Promise<T>)[],
): (
  image: Buffer,
  options?: RecogniseOptions,
  signal?: AbortSignal,
) => Promise<T> {
  type Recogniser = (typeof recognisers)[number];
  const free = recognisers.slice();
  const waiting: ((recogniser: Recogniser) => void)[] = [];
  const release = (recogniser: Recogniser) => {
    const next = waiting.shift();
    if (next) next(recogniser);
    else free.unshift(recogniser);
  };
  return async (image, options, signal) => {
    const recogniser =
      free.shift() ?? (await new Promise<Recogniser>((r) => waiting.push(r)));
    try {
      signal?.throwIfAborted();
      return await recogniser(image, options);
    } finally {
      release(recogniser);
    }
  };
}

const ocrWorkerPool = Array.from({ length: ocrWorkers() }, () =>
  sharedWorker<Worker>(() => createWorker("spa", undefined, workerOptions())),
);

const readWithTesseract = pooledRecogniser(
  ocrWorkerPool.map((worker) => timedReader(worker)),
);

const recogniseWithTesseract: Recognise = async (image, options, signal) =>
  (await readWithTesseract(image, options, signal)).text;

const confidenceWithTesseract: Confidence = async (image, signal) =>
  (await readWithTesseract(image, undefined, signal)).confidence;

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
  // Tesseract's own judgement only alongside Tesseract: a test that brings
  // its own `recognise` does not want a real worker started to orient it.
  confidence: Confidence = recognise === recogniseWithTesseract
    ? confidenceWithTesseract
    : noConfidence,
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

    // The corners the person framed, when they did: checked again here, as
    // the row is read back rather than taken from the procedure that checked.
    const framed = receiptQuadSchema.safeParse(receipt.ticketQuad);
    const text = await readReceiptPhoto(
      imageBuffer,
      recognise,
      confidence,
      framed.success ? framed.data : undefined,
    );
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
  await Promise.all([
    ...ocrWorkerPool.map((worker) => worker.terminate()),
    stopImageThreads(),
  ]);
}
