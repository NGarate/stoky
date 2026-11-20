import { describe, it, expect } from "bun:test";
import {
  OCR_OPTIONS,
  OCR_TICKET_WIDTH,
  OCR_READINGS,
  bestReading,
  ocrWorkers,
  pooledRecogniser,
  readFramedLines,
  readReceiptPhoto,
} from "@/server/services/ocr";
import { InvalidInputError } from "@/server/services/errors";
import { parseReceiptText } from "@/server/services/receiptParser";
import { pngPainted } from "../utils/png";
import {
  INK,
  PAPER,
  PREPARING,
  inkOf,
  leftAlignedTicket,
  likesLeftText,
  ticketOnATable,
} from "../utils/tickets";

/**
 * How the prepared ticket is read: every way `OCR_READINGS` lists, and the
 * reading kept. How it is prepared is `ocr-prepare.test.ts`'s.
 */

describe("readReceiptPhoto", () => {
  const READ = "LECHE ENTERA 1,00\nPAN 0,50\nTOTAL 1,50";

  it("reads the prepared ticket once for each of the readings, at their sizes", async () => {
    const seen: { width: number; options: unknown }[] = [];
    const text = await readReceiptPhoto(
      ticketOnATable(),
      async (image, options) => {
        seen.push({
          width: (await new Bun.Image(image).metadata()).width,
          options,
        });
        return READ;
      },
    );

    expect(text).toBe(READ);
    expect(seen.map(({ width }) => width).sort()).toEqual(
      OCR_READINGS.map(({ scale }) =>
        Math.round(OCR_TICKET_WIDTH * scale),
      ).sort(),
    );
    for (const { options } of seen) expect(options).toEqual(OCR_OPTIONS);
  });

  it("asks for every reading before the first one answers", async () => {
    let asked = 0;
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const reading = readReceiptPhoto(ticketOnATable(), async () => {
      if (++asked === OCR_READINGS.length) answer();
      await answered;
      return READ;
    });

    expect(await reading).toBe(READ);
    expect(asked).toBe(OCR_READINGS.length);
  });

  it("reads it half turned when nothing was read and no judge said which way up", async () => {
    let calls = 0;
    const text = await readReceiptPhoto(ticketOnATable(), async () =>
      ++calls > OCR_READINGS.length ? READ : "",
    );

    expect(text).toBe(READ);
    expect(calls).toBe(2 * OCR_READINGS.length);
  });

  it(
    "does not read it again when its text said which way up",
    async () => {
      let calls = 0;
      await readReceiptPhoto(
        leftAlignedTicket(),
        async () => (calls++, ""),
        likesLeftText,
      );

      expect(calls).toBe(OCR_READINGS.length);
    },
    PREPARING,
  );

  it("calls off the readings still waiting when one fails", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const reading = readReceiptPhoto(
      ticketOnATable(),
      async (_image, _options, signal) => {
        signals.push(signal);
        if (signals.length === 1) throw new Error("timed out");
        return READ;
      },
    );

    await expect(reading).rejects.toThrow("timed out");
    expect(signals).toHaveLength(OCR_READINGS.length);
    for (const signal of signals) expect(signal?.aborted).toBe(true);
  });

  it("reads the ticket with its ink thinned as well as as it is", async () => {
    const inkAt = new Map<number, number[]>();
    await readReceiptPhoto(ticketOnATable(), async (image) => {
      const { width, ink } = inkOf(image);
      inkAt.set(width, [...(inkAt.get(width) ?? []), ink]);
      return READ;
    });

    // Each size is read twice, and one of the two has visibly less ink.
    expect(inkAt.size).toBe(3);
    for (const [, [one, two]] of inkAt) {
      expect(Math.min(one!, two!)).toBeLessThan(Math.max(one!, two!) * 0.99);
    }
  });
});

describe("readFramedLines", () => {
  /** 400 × 300, ink in its top-left quarter only, paper elsewhere. */
  const quarterInked = () =>
    pngPainted(400, 300, (x, y) => (x < 200 && y < 150 ? INK : PAPER));

  /** How dark each image read was, on average, and how wide. */
  async function framed(quad: Parameters<typeof readFramedLines>[1]) {
    const seen: { width: number; dark: number }[] = [];
    await readFramedLines(quarterInked(), quad, async (image) => {
      const { width, height, ink } = inkOf(image);
      seen.push({ width, dark: ink / (width * height) });
      return "PAN 1,00";
    });
    return seen;
  }

  it(
    "reads only what was framed, every way, scaled as a ticket's width is",
    async () => {
      const inked = await framed([
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [0, 0.5],
      ]);
      const blank = await framed([
        [0.5, 0.5],
        [1, 0.5],
        [1, 1],
        [0.5, 1],
      ]);

      expect(inked.map(({ width }) => width).sort()).toEqual(
        OCR_READINGS.map(({ scale }) =>
          Math.round(OCR_TICKET_WIDTH * scale),
        ).sort(),
      );
      for (const { dark } of inked) expect(dark).toBeGreaterThan(0.9);
      for (const { dark } of blank) expect(dark).toBeLessThan(0.1);
    },
    PREPARING,
  );

  it("refuses a frame with nothing inside it", async () => {
    const point: [number, number] = [0.3, 0.3];
    const reading = readFramedLines(
      quarterInked(),
      [point, point, point, point],
      async () => "",
    );

    await expect(reading).rejects.toBeInstanceOf(InvalidInputError);
  });
});

