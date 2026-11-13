import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  beforeAll,
} from "bun:test";
import { prisma } from "@/lib/prisma";
import {
  processReceiptOcr,
  sharedWorker,
  timedRecogniser,
} from "@/server/services/ocr";
import {
  parseReceiptText,
  saveParsedItems,
} from "@/server/services/receiptParser";
import { failInterruptedReceipts } from "@/server/services/receipt-recovery";
import {
  MatchStatus,
  ReceiptStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pngOf } from "../utils/png";
import { num } from "../utils/amount";

/**
 * A receipt's way through the database: the status the reading leaves it at,
 * and what saving the parsed text writes.
 *
 * What the parser makes of the text is `unit/receiptParser.test.ts`'s, and how
 * lines are matched to products is `receipt.matching.test.ts`'s. Nothing here
 * starts Tesseract: every reading is handed a recogniser of its own.
 */

let testDir: string;
let householdId: string;
let userId: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "stoky-ocr-test-"));
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `test-${randomUUID()}@example.com`, name: "Test User" },
  });
  userId = user.id;
  const household = await prisma.household.create({
    data: { name: "Test Household", members: { connect: { id: user.id } } },
  });
  householdId = household.id;
});

afterEach(async () => {
  await prisma.receiptItem.deleteMany({ where: { receipt: { householdId } } });
  await prisma.receipt.deleteMany({ where: { householdId } });
  await prisma.store.deleteMany({ where: { householdId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.household.delete({ where: { id: householdId } });
});

/**
 * A receipt of this test's household whose photo holds `photo`; with no
 * `photo`, the path names a file that does not exist.
 */
async function receiptWith(
  photo?: Uint8Array | string,
  data: Partial<Prisma.ReceiptUncheckedCreateInput> = {},
) {
  const imagePath = join(testDir, `${randomUUID()}.png`);
  if (photo !== undefined) await writeFile(imagePath, photo);
  return prisma.receipt.create({
    data: {
      imagePath,
      status: ReceiptStatus.UPLOADING,
      householdId,
      uploadedBy: userId,
      ...data,
    },
  });
}

const statusOf = async (id: string) =>
  (await prisma.receipt.findUniqueOrThrow({ where: { id } })).status;

/** A recogniser for a reading that must be refused before it is asked. */
function untouched() {
  const calls: unknown[] = [];
  return {
    calls,
    recognise: async (image: Buffer) => {
      calls.push(image);
      return "LECHE 1,25\n";
    },
  };
}

describe("reading a receipt", () => {
  it("refuses a receipt that does not exist", async () => {
    await expect(processReceiptOcr("non-existent-receipt-id")).rejects.toThrow(
      "Receipt not found",
    );
  });

  it("fails a receipt OCR read no text from, instead of leaving it PARSED", async () => {
    const receipt = await receiptWith(pngOf(60, 40));

    // What tesseract returns for a blank page: whitespace.
    await expect(
      processReceiptOcr(receipt.id, async () => " \n\n "),
    ).rejects.toThrow("No text recognised");

    expect(await statusOf(receipt.id)).toBe(ReceiptStatus.FAILED);
  });

  it("hands back the text and moves to PARSED when OCR reads some", async () => {
    const receipt = await receiptWith(pngOf(60, 40));

    const text = await processReceiptOcr(
      receipt.id,
      async () => "LECHE 1,25\n",
    );

    expect(text).toBe("LECHE 1,25\n");
    const updated = await prisma.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    expect(updated.status).toBe(ReceiptStatus.PARSED);
    expect(updated.rawOcrText).toBe("LECHE 1,25\n");
  });

  it("reads the ticket from the frame stored with the receipt", async () => {
    // A band 400 x 60 framed on a 400 x 300 photo: read standing, it is
    // nearly seven times as tall as it is wide; the whole photo, 4:3.
    const receipt = await receiptWith(pngOf(400, 300), {
      ticketQuad: [
        [0, 0.4],
        [1, 0.4],
        [1, 0.6],
        [0, 0.6],
      ],
    });

    const shapes: number[] = [];
    await processReceiptOcr(receipt.id, async (image) => {
      const { width, height } = await new Bun.Image(image).metadata();
      shapes.push(height! / width!);
      return "LECHE 1,25\n";
    });

    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) expect(shape).toBeGreaterThan(5);
  });

  it("moves to FAILED when recognition runs out of time", async () => {
    const receipt = await receiptWith(pngOf(60, 40));

    // The image tesseract cannot finish: a worker that never answers.
    let terminations = 0;
    const stuck = sharedWorker(async () => ({
      recognize: () => new Promise<{ data: { text: string } }>(() => {}),
      async terminate() {
        terminations += 1;
      },
    }));
    const ocr = processReceiptOcr(
      receipt.id,
      timedRecogniser(stuck, () => 50),
    ).then(
      () => "PARSED",
      (error: unknown) => (error as Error).message,
    );
    const guard = new Promise((resolve) =>
      setTimeout(() => resolve("still waiting"), 3000),
    );

    expect(await Promise.race([ocr, guard])).toBe(
      "OCR did not finish within 50 ms",
    );
    expect(terminations).toBe(1);
    expect(await statusOf(receipt.id)).toBe(ReceiptStatus.FAILED);
  });

  it("fails a receipt whose photo is gone, without reading anything", async () => {
    const receipt = await receiptWith();
    const ocr = untouched();

    await expect(
      processReceiptOcr(receipt.id, ocr.recognise),
    ).rejects.toMatchObject({ code: "ENOENT" });

    expect(ocr.calls).toHaveLength(0);
    expect(await statusOf(receipt.id)).toBe(ReceiptStatus.FAILED);
  });

  it("fails an empty photo, without reading anything", async () => {
    const receipt = await receiptWith("");
    const ocr = untouched();

    await expect(processReceiptOcr(receipt.id, ocr.recognise)).rejects.toThrow(
      "Empty image file",
    );

    expect(ocr.calls).toHaveLength(0);
    expect(await statusOf(receipt.id)).toBe(ReceiptStatus.FAILED);
  });

  it("fails bytes that are no image before OCR sees them", async () => {
    // A re-read takes the photo off disk, not through the upload's checks.
    const receipt = await receiptWith("This is a text file, not an image");
    const ocr = untouched();

    await expect(
      processReceiptOcr(receipt.id, ocr.recognise),
    ).rejects.toThrow();

    expect(ocr.calls).toHaveLength(0);
    expect(await statusOf(receipt.id)).toBe(ReceiptStatus.FAILED);
  });
});

describe("saving what was read", () => {
  it("stores the total and one PENDING row per line, as the parser read it", async () => {
    const receipt = await receiptWith(pngOf(60, 40));
    const parsed = parseReceiptText(`TIENDA
Fecha: 15/03/2024

Leche 1,25
2x Pan 0,95
Huevos 2,50

TOTAL: 4,70 EUR`);
    expect(parsed.items.length).toBe(3);

    await saveParsedItems(receipt.id, parsed);

    const saved = await prisma.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
      include: { items: true },
    });
    expect(num(saved.totalAmount)).toBe(4.7);
    expect(saved.items).toHaveLength(parsed.items.length);
    for (const line of parsed.items) {
      const row = saved.items.find((s) => s.parsedName === line.parsedName);
      expect(num(row?.parsedPrice)).toBe(line.parsedPrice);
      expect(num(row?.parsedQuantity)).toBe(line.parsedQuantity ?? 1);
      expect(row?.rawText).toBe(line.rawText);
      expect(row?.matchStatus).toBe(MatchStatus.PENDING);
    }
  });

  it("replaces the lines, so running twice is running once", async () => {
    const receipt = await receiptWith(pngOf(60, 40));
    const parsed = parseReceiptText("TIENDA\nLeche 1,25\nPan 0,95\n");

    await saveParsedItems(receipt.id, parsed);
    await saveParsedItems(receipt.id, parsed);

    // Not doubled: a second run over the same OCR text replaces the lines
    // it produced last time rather than appending a second copy of them.
    expect(
      await prisma.receiptItem.count({ where: { receiptId: receipt.id } }),
    ).toBe(parsed.items.length);
  });

  it("keeps the store chosen at upload instead of the one the header names", async () => {
    const chosen = await prisma.store.create({
      data: { name: "Mi Mercadona", householdId },
    });
    const receipt = await receiptWith(undefined, { storeId: chosen.id });

    await saveParsedItems(receipt.id, parseReceiptText("LIDL\nLeche 1,25"));

    const saved = await prisma.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    expect(saved.storeId).toBe(chosen.id);
    // And the header's guess was not created as a store on the side.
    const stores = await prisma.store.findMany({ where: { householdId } });
    expect(stores.map((store) => store.id)).toEqual([chosen.id]);
  });

  it("files the receipt under the header's store when none was chosen", async () => {
    const receipt = await receiptWith();

    await saveParsedItems(receipt.id, parseReceiptText("LIDL\nLeche 1,25"));

    const saved = await prisma.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
      include: { store: true },
    });
    expect(saved.store?.name).toBe("lidl");
  });

  it("files it under the household's store of that name, whatever its case", async () => {
    const existing = await prisma.store.create({
      data: { name: "Lidl", householdId },
    });
    const receipt = await receiptWith();

    await saveParsedItems(receipt.id, parseReceiptText("LIDL\nLeche 1,25"));

    const saved = await prisma.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    expect(saved.storeId).toBe(existing.id);
    expect(await prisma.store.count({ where: { householdId } })).toBe(1);
  });
});

