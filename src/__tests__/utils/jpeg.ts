/**
 * Reading a JPEG's marker chain, so a test can ask about EXIF without a
 * library.
 *
 * `Bun.Image.metadata()` returns `{width, height, format}` and nothing else —
 * measured on 1.3.14, on 1.4.0, and on the 1.4.3 that deploys (2026-10-12) —
 * so it cannot answer "does this carry EXIF". That question is the one
 * proving `CLAUDE.md`'s upload constraint: a photograph's GPS coordinates must
 * not survive an upload. The
 * only thing that could answer it was `sharp`, which is why the test suite
 * still depends on a library the application has stopped using.
 *
 * This reads the bytes the server produced instead of asking a second library
 * its opinion of them, which makes it the better assertion rather than a
 * grudging substitute
 * (`docs/superpowers/plans/2026-08-27-finishing-the-bun-migration.md` §1).
 *
 * **Not a search for the string.** `buffer.includes("Exif")` finds those four
 * characters anywhere — in compressed scan data by coincidence, or in a comment
 * segment — and misses nothing only by luck. Walking the chain says where the
 * bytes are, which is what "carries EXIF" means.
 */

/** Start of image. Every JPEG begins with it. */
const SOI = 0xd8;
/** Start of scan. Entropy-coded data follows, and marker parsing must stop. */
const SOS = 0xda;
/** End of image. */
const EOI = 0xd9;
/** `APP1`, the segment EXIF lives in. */
const APP1 = 0xe1;

/** What an EXIF APP1 segment opens with, per the TIFF/EP convention. */
const EXIF_HEADER = Buffer.from("Exif\0\0", "latin1");

export interface JpegSegment {
  /** The marker byte, e.g. `0xe1` for APP1. */
  marker: number;
  /** Where the segment's payload starts, past the two-byte length. */
  start: number;
  /** Payload length in bytes. */
  length: number;
}

/**
 * Every marker segment from SOI up to the scan.
 *
 * Stops at SOS deliberately: past it the bytes are compressed image data with
 * no marker structure, and continuing would read scan bytes as markers. Nothing
 * this is used for lives after the scan.
 */
export function jpegSegments(buffer: Buffer): JpegSegment[] {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== SOI) {
    throw new Error("Not a JPEG: no SOI marker");
  }

  const segments: JpegSegment[] = [];
  let offset = 2;

  while (offset + 3 < buffer.length) {
    // Markers may be preceded by any number of 0xFF fill bytes.
    if (buffer[offset] !== 0xff) break;

    let marker = buffer[offset + 1] as number;
    let cursor = offset + 2;
    while (marker === 0xff && cursor < buffer.length) {
      marker = buffer[cursor] as number;
      cursor += 1;
    }

    if (marker === SOS || marker === EOI) break;

    const length = buffer.readUInt16BE(cursor);
    // The length includes its own two bytes, so the payload is two shorter.
    segments.push({ marker, start: cursor + 2, length: length - 2 });
    offset = cursor + length;
  }

  return segments;
}

/**
 * Does this JPEG carry an EXIF block?
 *
 * True only for an APP1 segment whose payload opens with `Exif\0\0` — the
 * structure, not the characters.
 */
export function hasExif(buffer: Buffer): boolean {
  return jpegSegments(buffer).some(
    (segment) =>
      segment.marker === APP1 &&
      buffer
        .subarray(segment.start, segment.start + EXIF_HEADER.length)
        .equals(EXIF_HEADER),
  );
}

/**
 * The EXIF payload, or an empty buffer.
 *
 * Its *size* is what lets a test prove a fixture really carries more metadata
 * than its plainer twin — the premise check without which "the GPS is gone"
 * holds just as well for a photograph that never had any.
 */
export function exifPayload(buffer: Buffer): Buffer {
  for (const segment of jpegSegments(buffer)) {
    if (segment.marker !== APP1) continue;
    const payload = buffer.subarray(
      segment.start,
      segment.start + segment.length,
    );
    if (payload.subarray(0, EXIF_HEADER.length).equals(EXIF_HEADER)) {
      return payload;
    }
  }
  return Buffer.alloc(0);
}

/** Is this a JPEG at all? The SOI marker, which is what the extension is not. */
export function isJpeg(buffer: Buffer): boolean {
  return buffer.length > 2 && buffer[0] === 0xff && buffer[1] === SOI;
}

/**
 * Every start-of-frame marker. `C4`, `C8` and `CC` are in the range and are not
 * frames — they define Huffman tables, an extension and arithmetic coding.
 */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * The dimensions **as stored**, which is not what a decoder reports.
 *
 * `Bun.Image.metadata()` applies EXIF orientation while decoding, so it answers
 * with the *displayed* size: a 120 × 60 frame tagged "rotate 90" comes back as
 * 60 × 120. That is the right answer for almost every purpose and the wrong one
 * for a test asking whether the rotation was baked into the pixels — through
 * that lens, before and after look identical and the assertion proves nothing.
 *
 * `sharp` could see both because it reports the raw frame plus the tag. Nothing
 * in the shipped runtime can, so the frame header is read here: SOF gives
 * `[precision:1][height:2][width:2][components:1]`, and it describes the pixels
 * that are actually encoded.
 */
export function jpegDimensions(buffer: Buffer): {
  width: number;
  height: number;
} {
  for (const segment of jpegSegments(buffer)) {
    if (!SOF_MARKERS.has(segment.marker)) continue;
    return {
      height: buffer.readUInt16BE(segment.start + 1),
      width: buffer.readUInt16BE(segment.start + 3),
    };
  }
  throw new Error("No start-of-frame marker: not a JPEG this can measure");
}

/**
 * The EXIF orientation tag, or null when there is none.
 *
 * Tag `0x0112` in IFD0. The EXIF payload opens with `Exif\0\0`, then a TIFF
 * header whose first two bytes give the byte order — `II` little-endian or
 * `MM` big-endian — and every offset inside is relative to that header rather
 * than to the file.
 */
export function exifOrientation(buffer: Buffer): number | null {
  const payload = exifPayload(buffer);
  if (payload.length < 14) return null;

  const tiff = payload.subarray(EXIF_HEADER.length);
  const little = tiff.subarray(0, 2).toString("latin1") === "II";
  const u16 = (at: number) =>
    little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at);
  const u32 = (at: number) =>
    little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at);

  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return null;

  const entries = u16(ifd0);
  for (let index = 0; index < entries; index++) {
    const entry = ifd0 + 2 + index * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(entry) === 0x0112) {
      // A SHORT, so the value sits in the first two bytes of the value field.
      return u16(entry + 8);
    }
  }

  return null;
}
