/**
 * Reading and re-encoding a photograph somebody uploaded.
 *
 * One module because there are two callers and they must agree. The upload
 * procedure re-encodes what a person just sent; the OCR service re-reads what
 * is already on disk, because that path also runs on a receipt being
 * processed a second time, where the bytes did not come through the procedure
 * that checked them.
 *
 * **`Bun.Image`, not `sharp`.** The reason is not preference: `sharp` is a
 * native N-API module, and Next's standalone output cannot load it under Bun
 * — "Could not load the sharp module using the linux-x64 runtime", measured
 * against a real build. That single failure was the whole of what stood
 * between this application and running on Bun, so removing the dependency is
 * removing the obstacle rather than trading one library for another.
 *
 * **The bound is in pixels because the other one is in bytes.** The upload
 * caps the request at 10 MB; decoding allocates for width × height ×
 * channels, and for a compressible image the two are unrelated. A
 * 12,000 × 12,000 PNG of one flat colour weighs under 2 MB — measured — and
 * asks for gigabytes on decode. One request, no privilege beyond a session,
 * and the container is gone.
 * `SECURITY_REVIEW.md` finding 14.
 *
 * `maxPixels` is `Bun.Image`'s own equivalent of Sharp's `limitInputPixels`,
 * and it makes the same promise: the check runs after the header is read and
 * before any pixel buffer is allocated, so a tiny file claiming an enormous
 * canvas is refused cheaply. Verified against that bomb rather than trusted
 * from the documentation — it is refused with "input exceeds maxPixels
 * limit", and an ordinary photograph is not.
 */

import libheif from "libheif-js/wasm-bundle";
import { inflateSync } from "node:zlib";
import { InvalidInputError } from "./errors";

/** Past any phone camera, far short of what the byte cap cannot see. */
export const MAX_PIXELS = 50_000_000;

/**
 * The longest side a stored receipt photograph keeps, in pixels.
 *
 * `MAX_PIXELS` bounds the *decode*. It did not bound anything after it: the
 * re-encode kept the full resolution, so up to 50 MP went to disk — a 6.1 MB
 * noise PNG at 7000 × 7000 came out as a 47 MB JPEG, and comes out as 11.7 MB
 * at 4000 × 4000 now, measured — and the OCR path handed all of it to the one
 * Tesseract worker inside the app process. The security audit measured that
 * worker past the container's limit, then 1 GiB, on such an image.
 *
 * 4000 rather than the 2560 or 3000 a thumbnail would take, because a long
 * receipt photographed end to end is all long edge: its lines are what gets
 * smaller. And 4000 is the long edge of a 4:3 12 MP photograph, which is
 * left exactly as it is. Larger frames are scaled, and not only the 48 and
 * 50 MP ones: a 4080 × 3072 (12.5 MP) frame loses 2% of its edge and a
 * 5712 × 4284 (24 MP) one 30% — both gentler than the 48 MP case below —
 * and anything built to hurt goes the same way. Measured with the shipped
 * Spanish model on synthetic receipts: a 48 MP photograph of a 40-line
 * receipt and a 50 MP one of a 110-line receipt parse to the same total at
 * 4000 as at full size, and read as many lines or more. The case that lost
 * its total line is a 1800 × 12000 strip, taller than any single camera
 * frame — a stitched scan.
 */
export const MAX_LONG_EDGE = 4000;

/**
 * What the file says it is, without decoding it.
 *
 * The OCR path needs to know an image is readable before handing it to a
 * worker that would otherwise crash inside Tesseract.
 */
export async function readImageMetadata(
  buffer: Buffer,
): Promise<{ width?: number; height?: number }> {
  const metadata = await new Bun.Image(buffer, {
    maxPixels: MAX_PIXELS,
  }).metadata();

  return { width: metadata.width, height: metadata.height };
}

/**
 * The uploaded bytes, normalised to a JPEG this server produced.
 *
 * Three things at once, and all three are the point: the format stops being
 * whatever a caller sent, the EXIF goes — which is where a phone puts the GPS
 * coordinates of the shop — and the orientation tag is applied to the pixels
 * rather than left for a viewer to honour or ignore.
 *
 * That last one needs no call of its own here. Sharp wanted `.rotate()` with
 * no argument; `Bun.Image` applies EXIF orientation while decoding, which its
 * `autoOrient` option defaults to. Checked rather than assumed: a 120 × 60
 * source tagged orientation 6 comes out 60 × 120 from both libraries.
 *
 * And a fourth: nothing longer than `MAX_LONG_EDGE` is kept. `fit: "inside"`
 * keeps the aspect ratio, and `withoutEnlargement` leaves everything already
 * inside the box at its own size — without it the 120 × 60 above would be
 * blown up to 4000 × 2000. `Bun.Image` runs its steps in a fixed order,
 * `autoOrient` before `resize`, so the bound applies to the long edge of the
 * picture as it is displayed rather than as the sensor stored it.
 *
 * And "this server produced" needs `stripJpegMetadata` to be true.
 * `Bun.Image` carries the source's ICC colour profile through the re-encode
 * on purpose — its own documentation says so, to keep non-sRGB colour — and
 * measured: a JPEG, PNG or WebP tagged Display P3 came out with the same
 * 480-byte profile, and a hand-made `APP2` segment full of a caller's text
 * came out byte for byte. So the encoder's output is walked once more and
 * only what it needs to be a picture is kept.
 */
export async function reencodeAsJpeg(buffer: Buffer): Promise<Buffer> {
  const source = isHeif(buffer) ? await heifAsBitmap(buffer) : buffer;
  const jpeg = await new Bun.Image(source, { maxPixels: MAX_PIXELS })
    .resize(MAX_LONG_EDGE, MAX_LONG_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  return stripJpegMetadata(Buffer.from(jpeg));
}

/**
 * The `ftyp` major brands of a HEIF photograph: the HEVC ones a phone camera
 * writes, and the generic `mif1`/`msf1` some files lead with instead — two of
 * the five samples this was measured on did.
 */
export const HEIF_BRANDS = [
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
] as const;

/** A box size, then `ftyp`, then one of the brands above. */
export function isHeif(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString("latin1", 4, 8) === "ftyp" &&
    (HEIF_BRANDS as readonly string[]).includes(
      buffer.toString("latin1", 8, 12),
    )
  );
}

/**
 * A HEIC photograph as a bitmap `Bun.Image` can read.
 *
 * HEIC is what both iOS and Android save camera photographs as, and nothing
 * else on this path reads it: `Bun.Image` has no HEIC decoder on Linux
 * (`ERR_IMAGE_FORMAT_UNSUPPORTED` — it borrows the OS codec on macOS and
 * Windows), and Tesseract's Leptonica refuses one with `pix not read`,
 * measured. So it is decoded here, by `libheif-js` — libheif and libde265
 * compiled to WebAssembly — and handed on as an uncompressed BMP, which
 * `Bun.Image` decodes on every platform. Everything after that is the path a
 * JPEG takes: the same bound, the same resize, the same re-encode and the same
 * metadata strip. The orientation is libheif's to apply, and it does: `irot`
 * and `imir` are honoured while decoding.
 *
 * WebAssembly rather than Alpine's `vips-heif`, which also converts these
 * files (`docs/superpowers/plans/2026-08-25-development-in-the-image-preplan.md`,
 * run 6): that is a change to the image and to every machine that runs the
 * suites, and this is one package that behaves the same on all of them.
 *
 * `MAX_PIXELS` is checked before any pixel is decoded, as `Bun.Image` checks
 * it for the other formats — see `largestDeclaredCanvas` for why it is read
 * here rather than asked of libheif.
 */
