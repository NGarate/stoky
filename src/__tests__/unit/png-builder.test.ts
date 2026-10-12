import { describe, it, expect } from "bun:test";
import { pngClaiming, pngNoise, pngOf } from "../utils/png";
import { MAX_PIXELS, readImageMetadata, reencodeAsJpeg } from "@/server/services/image";

/**
 * The hand-assembled PNG, and the control that makes the bomb mean something.
 *
 * `Bun.Image` has no `create` — its statics are all clipboard — so a fixture
 * must be committed bytes or built. For a decompression bomb, built is the only
 * honest option: a checked-in file that asks a decoder for gigabytes is a thing
 * somebody opens by accident
 * (`docs/superpowers/plans/2026-08-27-finishing-the-bun-migration.md` §1).
 *
 * **The plan named one experiment as blocking that work**: whether a hand-built
 * bomb still trips `maxPixels` at all, since a security test that stops testing
 * while still passing is worse than one that is deleted. It does, and this file
 * is where that stays true rather than being a note about an afternoon.
 *
 * The strict control lives here rather than in the integration suite because it
 * needs the *message*. Through `receipt.upload`, a bomb and a malformed image
 * are both `BAD_REQUEST` and indistinguishable; here the difference between
 * "exceeds maxPixels" and a decode failure is readable, which is the whole
 * point of the pairing.
 */

describe("a PNG that claims more than it contains", () => {
  it("is refused for its pixel count", async () => {
    // 9000 x 9000 is 81 megapixels against a 50 megapixel bound, in 68 bytes.
    const bomb = pngClaiming(9000, 9000);

    expect(bomb.length).toBeLessThan(200);
    expect(9000 * 9000).toBeGreaterThan(MAX_PIXELS);

    let thrown: unknown;
    try {
      await readImageMetadata(bomb);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("maxPixels");
  });

  it("is accepted under the bound, with the identical payload", async () => {
    // The control the bomb needs. Same builder, same token `IDAT`, same length
    // — only the declared canvas differs. Without this, "refused" is explained
    // just as well by the data being sixteen bytes of nothing, and the bomb
    // fixture would be testing the wrong thing while staying green.
    const harmless = pngClaiming(60, 40);

    expect(harmless.length).toBe(pngClaiming(9000, 9000).length);

    const metadata = await readImageMetadata(harmless);
    expect(metadata.width).toBe(60);
    expect(metadata.height).toBe(40);
  });

  it("proves the bound is read from the header, not after a decode", async () => {
    // Sixty-eight bytes carrying no pixel data are enough to trigger the
    // refusal, so no decode can have happened first. `services/image.ts` claims
    // that ordering in prose; this is the evidence.
    const bomb = pngClaiming(9000, 9000);

    // The same bytes cannot be decoded at all — the payload describes nothing.
    await expect(reencodeAsJpeg(pngClaiming(60, 40))).rejects.toThrow();

    let message = "";
    try {
      await readImageMetadata(bomb);
    } catch (error) {
      message = (error as Error).message;
    }

    // Yet the large one fails on the bound rather than on the data.
    expect(message).toContain("maxPixels");
  });
});

describe("a PNG that is what it says", () => {
  it("decodes, so the builder is not simply producing rubbish", async () => {
    const valid = pngOf(60, 40);

    const metadata = await readImageMetadata(valid);
    expect(metadata.width).toBe(60);
    expect(metadata.height).toBe(40);

    // And survives the pipeline the application actually puts an upload through.
    const jpeg = await reencodeAsJpeg(valid);
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
  });

  it("stays small however large the canvas, which is the whole trick", async () => {
    // Flat colour deflates to almost nothing, so a genuinely valid 12 megapixel
    // photograph costs a few hundred bytes on disk. That is what lets the
    // "accepts an ordinary photograph" case exist without a committed file.
    const twelveMegapixels = pngOf(4000, 3000);

    expect(twelveMegapixels.length).toBeLessThan(64 * 1024);
    expect(4000 * 3000).toBeLessThan(MAX_PIXELS);
    expect((await readImageMetadata(twelveMegapixels)).width).toBe(4000);
  });
});

describe("a PNG of one-bit noise", () => {
  // The fixture for the storage amplification `receipt.upload` refuses. It is
  // only that fixture if it really is one bit a pixel and really is noise: a
  // builder that quietly wrote flat colour would make the refusal test fail
  // for the wrong reason, and one that wrote 8-bit would never be under the cap.

  it("decodes at the size it declares", async () => {
    const metadata = await readImageMetadata(pngNoise(4000, 4000));

    expect(metadata.width).toBe(4000);
    expect(metadata.height).toBe(4000);
  });

  it("weighs about an eighth of a byte a pixel, because noise does not deflate", () => {
    // 4000 × 4000 / 8 = 2,000,000 bytes of pixels, plus a filter byte a row.
    const noise = pngNoise(4000, 4000);

    expect(noise.length).toBeGreaterThan(2_000_000);
    expect(noise.length).toBeLessThan(2_100_000);
  });

  it("is the same bytes every time, so a size threshold is not luck", () => {
    expect(pngNoise(200, 200).equals(pngNoise(200, 200))).toBe(true);
    expect(pngNoise(200, 200).equals(pngNoise(200, 200, 7))).toBe(false);
  });
});
