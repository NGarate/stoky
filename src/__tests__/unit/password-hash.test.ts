import { describe, it, expect, spyOn } from "bun:test";
import * as argon2 from "argon2";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password-hash";

/**
 * `src/lib/auth/password-hash.ts` is the only place the application hashes or
 * verifies a password, so these are the only assertions standing between a
 * parameter edit and a silent change to the cost of every new account.
 *
 * Each hash here is a real 64 MiB Argon2id run, so the file keeps them few.
 */

/** The `m=…,t=…,p=…` segment of a PHC-encoded Argon2 hash. */
function parameters(encoded: string): string {
  const [, algorithm, version, params] = encoded.split("$");
  return `${algorithm}$${version}$${params}`;
}

const PASSWORD = "cocina despensa nevera";

describe("hashPassword", () => {
  it("hashes with Argon2id at 64 MiB, three passes and four lanes", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(parameters(hash)).toBe("argon2id$v=19$m=65536,t=3,p=4");
  });

  it("salts every hash, so two hashes of one password differ", async () => {
    const [first, second] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);

    expect(first).not.toBe(second);
  });
});

describe("verifyPassword", () => {
  it("accepts the password a hash was made from and nothing else", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, `${PASSWORD} `)).toBe(false);
  });

  it("answers false when there is no stored hash", async () => {
    expect(await verifyPassword(null, PASSWORD)).toBe(false);
    expect(await verifyPassword(undefined, PASSWORD)).toBe(false);
  });

  // Answering false is not enough: returning early would answer false too,
  // in a few milliseconds instead of a quarter of a second, and the stopwatch
  // would say which addresses have an account. Restored before asserting, so
  // a failure does not leave the spy in place for the next test.
  it("still runs Argon2id, against the dummy hash, when there is no stored hash", async () => {
    const verify = spyOn(argon2, "verify");
    let calls: unknown[][];
    try {
      await verifyPassword(null, PASSWORD);
    } finally {
      calls = verify.mock.calls.map((call) => [...call]);
      verify.mockRestore();
    }

    expect(calls).toEqual([[DUMMY_PASSWORD_HASH, PASSWORD]]);
  });
});

describe("DUMMY_PASSWORD_HASH", () => {
  // Verifying runs at the cost the stored hash names, not at the cost the
  // code is configured with. A dummy left behind at old parameters would make
  // an unknown address answer faster than a wrong password — the timing
  // difference it exists to close — and no other test would notice.
  it("names the parameters every account is hashed with", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(parameters(DUMMY_PASSWORD_HASH)).toBe(parameters(hash));
  });
});