async function heifAsBitmap(buffer: Buffer): Promise<Buffer> {
  if (largestDeclaredCanvas(buffer) > MAX_PIXELS) {
    throw new InvalidInputError("HEIF image exceeds maxPixels limit");
  }

  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(buffer);
  try {
    const image = images.find((candidate) => candidate.is_primary());
    if (!image)
      throw new InvalidInputError("No primary image in the HEIF file");

    const width = image.get_width();
    const height = image.get_height();
    const bitmap = emptyBitmap(width, height);
    // libheif writes its RGBA straight into the bitmap, after the header.
    const pixels = new Uint8ClampedArray(
      bitmap.buffer,
      bitmap.byteOffset + BMP_HEADER_BYTES,
      width * height * 4,
    );
    await new Promise<void>((resolve, reject) =>
      image.display({ data: pixels, width, height }, (result) =>
        result
          ? resolve()
          : reject(new InvalidInputError("HEIF image could not be decoded")),
      ),
    );
    return bitmap;
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
  }
}

/**
 * The largest canvas any image in a HEIF file declares, in pixels.
 *
 * Read from the file because libheif would not say: in this build
 * `heif_image_handle_get_ispe_width` answers 0, and a limit set with
 * `heif_context_set_maximum_image_size_limit` is not enforced on read or on
 * decode — measured, a 50 × 50 limit let the fixture's 120 × 64 through.
 * The handle's own `get_width` is the size *displayed*, after a `clap` crop,
 * and a crop can show 60 × 120 of a canvas of any size; it is the canvas that
 * is decoded.
 *
 * Each image declares its canvas in an `ispe` box — size, `ispe`, version and
 * flags, then width and height — and those live in the top-level `meta` box,
 * which is the only place looked: four bytes spelling `ispe` turn up by chance
 * in a few megabytes of compressed picture often enough to refuse a real
 * photograph. libheif refuses a picture whose decoded size differs from its
 * `ispe` ("Decoded image does not have the size signaled in the file").
 *
 * shortcut: the HEVC stream carries its own size, and libheif compares it with
 * the `ispe` only after decoding, so a stream lying about it is bounded by the
 * WebAssembly heap rather than by this; parse the `hvcC` SPS if that matters.
 */
function largestDeclaredCanvas(buffer: Buffer): number {
  let largest = 0;
  for (let at = 0; at + 8 <= buffer.length;) {
    let size = buffer.readUInt32BE(at);
    const type = buffer.toString("latin1", at + 4, at + 8);
    if (size === 1 && at + 16 <= buffer.length) {
      size = Number(buffer.readBigUInt64BE(at + 8));
    } else if (size === 0) {
      size = buffer.length - at;
    }
    if (size < 8) break;

    if (type === "meta") {
      const meta = buffer.subarray(at, Math.min(at + size, buffer.length));
      for (let ispe = meta.indexOf("ispe"); ispe !== -1;) {
        if (ispe + 16 > meta.length) break;
        const pixels =
          meta.readUInt32BE(ispe + 8) * meta.readUInt32BE(ispe + 12);
        largest = Math.max(largest, pixels);
        ispe = meta.indexOf("ispe", ispe + 4);
      }
    }
    at += size;
  }
  return largest;
}

/** `BITMAPFILEHEADER` and `BITMAPV4HEADER`, the smallest that carries masks. */
const BMP_HEADER_BYTES = 14 + 108;

/**
 * A 32-bit BMP for RGBA pixels, with the room for them left zeroed after the
 * header. The channel masks say where each one sits, so libheif's bytes are
 * the bitmap as they are, and a negative height says the rows run top-down as
 * libheif writes them.
 */
function emptyBitmap(width: number, height: number): Buffer {
  const pixelBytes = width * height * 4;
  const bitmap = Buffer.alloc(BMP_HEADER_BYTES + pixelBytes);
  bitmap.write("BM", 0, "latin1");
  bitmap.writeUInt32LE(BMP_HEADER_BYTES + pixelBytes, 2);
  bitmap.writeUInt32LE(BMP_HEADER_BYTES, 10);
  bitmap.writeUInt32LE(108, 14);
  bitmap.writeInt32LE(width, 18);
  bitmap.writeInt32LE(-height, 22);
  bitmap.writeUInt16LE(1, 26); // planes
  bitmap.writeUInt16LE(32, 28); // bits per pixel
  bitmap.writeUInt32LE(3, 30); // BI_BITFIELDS
  bitmap.writeUInt32LE(pixelBytes, 34);
  bitmap.writeUInt32LE(0x000000ff, 54); // red
  bitmap.writeUInt32LE(0x0000ff00, 58); // green
  bitmap.writeUInt32LE(0x00ff0000, 62); // blue
  bitmap.writeUInt32LE(0xff000000, 66); // alpha
  return bitmap;
}

/** Start of image, end of image, start of scan. */
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
/** `APP0`, where the JFIF header lives. `APP1`–`APP15` are everything else. */
const APP0 = 0xe0;
const APP15 = 0xef;
/** A comment: free text, and nothing a decoder needs. */
const COM = 0xfe;

/**
 * Every start-of-frame marker. `C4`, `C8` and `CC` fall inside the range and
 * are not frames — Huffman tables, an extension and arithmetic coding — which
 * is why this is a list.
 */
const START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * The segments a baseline or progressive JPEG needs before its scan: the
 * quantisation tables (`DQT`), the Huffman tables (`DHT`), the restart
 * interval (`DRI`) and the frame header.
 */
const KEPT_BEFORE_SCAN = new Set([0xdb, 0xc4, 0xdd, ...START_OF_FRAME]);

/** `JFIF\0`, then version, units, two densities and a 0 × 0 thumbnail. */
const JFIF_IDENTIFIER = Buffer.from("JFIF\0", "latin1");
const JFIF_PAYLOAD_WITHOUT_THUMBNAIL = 14;

function malformed(reason: string): Error {
  return new Error(`Malformed JPEG: ${reason}`);
}

/**
 * A JPEG with nothing in it but the picture.
 *
 * An allowlist, not a blocklist: `SOI`; an `APP0` only when it is a JFIF
 * header with no thumbnail; the tables and the frame header; and everything
 * from the first `SOS` to `EOI` copied as it is, because that is the
 * compressed image itself. Every other `APPn` — the ICC profile in `APP2`,
 * EXIF and XMP in `APP1`, Adobe's `APP14` — and every `COM` is dropped. Any
 * other marker before the scan is something this encoder has never been seen
 * to write, and it is refused rather than passed through: the walk only ever
 * sees `Bun.Image`'s own output, so an unexpected structure means the
 * assumption under this function has broken, and the upload is refused
 * (`receipt.upload` turns the throw into `BAD_REQUEST`).
 *
 * **What this costs.** A photograph shot in Display P3 or Adobe RGB loses the
 * tag that says so, and a viewer will show it as sRGB — slightly less
 * saturated. Tesseract reads luminance and ignores profiles, and nothing
 * displays a stored receipt today, so the trade is colour fidelity nobody
 * uses against a channel for a caller's bytes on disk. CMYK is not affected:
 * the encoder converts it to three-component YCbCr, which needs no `APP14`
 * (measured: a CMYK source came out as YCbCr with no `APP14` before this
 * walk ran).
 *
 * **What this is not.** It cleans what is stored. The decode before it still
 * parses whatever profile a caller sent, and the OCR path, which re-reads the
 * stored file, still parses the profile of one stored before this walk
 * existed; that is `Bun.Image`'s parser and `MAX_PIXELS`'s business, not this
 * function's.
 */
