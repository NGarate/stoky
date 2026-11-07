import { describe, it, expect } from "bun:test";
import {
  type Grey,
  croppedTicket,
  cropImage,
  decodePng,
  dewarped,
  findPaper,
  flattenedLight,
  straightenedTicket,
  thinned,
} from "@/server/services/image";
import {
  type Confidence,
  OCR_OPTIONS,
  OCR_TICKET_WIDTH,
  OCR_READINGS,
  bestReading,
  ocrWorkers,
  pooledRecogniser,
  prepareForOcr,
  readReceiptPhoto,
  terminateWorker,
} from "@/server/services/ocr";
import { parseReceiptText } from "@/server/services/receiptParser";
import { pngPainted } from "../utils/png";

/**
 * What the OCR is handed instead of the photograph: the paper alone, grey and
 * wide enough to read. Tesseract read a wooden table as words, so the crop is
 * the change these tests hold in place.
 */

const WOOD: [number, number, number] = [120, 72, 30];
const PAPER: [number, number, number] = [235, 235, 228];
const INK: [number, number, number] = [20, 20, 20];

/** A 400 × 300 table with a 100 × 240 ticket on it at (150, 30), printed with rows of ink. */
function ticketOnATable(): Buffer {
  return pngPainted(400, 300, (x, y) => {
    if (x < 150 || x >= 250 || y < 30 || y >= 270) return WOOD;
    return y % 12 < 3 && x > 160 && x < 240 ? INK : PAPER;
  });
}

/** Every pixel of an image `Bun.Image` can read, as rows of RGB(A). */
async function pixelsOf(image: Buffer) {
  const png = Buffer.from(await new Bun.Image(image).png().toBuffer());
  const rows: Uint8Array[] = [];
  const { width, height, channels } = decodePng(png, (_, row) =>
    rows.push(row.slice()),
  );
  const at = (x: number, y: number) =>
    Array.from(rows[y]!.subarray(x * channels, x * channels + 3));
  return { width, height, at };
}

describe("findPaper", () => {
  it("finds the ticket on the table, to within its margin", async () => {
    const paper = await findPaper(ticketOnATable(), 400, 300);

    expect(paper).not.toBeNull();
    expect(Math.abs(paper!.left - 150)).toBeLessThanOrEqual(5);
    expect(Math.abs(paper!.left + paper!.width - 250)).toBeLessThanOrEqual(5);
    expect(Math.abs(paper!.top - 30)).toBeLessThanOrEqual(5);
    expect(Math.abs(paper!.top + paper!.height - 270)).toBeLessThanOrEqual(5);
  });

  it("finds the ticket under a coloured light", async () => {
    // A blue cast: the paper itself is far from grey (R 137, B 241).
    const cast = (c: [number, number, number]): [number, number, number] => [
      Math.round(c[0] * 0.58),
      Math.round(c[1] * 0.78),
      c[2] === 30 ? 60 : Math.min(255, Math.round(c[2] * 1.03)),
    ];
    const blue = pngPainted(400, 300, (x, y) => {
      if (x < 150 || x >= 250 || y < 30 || y >= 270) return cast(WOOD);
      return cast(y % 12 < 3 && x > 160 && x < 240 ? INK : PAPER);
    });

    const paper = await findPaper(blue, 400, 300);

    expect(paper).not.toBeNull();
    expect(Math.abs(paper!.left - 150)).toBeLessThanOrEqual(5);
    expect(Math.abs(paper!.left + paper!.width - 250)).toBeLessThanOrEqual(5);
  });

  it("keeps the end of the ticket that is in shadow", async () => {
    const SHADED: [number, number, number] = [125, 125, 120];
    const shaded = pngPainted(400, 300, (x, y) => {
      if (x < 150 || x >= 250 || y < 30 || y >= 270) return WOOD;
      if (y % 12 < 3 && x > 160 && x < 240) return INK;
      return y < 150 ? PAPER : SHADED;
    });

    const paper = await findPaper(shaded, 400, 300);

    expect(paper).not.toBeNull();
    expect(Math.abs(paper!.top + paper!.height - 270)).toBeLessThanOrEqual(5);
  });

  it("leaves a photograph that is all paper as it is", async () => {
    const scan = pngPainted(200, 300, (_, y) => (y % 12 < 3 ? INK : PAPER));

    expect(await findPaper(scan, 200, 300)).toBeNull();
  });

  it("leaves a photograph with no paper in it as it is", async () => {
    expect(
      await findPaper(
        pngPainted(200, 300, () => WOOD),
        200,
        300,
      ),
    ).toBeNull();
  });
});

