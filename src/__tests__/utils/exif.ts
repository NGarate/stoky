/**
 * Writing an EXIF block, so a fixture can carry one without `sharp`.
 *
 * The last thing keeping the image tests on a library the application does not
 * deploy was the *fixture* job: `Bun.Image` has no `create`, and nothing in the
 * shipped runtime can attach metadata to a photograph
 * (`docs/superpowers/plans/2026-08-27-finishing-the-bun-migration.md` §1).
 *
 * A JPEG cannot reasonably be assembled from nothing — Huffman tables,
 * quantisation tables and entropy-coded scan data are not a fixture, they are a
 * codec. But it does not have to be. A valid JPEG comes from
 * `reencodeAsJpeg(pngOf(w, h))`, using the builder in `./png` and the runtime
 * that ships; this module then splices an `APP1` segment in after the `SOI`,
 * which is exactly how a camera puts one there.
 *
 * **That is not circular.** The property under test is that re-encoding
 * *removes* EXIF and bakes orientation in; neither is used to create the
 * fixture, whose metadata comes from here. And each test asserts the premise —
 * that the source really does carry what it claims — before asserting anything
 * about the result.
 *
 * EXIF is TIFF, which is why this is more than a byte array: a header naming
 * the byte order, an IFD of 12-byte entries **in ascending tag order**, and a
 * data area for every value too large to sit in an entry's four bytes.
 */

/** `Exif\0\0`, the prefix that makes an APP1 segment an EXIF one. */
const EXIF_PREFIX = Buffer.from("Exif\0\0", "latin1");

/** TIFF field types, as far as this needs them. */
const ASCII = 2;
const SHORT = 3;
const LONG = 4;

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** The value, however long. Placed inline when it fits in four bytes. */
  value: Buffer;
}

export interface ExifSpec {
  /** `II` little-endian, `MM` big-endian. Both are legal and both appear. */
  byteOrder?: "II" | "MM";
  make?: string;
  model?: string;
  copyright?: string;
  /** 1–8. `6` is "rotate 90° clockwise", which is a phone held upright. */
  orientation?: number;
  /** The block a receipt photograph should never keep: where it was taken. */
  gps?: { latitudeRef: string; longitudeRef: string };
}

function ascii(value: string): Buffer {
  // NUL-terminated, and the count includes the terminator.
  return Buffer.from(`${value}\0`, "latin1");
}

/**
 * Serialises one IFD and its data area.
 *
 * `base` is where this IFD begins *within the TIFF block*, because every offset
 * an entry writes is relative to the TIFF header rather than to the file.
 */
function serialiseIfd(entries: Entry[], base: number, little: boolean): Buffer {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);

  const directory = Buffer.alloc(2 + sorted.length * 12 + 4);
  const overflow: Buffer[] = [];
  let dataAt = base + directory.length;

  const u16 = (buf: Buffer, at: number, n: number) =>
    little ? buf.writeUInt16LE(n, at) : buf.writeUInt16BE(n, at);
  const u32 = (buf: Buffer, at: number, n: number) =>
    little ? buf.writeUInt32LE(n, at) : buf.writeUInt32BE(n, at);

  u16(directory, 0, sorted.length);

  sorted.forEach((entry, index) => {
    const at = 2 + index * 12;
    u16(directory, at, entry.tag);
    u16(directory, at + 2, entry.type);
    u32(directory, at + 4, entry.count);

    if (entry.value.length <= 4) {
      // Inline, left-aligned in the four-byte value field.
      entry.value.copy(directory, at + 8);
    } else {
      u32(directory, at + 8, dataAt);
      overflow.push(entry.value);
      dataAt += entry.value.length;
      // TIFF wants values word-aligned; pad rather than let the next one start odd.
      if (entry.value.length % 2 === 1) {
        overflow.push(Buffer.alloc(1));
        dataAt += 1;
      }
    }
  });

  // No next IFD.
  u32(directory, 2 + sorted.length * 12, 0);

  return Buffer.concat([directory, ...overflow]);
}

/** The APP1 payload: `Exif\0\0` then a whole TIFF block. */
export function exifPayloadFor(spec: ExifSpec): Buffer {
  const little = (spec.byteOrder ?? "II") === "II";

  const u16 = (buf: Buffer, at: number, n: number) =>
    little ? buf.writeUInt16LE(n, at) : buf.writeUInt16BE(n, at);
  const u32 = (buf: Buffer, at: number, n: number) =>
    little ? buf.writeUInt32LE(n, at) : buf.writeUInt32BE(n, at);

  const header = Buffer.alloc(8);
  header.write(little ? "II" : "MM", 0, "latin1");
  u16(header, 2, 42); // the answer TIFF checks for, and how a reader confirms the order
  u32(header, 4, 8); // IFD0 begins immediately after this header

  const entries: Entry[] = [];
  if (spec.make !== undefined) {
    const value = ascii(spec.make);
    entries.push({ tag: 0x010f, type: ASCII, count: value.length, value });
  }
  if (spec.model !== undefined) {
    const value = ascii(spec.model);
    entries.push({ tag: 0x0110, type: ASCII, count: value.length, value });
  }
  if (spec.orientation !== undefined) {
    const value = Buffer.alloc(2);
    u16(value, 0, spec.orientation);
    entries.push({ tag: 0x0112, type: SHORT, count: 1, value });
  }
  if (spec.copyright !== undefined) {
    const value = ascii(spec.copyright);
    entries.push({ tag: 0x8298, type: ASCII, count: value.length, value });
  }

  if (!spec.gps) {
    return Buffer.concat([
      EXIF_PREFIX,
      header,
      serialiseIfd(entries, 8, little),
    ]);
  }

  // The GPS block is a *second* IFD, pointed at from the first. Its offset can
  // only be known once IFD0's own length is, so IFD0 is laid out twice: once to
  // measure, once with the pointer filled in.
  const pointer = Buffer.alloc(4);
  const withPointer = [
    ...entries,
    { tag: 0x8825, type: LONG, count: 1, value: pointer },
  ];
  const gpsAt = 8 + serialiseIfd(withPointer, 8, little).length;
  u32(pointer, 0, gpsAt);

  const gpsEntries: Entry[] = [
    {
      tag: 0x0001,
      type: ASCII,
      count: 2,
      value: ascii(spec.gps.latitudeRef),
    },
    {
      tag: 0x0003,
      type: ASCII,
      count: 2,
      value: ascii(spec.gps.longitudeRef),
    },
  ];

  return Buffer.concat([
    EXIF_PREFIX,
    header,
    serialiseIfd(withPointer, 8, little),
    serialiseIfd(gpsEntries, gpsAt, little),
  ]);
}

/**
 * The same JPEG, now carrying EXIF.
 *
 * Spliced straight after `SOI`, which is where a camera puts it and where the
 * marker walker looks. Any APP1 already present is left alone — nothing this is
 * used on has one, and silently replacing a segment would be a surprise.
 */
export function withExif(jpeg: Buffer, spec: ExifSpec): Buffer {
  const payload = exifPayloadFor(spec);

  const length = Buffer.alloc(2);
  // The length field counts itself, hence the two.
  length.writeUInt16BE(payload.length + 2);

  return Buffer.concat([
    jpeg.subarray(0, 2), // SOI
    Buffer.from([0xff, 0xe1]), // APP1
    length,
    payload,
    jpeg.subarray(2),
  ]);
}
