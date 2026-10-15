import { describe, expect, it } from "bun:test";
import {
  BROWSER_CAP_S,
  BROWSER_IDLE_S,
  nextExpiry,
  shouldSlide,
} from "@/lib/auth/session-policy";

/**
 * The arithmetic of a browser session's life: fifteen idle minutes, never past
 * a day from the sign-in. That the row is written with it, and that only
 * activity moves it, is `integration/session.policy.test.ts`.
 */

const MINUTE = 60_000;
const now = new Date("2026-10-15T12:00:00.000Z");

describe("nextExpiry", () => {
  it("is fifteen minutes from now for a session signed in a moment ago", () => {
    expect(nextExpiry({ authenticatedAt: now, now }).getTime()).toBe(
      now.getTime() + BROWSER_IDLE_S * 1000,
    );
  });

  it("is never past a day after the sign-in, however recent the activity", () => {
    const authenticatedAt = new Date(now.getTime() - (BROWSER_CAP_S * 1000 - 5 * MINUTE));
    expect(nextExpiry({ authenticatedAt, now }).getTime()).toBe(
      authenticatedAt.getTime() + BROWSER_CAP_S * 1000,
    );
  });

  it("is already past for a session signed in more than a day ago", () => {
    const authenticatedAt = new Date(now.getTime() - BROWSER_CAP_S * 1000 - 1000);
    expect(nextExpiry({ authenticatedAt, now }).getTime()).toBeLessThan(now.getTime());
  });
});

describe("shouldSlide", () => {
  it("leaves an expiry that is still almost whole", () => {
    expect(shouldSlide(new Date(now.getTime() + 14.5 * MINUTE), now)).toBe(false);
  });

  it("moves one that a minute or more of idleness has worn", () => {
    expect(shouldSlide(new Date(now.getTime() + 13.9 * MINUTE), now)).toBe(true);
    expect(shouldSlide(new Date(now.getTime() + MINUTE), now)).toBe(true);
  });
});