export function stripJpegMetadata(jpeg: Buffer): Buffer {
  const length = jpeg.length;
  if (length < 4 || jpeg[0] !== 0xff || jpeg[1] !== SOI) {
    throw malformed("no SOI marker");
  }
  if (jpeg[length - 2] !== 0xff || jpeg[length - 1] !== EOI) {
    throw malformed("no EOI marker at the end");
  }

  const kept: Buffer[] = [jpeg.subarray(0, 2)];
  let offset = 2;
  let sawFrame = false;

  for (;;) {
    if (offset >= length || jpeg[offset] !== 0xff) {
      throw malformed(`expected a marker at byte ${offset}`);
    }
    // A marker may be preceded by any number of 0xFF fill bytes.
    let cursor = offset + 1;
    while (cursor < length && jpeg[cursor] === 0xff) cursor += 1;
    if (cursor >= length) throw malformed("truncated marker");

    const marker = jpeg[cursor] as number;

    if (marker === SOS) {
      if (!sawFrame) throw malformed("a scan before any frame header");
      kept.push(jpeg.subarray(cursor - 1));
      break;
    }

    const isApplication = marker >= APP0 && marker <= APP15;
    if (!isApplication && marker !== COM && !KEPT_BEFORE_SCAN.has(marker)) {
      throw malformed(
        `unexpected marker 0x${marker.toString(16)} before the scan`,
      );
    }

    if (cursor + 3 > length) throw malformed("truncated segment length");
    // The length counts its own two bytes and not the marker's.
    const segmentLength = jpeg.readUInt16BE(cursor + 1);
    const end = cursor + 1 + segmentLength;
    if (segmentLength < 2 || end > length) {
      throw malformed(`segment 0x${marker.toString(16)} runs past the end`);
    }

    const payload = jpeg.subarray(cursor + 3, end);
    const keep = isApplication
      ? marker === APP0 &&
        payload.length === JFIF_PAYLOAD_WITHOUT_THUMBNAIL &&
        payload.subarray(0, JFIF_IDENTIFIER.length).equals(JFIF_IDENTIFIER)
      : marker !== COM;

    if (keep) {
      kept.push(jpeg.subarray(cursor - 1, end));
      if (START_OF_FRAME.has(marker)) sawFrame = true;
    }
    offset = end;
  }

  return Buffer.concat(kept);
}

/** The width the paper is looked for at: enough to see a receipt's edges. */
const PAPER_PROBE_WIDTH = 400;

/**
 * Where the receipt is in a photograph, as a rectangle of `width` × `height`
 * — or null when the paper fills the frame or cannot be told apart.
 *
 * A phone photograph of a ticket is mostly table: wood grain, a cloth, a
 * hand. Tesseract reads that background as lines of letters — a Mercadona
 * ticket on a wooden table came back with "MEN", "UA" and "ANETTE" around
 * every article — and those letters break the article lines apart. The paper
 * is what is bright and grey, so the rectangle is the longest run of columns
 * where at least a third of the pixels are, and then the longest run of rows
 * across those columns.
 *
 * **Bright and grey for this photograph, not in absolute terms.** The test
 * was a fixed one — brightest channel over 140, channels within 45 of each
 * other — and the light a ticket is photographed under moved the paper out of
 * it: under a blue cast (an Aldi ticket, paper at R 137 G 184 B 241) nothing
 * was grey and no paper was found; the shaded end of a Mercadona ticket fell
 * under 140 and the crop cut off its last eight articles and the TOTAL; the
 * darkened copies of the tickets lost their crops. So the channels are first
 * white-balanced against the paper itself — each divided by its own 95th
 * percentile, which on a photograph of a ticket is the paper — and then a
 * pixel is paper when it is at least `PAPER_BRIGHTNESS` of that white and
 * its channels are within `PAPER_CHROMA` of each other relative to its
 * brightness, so a shadow keeps the grey it has. None of the five crops
 * that analysts found cutting away articles or the total cuts now, and the
 * shaded Mercadona ticket's parse score went from 70% to 84%. The average
 * moved less than that suggests — 48.2% to 50.3% over 77 photographs, 42.2%
 * to 39.2% over 34 more — because moving every crop edge by one pixel of the
 * probe, and nothing else, moves those averages by up to 3 points: what
 * Tesseract reads off a ticket is that sensitive to its margin.
 *
 * Measured on a downscaled copy, because a ticket's edges do not need detail
 * and a 12 MP photograph decoded whole is 48 MB. `Bun.Image` encodes no raw
 * format, so the copy is a PNG and its pixels are inflated here.
 */
export async function findPaper(
  image: Buffer,
  width: number,
  height: number,
): Promise<Region | null> {
  const probe = await new Bun.Image(image, { maxPixels: MAX_PIXELS })
    .resize(Math.min(PAPER_PROBE_WIDTH, width))
    .png()
    .toBuffer();
  const rgb: Uint8Array[] = [];
  const histograms = [0, 1, 2].map(() => new Uint32Array(256));
  const { width: w, height: h } = decodePng(
    Buffer.from(probe),
    (_, row, channels) => {
      const pixels = new Uint8Array((row.length / channels) * 3);
      for (let x = 0; x < pixels.length / 3; x++) {
        for (let c = 0; c < 3; c++) {
          const value = row[x * channels + (channels < 3 ? 0 : c)];
          pixels[x * 3 + c] = value;
          histograms[c][value]++;
        }
      }
      rgb.push(pixels);
    },
  );
  const white = histograms.map((counts) => percentile(counts, 0.95) || 1);
  const paper = new Uint8Array(w * h);
  rgb.forEach((pixels, y) => {
    for (let x = 0; x < w; x++) {
      const r = Math.min(1, pixels[x * 3] / white[0]);
      const g = Math.min(1, pixels[x * 3 + 1] / white[1]);
      const b = Math.min(1, pixels[x * 3 + 2] / white[2]);
      const max = Math.max(r, g, b);
      paper[y * w + x] =
        max > PAPER_BRIGHTNESS && max - Math.min(r, g, b) < PAPER_CHROMA * max
          ? 1
          : 0;
    }
  });

  const columns = Array.from({ length: w }, (_, x) => {
    let count = 0;
    for (let y = 0; y < h; y++) count += paper[y * w + x];
    return count / h;
  });
  const [x0, x1] = longestRun(columns, 0.35, Math.ceil(w * 0.02));
  const rows = Array.from({ length: h }, (_, y) => {
    let count = 0;
    for (let x = x0; x <= x1; x++) count += paper[y * w + x];
    return count / (x1 - x0 + 1);
  });
  const [y0, y1] = longestRun(rows, 0.35, Math.ceil(h * 0.03));

  // Too little to be the ticket, or all of it: either way, read the frame.
  const area = ((x1 - x0 + 1) * (y1 - y0 + 1)) / (w * h);
  if (area < 0.15 || area > 0.92) return null;

  const scale = width / w;
  const pad = Math.round(w * 0.01);
  const left = Math.max(0, Math.floor((x0 - pad) * scale));
  const top = Math.max(0, Math.floor((y0 - pad) * scale));
  return {
    left,
    top,
    width: Math.min(width, Math.ceil((x1 + pad + 1) * scale)) - left,
    height: Math.min(height, Math.ceil((y1 + pad + 1) * scale)) - top,
  };
}

/**
 * How bright, against the white-balanced paper, a pixel must be to be paper,
 * and how far apart its channels may be as a fraction of its brightness.
 * Loose on brightness on purpose: a background as bright and grey as paper
 * only makes the rectangle the whole frame, which reads the photograph as it
 * is, while a test too tight for a shadow cuts the ticket.
 */
