/**
 * The pixel work of preparing a receipt photograph, on a thread of its own.
 *
 * **Why a thread.** The preparation (`image.ts`) is loops over every pixel
 * in JavaScript: straightening, flattening the light, dewarping. On the
 * server's own thread they held the event loop for up to 2.5 s at a time
 * per photograph, measured, during which the server answered nobody. Here
 * they hold this thread instead. What needs Tesseract (which way up the
 * ticket is) stays with the caller, `prepareForOcr` in `ocr.ts`, which is
 * the only thing that talks to this thread.
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
  straightenedTicket,
  thinned,
} from "./image";

/** What `prepareForOcr` asks of this thread, one step at a time. */
export type PreparationRequest =
  | {
      id: number;
      /** The ticket straightened or cropped, standing, with its light flattened. */
      step: "ticket";
      image: Uint8Array;
      width: number;
    }
  | {
      id: number;
      /** `grey` with its lines straightened when they curve. */
      step: "dewarped";
      grey: Grey;
    }
  | {
      id: number;
      /** `grey` as a PNG per reading, scaled and with its ink thinned as each asks. */
      step: "readings";
      grey: Grey;
      readings: readonly { scale: number; thin: boolean }[];
    };

/** The answer to the request with the same `id`. */
export type PreparationReply =
  | { id: number; grey: Grey }
  | { id: number; images: Uint8Array[] }
  | { id: number; error: { name: string; message: string } };

async function answer(
  request: PreparationRequest,
): Promise<{ grey: Grey } | { images: Uint8Array[] }> {
  switch (request.step) {
    case "ticket": {
      const image = Buffer.from(
        request.image.buffer,
        request.image.byteOffset,
        request.image.byteLength,
      );
      const grey =
        (await straightenedTicket(image, request.width)) ??
        (await croppedTicket(image, request.width));
      return { grey: flattenedLight(grey) };
    }
    case "dewarped":
      return { grey: dewarped(request.grey) };
    case "readings": {
      const { grey, readings } = request;
      const thin = readings.some((reading) => reading.thin)
        ? thinned(grey)
        : grey;
      const images = await Promise.all(
        readings.map((reading) =>
          greyPng(
            reading.thin ? thin : grey,
            Math.round(grey.width * reading.scale),
          ),
        ),
      );
      return { images: images.map((png) => new Uint8Array(png)) };
    }
  }
}

parentPort?.on("message", async (request: PreparationRequest) => {
  try {
    const result = await answer(request);
    // The pixels go back without a copy: nothing here keeps them.
    const transfer =
      "grey" in result
        ? [result.grey.pixels.buffer]
        : result.images.map((image) => image.buffer);
    parentPort!.postMessage(
      { id: request.id, ...result } satisfies PreparationReply,
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
