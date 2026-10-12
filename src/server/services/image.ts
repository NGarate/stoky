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
 */
export async function reencodeAsJpeg(buffer: Buffer): Promise<Buffer> {
  const jpeg = await new Bun.Image(buffer, { maxPixels: MAX_PIXELS })
    .resize(MAX_LONG_EDGE, MAX_LONG_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  return Buffer.from(jpeg);
}
