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
  const jpeg = await new Bun.Image(buffer, { maxPixels: MAX_PIXELS })
    .resize(MAX_LONG_EDGE, MAX_LONG_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  return stripJpegMetadata(Buffer.from(jpeg));
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