describe("bestReading", () => {
  it("takes the date from another reading when the one kept has none", () => {
    const text = bestReading([
      "PAN 1,00\nTOTAL 1,00\n| _va-0d 2024 19:55:50",
      "PAN 1,00\n08-04-2024 19:58:56",
    ]);

    const date = parseReceiptText(text).purchaseDate!;
    expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([
      2024, 4, 8,
    ]);
  });

  it("leaves a reading that has its own date as it is", () => {
    const kept = "PAN 1,00\nTOTAL 1,00\n07-04-2024 10:00";

    expect(bestReading([kept, "PAN 1,00\n08-04-2024 19:58:56"])).toBe(kept);
  });
});

describe("bestReading", () => {
  it("believes the reading whose articles less its discounts make the total", () => {
    const good =
      "CARREFOUR\nZUMO 2,00\nDTO ZUMO -0,50\nPAN 1,00\nLECHE 2,00\nTOTAL 4,50";
    const misread = good.replace("LECHE 2,00", "LECHE 1,50");

    expect(bestReading([misread, good])).toBe(good);
  });

  it("keeps, of the readings that add up, the one the others agree with", () => {
    // Both add up; the second has misread two prices in a way that still
    // sums, and the other readings, which do not add up, side with the first.
    const right = "PAN 1,49\nLECHE 2,99\nTOTAL 4,48";
    const lucky = "PAN 1,99\nLECHE 2,49\nTOTAL 4,48";
    const others = [
      "PAN 1,49\nLECHE 2,93\nTOTAL 4,48",
      "PAN 1,49\nLECHE 2,99\nHUEVOS 9,99\nTOTAL 4,48",
    ];

    expect(bestReading([lucky, right, ...others])).toBe(right);
    expect(bestReading([right, lucky, ...others])).toBe(right);
  });

  it("keeps the one the others agree with when none adds up", () => {
    const agreed = "PAN 1,49\nLECHE 2,99\nTOTAL 9,00";
    const alone = "PAN 7,77\nLECHE 8,88\nTOTAL 9,00";

    expect(
      bestReading([alone, agreed, "PAN 1,49\nLECHE 2,99\nTOTAL 8,00"]),
    ).toBe(agreed);
  });
});

describe("ocrWorkers", () => {
  it("reads a positive whole number, up to the processors there are", () => {
    expect(ocrWorkers("3", 8)).toBe(3);
    expect(ocrWorkers("12", 4)).toBe(4);
  });

  it("keeps the default of three for anything else", () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "dos"]) {
      expect(ocrWorkers(value, 8)).toBe(3);
    }
  });

  it("never asks for fewer than one, nor more than a single processor runs", () => {
    expect(ocrWorkers(undefined, 1)).toBe(1);
  });
});

describe("pooledRecogniser", () => {
  /** A recogniser that holds every image until it is told to answer. */
  function held(name: string) {
    const waiting: (() => void)[] = [];
    return {
      waiting,
      recognise: () =>
        new Promise<string>((resolve) => waiting.push(() => resolve(name))),
    };
  }

  it("hands images that arrive together to different recognisers", async () => {
    const a = held("a");
    const b = held("b");
    const pool = pooledRecogniser([a.recognise, b.recognise]);
    const one = pool(Buffer.alloc(0));
    const two = pool(Buffer.alloc(0));

    expect([a.waiting.length, b.waiting.length]).toEqual([1, 1]);
    a.waiting[0]!();
    b.waiting[0]!();
    expect([await one, await two]).toEqual(["a", "b"]);
  });

  it("keeps to the first while it is free, so one image starts one worker", async () => {
    const a = held("a");
    const b = held("b");
    const pool = pooledRecogniser([a.recognise, b.recognise]);

    const first = pool(Buffer.alloc(0));
    a.waiting[0]!();
    await first;
    const second = pool(Buffer.alloc(0));
    a.waiting[1]!();

    expect(await second).toBe("a");
    expect(b.waiting).toHaveLength(0);
  });

  it("gives a waiting image to whichever recogniser frees first", async () => {
    const stuck = held("stuck");
    const quick = held("quick");
    const pool = pooledRecogniser([stuck.recognise, quick.recognise]);
    const images = [0, 1, 2, 3].map(() => pool(Buffer.alloc(0)));

    // The first is stuck; the rest go through the other as it frees.
    for (let i = 0; i < 3; i++) {
      quick.waiting[i]!();
      await images[i + 1];
    }

    expect(await Promise.all(images.slice(1))).toEqual([
      "quick",
      "quick",
      "quick",
    ]);
    expect(stuck.waiting).toHaveLength(1);
  });

  it("drops the images still waiting once their receipt has failed", async () => {
    const only = held("a");
    const pool = pooledRecogniser([only.recognise]);
    const failed = new AbortController();
    const images = [0, 1, 2].map(() =>
      pool(Buffer.alloc(0), undefined, failed.signal).catch(() => "dropped"),
    );

    failed.abort();
    only.waiting[0]!();

    // The one already started ends; the two behind it are never read.
    expect(await Promise.all(images)).toEqual(["a", "dropped", "dropped"]);
    expect(only.waiting).toHaveLength(1);
  });

  it("frees a recogniser whose image failed", async () => {
    let calls = 0;
    const pool = pooledRecogniser([
      async () => {
        calls++;
        throw new Error("unreadable");
      },
      async () => "b",
    ]);

    await expect(pool(Buffer.alloc(0))).rejects.toThrow("unreadable");
    await expect(pool(Buffer.alloc(0))).rejects.toThrow("unreadable");
    expect(calls).toBe(2);
  });
});
