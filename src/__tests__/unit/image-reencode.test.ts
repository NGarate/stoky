import { describe, it, expect } from "bun:test";
import {
  MAX_LONG_EDGE,
  MAX_PIXELS,
  reencodeAsJpeg,
  stripJpegMetadata,
} from "@/server/services/image";
import { withExif } from "../utils/exif";
import { pngClaiming, pngOf } from "../utils/png";
import {
  exifOrientation,
  exifPayload,
  hasExif,
  isJpeg,
  jpegDimensions,
  jpegSegments,
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
 * **And nothing builds its fixtures with `sharp` any more either.** `pngOf`
 * assembles a valid PNG, `reencodeAsJpeg` turns it into a valid JPEG on the
 * runtime that ships, and `withExif` splices the metadata in — the way a camera
 * does. `unit/exif-writer.test.ts` and `unit/png-builder.test.ts` hold both
 * builders to what sharp reads back, so the fixtures are checked against a
 * second opinion in one place rather than depending on one everywhere.
 */

/**
 * A small JPEG, optionally carrying the metadata a phone attaches.
 *
 * No `sharp` anywhere: `pngOf` assembles a valid PNG, `reencodeAsJpeg` turns it
 * into a valid JPEG using the runtime that ships, and `withExif` splices the
 * `APP1` segment in after `SOI` — which is where a camera puts it.
 * `unit/exif-writer.test.ts` holds that writer to what sharp reads back, so
 * these are not bytes only this repository believes in.
 */
async function photograph(options: { gps?: boolean } = {}): Promise<Buffer> {
  return withExif(await reencodeAsJpeg(pngOf(40, 20)), {
    copyright: "Stoky Test",
    make: "TestPhone",
    model: "TestModel",
    // The block this control exists for: a photograph of a receipt is taken
    // where the household shops, and often where it lives.
    ...(options.gps ? { gps: { latitudeRef: "N", longitudeRef: "W" } } : {}),
  });
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
    const png = pngOf(30, 30);

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
    const landscape = withExif(await reencodeAsJpeg(pngOf(120, 60)), {
      orientation: 6,
    });

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
    const bomb = pngClaiming(9000, 9000);

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
    //
    // Both sides now, read from the frame header, where this used to check
    // the width alone through a decoder: since the long-edge bound below, 4000
    // is also exactly where resizing starts, so this is the photograph that
    // must come through *whole* — accepted, and at its own size.
    const twelveMegapixels = pngOf(4000, 3000);

    const output = await reencodeAsJpeg(twelveMegapixels);

    expect(jpegDimensions(output)).toEqual({ width: 4000, height: 3000 });
  });
});

describe("the long edge", () => {
  // `MAX_PIXELS` bounds what is decoded. This bounds what is kept: what goes to
  // disk, and what the OCR worker is later handed whole. Without it a 50 MP
  // photograph — or a noise image built to be expensive — is stored and
  // recognised at full size.

  it("is where the module says it is", () => {
    // 4000 is the long edge of a 12 MP phone photograph. Lowering it starts
    // resizing ordinary photographs, which is a decision rather than a tidy-up.
    expect(MAX_LONG_EDGE).toBe(4000);
  });

  it("brings a wider image down to it, keeping the proportions", async () => {
    // 6000 × 1000 → 4000 × 666.7, rounded. A box that stretched to fit
    // (`fit: "fill"`) would come out 4000 × 4000; one that ignored the bound
    // would come out as it went in.
    const output = await reencodeAsJpeg(pngOf(6000, 1000));

    expect(jpegDimensions(output)).toEqual({ width: 4000, height: 667 });
  });

  it("brings a taller one down by its height, which is the long receipt", async () => {
    // A receipt photographed end to end is the shape this is most likely to
    // meet, and the edge that is long is the height.
    const output = await reencodeAsJpeg(pngOf(1000, 6000));

    expect(jpegDimensions(output)).toEqual({ width: 667, height: 4000 });
  });

  it("leaves an image already inside it at its own size", async () => {
    // `withoutEnlargement`. Without it a box is a target, and this comes out
    // 4000 × 3000 — larger on disk and in OCR than what was sent.
    const output = await reencodeAsJpeg(pngOf(1200, 900));

    expect(jpegDimensions(output)).toEqual({ width: 1200, height: 900 });
  });
});

/**
 * A JPEG with one more segment spliced in straight after `SOI` — where a
 * camera, an editor or anybody building a carrier by hand puts it.
 */
function withSegment(jpeg: Buffer, marker: number, payload: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    Buffer.from([0xff, marker]),
    length,
    payload,
    jpeg.subarray(2),
  ]);
}

const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const COM = 0xfe;

/** Text no encoder would write, so finding it in the output means it was copied. */
const CARRIED = "<script>alert('STOKY-ICC-MARKER')</script>";

/**
 * An `APP2` `ICC_PROFILE` segment the way the audit built it: a 128-byte ICC
 * header a parser accepts (`acsp` at offset 36), followed by a caller's text.
 * `Bun.Image` copied it into its output byte for byte.
 */
function iccProfileCarrying(text: string): Buffer {
  const header = Buffer.alloc(128);
  const body = Buffer.from(text.repeat(50), "latin1");
  header.writeUInt32BE(128 + body.length, 0);
  header.write("mntr", 12, "latin1");
  header.write("RGB ", 16, "latin1");
  header.write("XYZ ", 20, "latin1");
  header.write("acsp", 36, "latin1");
  return Buffer.concat([
    Buffer.from("ICC_PROFILE\0", "latin1"),
    Buffer.from([1, 1]), // chunk 1 of 1
    header,
    body,
  ]);
}

const markersOf = (jpeg: Buffer) => jpegSegments(jpeg).map((segment) => segment.marker);

