import { describe, it, expect, afterEach } from "bun:test";
import {
  DEFAULT_OCR_TIMEOUT_MS,
  ocrTimeoutMs,
  processReceiptOcr,
  sharedWorker,
  terminateWorker,
  timedRecogniser,
} from "@/server/services/ocr";

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

  describe("ocrTimeoutMs", () => {
    it("reads a positive whole number of milliseconds", () => {
      expect(ocrTimeoutMs("90000")).toBe(90_000);
      expect(ocrTimeoutMs("2147483647")).toBe(2_147_483_647);
    });

    // "2147483648" is one past the longest delay a timer holds: the runtime
    // would fire it after 1 ms and fail every scan.
    it("keeps the default for anything that would weaken the bound", () => {
      for (const configured of [undefined, "", "0", "-5", "1.5", "abc", "Infinity", "2147483648"]) {
        expect(ocrTimeoutMs(configured)).toBe(DEFAULT_OCR_TIMEOUT_MS);
      }
      expect(DEFAULT_OCR_TIMEOUT_MS).toBe(120_000);
    });
  });

  describe("timedRecogniser", () => {
    const image = Buffer.from("not looked at");
    const LIMIT = 40;

    /**
     * Workers that answer in turn with the given behaviours: a string is the
     * text it recognises at once, `"hang"` never answers — the image
     * tesseract cannot finish. Each counts its terminations and how many
     * recognitions it was handed.
     */
    function fakeWorkers(...behaviours: string[]) {
      const made: { terminations: number; recognitions: number }[] = [];
      const create = async () => {
        const behaviour = behaviours[made.length] ?? "spare";
        const worker = {
          terminations: 0,
          recognitions: 0,
          recognize(_image: Buffer): Promise<{ data: { text: string } }> {
            worker.recognitions += 1;
            if (behaviour === "hang") return new Promise(() => {});
            if (behaviour === "throw") return Promise.reject(new Error("unreadable"));
            return Promise.resolve({ data: { text: behaviour } });
          },
          async terminate() {
            worker.terminations += 1;
          },
        };
        made.push(worker);
        return worker;
      };
      const recognise = timedRecogniser(sharedWorker(create), () => LIMIT);
      return { recognise, made };
    }

    /**
     * How a recognition ended — raced against a guard of its own, so one
     * with no limit fails the test that waits on it instead of hanging the
     * run.
     */
    function outcome(recognition: Promise<string>) {
      return Promise.race([
        recognition.then(
          (text) => ({ text }),
          (error: unknown) => ({ error: (error as Error).message }),
        ),
        new Promise((resolve) => setTimeout(() => resolve("still waiting"), LIMIT * 10)),
      ]);
    }

    it("gives up on a worker that never answers, and terminates it once", async () => {
      const { recognise, made } = fakeWorkers("hang");

      const started = performance.now();
      expect(await outcome(recognise(image))).toEqual({
        error: `OCR did not finish within ${LIMIT} ms`,
      });

      expect(performance.now() - started).toBeGreaterThanOrEqual(LIMIT - 5);
      expect(made).toHaveLength(1);
      expect(made[0]!.terminations).toBe(1);
    });

    it("hands the next image to a fresh worker", async () => {
      const { recognise, made } = fakeWorkers("hang", "LECHE 1,25");

      expect(await outcome(recognise(image))).toHaveProperty("error");
      expect(await outcome(recognise(image))).toEqual({ text: "LECHE 1,25" });

      expect(made).toHaveLength(2);
      expect(made[1]!.terminations).toBe(0);
    });

    it("does not hand a queued image to the worker that is stuck", async () => {
      // Both arrive together. Given to the stuck worker as well, the second
      // would never be answered: tesseract's terminate does not settle the
      // jobs still queued on it.
      const { recognise, made } = fakeWorkers("hang", "PAN 0,95");

      const [first, second] = await Promise.all([
        outcome(recognise(image)),
        outcome(recognise(image)),
      ]);

      expect(first).toHaveProperty("error");
      expect(second).toEqual({ text: "PAN 0,95" });
      expect(made.map((worker) => worker.recognitions)).toEqual([1, 1]);
      expect(made[0]!.terminations).toBe(1);
    });

    it("keeps a worker whose recognition failed in time", async () => {
      // An error is an answer: the worker is free, and reloading the model
      // for every unreadable photo would be cost for nothing.
      const { recognise, made } = fakeWorkers("throw");

      expect(await outcome(recognise(image))).toEqual({ error: "unreadable" });
      expect(await outcome(recognise(image))).toEqual({ error: "unreadable" });

      expect(made).toHaveLength(1);
      expect(made[0]!.terminations).toBe(0);
    });

    it("leaves a worker that answered in time alone", async () => {
      const { recognise, made } = fakeWorkers("HUEVOS 2,10");

      await expect(recognise(image)).resolves.toBe("HUEVOS 2,10");
      // Past the limit: a timer left running would fire now.
      await new Promise((resolve) => setTimeout(resolve, LIMIT * 2));
      await expect(recognise(image)).resolves.toBe("HUEVOS 2,10");

      expect(made).toHaveLength(1);
      expect(made[0]!.terminations).toBe(0);
    });
  });
});