const PAPER_BRIGHTNESS = 0.45;
const PAPER_CHROMA = 0.22;

/** The smallest value at or over `fraction` of a histogram's counts. */
function percentile(counts: Uint32Array, fraction: number): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  let seen = 0;
  for (let value = 0; value < counts.length; value++) {
    seen += counts[value];
    if (seen >= total * fraction) return value;
  }
  return counts.length - 1;
}

/**
 * The first and last index of the longest run of values at or over `floor`,
 * bridging dips of up to `gap` values: a line of bold print across the
 * ticket is mostly ink, and must not cut the paper in two.
 */
function longestRun(
  values: number[],
  floor: number,
  gap: number,
): [number, number] {
  let best: [number, number] = [0, values.length - 1];
  let bestLength = 0;
  let start = -1;
  let lastHigh = -1;
  for (let i = 0; i <= values.length; i++) {
    const high = i < values.length && values[i] >= floor;
    if (high) {
      if (start < 0) start = i;
      lastHigh = i;
    } else if (start >= 0 && (i === values.length || i - lastHigh > gap)) {
      if (lastHigh - start + 1 > bestLength) {
        bestLength = lastHigh - start + 1;
        best = [start, lastHigh];
      }
      start = -1;
    }
  }
  return best;
}

/** A rectangle of an image, in its pixels. */
export interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * `region` of `image` as a 32-bit BMP, which `Bun.Image` and Tesseract both
 * read — `Bun.Image` has resize and rotate but no crop.
 *
 * Decoded a row at a time from a PNG of the whole image, so what is held is
 * the crop and two rows, not the photograph.
 */
export async function cropImage(
  image: Buffer,
  region: Region,
): Promise<Buffer> {
  const png = await new Bun.Image(image, { maxPixels: MAX_PIXELS })
    .png()
    .toBuffer();
  const bitmap = emptyBitmap(region.width, region.height);
  const out = bitmap.subarray(BMP_HEADER_BYTES);
  decodePng(Buffer.from(png), (y, row, channels) => {
    if (y < region.top || y >= region.top + region.height) return;
    const target = (y - region.top) * region.width * 4;
    for (let x = 0; x < region.width; x++) {
      const from = (region.left + x) * channels;
      const to = target + x * 4;
      const grey = channels < 3;
      out[to] = row[from];
      out[to + 1] = grey ? row[from] : row[from + 1];
      out[to + 2] = grey ? row[from] : row[from + 2];
      out[to + 3] = 255;
    }
  });
  return bitmap;
}

/**
 * The rows of an 8-bit, non-interlaced greyscale, RGB or RGBA PNG — what
 * `Bun.Image` writes — handed to `onRow` one at a time, top to bottom. Not a
 * general decoder: anything else throws. Returns the size and channel count.
 */
export function decodePng(
  png: Buffer,
  onRow: (y: number, row: Uint8Array, channels: number) => void,
): { width: number; height: number; channels: number } {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels =
        ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[body[9]] ?? 0;
      if (body[8] !== 8 || !channels || body[12] !== 0) {
        // Only `Bun.Image`'s own output reaches here; anything else is an image
        // this path cannot work with, and the receipt fails like one.
        throw new InvalidInputError("Unsupported PNG layout");
      }
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? current[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      current[x] = (line[x] + predicted) & 0xff;
    }
    onRow(y, current, channels);
    [previous, current] = [current, previous];
  }
  return { width, height, channels };
}

// ---------------------------------------------------------------------------
// Preparing a receipt photograph for OCR.
//
// Everything below works on a copy held in memory and hands Tesseract a PNG;
// the stored photograph is never changed. The steps, their order and their
// numbers come from the bench in `test-tickets/bench/` (its README and
// `docs/superpowers/plans/2026-11-06-long-receipts-in-parts.md` §0): on 9 real
// tickets and 30 degraded copies of them, the parse score went from 27% with
// a crop alone to 89% with these steps. `prepareForOcr` in `ocr.ts` runs
// them in order on a thread of their own (`prepare-worker.ts`): straightened
// or cropped → `flattenedLight` → turned upright → `dewarped`.
// ---------------------------------------------------------------------------

/** An 8-bit greyscale image, row by row. */
export interface Grey {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** `image` at `width` pixels across as rows, in grey when asked. Rows are copies. */
async function decodedRows(image: Buffer, width: number, grey: boolean) {
  let resized = new Bun.Image(image, { maxPixels: MAX_PIXELS }).resize(width);
  if (grey) resized = resized.modulate({ saturation: 0 });
  const png = Buffer.from(await resized.png().toBuffer());
  const rows: Uint8Array[] = [];
  const size = decodePng(png, (_, row) => rows.push(Uint8Array.from(row)));
  return { ...size, rows };
}

/** At most this many pixels in a prepared ticket: Tesseract's memory is per pixel. */
const TICKET_MAX_PIXELS = 20_000_000;

/**
 * The ticket cropped to its paper (`findPaper`), grey, and scaled up to at
 * least `width` across — never down. The crop is the fallback when the
 * corners cannot be trusted (`straightenedTicket`).
 *
 * A crop wider than tall was taken on its side, so it is turned a quarter
 * first, so that the ticket's width is what is scaled. Decided from the
 * paper's size before anything is built: the turn used to be found by
 * building the crop and building it again turned.
 */
export async function croppedTicket(
  image: Buffer,
  width: number,
): Promise<Grey> {
  const { width: photoWidth, height: photoHeight } =
    await readImageMetadata(image);
  if (!photoWidth || !photoHeight) {
    throw new InvalidInputError("Image has no dimensions");
  }
  const paper = await findPaper(image, photoWidth, photoHeight);
  const source = paper ? await cropImage(image, paper) : image;
  if (paper) await blankBeyondPaper(source, paper.width, paper.height);
  const paperWidth = paper?.width ?? photoWidth;
  const paperHeight = paper?.height ?? photoHeight;
  const turn = paperWidth > paperHeight ? 90 : 0;
  const across = turn === 90 ? paperHeight : paperWidth;
  const down = turn === 90 ? paperWidth : paperHeight;
  const scale = Math.max(
    1,
    Math.min(width / across, Math.sqrt(TICKET_MAX_PIXELS / (across * down))),
  );
  const png = await new Bun.Image(source, { maxPixels: MAX_PIXELS })
    .rotate(turn)
    .resize(Math.round(across * scale))
    .modulate({ saturation: 0 })
    .png()
    .toBuffer();
  return greyOfPng(Buffer.from(png));
}

/** How finely the paper's edge is found inside a crop, in pixels across. */
const EDGE_PROBE_WIDTH = 300;

/**
 * Whitens, row by row, what of a crop (a `cropImage` bitmap) lies beyond the
 * paper's edges.
 *
 * A rectangle around a ticket that is tilted, curved or narrower at one end
 * holds strips of what it lies on, and Tesseract reads a cloth's weave as
 * letters on every line beside it: a Costco ticket on dark fabric came back
 * as "EA O. Ostco Bol" for "Costco Bolsa Cong", "Sn: 562292" for "562292 V".
 * The paper is the largest connected part of the paper mask, its holes —
 * the print — closed, so a row's paper runs from its first pixel of that
 * part to its last, and a black bar of print in between stays. A row with no
 * paper found is left as it is: a shadow across the ticket is not a reason
 * to blank a line of it.
 */
async function blankBeyondPaper(
  bitmap: Buffer,
  width: number,
  height: number,
): Promise<void> {
  const probe = await decodedRows(
    bitmap,
    Math.min(EDGE_PROBE_WIDTH, width),
    false,
  );
  const w = probe.width;
  const h = probe.height;
  const mask = largestPart(
    paperMask(probe.rows, w, h, probe.channels).mask,
    w,
    h,
  );
  const spans = Array.from({ length: h }, (_, y) => {
    let first = -1;
    let last = -1;
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (first < 0) first = x;
      last = x;
    }
    return [first, last] as const;
  });
  const across = width / w;
  // Two probe pixels: the mask's edge is that coarse.
  const margin = Math.ceil(2 * across);
  const pixels = bitmap.subarray(BMP_HEADER_BYTES);
  for (let y = 0; y < height; y++) {
    const [first, last] = spans[Math.min(h - 1, Math.floor((y * h) / height))]!;
    if (first < 0) continue;
    const from = Math.max(0, Math.floor(first * across) - margin);
    const to = Math.min(width, Math.ceil((last + 1) * across) + margin);
    pixels.fill(255, y * width * 4, (y * width + from) * 4);
    pixels.fill(255, (y * width + to) * 4, (y + 1) * width * 4);
  }
}

