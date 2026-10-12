import { deflateSync } from "node:zlib";

/**
 * Assembling a PNG by hand, because `Bun.Image` cannot make one.
 *
 * `Bun.Image`'s statics are `backend`, `clipboardChangeCount`, `fromClipboard`
 * and `hasClipboardImage` — all clipboard, none constructive — and its
 * constructor takes *encoded* bytes. There is no equivalent of
 * `sharp({ create: … })`, so a fixture has to be committed or built
 * (`docs/superpowers/plans/2026-08-27-finishing-the-bun-migration.md` §1).
 *
 * For the decompression bomb, built is the only honest option: a checked-in
 * file that asks a decoder for gigabytes is a thing somebody opens by accident.
 * Sixty-eight bytes of assembly here is smaller, faster and legible — the
 * dimensions are an argument rather than a property of an opaque blob.
 *
 * **Whether a hand-built bomb still trips `maxPixels` was the open question**
 * the plan named as blocking this work. It does: a header claiming 9000 × 9000
 * over a token `IDAT` is refused with `Image: input exceeds maxPixels limit`,
 * and the same token `IDAT` under a 60 × 40 header is accepted — which is what
 * makes the refusal about the pixel count rather than about the data being
 * nothing.
 */

/** CRC-32 as PNG defines it, over the chunk type and its data. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));

  return Buffer.concat([length, typed, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Truecolour at 8 bits unless a caller says otherwise; only the noise asks. */
interface Header {
  bitDepth: number;
  colourType: number;
  /** Chunks between `IHDR` and `IDAT` — a palette, for colour type 3. */
  before?: Buffer[];
}

const TRUECOLOUR: Header = { bitDepth: 8, colourType: 2 };

function assemble(
  width: number,
  height: number,
  idat: Buffer,
  header: Header = TRUECOLOUR,
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = header.bitDepth;
  ihdr[9] = header.colourType;
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    ...(header.before ?? []),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A PNG whose header *claims* `width × height` over almost no data.
 *
 * The whole point of a decompression bomb: tiny on disk, enormous once decoded.
 * The `IDAT` here is a deflate stream of sixteen zero bytes and does not
 * describe the declared canvas at all — which does not matter, because
 * `maxPixels` is checked when the header is read and before any pixel buffer is
 * allocated. Sixty-eight bytes containing no pixel data are enough to trigger
 * it, which is itself the evidence for that ordering.
 *
 * Pass a size *under* the bound to get the control case: identical bytes,
 * accepted, so a refusal above the bound cannot be blamed on the token `IDAT`.
 */
export function pngClaiming(width: number, height: number): Buffer {
  return assemble(width, height, deflateSync(Buffer.alloc(16)));
}

/**
 * A PNG that is genuinely what it says: flat black, correctly encoded.
 *
 * For the cases that need a decodable image rather than a bomb. Each scanline
 * is a filter byte followed by RGB triples, all zero, which deflates to almost
 * nothing however large the canvas.
 */
export function pngOf(width: number, height: number): Buffer {
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  return assemble(width, height, deflateSync(scanlines));
}

/**
 * Black-and-white noise at one bit per pixel: cheap to send, dear to store.
 *
 * The storage amplification the security audit found. A palette PNG spends
 * one *bit* on a pixel and random bits do not deflate, so the file is about
 * `width × height / 8` bytes. A JPEG of the same pixels spends about a *byte*
 * on each — every one is an edge, and quality 90 keeps edges — so the stored
 * file is several times what was uploaded. Noise in RGB does not reproduce
 * it: three random bytes a pixel are already dearer to send than the JPEG is
 * to keep, and the re-encode makes them smaller.
 *
 * Seeded rather than `randomBytes`, so the bytes and therefore the JPEG's size
 * are the same on every run: a size threshold tested against a different
 * image each time is a test that can pass or fail by luck.
 */
export function pngNoise(width: number, height: number, seed = 0x5eed): Buffer {
  const rowBytes = Math.ceil(width / 8);
  const scanlines = Buffer.alloc(height * (1 + rowBytes));

  // xorshift32: enough to defeat deflate, and two lines rather than a dependency.
  let state = seed >>> 0 || 1;
  for (let row = 0; row < height; row++) {
    const start = row * (1 + rowBytes);
    scanlines[start] = 0; // filter: none
    for (let i = 1; i <= rowBytes; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      scanlines[start + i] = state & 0xff;
    }
  }

  // Index 0 black, index 1 white: the widest contrast two entries can carry.
  const palette = chunk("PLTE", Buffer.from([0, 0, 0, 0xff, 0xff, 0xff]));

  return assemble(width, height, deflateSync(scanlines), {
    bitDepth: 1,
    colourType: 3,
    before: [palette],
  });
}
