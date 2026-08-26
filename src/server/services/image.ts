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
 * caps the request at 10 MB, and that caps what is *stored*; decoding
 * allocates for width × height × channels, and for a compressible image the
 * two are unrelated. A 12,000 × 12,000 PNG of one flat colour weighs under
 * 2 MB — measured — and asks for gigabytes on decode. One request, no
 * privilege beyond a session, and the container is gone.
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
 */
export async function reencodeAsJpeg(buffer: Buffer): Promise<Buffer> {
  const jpeg = await new Bun.Image(buffer, { maxPixels: MAX_PIXELS })
    .jpeg({ quality: 90 })
    .toBuffer();

  return Buffer.from(jpeg);
}
