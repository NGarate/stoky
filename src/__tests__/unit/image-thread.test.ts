import { describe, it, expect, afterEach } from "bun:test";
import {
  isRunning,
  onImageThread,
  sent,
  stopImageThreads,
  stopThreadsIdleFor,
} from "@/server/services/image-thread";

afterEach(async () => {
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

    expect(await ask()).toBe("PAN 1,00");
    expect(isRunning("upload")).toBe(true);
    await Bun.sleep(200);
    expect(isRunning("upload")).toBe(false);
    // And the next request starts one again.
    expect(await ask()).toBe("PAN 1,00");
  });

  it("is kept when not, as a production server's are", async () => {
    expect(await ask()).toBe("PAN 1,00");
    await Bun.sleep(200);
    expect(isRunning("upload")).toBe(true);
  });

  it("is not stopped while it has work", async () => {
    stopThreadsIdleFor(50);

    await ask();
    // A request arriving before the idle limit keeps the same thread.
    await Bun.sleep(20);
    const second = ask();
    await Bun.sleep(40);
    expect(await second).toBe("PAN 1,00");
    expect(isRunning("upload")).toBe(true);
  });
});
