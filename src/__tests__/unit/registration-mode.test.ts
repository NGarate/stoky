import { describe, expect, it, spyOn } from "bun:test";
import {
  REGISTRATION_CLOSED_MESSAGE,
  REGISTRATION_ENV,
  REGISTRATION_MODES,
  assertKnownRegistrationMode,
  isRegistrationClosedRefusal,
  parseRegistrationMode,
  registrationAllows,
  registrationMode,
  registrationOpen,
} from "@/lib/auth/registration";

/**
 * `STOKY_REGISTRATION`, as a value: what each spelling means, and that a
 * spelling it does not know — `open`, a mode until 2026-11-14, included —
 * never lets anybody register.
 *
 * What the setting *does* to `auth.register` — the order of the checks, the
 * first-user race — needs a real database and is in
 * `src/__tests__/integration/registration.test.ts`.
 */

describe("parsing the setting", () => {
  it("is first-user when unset, the bundle's own default", () => {
    expect(parseRegistrationMode(undefined)).toEqual({
      mode: "first-user",
      problem: null,
    });
  });

  it("is first-user when unset in development and the suites too, not open", () => {
    for (const NODE_ENV of ["production", "development", "test", undefined]) {
      expect(registrationMode({ NODE_ENV })).toBe("first-user");
    }
  });

  it("treats empty as unset, which is what Compose's :- default does too", () => {
    expect(parseRegistrationMode("").mode).toBe("first-user");
    expect(
      registrationMode({ NODE_ENV: "development", [REGISTRATION_ENV]: "" }),
    ).toBe("first-user");
  });

  it("takes each known value as written", () => {
    for (const mode of REGISTRATION_MODES) {
      expect(parseRegistrationMode(mode)).toEqual({ mode, problem: null });
    }
  });

  it("knows first-user and closed, and no longer open: one household per installation", () => {
    expect([...REGISTRATION_MODES].sort()).toEqual(["closed", "first-user"]);
    const setting = parseRegistrationMode("open");
    expect(setting.mode).toBe("closed");
    expect(setting.problem).toContain('"open"');
  });

  it("closes on anything it does not know — never falls back to open", () => {
    // The near misses are the dangerous ones: each reads as "open" or "on" to
    // a person, and a lenient parser would make a typo the least safe value.
    for (const raw of [
      "Open",
      "OPEN",
      " open",
      "open ",
      "true",
      "yes",
      "1",
      "firstuser",
      "first_user",
      "disabled",
    ]) {
      const setting = parseRegistrationMode(raw);
      expect(setting.mode).toBe("closed");
      expect(setting.problem).not.toBeNull();
    }
  });

  it("says which variable, what it was, and what it may be", () => {
    const { problem } = parseRegistrationMode("Open");
    expect(problem).toContain(REGISTRATION_ENV);
    expect(problem).toContain('"Open"');
    for (const mode of REGISTRATION_MODES) expect(problem).toContain(mode);
  });

  it("is read from the environment it is given, on every call", () => {
    expect(registrationMode({ NODE_ENV: "production" })).toBe("first-user");
    expect(
      registrationMode({ NODE_ENV: "production", STOKY_REGISTRATION: "open" }),
    ).toBe("closed");
    expect(
      registrationMode({
        NODE_ENV: "development",
        STOKY_REGISTRATION: "closed",
      }),
    ).toBe("closed");
    expect(
      registrationMode({ NODE_ENV: "development", STOKY_REGISTRATION: "nope" }),
    ).toBe("closed");
  });
});

describe("whether one more account may register", () => {
  it("only while there are no accounts, when first-user", () => {
    expect(registrationAllows("first-user", 0)).toBe(true);
    expect(registrationAllows("first-user", 1)).toBe(false);
    expect(registrationAllows("first-user", 50)).toBe(false);
  });

  it("never, when closed — not even the first", () => {
    for (const count of [0, 1, 50])
      expect(registrationAllows("closed", count)).toBe(false);
  });
});

/**
 * What `/register` asks before it chooses between the form and the page that
 * says registration is closed. The same rule as above, plus when it is worth a
 * query: the screen is the one place a stranger can make the server count
 * accounts, so it should only happen when the answer depends on them.
 */