describe("cropImage", () => {
  it("keeps exactly the pixels inside the region", async () => {
    const image = pngPainted(40, 30, (x, y) => [x * 5, y * 7, 99]);

    const cropped = await pixelsOf(
      await cropImage(image, { left: 10, top: 5, width: 20, height: 15 }),
    );

    expect([cropped.width, cropped.height]).toEqual([20, 15]);
    expect(cropped.at(0, 0)).toEqual([50, 35, 99]);
    expect(cropped.at(19, 14)).toEqual([145, 133, 99]);
  });
});

/** Room for a test that prepares whole photographs: each takes 1–3 s. */
const PREPARING = 30_000;

/** What share of a grey image's pixels are ink (below half brightness). */
function inkShare(grey: Grey, from = 0, to = grey.width): number {
  let ink = 0;
  for (let y = 0; y < grey.height; y++) {
    for (let x = from; x < to; x++)
      if (grey.pixels[y * grey.width + x]! < 128) ink++;
  }
  return ink / (grey.height * (to - from));
}

/** A grey image painted pixel by pixel. */
function greyPainted(
  width: number,
  height: number,
  paint: (x: number, y: number) => number,
): Grey {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels[y * width + x] = paint(x, y);
  }
  return { width, height, pixels };
}

/**
 * A 100 × 240 ticket on a table whose printed lines start at the left margin
 * and stop short of the right one, the way a ticket's article names do. Its
 * left and right are therefore told apart, and so is which way up it is.
 */
function leftAlignedTicket(turn: 0 | 90 | 180 = 0): Buffer {
  const W = turn === 90 ? 300 : 400;
  const H = turn === 90 ? 400 : 300;
  return pngPainted(W, H, (px, py) => {
    // The upright ticket's own coordinates for this pixel.
    let [x, y] = [px, py];
    if (turn === 180) [x, y] = [399 - px, 299 - py];
    if (turn === 90) [x, y] = [py, 299 - px];
    if (x < 150 || x >= 250 || y < 30 || y >= 270) return WOOD;
    return y % 12 < 3 && x > 160 && x < 210 ? INK : PAPER;
  });
}

describe("croppedTicket", () => {
  it("hands back the ticket alone, grey, at the width it is prepared at", async () => {
    const grey = await croppedTicket(ticketOnATable(), OCR_TICKET_WIDTH);

    // The 100-pixel-wide ticket, upscaled; none of the table is left.
    expect(grey.width).toBe(OCR_TICKET_WIDTH);
    expect(grey.height / grey.width).toBeCloseTo(
      (240 + 2 * 4) / (100 + 2 * 4),
      0,
    );
  });

  it("does not shrink a ticket already wide enough", async () => {
    const wide = pngPainted(1600, 4000, (_, y) => (y % 12 < 3 ? INK : PAPER));

    expect((await croppedTicket(wide, OCR_TICKET_WIDTH)).width).toBe(1600);
  });
});

describe("straightenedTicket", () => {
  /**
   * A 300 × 700 ticket turned `degrees` on a dark table, in a 1000 × 1000
   * photo. Darker than `WOOD`: paper must be three times as bright as its
   * table for the corners to be trusted, and `WOOD` is only twice.
   */
  function tiltedTicket(
    degrees: number,
    table: [number, number, number] = [50, 35, 20],
  ): Buffer {
    const t = (degrees * Math.PI) / 180;
    return pngPainted(1000, 1000, (px, py) => {
      const dx = px - 500;
      const dy = py - 500;
      const x = dx * Math.cos(t) + dy * Math.sin(t);
      const y = -dx * Math.sin(t) + dy * Math.cos(t);
      if (Math.abs(x) > 150 || Math.abs(y) > 350) return table;
      return (y + 350) % 24 < 6 && Math.abs(x) < 120 ? INK : PAPER;
    });
  }

  it("turns a tilted ticket into an upright rectangle", async () => {
    const grey = await straightenedTicket(tiltedTicket(8), OCR_TICKET_WIDTH);

    expect(grey).not.toBeNull();
    expect(grey!.width).toBe(OCR_TICKET_WIDTH);
    expect(grey!.height / grey!.width).toBeCloseTo(700 / 300, 1);
    // Straight: a printed line runs level across the rectangle, so some row
    // is inked across most of its middle.
    const middle = (y: number) => {
      let ink = 0;
      for (let x = 300; x < 1100; x++)
        if (grey!.pixels[y * grey!.width + x]! < 128) ink++;
      return ink / 800;
    };
    let best = 0;
    for (let y = 0; y < grey!.height; y++) best = Math.max(best, middle(y));
    expect(best).toBeGreaterThan(0.9);
  });

  it("leaves a ticket that is already square to the frame to the crop", async () => {
    expect(
      await straightenedTicket(tiltedTicket(0), OCR_TICKET_WIDTH),
    ).toBeNull();
  });

  it("does not trust corners when the paper is not three times as bright as the table", async () => {
    // WOOD is about twice as dark as the paper: the outline found on such a
    // table was the table's often enough that a warp did more harm than good.
    expect(
      await straightenedTicket(tiltedTicket(8, WOOD), OCR_TICKET_WIDTH),
    ).toBeNull();
  });

  it("does not trust corners when the table is as light as the paper", async () => {
    const light: [number, number, number] = [200, 200, 195];

    expect(
      await straightenedTicket(tiltedTicket(8, light), OCR_TICKET_WIDTH),
    ).toBeNull();
  });
});

