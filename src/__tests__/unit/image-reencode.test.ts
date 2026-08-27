import { describe, it, expect } from "bun:test";
import sharp from "sharp";
import { MAX_PIXELS, readImageMetadata, reencodeAsJpeg } from "@/server/services/image";
import {
  exifOrientation,
  exifPayload,
  hasExif,
  isJpeg,
  jpegDimensions,
} from "../utils/jpeg";

/**
 * What `reencodeAsJpeg` promises, asserted instead of described.
 *
 * The module made four claims and **nothing tested any of them**. Two are
 * privacy controls `CLAUDE.md` requires of the upload path — "re-encode with
 * Sharp (strips EXIF)" — and one is the decompression bound that closed
 * `SECURITY_REVIEW.md` finding 14. Its docblock says the orientation behaviour
 * was "checked rather than assumed", and it was: by hand, once, during the
 * migration off `sharp`, by somebody who is not going to check it again.
 *
 * That matters more than usual here because the implementation was replaced
 * wholesale. `sharp` could not be loaded from Next's standalone output under
 * Bun, so the whole thing is `Bun.Image` now — a different library making the
 * same four promises, with no test that would notice if one of them stopped
 * being true.
 *
 * **Nothing here asks `sharp` about a result any more.** EXIF, the frame's
 * stored dimensions and the orientation tag are all read out of the file's own
 * marker chain (`../utils/jpeg`), which is both sharp-free and the better
 * question: it reads the bytes the server produced rather than a second
 * library's opinion of them. `unit/jpeg-markers.test.ts` holds the walker to
 * sharp's answers so the swap is a fact rather than a hope.
 *
 * `sharp` still *builds* the fixtures, because `Bun.Image` has no `create` —
 * its statics are all clipboard. That is the fixture half of
 * `docs/superpowers/plans/2026-08-27-finishing-the-bun-migration.md` §1 and is
 * deliberately not this file's business yet.
 *
 * ## The buffer trap, recorded so nobody rediscovers it
 *
 * `sharp`'s `.toBuffer()` hands back a Buffer over a pooled, resizable
 * `ArrayBuffer`, and `Bun.Image` refuses one: *"resizable / shared ArrayBuffer
 * is not supported"*. That is a fixture problem and **not** a product one — the
 * router feeds it `Buffer.from(fileBase64, "base64")`, which is fixed-length
 * and unpooled, confirmed by reading `.buffer.byteLength` and `.byteOffset` off
 * a real one. Every fixture here is copied through `fixedLength` for that
 * reason; without it these tests fail for a reason that says nothing about the
 * code.
 */

/** A copy backed by its own fixed-length ArrayBuffer. See the docblock. */
function fixedLength(buffer: Buffer): Buffer {
  return Buffer.from(buffer);
}

/** A small JPEG, optionally carrying the metadata a phone attaches. */
async function photograph(
  options: { gps?: boolean } = {},
): Promise<Buffer> {
  const image = sharp({
    create: {
      width: 40,
      height: 20,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  }).jpeg();

  return fixedLength(
    await image
      .withExif({
        IFD0: { Copyright: "Stoky Test", Make: "TestPhone", Model: "TestModel" },
        // `IFD3` is where EXIF keeps GPS, and it is the block this control
        // exists for: a photograph of a receipt is taken where the household
        // shops, and often where it lives.
        ...(options.gps
          ? { IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "W" } }
          : {}),
      })
      .toBuffer(),
  );
}

/**
 * The EXIF payload, read out of the file's own marker chain.
 *
 * `../utils/jpeg` rather than sharp: `Bun.Image` cannot see EXIF at all, and
 * this reads the bytes the server produced instead of asking a second library
 * what it makes of them. `unit/jpeg-markers.test.ts` holds the two to the same
 * answers.
 */
function exifOf(image: Buffer): Buffer {
  return exifPayload(image);
}

const photographWithExif = () => photograph({ gps: true });

