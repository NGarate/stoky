/**
 * A four-cornered selection on a receipt photograph, in the photograph's own
 * proportions: each corner is `[x, y]` from 0 to 1, top-left first and then
 * clockwise. The photo is kept whole and the frame beside it
 * (`Receipt.ticketQuad`), so a frame can always be corrected; the server
 * straightens what a frame holds (`src/server/services/image.ts`).
 */
export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];

/** The whole photograph: choosing it is choosing not to crop. */
export const FULL_FRAME: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** A rectangle of the photo, in its proportions. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest rectangle of the photo that holds `quad`. */
export function boundsOf(quad: Quad): Box {
  const xs = quad.map(([x]) => x);
  const ys = quad.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

export const isFullFrame = (quad: Quad) =>
  quad.every(([x, y], i) => x === FULL_FRAME[i]![0] && y === FULL_FRAME[i]![1]);

/** The 3 × 3 homography taking `from[i]` to `to[i]`, as its 8 free numbers. */
export function homography(from: Point[], to: Point[]): number[] {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) {
      if (Math.abs(rows[r]![c]!) > Math.abs(rows[pivot]![c]!)) pivot = r;
    }
    [rows[c], rows[pivot]] = [rows[pivot]!, rows[c]!];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const factor = rows[r]![c]! / rows[c]![c]!;
      for (let k = c; k < 9; k++) rows[r]![k]! -= factor * rows[c]![k]!;
    }
  }
  return rows.map((row, i) => row[8]! / row[i]!);
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * The rectangle `quad` straightens into, in the units its corners are in:
 * the mean of its opposite sides.
 */
export function straightenedSize(quad: Point[]): {
  width: number;
  height: number;
} {
  const [tl, tr, br, bl] = quad as Quad;
  return {
    width: (distance(tl, tr) + distance(bl, br)) / 2,
    height: (distance(tl, bl) + distance(tr, br)) / 2,
  };
}

/**
 * For each pixel of a `width` × `height` rectangle, where it falls inside
 * `quad` (in the source's pixels): what both warps sample from.
 */
export function sourceOf(
  quad: Point[],
  width: number,
  height: number,
): (x: number, y: number) => Point {
  const m = homography(
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    quad,
  );
  return (x, y) => {
    const d = m[6]! * x + m[7]! * y + 1;
    return [
      (m[0]! * x + m[1]! * y + m[2]!) / d,
      (m[3]! * x + m[4]! * y + m[5]!) / d,
    ];
  };
}
