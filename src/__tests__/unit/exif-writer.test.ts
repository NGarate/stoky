import { describe, it, expect } from "bun:test";
import sharp from "sharp";
import { exifPayloadFor, withExif } from "../utils/exif";
import { pngOf } from "../utils/png";
import { exifOrientation, exifPayload, hasExif, jpegDimensions } from "../utils/jpeg";
import { reencodeAsJpeg } from "@/server/services/image";

/**
 * The EXIF writer, held to the only standard that matters for a fixture: that
 * a real decoder reads back what it wrote.
 *
 * This is the last piece of the fixture job. `Bun.Image` has no `create` and
 * cannot attach metadata, so a photograph carrying EXIF could only come from
 * `sharp` — which is why the image tests still imported a library the
 * application does not deploy
 * (`docs/superpowers/plans/2026-08-27-finishing-the-bun-migration.md` §1).
 *
 * A JPEG is not assembled from nothing here: `reencodeAsJpeg(pngOf(w, h))`
 * produces a valid one using the runtime that ships, and the writer splices an
 * `APP1` segment in after `SOI`, which is where a camera puts it.
 *
 * **`sharp` is imported on purpose and stays.** A fixture writer nobody checks
 * is a way to write tests that pass against bytes only this repository
 * believes in — the exact failure the plan warns about for the bomb fixture. Its
 * job here is to be the second opinion, the same as in
 * `unit/jpeg-markers.test.ts`, and removing it would not be a smaller
 * dependency but a missing check.
 */

/** A valid JPEG with no metadata of its own, built without sharp. */
async function plainJpeg(width = 120, height = 60): Promise<Buffer> {
  return reencodeAsJpeg(pngOf(width, height));
}

describe("the JPEG the writer starts from", () => {
  it("is valid, the size it claims, and carries nothing", async () => {
    // The premise for every splice below. A base that already had EXIF would
    // make "the writer added it" unfalsifiable.
    const base = await plainJpeg(120, 60);

    expect(jpegDimensions(base)).toEqual({ width: 120, height: 60 });
    expect(hasExif(base)).toBe(false);
    expect(Boolean((await sharp(base).metadata()).exif)).toBe(false);
  });
});

describe("what sharp reads back", () => {
  for (const byteOrder of ["II", "MM"] as const) {
    it(`agrees with the writer in ${byteOrder} byte order`, async () => {
      // Both orders are legal TIFF and both appear in the wild. A writer that
      // only worked in one would produce fixtures that quietly exercise half
      // the reader — including this repository's own `exifOrientation`.
      const tagged = withExif(await plainJpeg(), {
        byteOrder,
        make: "TestPhone",
        model: "TestModel",
        copyright: "Stoky Test",
        orientation: 6,
        gps: { latitudeRef: "N", longitudeRef: "W" },
      });

      const bySharp = await sharp(tagged).metadata();

      expect(Boolean(bySharp.exif)).toBe(true);
      expect(bySharp.orientation).toBe(6);
      // And the frame is untouched: splicing a segment must not disturb the
      // image, only precede it.
      expect(bySharp.width).toBe(120);
      expect(bySharp.height).toBe(60);

      // The repository's own reader says the same.
      expect(hasExif(tagged)).toBe(true);
      expect(exifOrientation(tagged)).toBe(6);
      expect(jpegDimensions(tagged)).toEqual({ width: 120, height: 60 });
    });
  }

  it("writes the strings where a reader can find them", async () => {
    // ASCII tags are the ones a test can look for directly, and the ones that
    // identify a camera.
    const tagged = withExif(await plainJpeg(), {
      make: "TestPhone",
      model: "TestModel",
      copyright: "Stoky Test",
    });
    const text = tagged.toString("latin1");

    expect(text).toContain("TestPhone");
    expect(text).toContain("TestModel");
    expect(text).toContain("Stoky Test");
  });
});

describe("the GPS block", () => {
  it("makes the payload measurably larger than the same photograph without it", async () => {
    // The premise every "the GPS is gone" assertion rests on. Without a size
    // difference, that claim holds just as well for a photograph that never
    // carried any.
    const base = await plainJpeg();
    const withGps = withExif(base, {
      make: "TestPhone",
      gps: { latitudeRef: "N", longitudeRef: "W" },
    });
    const withoutGps = withExif(base, { make: "TestPhone" });

    expect(exifPayload(withGps).length).toBeGreaterThan(
      exifPayload(withoutGps).length,
    );
  });

  it("is a second IFD, not a longer first one", async () => {
    // EXIF puts GPS in its own directory reached through tag 0x8825. Writing
    // the fields into IFD0 instead would produce a payload sharp reads as
    // having no GPS at all — larger, and wrong.
    const payload = exifPayloadFor({
      gps: { latitudeRef: "N", longitudeRef: "W" },
    });

    // Past `Exif\0\0` and the 8-byte TIFF header, IFD0 opens with its entry
    // count. One entry: the pointer.
    const tiff = payload.subarray(6);
    expect(tiff.readUInt16LE(8)).toBe(1);
    expect(tiff.readUInt16LE(10)).toBe(0x8825);
  });
});

describe("what the writer is for", () => {
  it("produces a photograph the re-encoder then strips", async () => {
    // The round trip the whole fixture job exists to enable, now with no sharp
    // anywhere in it.
    const tagged = withExif(await plainJpeg(120, 60), {
      make: "TestPhone",
      orientation: 6,
      gps: { latitudeRef: "N", longitudeRef: "W" },
    });

    expect(hasExif(tagged)).toBe(true);
    expect(exifOrientation(tagged)).toBe(6);

    const output = await reencodeAsJpeg(tagged);

    expect(hasExif(output)).toBe(false);
    expect(exifOrientation(output)).toBeNull();
    // Rotated in the pixels, which is the orientation tag being honoured
    // rather than carried.
    expect(jpegDimensions(output)).toEqual({ width: 60, height: 120 });
  });
});