describe("flattenedLight", () => {
  it("makes paper white and ink black on both sides of a shadow", () => {
    // The left half in shadow: its paper is darker than the right half's ink
    // is light, so no single cut could separate both.
    const shaded = greyPainted(900, 600, (x, y) => {
      const paper = x < 450 ? 110 : 235;
      return y % 30 < 6 && x % 450 > 60 && x % 450 < 390 ? paper * 0.3 : paper;
    });
    const flat = flattenedLight(shaded);
    const at = (x: number, y: number) => flat.pixels[y * flat.width + x]!;

    // Away from the top edge: a dark block within two blocks of the crop's
    // edge is taken for the table and blanked, by design.
    for (const x of [200, 700]) {
      expect(at(x, 315)).toBe(255); // paper between lines
      expect(at(x, 303)).toBeLessThan(60); // a line
    }
  });

  it("brings faint ink out as firmly as dark ink", () => {
    const faint = greyPainted(900, 600, (x, y) =>
      y % 30 < 6 && x > 60 && x < 840 ? (x < 450 ? 40 : 170) : 235,
    );
    const flat = flattenedLight(faint);

    expect(flat.pixels[303 * flat.width + 700]!).toBeLessThan(60);
  });
});

describe("dewarped", () => {
  /** Lines bowed down by `bow` pixels at the edges, as on a ticket that curls. */
  function curled(bow: number): Grey {
    return greyPainted(1400, 1200, (x, y) => {
      const u = (x - 700) / 700;
      const lineY = (y - bow * u * u) % 40;
      return lineY >= 0 && lineY < 8 && x > 40 && x < 1360 && y > 80 && y < 1120
        ? 20
        : 240;
    });
  }

  /** How far the ink at the edge sits from the ink in the middle, in rows. */
  function bowOf(grey: Grey): number {
    const firstInk = (x: number) => {
      for (let y = 200; y < grey.height; y++) {
        if (grey.pixels[y * grey.width + x]! < 128) return y;
      }
      return -1;
    };
    // The same line: the first ink at or below row 200 in the middle, and the
    // ink nearest that row at the edge.
    const middle = firstInk(700);
    const edge = firstInk(80);
    return Math.min(Math.abs(edge - middle), Math.abs(edge - middle - 40));
  }

  it("brings a curled ticket's lines level", () => {
    const before = curled(16);
    const after = dewarped(before);

    expect(bowOf(before)).toBeGreaterThanOrEqual(10);
    expect(bowOf(after)).toBeLessThanOrEqual(3);
  });

  it("leaves straight lines alone", () => {
    const straight = curled(0);

    expect(dewarped(straight)).toBe(straight);
  });
});

describe("thinned", () => {
  it("narrows the ink by a pixel on every side and keeps the size", () => {
    // A block of ink 5 × 5, columns 10–14 and rows 6–10, on white.
    const block = greyPainted(30, 20, (x, y) =>
      x >= 10 && x < 15 && y >= 6 && y < 11 ? 20 : 255,
    );
    const thin = thinned(block);
    const inked = (x: number, y: number) =>
      thin.pixels[y * thin.width + x]! < 128;

    expect([thin.width, thin.height]).toEqual([30, 20]);
    expect(
      Array.from({ length: 30 }, (_, x) => x).filter((x) => inked(x, 8)),
    ).toEqual([11, 12, 13]);
    expect(
      Array.from({ length: 20 }, (_, y) => y).filter((y) => inked(12, y)),
    ).toEqual([7, 8, 9]);
  });
});

