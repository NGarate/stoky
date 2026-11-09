/**
 * The pixel work of preparing a receipt photograph, on a thread of its own.
 *
 * **Why a thread.** The preparation (`image.ts`) is loops over every pixel
 * in JavaScript: straightening, flattening the light, turning, dewarping. On
 * the server's own thread they held the event loop for up to 2.5 s at a time
 * per photograph, measured, during which the server answered nobody. Here
 * they hold this thread instead. What needs Tesseract (which way up the
 * ticket is) stays with the caller, `prepareForOcr` in `ocr.ts`, which is
 * the only thing that talks to this thread and touches no pixels itself: it
 * is handed small PNGs to judge, and answers with the turn to make.
 *
 * Next bundles this file as a `[worker thread]` chunk because `ocr.ts`
 * starts it with `new Worker(new URL(…, import.meta.url))`, and its
 * standalone output keeps the chunk: checked on a production build, where
 * the chunk ran under Bun and answered.
 */
import { parentPort } from "node:worker_threads";
import {
  type Grey,
  croppedTicket,
  dewarped,
  flattenedLight,
  greyPng,
  greyPngs,
  middleBand,
  straightenedTicket,
  thinned,
  turnedHalf,
  turnedQuarter,
} from "./image";

/** Quarter turns clockwise. */
export type Turn = 0 | 1 | 2 | 3;

/** What `prepareForOcr` asks of this thread, one step at a time. */
export type PreparationRequest =
  | {
      id: number;
      /**
       * The ticket straightened or cropped, standing, with its light
       * flattened — and, as PNGs indexed by `Turn`, its middle band turned
       * each way, for Tesseract to say which way up it reads.
       */
      step: "ticket";
      image: Uint8Array;
      width: number;
    }
  | {
      id: number;
      /** `grey` turned by `turn`, with its lines straightened when they curve. */
      step: "upright";
      grey: Grey;
      turn: Turn;
    }
  | {
      id: number;
      /** `grey` as a PNG per reading, scaled and with its ink thinned as each asks. */
      step: "readings";
      grey: Grey;
      readings: readonly { scale: number; thin: boolean }[];
    };

/** What a step hands back: an image, PNGs, or both. */
export interface Prepared {
  grey?: Grey;
  images?: Uint8Array[];
}

/** The answer to the request with the same `id`. */
export type PreparationReply =
  | (Prepared & { id: number })
  | { id: number; error: { name: string; message: string } };

/** `grey` turned `turn` quarters clockwise. */
function turned(grey: Grey, turn: Turn): Grey {
  const quarter = turn % 2 ? turnedQuarter(grey) : grey;
  return turn >= 2 ? turnedHalf(quarter) : quarter;
}

async function answer(
  request: PreparationRequest,
): Promise<{ grey?: Grey; images?: Buffer[] }> {
  switch (request.step) {
    case "ticket": {
      const image = Buffer.from(
        request.image.buffer,
        request.image.byteOffset,
        request.image.byteLength,
      );
      const ticket = flattenedLight(
        (await straightenedTicket(image, request.width)) ??
          (await croppedTicket(image, request.width)),
      );
      // A ticket is longer than it is wide: one wider than tall lies on its side.
      const grey =
        ticket.width > ticket.height ? turnedQuarter(ticket) : ticket;
      const across = turnedQuarter(grey);
      const images = await Promise.all(
        [grey, across, turnedHalf(grey), turnedHalf(across)].map((turn) =>
          greyPng(middleBand(turn)),
        ),
      );
      return { grey, images };
    }
    case "upright":
      return { grey: dewarped(turned(request.grey, request.turn)) };
    case "readings": {
      const { grey, readings } = request;
      const images: Buffer[] = [];
      // One source at a time, each a bitmap resized to all its widths: a
      // bitmap per reading held six full-size bitmaps at once.
      for (const thin of [false, true]) {
        const at = readings.flatMap((reading, i) =>
          reading.thin === thin ? [i] : [],
        );
        if (at.length === 0) continue;
        const pngs = await greyPngs(
          thin ? thinned(grey) : grey,
          at.map((i) => Math.round(grey.width * readings[i]!.scale)),
        );
        at.forEach((i, k) => (images[i] = pngs[k]!));
      }
      return { images };
    }
  }
}

parentPort?.on("message", async (request: PreparationRequest) => {
  try {
    const { grey, images = [] } = await answer(request);
    const pngs = images.map((png) => new Uint8Array(png));
    // The pixels go back without a copy: nothing here keeps them.
    const transfer = [
      ...(grey ? [grey.pixels.buffer] : []),
      ...pngs.map((png) => png.buffer),
    ];
    parentPort!.postMessage(
      { id: request.id, grey, images: pngs } satisfies PreparationReply,
      transfer as ArrayBuffer[],
    );
  } catch (error) {
    const { name, message } =
      error instanceof Error ? error : new Error(String(error));
    parentPort!.postMessage({
      id: request.id,
      error: { name, message },
    } satisfies PreparationReply);
  }
});
