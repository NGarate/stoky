import { describe, expect, it } from "bun:test";
import {
  NO_MATCH_CODE,
  TOTP_DIGITS,
  hotp,
  matchingStep,
  totpStep,
} from "@/lib/auth/policy-plugin";

/**
 * The arithmetic of the TOTP replay guard (PROGRESS D148), without Better
 * Auth or a database: which step a code is for. That the guard claims the
 * step, and that Better Auth then agrees, is `integration/two-factor.test.ts`.
 */

describe("hotp", () => {
  it("gives RFC 4226's test values", () => {
    // Appendix D: the secret "12345678901234567890", counters 0 to 9.
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    expect(
      expected.map((_, counter) => hotp("12345678901234567890", counter)),
    ).toEqual(expected);
  });

  it("agrees with the code Better Auth's own library makes for a secret it stores", () => {
    // Better Auth keys the HMAC with the secret's UTF-8 bytes, not with its
    // base32 decoding: a guard that decoded it would match nothing. The
    // values are what `createOTP(secret).hotp(counter)` from Better Auth
    // 1.7.7's `@better-auth/utils/otp` gives, written down rather than
    // imported: that package is Better Auth's dependency, not ours. That the
    // two still agree on a live instance is `integration/two-factor.test.ts`,
    // where every code accepted is one this function made.
    const secret = "u2Jw0dYbQ7vKp1sXl9TzR4mNc8EaHf6G";
    expect(
      [0, 1, 59_000_000, 59_000_001].map((counter) => hotp(secret, counter)),
    ).toEqual(["141416", "366670", "932299", "533475"]);
  });
});

describe("matchingStep", () => {
  const secret = "u2Jw0dYbQ7vKp1sXl9TzR4mNc8EaHf6G";
  // Mid-step, so a step's start is not what is being tested.
  const at = (59_000_000 * 30 + 15) * 1000;
  const now = totpStep(at);

  it("finds the step of a code for now, one before or one after", () => {
    expect(matchingStep(secret, hotp(secret, now), at)).toBe(now);
    expect(matchingStep(secret, hotp(secret, now - 1), at)).toBe(now - 1);
    expect(matchingStep(secret, hotp(secret, now + 1), at)).toBe(now + 1);
  });

  it("finds none two steps out, which is outside Better Auth's window too", () => {
    expect(matchingStep(secret, hotp(secret, now - 2), at)).toBeNull();
    expect(matchingStep(secret, hotp(secret, now + 2), at)).toBeNull();
  });

  it("finds none for another secret's code, or for something that is not a code", () => {
    expect(matchingStep(secret, hotp(`${secret}x`, now), at)).toBeNull();
    for (const code of [
      "",
      "12345",
      `${hotp(secret, now)}0`,
      `${hotp(secret, now)}\0`,
      NO_MATCH_CODE,
      "ñññññ",
    ]) {
      expect(matchingStep(secret, code, at), JSON.stringify(code)).toBeNull();
    }
  });

  it("makes its replacement for a wrong code something no step can produce", () => {
    expect(NO_MATCH_CODE).not.toMatch(new RegExp(`^\\d{${TOTP_DIGITS}}$`));
  });
});
