import { describe, it, expect, spyOn } from "bun:test";
import * as argon2 from "argon2";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  replacePasswordHashCost,
  verifyPassword,
} from "@/lib/auth/password-hash";

/**
 * `src/lib/auth/password-hash.ts` is the only place the application hashes or
 * verifies a password, so these are the only assertions standing between a
 * parameter edit and a silent change to the cost of every new account.
 *
 * The cost production hashes at is asked of a fresh copy of the module, which
 * nothing has called `replacePasswordHashCost` on: what the server loads.
 * Each of those is a real 64 MiB Argon2id run, so the file keeps them few.
 */

/** The `m=…,t=…,p=…` segment of a PHC-encoded Argon2 hash. */
function parameters(encoded: string): string {
  const [, algorithm, version, params] = encoded.split("$");
  return `${algorithm}$${version}$${params}`;
}

const PASSWORD = "cocina despensa nevera";

/** `hashPassword` as the server loads it, unreplaced by the test preload. */
async function productionHash(password: string): Promise<string> {
  // A variable, so TypeScript does not try to resolve the query string.
  const fresh: string = "@/lib/auth/password-hash?as-production-loads-it";
  const module: { hashPassword: typeof hashPassword } = await import(fresh);
  return module.hashPassword(password);
}

describe("hashPassword", () => {
  it("hashes with Argon2id at 64 MiB, three passes and four lanes", async () => {
    const hash = await productionHash(PASSWORD);

    expect(parameters(hash)).toBe("argon2id$v=19$m=65536,t=3,p=4");
  });

  it("hashes at a replaced cost only until it is put back, and still with Argon2id", async () => {
    const before = parameters(await hashPassword(PASSWORD));
    const restore = replacePasswordHashCost({
      memoryCost: 2048,
      timeCost: 2,
      parallelism: 1,
    });
    let replaced: string;
    try {
      replaced = await hashPassword(PASSWORD);
    } finally {
      restore();
    }

    expect(parameters(replaced)).toBe("argon2id$v=19$m=2048,t=2,p=1");
    expect(parameters(await hashPassword(PASSWORD))).toBe(before);
  });

  it("salts every hash, so two hashes of one password differ", async () => {
    const [first, second] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);

    expect(first).not.toBe(second);
  });
});

// The seam lowers the cost of every account hashed after it, so a call from
// application code would hash every new password at a tenth of the cost while
// every other test here still passed: the pin above asks a fresh copy.
describe("replacePasswordHashCost", () => {
  it("is named by no file the application, the seed, e2e or a script loads", () => {
    const root = join(import.meta.dir, "../../..");
    const naming = ["src", "prisma", "e2e", "scripts"].flatMap((dir) =>
      [...new Bun.Glob(`${dir}/**/*`).scanSync({ cwd: root, dot: true })]
        .filter((path) => !path.startsWith("src/__tests__/"))
        .filter((path) =>
          readFileSync(join(root, path), "latin1").includes(
            "replacePasswordHashCost",
          ),
        ),
    );

    expect(naming).toEqual(["src/lib/auth/password-hash.ts"]);
  });

  it("refuses in a production build", () => {
    // Next typings make `NODE_ENV` read-only; a production build inlines it.
    const env = process.env as Record<string, string | undefined>;
    const was = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(() => replacePasswordHashCost()).toThrow("for tests only");
    } finally {
      env.NODE_ENV = was;
    }
  });
});

describe("verifyPassword", () => {
  it("accepts the password a hash was made from and nothing else", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, `${PASSWORD} `)).toBe(false);
  });

  // The stored hash names its own cost, so the tests' cheap hashes and the
  // server's are checked by one function, each at the cost it was made with.
  it("accepts a hash made at the production cost too", async () => {
    expect(await verifyPassword(await productionHash(PASSWORD), PASSWORD)).toBe(
      true,
    );
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
    const hash = await productionHash(PASSWORD);

    expect(parameters(DUMMY_PASSWORD_HASH)).toBe(parameters(hash));
  });
});
