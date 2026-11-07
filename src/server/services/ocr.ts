import { createWorker, type Worker } from "tesseract.js";
import { prisma } from "@/lib/prisma";
import { ReceiptStatus } from "@/generated/prisma/client";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker as Thread } from "node:worker_threads";
import { join } from "node:path";
import { InvalidInputError, NotFoundError, UpstreamError } from "./errors";
import { parseReceiptText } from "./receiptParser";
import {
  type Grey,
  greyPng,
  middleBand,
  readImageMetadata,
  turnedHalf,
  turnedQuarter,
} from "./image";
import type { PreparationReply, PreparationRequest } from "./prepare-worker";

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
export interface Reading {
  text: string;
  confidence: number;
}

/** What one recognition is asked for: Tesseract's options and parameters. */
export type RecogniseOptions = Record<string, string | boolean>;

/** The OCR engine, as the pipeline sees it: an image and options in, text out. */
export type Recognise = (
  image: Buffer,
  options?: RecogniseOptions,
) => Promise<string>;

/** How sure the OCR engine is of its reading of an image, 0–100. */
export type Confidence = (image: Buffer) => Promise<number>;

/** No opinion on any image: the orientation the proportions chose stands. */
export const noConfidence: Confidence = async () => 0;

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
export function timedReader<W extends RecognisingWorker>(
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
 * Every number of the preparation was measured at this width, and the
 * readings are scaled from it (`OCR_READINGS`).
 */
export const OCR_TICKET_WIDTH = 1400;

/** One of the readings taken of every photograph. */
export interface OcrReading {
  /** The prepared ticket's width this reading is scaled to. */
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
 * `grey` the right way up.
 *
 * - **Proportions pick the axis.** A ticket is longer than it is wide, so a
 *   ticket wider than tall was photographed on its side and is turned a
 *   quarter.
 * - **Text picks which end is up**: of the ticket and its half-turn, the one
 *   whose middle band Tesseract reads with more confidence. Upside-down text
 *   reads as nonsense, and its confidence says so.
 * - **When that is a tie, the other axis is tried too**: a ticket close to
 *   square can fool the proportions, and only a clearly better confidence
 *   wins.
 *
 * Measured on 28 photographs turned a quarter or half a turn: 28 right.
 */
async function upright(grey: Grey, confidence: Confidence): Promise<Grey> {
  const standing = grey.width > grey.height ? turnedQuarter(grey) : grey;
  const judge = async (candidate: Grey) =>
    confidence(await greyPng(middleBand(candidate)));
  const flipped = turnedHalf(standing);
  const [asIs, turned] = await Promise.all([judge(standing), judge(flipped)]);
  let best = turned > asIs ? flipped : standing;
  let bestConfidence = Math.max(asIs, turned);
  if (Math.abs(asIs - turned) < ORIENTATION_MARGIN) {
    const across = turnedQuarter(standing);
    const others = [across, turnedHalf(across)];
    const scores = await Promise.all(others.map(judge));
    others.forEach((candidate, i) => {
      if (scores[i]! > bestConfidence + ORIENTATION_MARGIN) {
        best = candidate;
        bestConfidence = scores[i]!;
      }
    });
  }
  return best;
}

/** Requests the preparation thread has not answered yet, by id. */
type Waiting = Map<
  number,
  { resolve: (reply: PreparationReply) => void; reject: (error: Error) => void }
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
function onPreparationThread(
  request: DistributiveOmit<PreparationRequest, "id">,
): Promise<PreparationReply> {
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
    thread.postMessage({ ...request, id });
  });
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** The grey image a preparation step answered with. */
function greyOf(reply: PreparationReply): Grey {
  if (!("grey" in reply)) {
    throw new UpstreamError("The preparation thread sent no image back");
  }
  return reply.grey;
}

/**
 * The photograph as the readings start from: the ticket alone, square to the
 * frame, evenly lit, the right way up and with its lines straight. The stored
 * photograph is not changed — this is a copy, made every time OCR runs.
 *
 * 1. **Straightened** from its four corners when they can be trusted
 *    (`straightenedTicket`), otherwise **cropped** to the paper, so the table
 *    around a ticket is not read as text. A crop wider than tall is taken on
 *    its side, so that the ticket's width is what is scaled.
 * 2. **Light flattened** (`flattenedLight`): shadows, folds and faint ink.
 * 3. **Turned upright** (`upright`), by its proportions and then by its text.
 * 4. **Lines straightened** when they curve (`dewarped`).
 *
 * On 9 real tickets and 30 copies turned, darkened, shrunk and shadowed, the
 * parse score went from 27% with the crop alone to 89% with all four.
 */
export async function prepareForOcr(
  image: Buffer,
  confidence: Confidence = noConfidence,
): Promise<Grey> {
  const ticket = greyOf(
    await onPreparationThread({
      step: "ticket",
      image,
      width: OCR_TICKET_WIDTH,
    }),
  );
  const standing = await upright(ticket, confidence);
  return greyOf(
    await onPreparationThread({ step: "dewarped", grey: standing }),
  );
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

/** How many of `a`'s values `b` has too, each counted once. */
function shared(a: readonly number[], b: readonly number[]): number {
  const left = [...b];
  let count = 0;
  for (const value of a) {
    const at = left.indexOf(value);
    if (at >= 0) {
      count++;
      left.splice(at, 1);
    }
  }
  return count;
}

/**
 * The reading the others agree with.
 *
 * **The readings whose articles add up to their total, if any do**, less the
 * discounts they found: a misread digit or a lost line breaks that sum.
 * **Among those, the one whose prices the other readings share most**, every
 * reading counting, so that six readings outvote one that went wrong in its
 * own way. Measured on the bench of `OCR_READINGS`: picking instead the
 * reading `readingScore` rated highest scored 0.861 of 24 readings, against
 * 0.901 for this, because that score rewards a reading for finding more
 * lines, including lines that are not articles. The first of equals.
 *
 * **With a date from another reading when it has none.** The date is one
 * short line, and which pass reads it is close to chance; the score cannot
 * weigh it — a date bonus in `readingScore` chose worse readings. So the
 * first line of another reading that parses to a date on its own is added to
 * the end of the one kept. Measured over 111 photographs: two tickets gained
 * their date and no score fell.
 */
export function bestReading(readings: readonly string[]): string {
  const parsed = readings.map((reading) => parseReceiptText(reading));
  const prices = parsed.map(({ items }) =>
    items.map((item) => Math.round(item.parsedPrice * 100)),
  );
  const addsUp = parsed.map(({ items, totalAmount, discountAmount = 0 }) => {
    if (!totalAmount) return false;
    const sum =
      items.reduce((total, item) => total + item.parsedPrice, 0) -
      discountAmount;
    return Math.abs(sum - totalAmount) / totalAmount < 0.005;
  });
  const candidates = readings
    .map((_, index) => index)
    .filter((index) => addsUp[index] || !addsUp.includes(true));
  // Prices both readings have, less the ones only one of them has: two
  // readings that agree on everything score their length twice.
  const agreement = (index: number) =>
    prices.reduce(
      (total, other, at) =>
        at === index
          ? total
          : total +
            2 * shared(prices[index]!, other) -
            other.length -
            prices[index]!.length,
      0,
    );
  let bestIndex = candidates[0] ?? 0;
  for (const index of candidates.slice(1)) {
    if (agreement(index) > agreement(bestIndex)) bestIndex = index;
  }
  const best = readings[bestIndex] ?? "";
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

/** `prepared` read every way `OCR_READINGS` lists, all at once. */
async function readEveryWay(
  prepared: Grey,
  recognise: Recognise,
): Promise<string[]> {
  const reply = await onPreparationThread({
    step: "readings",
    grey: prepared,
    readings: OCR_READINGS,
  });
  if (!("images" in reply)) {
    throw new UpstreamError("The preparation thread sent no images back");
  }
  // In parallel: the recogniser spreads them over its workers.
  return Promise.all(
    reply.images.map((image) =>
      recognise(
        Buffer.from(image.buffer, image.byteOffset, image.byteLength),
        OCR_OPTIONS,
      ),
    ),
  );
}

/**
 * Every reading of `OCR_READINGS` of the prepared photograph, and the one
 * kept.
 *
 * A photograph taken upside down no longer needs a second round: the
 * preparation turns it by its text (`upright`). `confidence` is what judges
 * that; left out, the proportions alone decide.
 */
export async function readReceiptPhoto(
  image: Buffer,
  recognise: Recognise,
  confidence: Confidence = noConfidence,
): Promise<string> {
  const prepared = await prepareForOcr(image, confidence);
  return bestReading(await readEveryWay(prepared, recognise));
}

/** Workers when `OCR_WORKERS` does not say otherwise. */
export const DEFAULT_OCR_WORKERS = 2;

/**
 * `OCR_WORKERS` when it is a positive whole number, the default otherwise;
 * never more than the processor can run at once.
 *
 * Each worker is a thread with its own copy of the model, about 120 MB, and
 * reads one image at a time. Measured with six readings of one long ticket on
 * an 8-core machine, with the model the image bakes: 1 worker 37.9 s, 2
 * 20.7 s, 3 15.7 s; past three, the slowest single reading is what is left.
 * Two by default, because the release bundle gives the application 1 GiB.
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
 * One recogniser made of several, each image handed to the one with the
 * fewest in hand; the first of equals.
 *
 * Each keeps its own queue and its own time limit (`timedRecogniser`), so an
 * image's clock still starts when its worker starts it, and a worker that is
 * replaced takes nothing of the others' with it. A recogniser is only asked
 * once it is needed: one image at a time keeps to the first one, and so
 * starts one worker.
 */
export function pooledRecogniser<T = string>(
  recognisers: readonly ((
    image: Buffer,
    options?: RecogniseOptions,
  ) => Promise<T>)[],
): (image: Buffer, options?: RecogniseOptions) => Promise<T> {
  const inHand = recognisers.map(() => 0);
  return (image, options) => {
    const index = inHand.indexOf(Math.min(...inHand));
    inHand[index]!++;
    return recognisers[index]!(image, options).finally(() => {
      inHand[index]!--;
    });
  };
}

const ocrWorkerPool = Array.from({ length: ocrWorkers() }, () =>
  sharedWorker<Worker>(() => createWorker("spa", undefined, workerOptions())),
);

const readWithTesseract = pooledRecogniser(
  ocrWorkerPool.map((worker) => timedReader(worker)),
);

const recogniseWithTesseract: Recognise = async (image, options) =>
  (await readWithTesseract(image, options)).text;

const confidenceWithTesseract: Confidence = async (image) =>
  (await readWithTesseract(image)).confidence;

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

    const text = await readReceiptPhoto(imageBuffer, recognise, confidence);
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
  const preparation = preparationThread;
  preparationThread = null;
  await Promise.all([
    ...ocrWorkerPool.map((worker) => worker.terminate()),
    preparation?.thread.terminate(),
  ]);
}
