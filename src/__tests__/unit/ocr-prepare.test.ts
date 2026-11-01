import { describe, it, expect } from "bun:test";
import { cropImage, decodePng, findPaper } from "@/server/services/image";
import {
  OCR_MIN_WIDTH,
  OCR_PASSES,
  bestReading,
  prepareForOcr,
  readReceiptPhoto,
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

describe("prepareForOcr", () => {
  it("hands the OCR the ticket alone, grey, at a readable width", async () => {
    const prepared = await pixelsOf(await prepareForOcr(ticketOnATable()));

    // The 100-pixel-wide ticket, upscaled; none of the table is left.
    expect(prepared.width).toBe(OCR_MIN_WIDTH);
    expect(prepared.height / prepared.width).toBeCloseTo(
      (240 + 2 * 4) / (100 + 2 * 4),
      0,
    );
    const [r, g, b] = prepared.at(prepared.width >> 1, 2);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("does not shrink a photograph already wide enough", async () => {
    const wide = pngPainted(1600, 200, (_, y) => (y % 12 < 3 ? INK : PAPER));

    expect((await pixelsOf(await prepareForOcr(wide))).width).toBe(1600);
  });
});

describe("readReceiptPhoto", () => {
  const READ = "LECHE ENTERA 1,00\nPAN 0,50\nTOTAL 1,50";

  it("reads an ordinary ticket once per pass", async () => {
    const seen: Buffer[] = [];
    const text = await readReceiptPhoto(ticketOnATable(), async (image) => {
      seen.push(image);
      return READ;
    });

    expect(text).toBe(READ);
    expect(seen).toHaveLength(OCR_PASSES.length);
  });

  it("turns a ticket that gave no article upside down and reads it again", async () => {
    const seen: Buffer[] = [];
    const text = await readReceiptPhoto(ticketOnATable(), async (image) => {
      seen.push(image);
      return seen.length > OCR_PASSES.length ? READ : "05,1 LATOT";
    });

    expect(text).toBe(READ);
    expect(seen).toHaveLength(2 * OCR_PASSES.length);
    // The same picture, half a turn round: its first row is the last one.
    const upright = await pixelsOf(seen[0]!);
    const turned = await pixelsOf(seen[OCR_PASSES.length]!);
    expect([turned.width, turned.height]).toEqual([
      upright.width,
      upright.height,
    ]);
    for (const y of [0, 5, upright.height >> 1]) {
      expect(turned.at(3, upright.height - 1 - y)).toEqual(
        upright.at(upright.width - 4, y),
      );
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
});
