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
 * spelling it does not know never means `open`.
 *
 * What the setting *does* to `auth.register` — the order of the checks, the
 * first-user race — needs a real database and is in
 * `src/__tests__/integration/registration.test.ts`.
 */

describe("parsing the setting", () => {
  it("is first-user when unset in production, the bundle's own default", () => {
    expect(parseRegistrationMode(undefined, "production")).toEqual({
      mode: "first-user",
      problem: null,
    });
  });

  it("is open when unset anywhere else, so development and the suites can register", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      expect(parseRegistrationMode(undefined, nodeEnv)).toEqual({ mode: "open", problem: null });
    }
  });

  it("treats empty as unset, which is what Compose's :- default does too", () => {
    expect(parseRegistrationMode("", "production").mode).toBe("first-user");
    expect(parseRegistrationMode("", "development").mode).toBe("open");
  });

  it("takes each known value as written, whatever NODE_ENV says", () => {
    for (const mode of REGISTRATION_MODES) {
      for (const nodeEnv of ["production", "development", undefined]) {
        expect(parseRegistrationMode(mode, nodeEnv)).toEqual({ mode, problem: null });
      }
    }
  });

  it("closes on anything it does not know — never falls back to open", () => {
    // The near misses are the dangerous ones: each reads as "open" or "on" to
    // a person, and a lenient parser would make a typo the least safe value.
    for (const raw of ["Open", "OPEN", " open", "open ", "true", "yes", "1", "firstuser", "first_user", "disabled"]) {
      const setting = parseRegistrationMode(raw, "production");
      expect(setting.mode).toBe("closed");
      expect(setting.problem).not.toBeNull();
      expect(parseRegistrationMode(raw, "development").mode).toBe("closed");
    }
  });

  it("says which variable, what it was, and what it may be", () => {
    const { problem } = parseRegistrationMode("Open", "production");
    expect(problem).toContain(REGISTRATION_ENV);
    expect(problem).toContain('"Open"');
    for (const mode of REGISTRATION_MODES) expect(problem).toContain(mode);
  });

  it("is read from the environment it is given, on every call", () => {
    expect(registrationMode({ NODE_ENV: "production" })).toBe("first-user");
    expect(registrationMode({ NODE_ENV: "production", STOKY_REGISTRATION: "open" })).toBe("open");
    expect(registrationMode({ NODE_ENV: "development", STOKY_REGISTRATION: "closed" })).toBe("closed");
    expect(registrationMode({ NODE_ENV: "development", STOKY_REGISTRATION: "nope" })).toBe("closed");
  });
});

describe("whether one more account may register", () => {
  it("always, when open", () => {
    for (const count of [0, 1, 50]) expect(registrationAllows("open", count)).toBe(true);
  });

  it("only while there are no accounts, when first-user", () => {
    expect(registrationAllows("first-user", 0)).toBe(true);
    expect(registrationAllows("first-user", 1)).toBe(false);
    expect(registrationAllows("first-user", 50)).toBe(false);
  });

  it("never, when closed — not even the first", () => {
    for (const count of [0, 1, 50]) expect(registrationAllows("closed", count)).toBe(false);
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
  function counter(count: number): { calls: number; count: () => Promise<number> } {
    const tally = {
      calls: 0,
      count: async () => {
        tally.calls += 1;
        return count;
      },
    };
    return tally;
  }

  it("offers it when open, without counting", async () => {
    const users = counter(50);
    expect(await registrationOpen("open", users.count)).toBe(true);
    expect(users.calls).toBe(0);
  });

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
      expect(await registrationOpen("first-user", counter(count).count)).toBe(false);
    }
  });
});

describe("refusing to start", () => {
  it("throws on an unknown value in production", () => {
    expect(() => assertKnownRegistrationMode("Open", "production", undefined)).toThrow(
      /refusing to start.*STOKY_REGISTRATION/,
    );
  });

  it("accepts every known value and the unset default in production", () => {
    for (const raw of [...REGISTRATION_MODES, undefined, ""]) {
      expect(() => assertKnownRegistrationMode(raw, "production", undefined)).not.toThrow();
    }
  });

  it("does not stop development, where an unknown value is already closed", () => {
    expect(() => assertKnownRegistrationMode("Open", "development", undefined)).not.toThrow();
  });

  it("does not stop `next build`, which has no runtime configuration", () => {
    expect(() =>
      assertKnownRegistrationMode("Open", "production", "phase-production-build"),
    ).not.toThrow();
  });

  it("stops the server from the instrumentation hook, and names both problems at once", async () => {
    const env = process.env as Record<string, string | undefined>;
    const keys = [
      "NODE_ENV",
      "NEXTAUTH_SECRET",
      "NEXTAUTH_URL",
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
      env.NEXTAUTH_SECRET = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";
      // Production refuses to start without one (D136), which would be a
      // third line below.
      env.NEXTAUTH_URL = "https://stoky.example.com";

      env[REGISTRATION_ENV] = "Open";
      await expect(register()).rejects.toThrow("exit 1");
      expect(logged.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/refusing to start.*STOKY_REGISTRATION/),
      ]);

      // Both wrong: one exit, two lines, so one restart fixes both.
      logged.mockClear();
      delete env.NEXTAUTH_SECRET;
      await expect(register()).rejects.toThrow("exit 1");
      const lines = logged.mock.calls.map((call) => String(call[0]));
      expect(lines).toHaveLength(2);
      expect(lines.some((line) => line.includes("NEXTAUTH_SECRET"))).toBe(true);
      expect(lines.some((line) => line.includes(REGISTRATION_ENV))).toBe(true);

      exit.mockClear();
      env.NEXTAUTH_SECRET = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";
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