describe("whether the register screen offers its form", () => {
  /** A count that records being asked. */
  function counter(count: number): {
    calls: number;
    count: () => Promise<number>;
  } {
    const tally = {
      calls: 0,
      count: async () => {
        tally.calls += 1;
        return count;
      },
    };
    return tally;
  }

  it("refuses when closed, without counting — not even on an empty instance", async () => {
    const users = counter(0);
    expect(await registrationOpen("closed", users.count)).toBe(false);
    expect(users.calls).toBe(0);
  });

  it("offers it on a first-user instance nobody has claimed, having counted", async () => {
    const users = counter(0);
    expect(await registrationOpen("first-user", users.count)).toBe(true);
    expect(users.calls).toBe(1);
  });

  it("refuses on a first-user instance with an account", async () => {
    for (const count of [1, 50]) {
      expect(await registrationOpen("first-user", counter(count).count)).toBe(
        false,
      );
    }
  });
});

describe("refusing to start", () => {
  it("throws on an unknown value in production", () => {
    expect(() =>
      assertKnownRegistrationMode("Open", "production", undefined),
    ).toThrow(/refusing to start.*STOKY_REGISTRATION/);
  });

  it("throws on open, saying what to set instead", () => {
    expect(() =>
      assertKnownRegistrationMode("open", "production", undefined),
    ).toThrow(
      'STOKY_REGISTRATION is "open"; it must be one of first-user, closed. Set it in .env, or remove the line to use first-user.',
    );
  });

  it("accepts every known value and the unset default in production", () => {
    for (const raw of [...REGISTRATION_MODES, undefined, ""]) {
      expect(() =>
        assertKnownRegistrationMode(raw, "production", undefined),
      ).not.toThrow();
    }
  });

  it("does not stop development, where an unknown value is already closed", () => {
    expect(() =>
      assertKnownRegistrationMode("Open", "development", undefined),
    ).not.toThrow();
  });

  it("does not stop `next build`, which has no runtime configuration", () => {
    expect(() =>
      assertKnownRegistrationMode(
        "Open",
        "production",
        "phase-production-build",
      ),
    ).not.toThrow();
  });

  it("stops the server from the instrumentation hook, and names both problems at once", async () => {
    const env = process.env as Record<string, string | undefined>;
    const keys = [
      "NODE_ENV",
      "STOKY_SECRET",
      "STOKY_URLS",
      "NEXT_PHASE",
      "NEXT_RUNTIME",
      REGISTRATION_ENV,
    ];
    const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
    const { register } = await import("@/instrumentation");
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
    const logged = spyOn(console, "error").mockImplementation(() => {});

    try {
      env.NODE_ENV = "production";
      env.NEXT_RUNTIME = "nodejs";
      delete env.NEXT_PHASE;
      env.STOKY_SECRET = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";
      // Production refuses to start without one (D136), which would be a
      // third line below.
      env.STOKY_URLS = "https://stoky.example.com";

      env[REGISTRATION_ENV] = "Open";
      await expect(register()).rejects.toThrow("exit 1");
      expect(logged.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/refusing to start.*STOKY_REGISTRATION/),
      ]);

      // Both wrong: one exit, two lines, so one restart fixes both.
      logged.mockClear();
      delete env.STOKY_SECRET;
      await expect(register()).rejects.toThrow("exit 1");
      const lines = logged.mock.calls.map((call) => String(call[0]));
      expect(lines).toHaveLength(2);
      expect(lines.some((line) => line.includes("STOKY_SECRET"))).toBe(true);
      expect(lines.some((line) => line.includes(REGISTRATION_ENV))).toBe(true);

      exit.mockClear();
      env.STOKY_SECRET = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";
      env[REGISTRATION_ENV] = "first-user";
      await register();
      delete env[REGISTRATION_ENV];
      await register();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      logged.mockRestore();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
    }
  });
});

describe("the refusal the screens recognise", () => {
  it("is recognised in the message tRPC carries, and nothing else is", () => {
    expect(isRegistrationClosedRefusal(REGISTRATION_CLOSED_MESSAGE)).toBe(true);
    expect(isRegistrationClosedRefusal("Email already registered")).toBe(false);
    expect(isRegistrationClosedRefusal(undefined)).toBe(false);
  });
});
