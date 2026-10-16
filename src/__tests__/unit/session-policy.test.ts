import { describe, expect, it } from "bun:test";
import {
  BROWSER_CAP_S,
  BROWSER_IDLE_S,
  REMEMBERED_CAP_S,
  REMEMBERED_IDLE_S,
  capFor,
  clampRemembered,
  deadlineKind,
  initialExpiry,
  nextExpiry,
  persistentAtCreate,
  rememberedRefreshDue,
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

describe("deadlineKind", () => {
  const authenticatedAt = new Date(now.getTime() - 23 * 60 * MINUTE);
  const limit = authenticatedAt.getTime() + BROWSER_CAP_S * 1000;
  const kindAt = (expiresAt: number) =>
    deadlineKind({ expiresAt: new Date(expiresAt), authenticatedAt, capS: BROWSER_CAP_S });

  it("is the limit when the expiry is the day after the sign-in", () => {
    expect(kindAt(limit)).toBe("cap");
  });

  it("is the limit within a second of it, either side", () => {
    // The sum is computed in one process and stored by another; a second's
    // slack keeps a rounding from offering a button that cannot help.
    expect(kindAt(limit - 1000)).toBe("cap");
    expect(kindAt(limit + 1000)).toBe("cap");
  });

  it("is idle a moment more than a second before it", () => {
    expect(kindAt(limit - 1001)).toBe("idle");
  });

  it("is idle for a session with most of its day ahead", () => {
    expect(kindAt(limit - 45 * MINUTE)).toBe("idle");
    expect(
      deadlineKind({
        expiresAt: nextExpiry({ authenticatedAt: now, now }),
        authenticatedAt: now,
        capS: BROWSER_CAP_S,
      }),
    ).toBe("idle");
  });

  it("is the limit once nextExpiry has stopped sliding", () => {
    // Ten minutes before the limit, activity yields the limit itself.
    const late = new Date(limit - 10 * MINUTE);
    expect(
      deadlineKind({
        expiresAt: nextExpiry({ authenticatedAt, now: late }),
        authenticatedAt,
        capS: BROWSER_CAP_S,
      }),
    ).toBe("cap");
  });
});

const DAY = 24 * 60 * MINUTE;

describe("a remembered session's figures", () => {
  it("are ninety idle days under a year, as the owner set them (D141)", () => {
    expect(REMEMBERED_IDLE_S).toBe(90 * 24 * 60 * 60);
    expect(REMEMBERED_CAP_S).toBe(365 * 24 * 60 * 60);
    expect(capFor(true)).toBe(REMEMBERED_CAP_S);
    expect(capFor(false)).toBe(BROWSER_CAP_S);
  });
});

describe("initialExpiry", () => {
  it("is a browser session's nextExpiry when not remembered", () => {
    const authenticatedAt = new Date(now.getTime() - 3 * MINUTE);
    expect(initialExpiry({ persistent: false, authenticatedAt, now })).toEqual(
      nextExpiry({ authenticatedAt, now }),
    );
  });

  it("is ninety days from now for a remembered sign-in", () => {
    expect(initialExpiry({ persistent: true, authenticatedAt: now, now }).getTime()).toBe(
      now.getTime() + 90 * DAY,
    );
  });

  it("is never past the year from the sign-in, on a re-create late in it", () => {
    const authenticatedAt = new Date(now.getTime() - 300 * DAY);
    expect(initialExpiry({ persistent: true, authenticatedAt, now }).getTime()).toBe(
      authenticatedAt.getTime() + 365 * DAY,
    );
  });
});

describe("clampRemembered", () => {
  it("lets Better Auth's ninety days stand while the year allows", () => {
    const proposed = new Date(now.getTime() + 90 * DAY);
    expect(clampRemembered({ proposed, authenticatedAt: now })).toEqual(proposed);
  });

  it("holds it to a year from the sign-in", () => {
    const authenticatedAt = new Date(now.getTime() - 364 * DAY);
    const proposed = new Date(now.getTime() + 90 * DAY);
    expect(clampRemembered({ proposed, authenticatedAt }).getTime()).toBe(
      authenticatedAt.getTime() + 365 * DAY,
    );
  });
});

describe("persistentAtCreate", () => {
  const ninetyDays = new Date(now.getTime() + 90 * DAY);
  const oneDay = new Date(now.getTime() + DAY);

  it("is what the route said, whatever the cookie or the expiry", () => {
    for (const dontRememberCookie of [true, false]) {
      for (const proposedExpiresAt of [ninetyDays, oneDay]) {
        const base = { dontRememberCookie, proposedExpiresAt, now };
        expect(persistentAtCreate({ ...base, remember: "1" })).toBe(true);
        expect(persistentAtCreate({ ...base, remember: "0" })).toBe(false);
        expect(persistentAtCreate({ ...base, remember: "yes" })).toBe(false);
      }
    }
  });

  it("without the route's word, is remembered only with no cookie and Better Auth's ninety days", () => {
    const base = { remember: null, now };
    expect(persistentAtCreate({ ...base, dontRememberCookie: false, proposedExpiresAt: ninetyDays })).toBe(true);
    expect(persistentAtCreate({ ...base, dontRememberCookie: true, proposedExpiresAt: ninetyDays })).toBe(false);
    expect(persistentAtCreate({ ...base, dontRememberCookie: false, proposedExpiresAt: oneDay })).toBe(false);
  });

  it("reads Better Auth's day, with its minute's slack, as not remembered", () => {
    const base = { remember: null, dontRememberCookie: false, now };
    const justOver = new Date(now.getTime() + DAY + MINUTE);
    const over = new Date(now.getTime() + DAY + MINUTE + 1);
    expect(persistentAtCreate({ ...base, proposedExpiresAt: justOver })).toBe(false);
    expect(persistentAtCreate({ ...base, proposedExpiresAt: over })).toBe(true);
  });
});

describe("rememberedRefreshDue", () => {
  it("is a day after the row was last written, and not a millisecond before", () => {
    expect(rememberedRefreshDue(new Date(now.getTime() - DAY), now)).toBe(true);
    expect(rememberedRefreshDue(new Date(now.getTime() - DAY + 1), now)).toBe(false);
    expect(rememberedRefreshDue(now, now)).toBe(false);
  });
});

describe("deadlineKind for a remembered session", () => {
  it("is idle ninety days out, and the limit once the year holds it", () => {
    const authenticatedAt = new Date(now.getTime() - 10 * DAY);
    expect(
      deadlineKind({
        expiresAt: initialExpiry({ persistent: true, authenticatedAt, now }),
        authenticatedAt,
        capS: capFor(true),
      }),
    ).toBe("idle");

    const late = new Date(now.getTime() - 300 * DAY);
    expect(
      deadlineKind({
        expiresAt: initialExpiry({ persistent: true, authenticatedAt: late, now }),
        authenticatedAt: late,
        capS: capFor(true),
      }),
    ).toBe("cap");
  });
});
