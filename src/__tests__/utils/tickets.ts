import { decodePng } from "@/server/services/image";
import type { Confidence } from "@/server/services/ocr";
import { pngPainted } from "./png";

/**
 * The photographs the OCR tests prepare and read, and how they look at what
 * comes back: shared by `unit/ocr-prepare.test.ts` and
 * `unit/ocr-read.test.ts`, which are two files so that a parallel run can
 * prepare in both at once.
 */

export const WOOD: [number, number, number] = [120, 72, 30];
export const PAPER: [number, number, number] = [235, 235, 228];
export const INK: [number, number, number] = [20, 20, 20];

/** A 400 × 300 table with a 100 × 240 ticket on it at (150, 30), printed with rows of ink. */
export function ticketOnATable(): Buffer {
  return pngPainted(400, 300, (x, y) => {
    if (x < 150 || x >= 250 || y < 30 || y >= 270) return WOOD;
    return y % 12 < 3 && x > 160 && x < 240 ? INK : PAPER;
  });
}

/**
 * A PNG the preparation made, its size and how many of its pixels are ink
 * (red below 128): all of them, and those in its left half. Counted as each
 * row is decoded, with no row kept and nothing allocated per pixel — the
 * readings are a million pixels each, and a test looks at six or twelve.
 */
export function inkOf(png: Buffer) {
  let ink = 0;
  let left = 0;
  const size = decodePng(png, (_, row, channels) => {
    const half = (row.length / channels) >> 1;
    for (let x = 0, i = 0; i < row.length; x++, i += channels) {
      if (row[i]! < 128) {
        ink++;
        if (x < half) left++;
      }
    }
  });
  return { ...size, ink, left };
}

/** Room for a test that prepares whole photographs: each takes 1–3 s. */
export const PREPARING = 30_000;

/**
 * A 100 × 240 ticket on a table whose printed lines start at the left margin
 * and stop short of the right one, the way a ticket's article names do. Its
 * left and right are therefore told apart, and so is which way up it is.
 */
export function leftAlignedTicket(turn: 0 | 90 | 180 = 0): Buffer {
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

/** Tesseract's confidence, as far as these tests need it: sure of text that starts on the left. */
export const likesLeftText: Confidence = async (png) => {
  const { width, height, ink, left } = inkOf(png);
  const half = width >> 1;
  return left / (height * half) > (ink - left) / (height * (width - half))
    ? 90
    : 20;
};
