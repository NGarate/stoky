import sharp from "sharp";

/**
 * Reading and re-encoding a photograph somebody uploaded.
 *
 * One module because there are two callers and they must agree. The upload
 * procedure re-encodes what a person just sent; the OCR service re-reads what
 * is already on disk, because that path also runs on a receipt being
 * processed a second time, where the bytes did not come through the procedure
 * that checked them. Both need the same bound, and until this file existed
 * both declared their own `MAX_PIXELS` — one of them mid-function, which is
 * how a constant that is meant to be a security control comes to look like a
 * local variable.
 *
 * **The bound is in pixels because the other one is in bytes.** The upload
 * caps the request at 10 MB, and that caps what is *stored*; decoding
 * allocates for width × height × channels, and for a compressible image the
 * two numbers are unrelated. A 12,000 × 12,000 PNG of one flat colour is
 * 431 KB — measured — and asks for gigabytes on decode. One request, no
 * privilege beyond a session, and the container is gone.
 * `SECURITY_REVIEW.md` finding 14.
 */
export const MAX_PIXELS = 50_000_000;

/**
 * What the file says it is, without decoding it.
 *
 * Used by the OCR path, which needs to know an image is readable before
 * handing it to a worker that would otherwise crash inside Tesseract.
 */
export async function readImageMetadata(
  buffer: Buffer,
): Promise<{ width?: number; height?: number }> {
  const metadata = await sharp(buffer, {
    limitInputPixels: MAX_PIXELS,
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
 */
export async function reencodeAsJpeg(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { limitInputPixels: MAX_PIXELS })
    .jpeg({ quality: 90, progressive: true })
    .rotate()
    .toBuffer();
}
