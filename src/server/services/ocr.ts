import { createWorker, type Worker } from "tesseract.js";
import { prisma } from "@/lib/prisma";
import { ReceiptStatus } from "@prisma/client";
import sharp from "sharp";
import { InvalidInputError, NotFoundError } from "./errors";

let worker: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = await createWorker("spa");
  }
  return worker;
}

export async function processReceiptOcr(receiptId: string): Promise<string> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
  });

  if (!receipt) {
    throw new NotFoundError("Receipt not found");
  }

  try {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { status: ReceiptStatus.PROCESSING },
    });

    const fs = await import("node:fs");
    const imageBuffer = await fs.promises.readFile(receipt.imagePath);
    if (imageBuffer.length === 0) {
      throw new InvalidInputError("Empty image file");
    }

    // Validate image before passing it to OCR to avoid worker-level crashes.
    await sharp(imageBuffer).metadata();

    const ocrWorker = await getWorker();
    const {
      data: { text },
    } = await ocrWorker.recognize(imageBuffer);

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        rawOcrText: text,
        status: ReceiptStatus.PARSED,
        processedAt: new Date(),
      },
    });

    return text;
  } catch (error) {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { status: ReceiptStatus.FAILED },
    });
    throw error;
  }
}

export async function terminateWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
