import { describe, it, expect } from "bun:test";
import {
  DEVICE_ID_COOKIE,
  DEVICE_ID_MAX_AGE_S,
  isDeviceId,
  mintDeviceId,
} from "@/lib/device";

/**
 * The identifier that makes Journey 8's screen choice a server decision.
 *
 * The value is attacker-controlled — anyone can send any cookie — and it ends
 * up as half of a database key, so what matters here is what gets *refused*.
 */

describe("what counts as a device id", () => {
  it("accepts what it mints", () => {
    // Several, because a generator that returned one constant would pass a
    // single-value check and be the worst possible bug here: every browser in
    // the world sharing one device.
    const minted = Array.from({ length: 20 }, () => mintDeviceId());

    for (const id of minted) expect(isDeviceId(id)).toBe(true);
    expect(new Set(minted).size).toBe(20);
  });

  it("refuses everything that is not one", () => {
    const hostile = [
      undefined,
      "",
      "   ",
      "not-a-uuid",
      // A v1 UUID: right shape, wrong version, and carries a MAC address and a
      // timestamp — exactly what this deliberately does not.
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      // Right shape, wrong variant nibble.
      "6ba7b810-9dad-4d11-c0b4-00c04fd430c8",
      // Upper case: not what `randomUUID` emits, so it did not come from here.
      "6BA7B810-9DAD-4D11-80B4-00C04FD430C8",
      // The shapes an injection would arrive as.
      "'; drop table \"User\"; --",
      "../../etc/passwd",
      "<script>alert(1)</script>",
      // Right pattern with something appended, which a non-anchored regex
      // would wave through.
      "6ba7b810-9dad-4d11-80b4-00c04fd430c8 or 1=1",
      "6ba7b810-9dad-4d11-80b4-00c04fd430c8\n6ba7b810-9dad-4d11-80b4-00c04fd430c9",
    ];

    for (const value of hostile) {
      expect(isDeviceId(value as string | undefined)).toBe(false);
    }
  });

  it("is a first-party cookie name with no personal data in it", () => {
    // Said out loud because this is a privacy-first product: the name is what
    // somebody inspecting their own browser sees, and it should read as ours
    // and as nothing else.
    expect(DEVICE_ID_COOKIE).toBe("stoky_device");
  });

  it("remembers a device for a year, not a session", () => {
    // §5.1's promise is "asked once, then remembered", which a session cookie
    // would break on every browser restart.
    expect(DEVICE_ID_MAX_AGE_S).toBe(365 * 24 * 60 * 60);
  });
});
