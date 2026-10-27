import { describe, it, expect } from "bun:test";
import { DEVICE_ID_COOKIE, mintDeviceId } from "@/lib/device";
import {
  deviceFingerprint,
  deviceIdFromHeaders,
} from "@/lib/auth/known-devices";

/**
 * Reading the device off the sign-in request, without a cache.
 *
 * Whether a device is *known* is asked of Valkey and proven in the integration
 * suite. What is here is the part before that: which cookie value reaches the
 * question at all. The value is attacker-controlled, so what matters most is
 * what is refused.
 */

const headersWith = (cookie?: string) =>
  new Headers(cookie === undefined ? {} : { cookie });

describe("reading the device cookie", () => {
  it("reads the device cookie among others", () => {
    const id = mintDeviceId();
    expect(
      deviceIdFromHeaders(
        headersWith(
          `authjs.csrf-token=abc; ${DEVICE_ID_COOKIE}=${id}; NEXT_LOCALE=es`,
        ),
      ),
    ).toBe(id);
  });

  it("is undefined with no cookie, or none of ours", () => {
    expect(deviceIdFromHeaders(headersWith())).toBeUndefined();
    expect(deviceIdFromHeaders(headersWith("NEXT_LOCALE=es"))).toBeUndefined();
  });

  it("does not take a cookie whose name only ends in ours", () => {
    // `x_stoky_device` is somebody else's cookie, and matching on a suffix
    // would let it stand in for the device.
    expect(
      deviceIdFromHeaders(
        headersWith(`x_${DEVICE_ID_COOKIE}=${mintDeviceId()}`),
      ),
    ).toBeUndefined();
  });

  it("treats a malformed value as no device", () => {
    // It becomes half of a Valkey key; only what `proxy.ts` could have minted
    // gets that far.
    for (const value of ["", "not-a-uuid", "*", `${mintDeviceId()}x`]) {
      expect(
        deviceIdFromHeaders(headersWith(`${DEVICE_ID_COOKIE}=${value}`)),
      ).toBeUndefined();
    }
  });
});

describe("deviceIdFromHeaders", () => {
  it("reads the device from bare headers, as the sign-in policy hands them over", () => {
    // The policy is given `Headers`, not a `Request`: whatever verifies the
    // password decides what request object exists, and the budget must not
    // depend on it.
    const id = mintDeviceId();
    expect(
      deviceIdFromHeaders(
        new Headers({ cookie: `NEXT_LOCALE=es; ${DEVICE_ID_COOKIE}=${id}` }),
      ),
    ).toBe(id);
    expect(deviceIdFromHeaders(new Headers())).toBeUndefined();
    expect(
      deviceIdFromHeaders(
        new Headers({ cookie: `${DEVICE_ID_COOKIE}=not-a-uuid` }),
      ),
    ).toBeUndefined();
  });
});

describe("deviceFingerprint", () => {
  it("is not the id, and tells two ids apart", () => {
    // Stored and counted in place of the cookie value, so Valkey holds
    // nothing worth replaying as one.
    const a = mintDeviceId();
    const b = mintDeviceId();
    expect(deviceFingerprint(a)).not.toContain(a);
    expect(deviceFingerprint(a)).toBe(deviceFingerprint(a));
    expect(deviceFingerprint(a)).not.toBe(deviceFingerprint(b));
    expect(deviceFingerprint(a)).toMatch(/^[0-9a-f]{32}$/);
  });
});
