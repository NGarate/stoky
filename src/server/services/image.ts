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
 * worker past the container's 1 GiB limit on such an image.
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
