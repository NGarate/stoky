import { describe, it, expect } from "bun:test";
import sharp from "sharp";
import {
  exifOrientation,
  exifPayload,
  hasExif,
  isJpeg,
  jpegDimensions,
  jpegSegments,
} from "../utils/jpeg";
import { readImageMetadata, reencodeAsJpeg } from "@/server/services/image";

/**
 * The JPEG marker walker, held to the two things it is for.
 *
 * It exists because `Bun.Image.metadata()` returns `{width, height, format}`
 * and nothing else, so nothing in the runtime this application deploys on can
 * answer "does this photograph still carry EXIF" — the question that proves
 * `CLAUDE.md`'s upload constraint. Until now only `sharp` could, which is why
 * the suite still depends on a library the application dropped.
 *
 * Two properties matter and both are asserted here rather than assumed:
 *
 * 1. **It agrees with `sharp`** on every buffer either is asked about. A
 *    replacement that disagreed would be trading a working assertion for a
 *    plausible one.
 * 2. **It is not a substring search**, and the difference is testable: a JPEG
 *    carrying the literal bytes `Exif\0\0` inside a *comment* segment makes
 *    `buffer.includes("Exif")` true while the file carries no EXIF at all. That
 *    case is constructed below, because a helper whose advantage cannot be
 *    demonstrated may as well be the one-liner.
 *
 * It answers three questions, not one: whether EXIF is present, what the
 * frame's *stored* dimensions are, and what the orientation tag says. The
 * second exists because `Bun.Image` applies orientation while decoding and so
 * reports the displayed size — through that lens a rotated source and its
 * re-encoded output look identical, and the assertion that the rotation was
 * baked in proves nothing.
 *
 * `sharp` appears here in two roles, and only one of them is a dependency this
 * is trying to remove: it **builds** the fixtures, because `Bun.Image` has no
 * `create`, and it is the thing being **agreed with**. The first is the fixture
 * job, which `docs/superpowers/plans/2026-08-27-finishing-the-bun-migration.md`
 * keeps separate; the second is the point of this file and would be pointless
 * to remove.
 */

/** Copied out of sharp's pooled buffer — `Bun.Image` refuses a resizable one. */
const fixedLength = (buffer: Buffer): Buffer => Buffer.from(buffer);

const canvas = () =>
  sharp({
    create: { width: 60, height: 40, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).jpeg();

async function withGps(): Promise<Buffer> {
  return fixedLength(
    await canvas()
      .withExif({
        IFD0: { Copyright: "Stoky Test", Make: "TestPhone" },
        IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "W" },
      })
      .toBuffer(),
  );
}

async function withoutGps(): Promise<Buffer> {
  return fixedLength(
    await canvas()
      .withExif({ IFD0: { Copyright: "Stoky Test", Make: "TestPhone" } })
      .toBuffer(),
  );
}

async function withoutExif(): Promise<Buffer> {
  return fixedLength(await canvas().toBuffer());
}

/**
 * A JPEG with no EXIF that nevertheless contains the bytes `Exif\0\0`.
 *
 * A `COM` segment (`0xFFFE`) spliced in after SOI. This is what separates
 * walking the chain from searching the file, and the only way to show it is to
 * build the case that tells them apart.
 */
async function exifStringInAComment(): Promise<Buffer> {
  const source = await withoutExif();
  const payload = Buffer.from("Exif\0\0 not an EXIF block", "latin1");

  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);

  return Buffer.concat([
    source.subarray(0, 2), // SOI
    Buffer.from([0xff, 0xfe]), // COM
    length,
    payload,
    source.subarray(2),
  ]);
}