describe("what is stored besides the picture", () => {
  // The re-encode is what makes a stored receipt "an image this server
  // produced". `Bun.Image` keeps the source's colour profile through it on
  // purpose, so without a walk over its output a caller's bytes reached the
  // uploads volume verbatim inside an ICC segment.

  async function carrier(): Promise<Buffer> {
    return withSegment(await reencodeAsJpeg(pngOf(64, 48)), APP2, iccProfileCarrying(CARRIED));
  }

  it("really is there to begin with, or the test below proves nothing", async () => {
    const source = await carrier();

    expect(markersOf(source)).toContain(APP2);
    expect(source.toString("latin1")).toContain(CARRIED);
    // And it is still a picture the decoder accepts, profile and all.
    expect((await new Bun.Image(source).metadata()).width).toBe(64);
  });

  it("is gone after the re-encode: no ICC profile, no application segment but JFIF", async () => {
    const output = await reencodeAsJpeg(await carrier());
    const markers = markersOf(output);

    expect(markers).not.toContain(APP2);
    expect(markers.filter((marker) => marker >= 0xe0 && marker <= 0xef)).toEqual([APP0]);
    expect(markers).not.toContain(COM);
    expect(output.toString("latin1")).not.toContain("STOKY-ICC-MARKER");
    expect(output.toString("latin1")).not.toContain("ICC_PROFILE");
  });

  it("leaves the picture itself alone", async () => {
    // Stripping that broke the file would pass the test above.
    const output = await reencodeAsJpeg(await carrier());

    expect(jpegDimensions(output)).toEqual({ width: 64, height: 48 });
    expect(await new Bun.Image(output).metadata()).toMatchObject({
      width: 64,
      height: 48,
      format: "jpeg",
    });
    expect(output.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });
});

describe("stripJpegMetadata on its own", () => {
  // `reencodeAsJpeg` only ever hands it the encoder's output. These are the
  // cases that output never contains, which is why they are built by hand.

  async function plain(): Promise<Buffer> {
    return reencodeAsJpeg(pngOf(16, 16));
  }

  it("keeps the encoder's output byte for byte when there was nothing to drop", async () => {
    // Straight from `Bun.Image`, not through `reencodeAsJpeg`: what the walk
    // is handed in production. A strip that also dropped a table the decoder
    // needs would fail here before it failed anywhere else.
    const jpeg = Buffer.from(await new Bun.Image(pngOf(16, 16)).jpeg({ quality: 90 }).toBuffer());

    expect(stripJpegMetadata(jpeg).equals(jpeg)).toBe(true);
  });

  it("drops EXIF, XMP and comments as well as colour profiles", async () => {
    let jpeg = await plain();
    jpeg = withSegment(jpeg, COM, Buffer.from("a comment", "latin1"));
    jpeg = withSegment(jpeg, APP1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x/>", "latin1"));
    jpeg = withSegment(jpeg, 0xee, Buffer.from("Adobe\0\0\0\0\0\0\0", "latin1"));

    expect(markersOf(stripJpegMetadata(jpeg))).toEqual(markersOf(await plain()));
  });

  it("drops a JFIF header carrying a thumbnail, and an APP0 that is not JFIF", async () => {
    const clean = await plain();
    // The encoder's own APP0 is first; take it out so the spliced ones are the
    // only candidates.
    const [first] = jpegSegments(clean);
    expect(first?.marker).toBe(APP0);
    const withoutJfif = Buffer.concat([
      clean.subarray(0, 2),
      clean.subarray((first?.start ?? 0) + (first?.length ?? 0)),
    ]);

    const thumbnail = Buffer.concat([
      Buffer.from("JFIF\0", "latin1"),
      Buffer.from([1, 1, 0, 0, 1, 0, 1, 1, 1]), // a 1 × 1 thumbnail…
      Buffer.from([255, 0, 0]), // …of one red pixel
    ]);
    const notJfif = Buffer.from("JFXX\0\x10", "latin1");

    expect(markersOf(stripJpegMetadata(withSegment(withoutJfif, APP0, thumbnail)))).not.toContain(
      APP0,
    );
    expect(markersOf(stripJpegMetadata(withSegment(withoutJfif, APP0, notJfif)))).not.toContain(
      APP0,
    );
  });

  it("refuses something that is not a JPEG", () => {
    expect(() => stripJpegMetadata(pngOf(4, 4))).toThrow(/Malformed JPEG: no SOI/);
  });

  it("refuses a truncated one", async () => {
    const jpeg = await plain();

    expect(() => stripJpegMetadata(jpeg.subarray(0, jpeg.length - 1))).toThrow(/no EOI/);
    // Cut inside the tables, then given an EOI back so only the structure is wrong.
    const cut = Buffer.concat([jpeg.subarray(0, 30), Buffer.from([0xff, 0xd9])]);
    expect(() => stripJpegMetadata(cut)).toThrow(/Malformed JPEG/);
  });

  it("refuses a segment whose length runs past the end", async () => {
    const jpeg = Buffer.from(await plain());
    // The first segment's length, pointed past the end of the file.
    jpeg.writeUInt16BE(0xfff0, 4);

    expect(() => stripJpegMetadata(jpeg)).toThrow(/runs past the end/);
  });

  it("refuses a marker it was not written to expect, rather than passing it through", async () => {
    // DAC, the arithmetic-coding table: legal JPEG, and nothing this encoder writes.
    const jpeg = withSegment(await plain(), 0xcc, Buffer.from([0x00, 0x10]));

    expect(() => stripJpegMetadata(jpeg)).toThrow(/unexpected marker 0xcc/);
  });

  it("refuses a scan with no frame header before it", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9]);

    expect(() => stripJpegMetadata(jpeg)).toThrow(/scan before any frame/);
  });
});