/** A PNG's first channel as `Grey`. */
function greyOfPng(png: Buffer): Grey {
  const rows: Uint8Array[] = [];
  const { width, height } = decodePng(png, (_, row, channels) => {
    const grey = new Uint8Array(row.length / channels);
    for (let x = 0; x < grey.length; x++) grey[x] = row[x * channels]!;
    rows.push(grey);
  });
  const pixels = new Uint8Array(width * height);
  rows.forEach((row, y) => pixels.set(row, y * width));
  return { width, height, pixels };
}

/**
 * `grey` as a PNG, scaled to `width` pixels across when given.
 *
 * A PNG and not a BMP: Tesseract took over 40 s on a large 32-bit BMP that it
 * read in 1.8 s as a PNG.
 */
export async function greyPng(grey: Grey, width?: number): Promise<Buffer> {
  return (await greyPngs(grey, [width]))[0]!;
}

/**
 * `grey` as a PNG at each of `widths` (as it is where one is undefined), all
 * from one 32-bit bitmap. A bitmap per width held them all at once: six of a
 * 20-megapixel ticket were 480 MB. The PNGs are the same bytes either way.
 */
export async function greyPngs(
  grey: Grey,
  widths: readonly (number | undefined)[],
): Promise<Buffer[]> {
  const bitmap = emptyBitmap(grey.width, grey.height);
  const out = bitmap.subarray(BMP_HEADER_BYTES);
  for (let i = 0; i < grey.pixels.length; i++) {
    const to = i * 4;
    out[to] = out[to + 1] = out[to + 2] = grey.pixels[i]!;
    out[to + 3] = 255;
  }
  return Promise.all(
    widths.map(async (width) => {
      let image = new Bun.Image(bitmap, { maxPixels: MAX_PIXELS });
      if (width !== undefined) image = image.resize(width);
      return Buffer.from(await image.png().toBuffer());
    }),
  );
}

/** Half a turn. */
export function turnedHalf(grey: Grey): Grey {
  return { ...grey, pixels: grey.pixels.slice().reverse() };
}

/** A quarter turn clockwise. */
export function turnedQuarter(grey: Grey): Grey {
  const { width, height, pixels } = grey;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[x * height + (height - 1 - y)] = pixels[y * width + x]!;
    }
  }
  return { width: height, height: width, pixels: out };
}

/** The middle `fraction` of the rows: enough lines to judge, at a fraction of the cost. */
export function middleBand(grey: Grey, fraction = 0.3): Grey {
  const rows = Math.max(1, Math.round(grey.height * fraction));
  const top = Math.round((grey.height - rows) / 2);
  return {
    width: grey.width,
    height: rows,
    pixels: grey.pixels.slice(top * grey.width, (top + rows) * grey.width),
  };
}

/**
 * The ink one pixel thinner on every side: each pixel becomes the lightest
 * of the 3 × 3 around it.
 *
 * A receipt printer's strokes are thick enough to close a digit's gaps, and
 * Tesseract then reads a `4` as a `9`. The same ticket read again with thinner
 * strokes misreads differently, which is what lets the readings outvote each
 * other (`OCR_READINGS` in `ocr.ts`).
 */
export function thinned(grey: Grey): Grey {
  const { width, height, pixels } = grey;
  return { width, height, pixels: windowMax(pixels, width, height, 1) };
}

/** One value per block of a block grid, and the grid's size. */
interface Blocks {
  across: number;
  down: number;
  values: Float32Array;
}

/** Each block replaced by `pick` over the blocks within `radius` of it. */
function overNeighbours(
  blocks: Blocks,
  radius: number,
  pick: (values: number[]) => number,
): Blocks {
  const { across, down, values } = blocks;
  const out = new Float32Array(across * down);
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      const near: number[] = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < down && xx >= 0 && xx < across) {
            near.push(values[yy * across + xx]!);
          }
        }
      }
      out[y * across + x] = pick(near);
    }
  }
  return { across, down, values: out };
}

const largest = (values: number[]) => Math.max(...values);
const smallest = (values: number[]) => Math.min(...values);
const mean = (values: number[]) =>
  values.reduce((total, value) => total + value, 0) / values.length;

/** A block grid's value at pixel (x, y), interpolated between block centres. */
function blockValueAt(blocks: Blocks, block: number, x: number, y: number) {
  const { across, down, values } = blocks;
  const fy = Math.min(down - 1, Math.max(0, (y + 0.5) / block - 0.5));
  const fx = Math.min(across - 1, Math.max(0, (x + 0.5) / block - 0.5));
  const y0 = Math.floor(fy);
  const x0 = Math.floor(fx);
  const y1 = Math.min(down - 1, y0 + 1);
  const x1 = Math.min(across - 1, x0 + 1);
  const ty = fy - y0;
  const tx = fx - x0;
  return (
    (values[y0 * across + x0]! * (1 - tx) + values[y0 * across + x1]! * tx) *
      (1 - ty) +
    (values[y1 * across + x0]! * (1 - tx) + values[y1 * across + x1]! * tx) * ty
  );
}

/**
 * The paper made evenly white and the ink evenly black: shadows, folds,
 * wrinkles and faint print undone.
 *
 * - **The paper's own brightness is divided out.** It is estimated per block
 *   (the 90th percentile, so one glint does not make a block white), spread
 *   over its neighbours so bold print and black boxes do not count as
 *   shadow, and smoothed. A pixel as bright as its paper is white whatever
 *   the light on it.
 * - **Table or cloth at the crop's edge is blanked**: a block far darker than
 *   the paper within two blocks of the edge. Only there — a shadow across the
 *   ticket is dark too, and blanking it erased the text under it.
 * - **The ink is stretched per neighbourhood**, to how dark the darkest ink
 *   around it is (never lighter than 0.7 of the paper, or the grain of empty
 *   paper would be stretched too), so faint blue print comes out as firmly as
 *   black. Then a gamma of 1.6, and anything above 0.88 of the paper is white.
 */
