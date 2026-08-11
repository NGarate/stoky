import { describe, it, expect } from "bun:test";
import { MAX_DELAY_MS, backoffDelay } from "@/lib/offline/backoff";

/**
 * The wait between attempts, tested for its shape rather than sampled.
 *
 * `random` is injected precisely so these can be assertions instead of
 * observations — a test that draws real randomness and checks a range is a
 * test that passes for the wrong reason roughly whenever it feels like it.
 */

const always = (value: number) => () => value;

describe("backoffDelay", () => {
  it("grows with the number of attempts", () => {
    const delays = [0, 1, 2, 3, 4].map((n) => backoffDelay(n, always(1)));

    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1] as number);
    }
  });

  it("never waits longer than the ceiling", () => {
    // Otherwise a queue that has failed twenty times waits eleven days.
    for (const attempts of [8, 12, 20, 100]) {
      expect(backoffDelay(attempts, always(0.999))).toBeLessThanOrEqual(
        MAX_DELAY_MS,
      );
    }
  });

  it("is full jitter, not exponential with noise", () => {
    // The lowest draw must reach zero. Three phones rejoining one wifi at the
    // same instant is the case this defends against, and a floor would keep
    // them synchronised however much noise was added on top.
    expect(backoffDelay(5, always(0))).toBe(0);
  });

  it("spreads across the whole window rather than clustering", () => {
    const ceiling = 1_000 * 2 ** 3;

    expect(backoffDelay(3, always(0))).toBe(0);
    expect(backoffDelay(3, always(0.5))).toBe(ceiling / 2);
    expect(backoffDelay(3, always(0.999))).toBeLessThan(ceiling);
  });

  it("treats a negative attempt count as the first attempt", () => {
    expect(backoffDelay(-3, always(0.999))).toBeLessThan(1_000);
  });

  it("returns whole milliseconds", () => {
    expect(Number.isInteger(backoffDelay(4, always(0.123456)))).toBe(true);
  });
});
