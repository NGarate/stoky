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

function assemble(width: number, height: number, idat: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
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