describe("the metadata a photograph arrives with", () => {
  it("is really there to begin with, or the test below proves nothing", async () => {
    // The premise, asserted rather than assumed. A fixture that quietly carries
    // no EXIF would make every assertion after it pass for free — which is the
    // failure mode this whole suite keeps finding elsewhere.
    const source = await photographWithExif();

    expect(hasExif(source)).toBe(true);
    expect(exifOf(source).length).toBeGreaterThan(0);
  });

  it("is gone after the re-encode", async () => {
    const output = await reencodeAsJpeg(await photographWithExif());

    // Both ways of asking, because they can disagree: whether an APP1 segment
    // carrying EXIF is present at all, and whether it has any payload.
    expect(hasExif(output)).toBe(false);
    expect(exifOf(output).length).toBe(0);
  });

  it("takes the GPS block with it", async () => {
    // Named separately from the assertion above even though one implies the
    // other, because this is the block with a person's whereabouts in it and a
    // regression should say so by name.
    //
    // **Not a byte search for "GPS".** That was the first version and it was
    // vacuous: EXIF tags are numeric ids, so the string never appears in the
    // file whether or not the block is there, and the assertion held for a
    // fixture carrying no GPS at all. The premise has to be established by
    // comparing against the same photograph without it.
    const withGps = await photograph({ gps: true });
    const withoutGps = await photograph({ gps: false });

    expect(
      exifOf(withGps).length,
      "the fixture carries no GPS, so this test would prove nothing",
    ).toBeGreaterThan(exifOf(withoutGps).length);

    // And the whole payload goes, which is what takes the GPS with it.
    expect(exifOf(await reencodeAsJpeg(withGps)).length).toBe(0);
  });

  it("leaves nothing identifying the camera in the bytes", async () => {
    // These are ASCII in the file, so they can be looked for directly — unlike
    // the GPS tags above.
    const output = await reencodeAsJpeg(await photographWithExif());
    const text = output.toString("latin1");

    expect(text).not.toContain("TestPhone");
    expect(text).not.toContain("TestModel");
    expect(text).not.toContain("Stoky Test");
  });
});

describe("the format", () => {
  it("stops being whatever was sent", async () => {
    // A PNG in. What lands on disk is a JPEG this server produced, which is the
    // point of re-encoding at all: the bytes are ours rather than a caller's.
    const png = fixedLength(
      await sharp({
        create: { width: 30, height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer(),
    );

    const output = await reencodeAsJpeg(png);

    expect(isJpeg(output)).toBe(true);
  });

  it("produces different bytes from the ones it was given", async () => {
    // A pass-through that happened to keep the format would satisfy the test
    // above. This one fails on it.
    const source = await photographWithExif();
    const output = await reencodeAsJpeg(source);

    expect(output.equals(source)).toBe(false);
  });
});

describe("orientation", () => {
  it("is applied to the pixels rather than left as a tag", async () => {
    // A tag is an instruction a viewer may honour or ignore, and Tesseract is a
    // viewer that ignores it — a receipt photographed in portrait would reach
    // OCR sideways. `Bun.Image` does this while decoding via `autoOrient`,
    // where `sharp` needed an explicit `.rotate()`; the behaviour survived the
    // migration and this is what keeps it.
    //
    // **Read from the frame header, not from a decoder.** `Bun.Image` applies
    // the tag while decoding, so it reports the *displayed* size for both the
    // source and the output — through that lens the two are identical and this
    // test proves nothing. SOF describes the pixels that are actually encoded,
    // which is the question being asked.
    const landscape = fixedLength(
      await sharp({
        create: { width: 120, height: 60, channels: 3, background: { r: 5, g: 5, b: 5 } },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );

    // The premise: the source really is stored landscape and really is tagged.
    expect(jpegDimensions(landscape)).toEqual({ width: 120, height: 60 });
    expect(exifOrientation(landscape)).toBe(6);

    const output = await reencodeAsJpeg(landscape);

    // Turned in the pixels, with nothing left to turn it again.
    expect(jpegDimensions(output)).toEqual({ width: 60, height: 120 });
    expect(exifOrientation(output)).toBeNull();
  });
});

describe("the pixel bound", () => {
  it("is where the module says it is", () => {
    // Past any phone camera — a 50 MP bound against the 12 MP a flagship
    // produces — and far short of what the byte cap cannot see.
    expect(MAX_PIXELS).toBe(50_000_000);
  });

  it("refuses a canvas past it, however few bytes it arrived in", async () => {
    // `SECURITY_REVIEW.md` finding 14, from the other side. 9000 × 9000 is 81
    // megapixels in a couple of hundred kilobytes: under any byte cap, and
    // gigabytes to decode.
    const bomb = fixedLength(
      await sharp({
        create: {
          width: 9000,
          height: 9000,
          channels: 3,
          background: { r: 9, g: 9, b: 9 },
        },
        limitInputPixels: false,
      })
        .png({ compressionLevel: 6 })
        .toBuffer(),
    );

    // The premise that makes this finding what it is: it is *small*.
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);

    let thrown: unknown;
    try {
      await reencodeAsJpeg(bomb);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("maxPixels");
  });

  it("still accepts a photograph a phone would actually take", async () => {
    // The half that stops the bound from being set by lowering it to nothing.
    // 4000 × 3000 is 12 megapixels, which is an ordinary camera.
    const photograph = fixedLength(
      await sharp({
        create: {
          width: 4000,
          height: 3000,
          channels: 3,
          background: { r: 120, g: 120, b: 120 },
        },
      })
        .jpeg()
        .toBuffer(),
    );

    const output = await reencodeAsJpeg(photograph);

    expect((await readImageMetadata(output)).width).toBe(4000);
  });
});