describe("walking the marker chain", () => {
  it("finds segments in a real JPEG, so the checks below are not vacuous", async () => {
    const segments = jpegSegments(await withGps());

    expect(segments.length).toBeGreaterThan(1);
    // APP1 is the one EXIF lives in, and this fixture has EXIF.
    expect(segments.some((segment) => segment.marker === 0xe1)).toBe(true);
  });

  it("refuses something that is not a JPEG", async () => {
    expect(() => jpegSegments(Buffer.from("this is not an image"))).toThrow(
      /Not a JPEG/,
    );
  });

  it("recognises a JPEG by its SOI rather than by a name", async () => {
    expect(isJpeg(await withGps())).toBe(true);
    expect(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe("agreeing with sharp", () => {
  it("gives the same answer on every buffer either can be asked about", async () => {
    const cases: Array<[string, Buffer]> = [
      ["source with GPS", await withGps()],
      ["source without GPS", await withoutGps()],
      ["source with no EXIF at all", await withoutExif()],
      ["after reencodeAsJpeg", await reencodeAsJpeg(await withGps())],
    ];

    for (const [label, buffer] of cases) {
      const sharpSays = Boolean((await sharp(buffer).metadata()).exif);
      expect(hasExif(buffer), `${label}: the two disagree`).toBe(sharpSays);
    }
  });
});

describe("what it is for", () => {
  it("says the EXIF is gone after a re-encode", async () => {
    // The assertion `CLAUDE.md`'s upload constraint rests on, now answerable
    // without sharp.
    expect(hasExif(await reencodeAsJpeg(await withGps()))).toBe(false);
    expect(exifPayload(await reencodeAsJpeg(await withGps())).length).toBe(0);
  });

  it("measures the payload, so a fixture's premise can be checked", async () => {
    // "The GPS is gone" holds just as well for a photograph that never carried
    // any. Comparing the two sizes is what turns that into evidence.
    expect((await exifPayload(await withGps())).length).toBeGreaterThan(
      (await exifPayload(await withoutGps())).length,
    );
  });

  it("reads the frame's stored size, which a decoder will not tell you", async () => {
    // The case this exists for: `Bun.Image` applies EXIF orientation while
    // decoding, so it reports the *displayed* size. A 120 x 60 frame tagged
    // "rotate 90" comes back 60 x 120, and a test comparing before with after
    // sees no difference. SOF describes the pixels that are encoded.
    const landscape = fixedLength(
      await sharp({
        create: { width: 120, height: 60, channels: 3, background: { r: 5, g: 5, b: 5 } },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );

    expect(jpegDimensions(landscape)).toEqual({ width: 120, height: 60 });
    // Which is what sharp says, and the opposite of what the decoder says.
    const bySharp = await sharp(landscape).metadata();
    expect({ width: bySharp.width, height: bySharp.height }).toEqual({
      width: 120,
      height: 60,
    });
    expect((await readImageMetadata(landscape)).width).toBe(60);
  });

  it("reads the orientation tag, and agrees with sharp about it", async () => {
    const landscape = fixedLength(
      await sharp({
        create: { width: 120, height: 60, channels: 3, background: { r: 5, g: 5, b: 5 } },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );

    // `?? null`, because sharp says `undefined` where this says `null` — the
    // same answer in two vocabularies, and the comparison has to pick one.
    expect(exifOrientation(landscape)).toBe(
      (await sharp(landscape).metadata()).orientation ?? null,
    );
    expect(exifOrientation(landscape)).toBe(6);

    // And there is none once the rotation has been applied to the pixels.
    expect(exifOrientation(await reencodeAsJpeg(landscape))).toBeNull();
    // Nor on a photograph that never carried EXIF at all — a different reason
    // for the same answer, and worth separating.
    expect(exifOrientation(await withoutExif())).toBeNull();
  });

  it("is not fooled by the bytes appearing outside an APP1 segment", async () => {
    // The case the whole helper exists for. A comment containing `Exif\0\0`
    // makes the naive check true and the structural one false.
    const decoy = await exifStringInAComment();

    expect(decoy.includes(Buffer.from("Exif")), "the fixture is not a decoy").toBe(
      true,
    );
    expect(hasExif(decoy)).toBe(false);

    // And sharp agrees with the structural answer, which is what makes it the
    // right one rather than merely the stricter one.
    expect(Boolean((await sharp(decoy).metadata()).exif)).toBe(false);
  });
});