export function flattenedLight(grey: Grey): Grey {
  const { width, height, pixels } = grey;
  const block = Math.max(8, Math.round(width / 90));
  const across = Math.ceil(width / block);
  const down = Math.ceil(height / block);
  const raw = new Float32Array(across * down);
  const histogram = new Uint32Array(256);
  for (let by = 0; by < down; by++) {
    for (let bx = 0; bx < across; bx++) {
      histogram.fill(0);
      let count = 0;
      for (let y = by * block; y < Math.min(height, (by + 1) * block); y++) {
        for (let x = bx * block; x < Math.min(width, (bx + 1) * block); x++) {
          histogram[pixels[y * width + x]!]!++;
          count++;
        }
      }
      let seen = 0;
      let value = 255;
      for (; value > 0; value--) {
        seen += histogram[value]!;
        if (seen >= count * 0.1) break;
      }
      raw[by * across + bx] = value;
    }
  }
  let paper: Blocks = { across, down, values: raw.slice() };
  paper = overNeighbours(paper, 2, largest);
  paper = overNeighbours(paper, 1, mean);
  paper = overNeighbours(paper, 1, mean);

  const sorted = Float32Array.from(raw).sort();
  const paperWhite = sorted[Math.floor(sorted.length * 0.95)]!;
  const cloth = raw.map((value, index) => {
    const x = index % across;
    const y = Math.floor(index / across);
    const nearEdge = x < 2 || y < 2 || x >= across - 2 || y >= down - 2;
    return value < paperWhite * 0.6 && nearEdge ? 1 : 0;
  });

  // Each pixel over its paper: 1 is paper.
  const ratio = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const blockRow = Math.min(down - 1, Math.floor(y / block)) * across;
    for (let x = 0; x < width; x++) {
      const background = blockValueAt(paper, block, x, y);
      const isCloth =
        cloth[blockRow + Math.min(across - 1, Math.floor(x / block))];
      ratio[y * width + x] = isCloth
        ? 1
        : Math.min(1, pixels[y * width + x]! / Math.max(1, background));
    }
  }

  const darkest = new Float32Array(across * down);
  for (let by = 0; by < down; by++) {
    for (let bx = 0; bx < across; bx++) {
      const values: number[] = [];
      for (let y = by * block; y < Math.min(height, (by + 1) * block); y += 2) {
        for (
          let x = bx * block;
          x < Math.min(width, (bx + 1) * block);
          x += 2
        ) {
          values.push(ratio[y * width + x]!);
        }
      }
      values.sort((a, b) => a - b);
      darkest[by * across + bx] = Math.min(
        0.7,
        values[Math.floor(values.length * 0.02)] ?? 0.7,
      );
    }
  }
  let ink: Blocks = { across, down, values: darkest };
  ink = overNeighbours(ink, 2, smallest);
  ink = overNeighbours(ink, 1, mean);

  const white = 0.88;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = ratio[y * width + x]!;
      if (value >= white) {
        out[y * width + x] = 255;
        continue;
      }
      const floor = blockValueAt(ink, block, x, y);
      const stretched = Math.max(0, (value - floor) / (white - floor));
      out[y * width + x] = Math.round(255 * Math.pow(stretched, 1.6));
    }
  }
  return { width, height, pixels: out };
}

type Point = [number, number];

/** The brightest value within `radius` pixels of each pixel. */
function windowMax(
  values: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const across = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 0;
      for (
        let d = Math.max(0, x - radius);
        d <= Math.min(width - 1, x + radius);
        d++
      ) {
        best = Math.max(best, values[y * width + d]!);
      }
      across[y * width + x] = best;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 0;
      for (
        let d = Math.max(0, y - radius);
        d <= Math.min(height - 1, y + radius);
        d++
      ) {
        best = Math.max(best, across[d * width + x]!);
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

/**
 * Which pixels of a small probe are paper, and how much brighter paper is
 * than what is around it.
 *
 * Paper is grey (white-balanced, little colour) and bright **against its own
 * neighbourhood**: at least 0.7 of the brightest pixel within a twelfth of the
 * probe, and never darker than 70 of 255. Against its neighbourhood rather
 * than the whole photograph because a ticket half in shadow is darker than
 * the lit table beside its other half. `separation` is paper over background
 * brightness at the photograph's Otsu cut: near 1, nothing stands out.
 */
function paperMask(
  rows: Uint8Array[],
  width: number,
  height: number,
  channels: number,
) {
  const histograms = [0, 1, 2].map(() => new Uint32Array(256));
  const channel = (row: Uint8Array, x: number, c: number) =>
    row[x * channels + (channels < 3 ? 0 : c)]!;
  for (const row of rows) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) histograms[c]![channel(row, x, c)]!++;
    }
  }
  const whites = histograms.map((counts) => percentile(counts, 0.95) || 1);
  const bright = new Uint8Array(width * height);
  const grey = new Uint8Array(width * height);
  const brightness = new Uint32Array(256);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const balanced = [0, 1, 2].map((c) =>
        Math.min(1, channel(row, x, c) / whites[c]!),
      );
      const max = Math.max(...balanced);
      bright[y * width + x] = Math.round(max * 255);
      grey[y * width + x] =
        max - Math.min(...balanced) < PAPER_CHROMA * max ? 1 : 0;
      brightness[bright[y * width + x]!]!++;
    }
  });
  const total = width * height;
  let sumAll = 0;
  for (let value = 0; value < 256; value++)
    sumAll += value * brightness[value]!;
  let below = 0;
  let sumBelow = 0;
  let bestBetween = 0;
  let separation = 0;
  for (let value = 0; value < 256; value++) {
    below += brightness[value]!;
    if (!below || below === total) continue;
    sumBelow += value * brightness[value]!;
    const meanBelow = sumBelow / below;
    const meanAbove = (sumAll - sumBelow) / (total - below);
    const between = below * (total - below) * (meanBelow - meanAbove) ** 2;
    if (between > bestBetween) {
      bestBetween = between;
      separation = meanAbove / Math.max(1, meanBelow);
    }
  }
  const near = windowMax(bright, width, height, Math.round(width / 12));
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < total; i++) {
    mask[i] = grey[i] && bright[i]! >= Math.max(70, 0.7 * near[i]!) ? 1 : 0;
  }
  return { mask, separation };
}

/** The mask closed (the text's holes filled) and cut to its largest connected part. */
function largestPart(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  // Growing is `windowMax`; shrinking counts outside the image as background.
  const shrink = (source: Uint8Array, radius: number) => {
    const across = new Uint8Array(width * height);
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 1;
        for (let d = -radius; d <= radius; d++) {
          const xx = x + d;
          value &= xx < 0 || xx >= width ? 0 : source[y * width + xx]!;
        }
        across[y * width + x] = value;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 1;
        for (let d = -radius; d <= radius; d++) {
          const yy = y + d;
          value &= yy < 0 || yy >= height ? 0 : across[yy * width + x]!;
        }
        out[y * width + x] = value;
      }
    }
    return out;
  };
  const closed = shrink(windowMax(mask, width, height, 3), 3);
  const label = new Int32Array(width * height).fill(-1);
  let best = -1;
  let bestSize = 0;
  const stack: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (!closed[i] || label[i]! >= 0) continue;
    let size = 0;
    stack.push(i);
    label[i] = i;
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const x = j % width;
      const y = (j / width) | 0;
      for (const k of [
        x > 0 ? j - 1 : -1,
        x < width - 1 ? j + 1 : -1,
        y > 0 ? j - width : -1,
        y < height - 1 ? j + width : -1,
      ]) {
        if (k >= 0 && closed[k] && label[k]! < 0) {
          label[k] = i;
          stack.push(k);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = i;
    }
  }
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

/** The convex hull, counter-clockwise. */
function convexHull(points: Point[]): Point[] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  const upper: Point[] = [];
  for (const q of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0)
      lower.pop();
    lower.push(q);
  }
  for (const q of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0)
      upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const doubleArea = (a: Point, b: Point, c: Point) =>
  Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

