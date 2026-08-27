import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import sharp from "sharp";
import { exifPayload, hasExif, isJpeg } from "../utils/jpeg";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createMockSession,
  createTestHousehold,
  createTestUser,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * What a *successful* upload leaves behind — `SECURITY_REVIEW.md` finding 15.
 *
 * The finding said no test performs a successful upload. One does:
 * `receipt.router.test.ts`, "still accepts the household's own store". It
 * asserts `expect(receipt).toBeDefined()`, which is the weakest statement
 * available — it proves the call did not throw.
 *
 * So the substance holds. Everything `CLAUDE.md` requires of this path is about
 * what the upload *produces*: "re-encode with Sharp (strips EXIF), store with
 * UUID filenames in isolated Docker volume". Not one of those was checked.
 * `unit/image-reencode.test.ts` now covers the re-encoder in isolation; this
 * covers the procedure wiring it up, which is a different claim — a correct
 * re-encoder whose result is not the thing written to disk would pass that file
 * and fail this one.
 *
 * The file it writes is deleted afterwards. `uploads/receipts/` had 48 orphaned
 * household directories from previous runs when this was written, which is the
 * suite's own small instance of finding 16.
 *
 * `sharp` remains only to *build* the photograph, because `Bun.Image` has no
 * `create`. Nothing here asks it about a result: EXIF and the JPEG marker are
 * read out of the file's own bytes by `../utils/jpeg`, which is the runtime
 * this application actually deploys on rather than a second opinion.
 */

const HOUSEHOLD = "Upload Artefact Household";
const PREFIX = "Upload Artefact ";

type Caller = ReturnType<typeof appRouter.createCaller>;

let caller: Caller;
let householdId: string;
/** Everything written during this file, removed in `afterAll` whatever happens. */
const written: string[] = [];

/** A JPEG carrying what a phone attaches, so "stripped" can mean something. */
async function photographWithExif(): Promise<Buffer> {
  // Copied out of sharp's pooled buffer: `Bun.Image` refuses a resizable one,
  // and the router's own `Buffer.from(base64)` is never pooled. See
  // `unit/image-reencode.test.ts` for the full story.
  return Buffer.from(
    await sharp({
      create: {
        width: 60,
        height: 40,
        channels: 3,
        background: { r: 200, g: 180, b: 160 },
      },
    })
      .jpeg()
      .withExif({
        IFD0: { Copyright: "Upload Artefact Test", Make: "ArtefactPhone" },
        IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "W" },
      })
      .toBuffer(),
  );
}

async function upload(): Promise<{ id: string; imagePath: string }> {
  const source = await photographWithExif();
  const receipt = await caller.receipt.upload({
    fileBase64: source.toString("base64"),
    mimeType: "image/jpeg",
  });

  written.push(receipt.imagePath);
  return { id: receipt.id, imagePath: receipt.imagePath };
}

beforeAll(async () => {
  const household = await createTestHousehold({ name: HOUSEHOLD });
  householdId = household.id;

  const user = await createTestUser({
    email: generateTestEmail("upload-artefact"),
    name: `${PREFIX}Owner`,
    password: "cocina despensa nevera",
    householdId,
    role: "OWNER",
  });

  const ctx = await createTRPCContext({
    session: createMockSession({ ...user, household }),
  });
  caller = appRouter.createCaller(ctx);
});

afterAll(async () => {
  for (const path of written) {
    await rm(path, { force: true });
  }
  // The directory too, or this file leaves exactly the litter it complains of.
  await rm(`uploads/receipts/${householdId}`, { recursive: true, force: true });

  await prisma.receiptItem.deleteMany({ where: { receipt: { householdId } } });
  await prisma.receipt.deleteMany({ where: { householdId } });
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({ where: { id: householdId } });
});

describe("where an accepted photograph is put", () => {
  it("goes in this household's own directory and nowhere else", async () => {
    // The household is in the path, which is what makes one household's
    // receipts unreachable by guessing at another's.
    const { imagePath } = await upload();

    expect(imagePath.startsWith(`uploads/receipts/${householdId}/`)).toBe(true);
  });

  it("is named with a UUID rather than anything the caller supplied", async () => {
    // A caller-influenced name is a path the caller can predict, and the
    // filename is the only thing standing between a stranger and a receipt if
    // the volume is ever served directly.
    const { imagePath } = await upload();
    const fileName = imagePath.split("/").pop() ?? "";

    expect(fileName).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/,
    );
  });

  it("is a `.jpg` whatever arrived, because the format is normalised", async () => {
    const { imagePath } = await upload();

    expect(imagePath.endsWith(".jpg")).toBe(true);
  });
});

describe("what is in the file", () => {
  it("is really there, and is really a JPEG", async () => {
    // The extension is a name; these are the bytes. `FF D8 FF` is the SOI
    // marker every JPEG starts with.
    const { imagePath } = await upload();
    const onDisk = await readFile(imagePath);

    expect(onDisk.length).toBeGreaterThan(0);
    expect(onDisk[0]).toBe(0xff);
    expect(onDisk[1]).toBe(0xd8);
    expect(onDisk[2]).toBe(0xff);
    expect(isJpeg(onDisk)).toBe(true);
  });

  it("carries none of the metadata the photograph arrived with", async () => {
    // The control `CLAUDE.md` asks for, asserted on the artefact rather than on
    // the function that was supposed to produce it. A correct re-encoder whose
    // output is not what gets written would pass the unit file and fail here.
    const source = await photographWithExif();

    // The premise: the thing being uploaded really does carry metadata.
    expect(hasExif(source)).toBe(true);
    expect(exifPayload(source).length).toBeGreaterThan(0);

    const { imagePath } = await upload();
    const onDisk = await readFile(imagePath);

    expect(hasExif(onDisk)).toBe(false);
    expect(exifPayload(onDisk).length).toBe(0);
    expect(onDisk.toString("latin1")).not.toContain("ArtefactPhone");
  });

  it("is not the bytes that were sent", async () => {
    // What lands on disk is an image this server produced. A pass-through that
    // happened to keep the format and lose the EXIF would still be a caller's
    // file, and this is the assertion that says so.
    const source = await photographWithExif();
    const { imagePath } = await upload();
    const onDisk = await readFile(imagePath);

    expect(onDisk.equals(source)).toBe(false);
  });
});

describe("the row that points at it", () => {
  it("records the path the file was actually written to", async () => {
    // A row pointing somewhere the file is not is indistinguishable from a
    // missing receipt at the moment somebody opens it.
    const { id, imagePath } = await upload();

    const row = await prisma.receipt.findUniqueOrThrow({ where: { id } });
    expect(row.imagePath).toBe(imagePath);
    expect(row.householdId).toBe(householdId);

    await expect(readFile(row.imagePath)).resolves.toBeDefined();
  });

  it("gives every upload its own file", async () => {
    // Two uploads, two names. A fixed or colliding name would mean one
    // household's receipt quietly replacing another's.
    const first = await upload();
    const second = await upload();

    expect(first.imagePath).not.toBe(second.imagePath);
    await expect(readFile(first.imagePath)).resolves.toBeDefined();
    await expect(readFile(second.imagePath)).resolves.toBeDefined();
  });
});
