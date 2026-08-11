import { describe, it, expect, afterEach } from "bun:test";
import { z } from "zod";
import { newOpId } from "@/lib/offline/ids";

/**
 * The insecure-context path, which localhost testing would never reach.
 *
 * `crypto.randomUUID` is secure-context only. `next.config.ts` explicitly
 * invites plain-HTTP LAN and Tailscale origins through `allowedDevOrigins`,
 * because reaching a self-hosted box from a phone is how this gets tested on
 * real hardware — and there `randomUUID` is simply absent. A test that only
 * exercises the happy path would pass on this machine and the queue would
 * refuse every change on the phone.
 */

const uuid = z.string().uuid();
const original = crypto.randomUUID;

afterEach(() => {
  Object.defineProperty(crypto, "randomUUID", {
    value: original,
    configurable: true,
    writable: true,
  });
});

/** Take `crypto.randomUUID` away, the way an insecure context does. */
function withoutRandomUUID(): void {
  Object.defineProperty(crypto, "randomUUID", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

describe("newOpId", () => {
  it("mints something the server's schema accepts", () => {
    expect(uuid.safeParse(newOpId()).success).toBe(true);
  });

  it("still mints one where crypto.randomUUID does not exist", () => {
    withoutRandomUUID();

    const id = newOpId();

    expect(uuid.safeParse(id).success).toBe(true);
  });

  it("sets the version and variant bits on the fallback", () => {
    withoutRandomUUID();

    const id = newOpId();

    // A 36-character random string is unique and still fails `.uuid()`.
    expect(id[14]).toBe("4");
    expect("89ab").toContain(id[19] as string);
  });

  it("does not repeat itself, on either path", () => {
    const secure = new Set(Array.from({ length: 5_000 }, newOpId));
    expect(secure.size).toBe(5_000);

    withoutRandomUUID();
    const insecure = new Set(Array.from({ length: 5_000 }, newOpId));
    expect(insecure.size).toBe(5_000);
  });

  it("uses the platform generator when there is one", () => {
    let calls = 0;
    Object.defineProperty(crypto, "randomUUID", {
      value: () => {
        calls += 1;
        return "11111111-1111-4111-8111-111111111111";
      },
      configurable: true,
      writable: true,
    });

    expect(newOpId()).toBe("11111111-1111-4111-8111-111111111111");
    expect(calls).toBe(1);
  });
});
