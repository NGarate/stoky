import { describe, it, expect, afterEach } from "bun:test";
import { processReceiptOcr, sharedWorker, terminateWorker } from "@/server/services/ocr";

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

  describe("sharedWorker", () => {
    /** A stand-in worker factory that counts what it made and what it ended. */
    function fakeFactory(options: { failFirst?: boolean } = {}) {
      const made: { terminated: boolean }[] = [];
      let calls = 0;
      const create = async () => {
        calls += 1;
        // Long enough that a second caller arrives while the first is loading.
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (options.failFirst && calls === 1) throw new Error("load failed");
        const worker = {
          terminated: false,
          async terminate() {
            worker.terminated = true;
          },
        };
        made.push(worker);
        return worker;
      };
      return { create, made, calls: () => calls };
    }

    it("creates one worker for first scans that arrive together", async () => {
      const factory = fakeFactory();
      const shared = sharedWorker(factory.create);

      const [first, second] = await Promise.all([shared.get(), shared.get()]);

      expect(factory.calls()).toBe(1);
      expect(first).toBe(second);

      await shared.terminate();
      // The only worker there is was terminated: none left running.
      expect(factory.made.map((worker) => worker.terminated)).toEqual([true]);
    });

    it("tries again after a creation that failed", async () => {
      const factory = fakeFactory({ failFirst: true });
      const shared = sharedWorker(factory.create);

      await expect(shared.get()).rejects.toThrow("load failed");
      const worker = await shared.get();

      expect(factory.calls()).toBe(2);
      expect(worker.terminated).toBe(false);
    });

    it("makes a new worker after terminate", async () => {
      const factory = fakeFactory();
      const shared = sharedWorker(factory.create);

      const before = await shared.get();
      await shared.terminate();
      const after = await shared.get();

      expect(before.terminated).toBe(true);
      expect(after).not.toBe(before);
      expect(after.terminated).toBe(false);
    });
  });
});