describe("Restart recovery", () => {
  // Dated well before anything else in the test database, so the sweep —
  // which is not scoped to a household, because a restart is not — cannot
  // reach another test's receipts, and the count below is this test's own.
  const startedAt = new Date("2001-01-01T00:00:00Z");
  const before = new Date("2000-06-01T00:00:00Z");
  const after = new Date("2001-01-01T00:00:01Z");

  const receiptIn = (status: ReceiptStatus, createdAt: Date) =>
    receiptWith(undefined, { status, createdAt });

  it("fails the receipts a previous process left in flight, and nothing else", async () => {
    const stranded = await Promise.all([
      receiptIn(ReceiptStatus.UPLOADING, before),
      receiptIn(ReceiptStatus.PROCESSING, before),
      receiptIn(ReceiptStatus.PARSED, before),
    ]);
    const settled = await Promise.all(
      [
        ReceiptStatus.NEEDS_REVIEW,
        ReceiptStatus.CONFIRMED,
        ReceiptStatus.APPLIED,
      ].map((status) => receiptIn(status, before)),
    );
    // This process's own: created after it started, still being read.
    const current = await receiptIn(ReceiptStatus.PROCESSING, after);

    const failed = await failInterruptedReceipts(startedAt);

    expect(failed).toBe(3);
    for (const receipt of stranded) {
      expect(await statusOf(receipt.id)).toBe(ReceiptStatus.FAILED);
    }
    for (const receipt of settled) {
      expect(await statusOf(receipt.id)).toBe(receipt.status);
    }
    expect(await statusOf(current.id)).toBe(ReceiptStatus.PROCESSING);
  });
});
