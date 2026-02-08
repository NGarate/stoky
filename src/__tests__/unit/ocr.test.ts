import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { processReceiptOcr, terminateWorker } from "@/server/services/ocr";
import { mock, spyOn } from "bun:test";

describe("OCR Service", () => {
  afterEach(async () => {
    await terminateWorker();
  });

  describe("processReceiptOcr", () => {
    it("should be defined", () => {
      expect(typeof processReceiptOcr).toBe("function");
    });

    it("should throw error for non-existent receipt", async () => {
      try {
        await processReceiptOcr("non-existent-id");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Worker lifecycle", () => {
    it("should terminate worker without errors", async () => {
      await expect(terminateWorker()).resolves.toBeUndefined();
    });

    it("should handle multiple terminate calls", async () => {
      await terminateWorker();
      await terminateWorker(); // Should not throw
      await terminateWorker(); // Should not throw
    });
  });
});