/** The largest quadrilateral with its corners on the hull. */
function largestQuad(hull: Point[]): Point[] {
  const n = hull.length;
  let best = 0;
  let quad = hull.slice(0, 4);
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      let areaOne = 0;
      let one = -1;
      let areaTwo = 0;
      let two = -1;
      for (let j = i + 1; j < k; j++) {
        const area = doubleArea(hull[i]!, hull[j]!, hull[k]!);
        if (area > areaOne) {
          areaOne = area;
          one = j;
        }
      }
      for (let l = k + 1; l < n + i; l++) {
        const area = doubleArea(hull[i]!, hull[l % n]!, hull[k]!);
        if (area > areaTwo) {
          areaTwo = area;
          two = l % n;
        }
      }
      if (one >= 0 && two >= 0 && areaOne + areaTwo > best) {
        best = areaOne + areaTwo;
        quad = [hull[i]!, hull[one]!, hull[k]!, hull[two]!];
      }
    }
  }
  return quad;
}

/** Corners from the top-left one round. */
function inOrder(quad: Point[]): Point[] {
  const cx = quad.reduce((total, p) => total + p[0], 0) / 4;
  const cy = quad.reduce((total, p) => total + p[1], 0) / 4;
  const sorted = quad
    .slice()
    .sort(
      (a, b) =>
        Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
    );
  let start = 0;
  sorted.forEach((p, i) => {
    if (p[0] + p[1] < sorted[start]![0] + sorted[start]![1]) start = i;
  });
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]!);
}

/** The 3 × 3 homography taking `from[i]` to `to[i]`, as its 8 free numbers. */
function homography(from: Point[], to: Point[]): number[] {
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

/** Pixels across the probe the corners are found on. */
const CORNER_PROBE_WIDTH = 600;

/**
 * The ticket warped to an upright rectangle from its four corners, its short
 * side at `width` pixels — or null when the warp should not be trusted or is
 * not needed, and the crop (`croppedTicket`) does as well.
 *
 * The corners are those of the largest quadrilateral inside the paper's
 * outline on a 600-pixel probe, grown 1.5% because that quadrilateral clips
 * curled corners. Every output pixel is then sampled from a grey copy of the
 * photograph at the resolution the output needs.
 *
 * **Trusted only when they look like a ticket's**: no corner more than 15°
 * from square, the paper filling the quadrilateral to within 10%, and paper
 * at least three times as bright as what is around it. On a light table or
 * under a shadow the outline found was the table's, skewed 22–74°, and the
 * warp turned a readable ticket into a smear; a wrong warp is worse than
 * none. **Needed only when the ticket is tilted or skewed 1.5° or more.**
 */
export async function straightenedTicket(
  image: Buffer,
  width: number,
): Promise<Grey | null> {
  const { width: photoWidth } = await new Bun.Image(image, {
    maxPixels: MAX_PIXELS,
  }).metadata();
  const probe = await decodedRows(image, CORNER_PROBE_WIDTH, false);
  const w = probe.width;
  const h = probe.height;
  const { mask: rawMask, separation } = paperMask(
    probe.rows,
    w,
    h,
    probe.channels,
  );
  const mask = largestPart(rawMask, w, h);
  let count = 0;
  const edge: Point[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      if (
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !mask[y * w + x - 1] ||
        !mask[y * w + x + 1] ||
        !mask[(y - 1) * w + x] ||
        !mask[(y + 1) * w + x]
      ) {
        edge.push([x, y]);
      }
    }
  }
  if (count < w * h * 0.1 || count > w * h * 0.95) return null;
  const quad = inOrder(largestQuad(convexHull(edge)));
  const quadArea =
    Math.abs(
      quad.reduce((total, p, i) => {
        const q = quad[(i + 1) % 4]!;
        return total + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) / 2;
  const fill = count / quadArea;

  const length = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sides = [0, 1, 2, 3].map(
    (i) => [quad[i]!, quad[(i + 1) % 4]!] as const,
  );
  const longest = sides.reduce((a, b) =>
    length(b[0], b[1]) > length(a[0], a[1]) ? b : a,
  );
  let tilt =
    (Math.atan2(longest[1][1] - longest[0][1], longest[1][0] - longest[0][0]) *
      180) /
    Math.PI;
  tilt = ((tilt % 90) + 90) % 90;
  const rotationDeg = Math.min(tilt, 90 - tilt);
  const skewDeg = Math.max(
    ...[0, 1, 2, 3].map((i) => {
      const a = quad[(i + 3) % 4]!;
      const b = quad[i]!;
      const c = quad[(i + 1) % 4]!;
      const one = [a[0] - b[0], a[1] - b[1]] as const;
      const two = [c[0] - b[0], c[1] - b[1]] as const;
      const cosine =
        (one[0] * two[0] + one[1] * two[1]) /
        (Math.hypot(...one) * Math.hypot(...two));
      return Math.abs((Math.acos(cosine) * 180) / Math.PI - 90);
    }),
  );
  const trusted =
    skewDeg <= 15 && fill <= 1.1 && fill >= 1 / 1.1 && separation >= 3;
  if (!trusted || Math.max(rotationDeg, skewDeg) < 1.5) return null;

  const cx = quad.reduce((total, p) => total + p[0], 0) / 4;
  const cy = quad.reduce((total, p) => total + p[1], 0) / 4;
  const grown = quad.map(
    ([x, y]) => [cx + (x - cx) * 1.015, cy + (y - cy) * 1.015] as Point,
  );
  const [tl, tr, br, bl] = grown as [Point, Point, Point, Point];
  const quadWidth = (length(tl, tr) + length(bl, br)) / 2;
  const quadHeight = (length(tl, bl) + length(tr, br)) / 2;
  // The text runs along the short side; that is what `width` is.
  const scale = Math.min(
    width / Math.min(quadWidth, quadHeight),
    Math.sqrt(TICKET_MAX_PIXELS / (quadWidth * quadHeight)),
  );
  const outWidth = Math.round(quadWidth * scale);
  const outHeight = Math.round(quadHeight * scale);
  // One output pixel to about one source pixel.
  const source = await decodedRows(
    image,
    Math.min(photoWidth, Math.round(CORNER_PROBE_WIDTH * scale)),
    true,
  );
  const k = source.width / CORNER_PROBE_WIDTH;
  const m = homography(
    [
      [0, 0],
      [outWidth, 0],
      [outWidth, outHeight],
      [0, outHeight],
    ],
    grown.map(([x, y]) => [x * k, y * k] as Point),
  );
  const out = new Uint8Array(outWidth * outHeight);
  const channels = source.channels;
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const d = m[6]! * x + m[7]! * y + 1;
      const u = (m[0]! * x + m[1]! * y + m[2]!) / d;
      const v = (m[3]! * x + m[4]! * y + m[5]!) / d;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      if (
        x0 < 0 ||
        y0 < 0 ||
        x0 >= source.width - 1 ||
        y0 >= source.height - 1
      ) {
        out[y * outWidth + x] = 255;
        continue;
      }
      const fx = u - x0;
      const fy = v - y0;
      const r0 = source.rows[y0]!;
      const r1 = source.rows[y0 + 1]!;
      const a = r0[x0 * channels]!;
      const b = r0[(x0 + 1) * channels]!;
      const c = r1[x0 * channels]!;
      const e = r1[(x0 + 1) * channels]!;
      out[y * outWidth + x] = Math.round(
        (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy,
      );
    }
  }
  return { width: outWidth, height: outHeight, pixels: out };
}

/** Least squares `y = c₀ + c₁x + c₂x²` up to `degree`; all zero when it cannot be solved. */
function polynomialFit(
  points: { x: number; y: number }[],
  degree: number,
): number[] {
  const n = degree + 1;
  const rows = Array.from({ length: n }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (const { x, y } of points) {
    const powers = Array.from({ length: n }, (_, i) => x ** i);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) rows[r]![c]! += powers[r]! * powers[c]!;
      rows[r]![n]! += powers[r]! * y;
    }
  }
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(rows[r]![c]!) > Math.abs(rows[pivot]![c]!)) pivot = r;
    }
    [rows[c], rows[pivot]] = [rows[pivot]!, rows[c]!];
    if (Math.abs(rows[c]![c]!) < 1e-12)
      return Array.from({ length: n }, () => 0);
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const factor = rows[r]![c]! / rows[c]![c]!;
      for (let k = c; k <= n; k++) rows[r]![k]! -= factor * rows[c]![k]!;
    }
  }
  return rows.map((row, i) => row[n]! / row[i]!);
}

