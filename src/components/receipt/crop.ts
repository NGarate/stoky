import {
  type Point,
  type Quad,
  sourceOf,
  straightenedSize,
} from "@/lib/receipt-quad";

/**
 * Longest side drawn from the photo. The server keeps no more than this
 * (`MAX_LONG_EDGE` in `src/server/services/image.ts`), and a larger canvas
 * is more than some phones will draw.
 */
const LONG_EDGE = 4000;

/**
 * The part of the photo at `src` inside `quad`, straightened into an upright
 * rectangle, as the JPEG that is sent in place of the photo: the server then
 * reads the ticket and nothing of the table it lay on. Each pixel is sampled
 * between its four neighbours; the same warp the server straightens with
 * (`sourceOf`).
 */
export async function croppedPhoto(src: string, quad: Quad): Promise<Blob> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const scale = Math.min(
    1,
    LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const source = canvas(width, height);
  source.drawImage(image, 0, 0, width, height);
  const from = source.getImageData(0, 0, width, height).data;

  const corners = quad.map(([x, y]) => [x * width, y * height] as Point);
  const size = straightenedSize(corners);
  const outWidth = Math.max(1, Math.round(size.width));
  const outHeight = Math.max(1, Math.round(size.height));
  const at = sourceOf(corners, outWidth, outHeight);
  const target = canvas(outWidth, outHeight);
  const out = target.createImageData(outWidth, outHeight);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const [u, v] = at(x + 0.5, y + 0.5);
      const x0 = Math.min(width - 2, Math.max(0, Math.floor(u - 0.5)));
      const y0 = Math.min(height - 2, Math.max(0, Math.floor(v - 0.5)));
      const fx = Math.min(1, Math.max(0, u - 0.5 - x0));
      const fy = Math.min(1, Math.max(0, v - 0.5 - y0));
      const o = (y * outWidth + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = from[(y0 * width + x0) * 4 + c]!;
        const b = from[(y0 * width + x0 + 1) * 4 + c]!;
        const d = from[((y0 + 1) * width + x0) * 4 + c]!;
        const e = from[((y0 + 1) * width + x0 + 1) * 4 + c]!;
        out.data[o + c] =
          (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
      }
      out.data[o + 3] = 255;
    }
  }
  target.putImageData(out, 0, 0);
  return new Promise((resolve, reject) =>
    target.canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The crop was not encoded")),
      "image/jpeg",
      0.92,
    ),
  );
}

function canvas(width: number, height: number): CanvasRenderingContext2D {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (!context) throw new Error("No canvas to crop on");
  return context;
}
