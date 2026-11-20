import { describe, it, expect, afterEach, jest } from "bun:test";
import {
  isRunning,
  onImageThread,
  sent,
  stopImageThreads,
  stopThreadsIdleFor,
} from "@/server/services/image-thread";

afterEach(async () => {
  // The idle limit is a timer here, in this thread, so the cases below run
  // it on a fake clock; the thread and its replies stay real.
  jest.useRealTimers();
  stopThreadsIdleFor(null);
  await stopImageThreads();
});

/** A request every thread answers at once: a reading chosen. */
const ask = async () =>
  sent(
    await onImageThread("upload", { step: "choose", readings: ["PAN 1,00"] }),
    "text",
  );

describe("an idle image thread", () => {
  it("stops when told to, so the next request runs the code as it is now", async () => {
    // What `next dev` asks: its code can change under a thread kept alive.
    stopThreadsIdleFor(50);
    jest.useFakeTimers();

    expect(await ask()).toBe("PAN 1,00");
    expect(isRunning("upload")).toBe(true);
    jest.advanceTimersByTime(50);
    expect(isRunning("upload")).toBe(false);
    jest.useRealTimers();
    // And the next request starts one again.
    expect(await ask()).toBe("PAN 1,00");
  });

  it("is kept when not, as a production server's are", async () => {
    jest.useFakeTimers();
    expect(await ask()).toBe("PAN 1,00");
    // An hour, where real time could only afford a moment.
    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(isRunning("upload")).toBe(true);
  });

  it("is not stopped while it has work", async () => {
    stopThreadsIdleFor(50);
    jest.useFakeTimers();

    await ask();
    // A request arriving before the idle limit keeps the same thread.
    jest.advanceTimersByTime(20);
    const second = ask();
    jest.advanceTimersByTime(40);
    expect(await second).toBe("PAN 1,00");
    expect(isRunning("upload")).toBe(true);
  });
});
