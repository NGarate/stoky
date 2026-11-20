import { describe, it, expect, afterEach, jest } from "bun:test";
import {
  isRunning,
  onImageThread,
  sent,
  stopImageThreads,
  stopThreadsIdleFor,
} from "@/server/services/image-thread";

afterEach(async () => {
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

/**
 * The idle limit is a `setTimeout` on this thread, so a fake clock takes it
 * past the limit at once instead of the test sleeping through it. The
 * thread's answers are messages, which the fake clock does not touch: `ask`
 * still waits on the real thread.
 */
describe("an idle image thread", () => {
  it("stops when told to, so the next request runs the code as it is now", async () => {
    // What `next dev` asks: its code can change under a thread kept alive.
    stopThreadsIdleFor(50);
    jest.useFakeTimers();

    expect(await ask()).toBe("PAN 1,00");
    jest.advanceTimersByTime(49);
    expect(isRunning("upload")).toBe(true);
    jest.advanceTimersByTime(1);
    expect(isRunning("upload")).toBe(false);
    // And the next request starts one again.
    expect(await ask()).toBe("PAN 1,00");
  });

  it("is kept when not, as a production server's are", async () => {
    // Said here, not left to an earlier case's afterEach: under
    // NODE_ENV=development (the CI image) the module starts at 30 s.
    stopThreadsIdleFor(null);
    jest.useFakeTimers();

    expect(await ask()).toBe("PAN 1,00");
    jest.advanceTimersByTime(24 * 60 * 60_000);
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