const polynomialAt = (coefficients: number[], x: number) =>
  coefficients.reduce((total, c, i) => total + c * x ** i, 0);

/**
 * The text lines' centres in each of `strips` vertical strips: the runs of
 * rows whose ink in the strip passes 4%, each run's ink-weighted middle.
 */
function stripCentres(grey: Grey, strips: number) {
  const { width, height, pixels } = grey;
  const stripWidth = Math.floor(width / strips);
  return Array.from({ length: strips }, (_, s) => {
    const x0 = s * stripWidth;
    const x1 = s === strips - 1 ? width : x0 + stripWidth;
    const profile = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      let ink = 0;
      for (let x = x0; x < x1; x++) if (pixels[y * width + x]! < 140) ink++;
      profile[y] = ink / (x1 - x0);
    }
    const ys: number[] = [];
    const heights: number[] = [];
    let start = -1;
    let mass = 0;
    let moment = 0;
    for (let y = 0; y <= height; y++) {
      if (y < height && profile[y]! > 0.04) {
        if (start < 0) {
          start = y;
          mass = 0;
          moment = 0;
        }
        mass += profile[y]!;
        moment += profile[y]! * y;
      } else if (start >= 0) {
        if (y - start >= 6 && mass > 0) {
          ys.push(moment / mass);
          heights.push(y - start);
        }
        start = -1;
      }
    }
    return { x: (x0 + x1) / 2, ys, heights };
  });
}

/**
 * The ticket with its text lines straightened, when they curve by half a
 * line or more; otherwise `grey` itself.
 *
 * Leptonica's vertical disparity: the line centres found in 20 strips are
 * linked across them, each line is fitted with a curve, and the curves'
 * slope and bend are modelled as smooth functions of the height on the page
 * (refitted three times without the lines that disagree, so one badly linked
 * line cannot bend the page). Every column is then shifted up or down by the
 * model. Under half a line of curvature it does more harm than good, and with
 * fewer than three lines there is nothing to model.
 */
export function dewarped(grey: Grey, strips = 20): Grey {
  const { width, height, pixels } = grey;
  const columns = stripCentres(grey, strips);
  const allHeights = columns.flatMap((c) => c.heights).sort((a, b) => a - b);
  const lineHeight = allHeights[Math.floor(allHeights.length / 2)] ?? 30;
  const tolerance = lineHeight * 0.6;

  // Linked outward from the middle strip, each line's next centre predicted
  // from its trend so far.
  const mid = Math.floor(strips / 2);
  type Line = { x: number; y: number }[];
  const lines: Line[] = columns[mid]!.ys.map((y) => [
    { x: columns[mid]!.x, y },
  ]);
  const extend = (from: number, to: number, step: number) => {
    for (let s = from; s !== to; s += step) {
      const column = columns[s]!;
      const taken = new Set<number>();
      for (const line of lines) {
        const end =
          step > 0
            ? line.reduce((a, b) => (b.x > a.x ? b : a))
            : line.reduce((a, b) => (b.x < a.x ? b : a));
        const side = line
          .filter((p) =>
            step > 0 ? p.x >= columns[mid]!.x : p.x <= columns[mid]!.x,
          )
          .sort((a, b) => a.x - b.x);
        let slope = 0;
        if (side.length >= 2) {
          const [p, q] = step > 0 ? side.slice(-2) : side.slice(0, 2);
          slope = (q!.y - p!.y) / (q!.x - p!.x);
        }
        // Past a gap of four strips the trend means nothing.
        if (Math.abs(column.x - end.x) > (width / strips) * 4) continue;
        const predicted = end.y + slope * (column.x - end.x);
        let best = -1;
        let bestDistance = tolerance;
        column.ys.forEach((y, i) => {
          const distance = Math.abs(y - predicted);
          if (distance < bestDistance && !taken.has(i)) {
            bestDistance = distance;
            best = i;
          }
        });
        if (best >= 0) {
          taken.add(best);
          line.push({ x: column.x, y: column.ys[best]! });
        }
      }
      // A centre no line took starts a line that begins away from the middle.
      column.ys.forEach((y, i) => {
        if (!taken.has(i)) lines.push([{ x: column.x, y }]);
      });
    }
  };
  extend(mid + 1, strips, 1);
  extend(mid - 1, -1, -1);

  const xc = width / 2;
  const fitted: { coefficients: number[]; at: number }[] = [];
  for (const line of lines) {
    if (line.length < 4) continue;
    const xs = line.map((p) => p.x);
    const span = (Math.max(...xs) - Math.min(...xs)) / width;
    if (span < 0.35) continue;
    const points = line.map((p) => ({ x: (p.x - xc) / xc, y: p.y }));
    const coefficients = polynomialFit(
      points,
      span > 0.6 && line.length >= 6 ? 2 : 1,
    );
    // Points far from their curve: two lines linked into one.
    const residual = Math.max(
      ...points.map((p) => Math.abs(polynomialAt(coefficients, p.x) - p.y)),
    );
    if (residual > lineHeight * 0.5) continue;
    fitted.push({ coefficients, at: polynomialAt(coefficients, 0) });
  }
  fitted.sort((a, b) => a.at - b.at);
  if (fitted.length < 3) return grey;

  const at = fitted.map((f) => f.at / height);
  const slopes = fitted.map((f) => f.coefficients[1] ?? 0);
  const bends = fitted.map((f) => f.coefficients[2] ?? 0);
  let keep = fitted.map(() => true);
  let slopeModel = [0];
  let bendModel = [0];
  for (let round = 0; round < 3; round++) {
    const kept = (values: number[]) =>
      at.flatMap((y, i) => (keep[i] ? [{ x: y, y: values[i]! }] : []));
    slopeModel = polynomialFit(kept(slopes), 2);
    bendModel = polynomialFit(kept(bends), 2);
    const misfit = at.map(
      (y, i) =>
        Math.abs(polynomialAt(slopeModel, y) - slopes[i]!) +
        Math.abs(polynomialAt(bendModel, y) - bends[i]!),
    );
    const sorted = misfit.filter((_, i) => keep[i]).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1e-9;
    keep = misfit.map((value) => value <= median * 3);
  }

  const out = new Uint8Array(width * height).fill(255);
  let maxShift = 0;
  for (let y = 0; y < height; y++) {
    const slope = polynomialAt(slopeModel, y / height);
    const bend = polynomialAt(bendModel, y / height);
    for (let x = 0; x < width; x++) {
      const u = (x - xc) / xc;
      const from = y + slope * u + bend * u * u;
      maxShift = Math.max(maxShift, Math.abs(from - y));
      const y0 = Math.floor(from);
      const f = from - y0;
      if (y0 < 0 || y0 >= height - 1) continue;
      out[y * width + x] = Math.round(
        pixels[y0 * width + x]! * (1 - f) + pixels[(y0 + 1) * width + x]! * f,
      );
    }
  }
  return Math.round(maxShift) / (lineHeight || 1) >= 0.5
    ? { width, height, pixels: out }
    : grey;
}