describe("prepareForOcr", () => {
  /** Tesseract's confidence, as far as these tests need it: sure of text that starts on the left. */
  const likesLeftText: Confidence = async (png) => {
    const band = await pixelsOf(png);
    const grey: Grey = greyPainted(
      band.width,
      band.height,
      (x, y) => band.at(x, y)[0]!,
    );
    const half = grey.width >> 1;
    return inkShare(grey, 0, half) > inkShare(grey, half) ? 90 : 20;
  };

  it(
    "hands back the ticket upright, by its text",
    async () => {
      for (const turn of [0, 180] as const) {
        const prepared = await prepareForOcr(
          leftAlignedTicket(turn),
          likesLeftText,
        );
        const half = prepared.width >> 1;

        expect(inkShare(prepared, 0, half)).toBeGreaterThan(
          inkShare(prepared, half),
        );
      }
    },
    PREPARING,
  );

  it(
    "stands a ticket photographed on its side the long way up",
    async () => {
      const prepared = await prepareForOcr(
        leftAlignedTicket(90),
        likesLeftText,
      );
      const half = prepared.width >> 1;

      expect(prepared.height).toBeGreaterThan(prepared.width);
      expect(inkShare(prepared, 0, half)).toBeGreaterThan(
        inkShare(prepared, half),
      );
    },
    PREPARING,
  );

  it(
    "with no judge of text, goes by the proportions alone",
    async () => {
      const prepared = await prepareForOcr(leftAlignedTicket(180));
      const half = prepared.width >> 1;

      // Upside down as photographed: nothing said otherwise.
      expect(inkShare(prepared, half)).toBeGreaterThan(
        inkShare(prepared, 0, half),
      );
    },
    PREPARING,
  );
});

describe("prepareForOcr's thread", () => {
  it(
    "leaves the server's thread free while it works",
    async () => {
      // A 1200 × 1600 photo: its preparation is seconds of pixel loops.
      const photo = pngPainted(1200, 1600, (x, y) => {
        if (x < 200 || x >= 1000 || y < 100 || y >= 1500) return WOOD;
        return y % 24 < 6 && x > 260 && x < 900 ? INK : PAPER;
      });
      let last = performance.now();
      let longest = 0;
      const tick = setInterval(() => {
        const now = performance.now();
        longest = Math.max(longest, now - last);
        last = now;
      }, 5);
      try {
        await prepareForOcr(photo);
      } finally {
        clearInterval(tick);
      }

      // On this thread the same work stalls it for most of a second at a time.
      expect(longest).toBeLessThan(250);
    },
    PREPARING,
  );

  it(
    "fails with the error the preparation met, and carries on after it",
    async () => {
      await expect(
        prepareForOcr(Buffer.from("not an image")),
      ).rejects.toThrow();

      const prepared = await prepareForOcr(ticketOnATable());
      expect(prepared.width).toBe(OCR_TICKET_WIDTH);
    },
    PREPARING,
  );

  it(
    "starts again after it was stopped",
    async () => {
      await terminateWorker();

      expect((await prepareForOcr(ticketOnATable())).width).toBe(
        OCR_TICKET_WIDTH,
      );
    },
    PREPARING,
  );
});

describe("prepareForOcr on a straightened ticket", () => {
  it(
    "stands a tilted ticket lying on its side the long way up",
    async () => {
      // 700 × 300, long side across, tilted 8°, on a dark table.
      const t = (8 * Math.PI) / 180;
      const lying = pngPainted(1000, 1000, (px, py) => {
        const dx = px - 500;
        const dy = py - 500;
        const x = dx * Math.cos(t) + dy * Math.sin(t);
        const y = -dx * Math.sin(t) + dy * Math.cos(t);
        if (Math.abs(x) > 350 || Math.abs(y) > 150) return [50, 35, 20];
        return (x + 350) % 24 < 6 && Math.abs(y) < 120 ? INK : PAPER;
      });
      const prepared = await prepareForOcr(lying);

      expect(prepared.height / prepared.width).toBeCloseTo(700 / 300, 1);
    },
    PREPARING,
  );
});

describe("readReceiptPhoto", () => {
  const READ = "LECHE ENTERA 1,00\nPAN 0,50\nTOTAL 1,50";

  it("reads the prepared ticket once for each of the readings, at their sizes", async () => {
    const seen: { width: number; options: unknown }[] = [];
    const text = await readReceiptPhoto(
      ticketOnATable(),
      async (image, options) => {
        seen.push({ width: (await pixelsOf(image)).width, options });
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

  it("reads the ticket with its ink thinned as well as as it is", async () => {
    const inkAt = new Map<number, number[]>();
    await readReceiptPhoto(ticketOnATable(), async (image) => {
      const { width, height, at } = await pixelsOf(image);
      let ink = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) if (at(x, y)[0]! < 128) ink++;
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

  it("keeps the default of two for anything else", () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "dos"]) {
      expect(ocrWorkers(value, 8)).toBe(2);
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
