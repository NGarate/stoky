import { describe, expect, it, spyOn } from "bun:test";
import {
  assertAuthEnvironment,
  authEnvironmentProblems,
  authEnvironmentWarnings,
  ignoredAuthVariableWarnings,
} from "@/lib/auth/environment";
import { PLACEHOLDER_SECRET } from "@/lib/auth/secret";
import * as receiptRecovery from "@/server/services/receipt-recovery";

/**
 * The environment the Better Auth instance refuses to be built in (PROGRESS
 * D135, D136, D138). The origins it trusts are `unit/public-url.test.ts`'s.
 *
 * Better Auth obeys `BETTER_AUTH_TRUSTED_ORIGINS` and `BETTER_AUTH_TELEMETRY`
 * over whatever its options say, so those are refused rather than ignored; a
 * production instance with no `STOKY_URLS` would guess its address from each
 * request; and one whose first entry is https beside plain HTTP to another
 * machine would loop every sign-in at that address. The server refuses to start on any of them (D136), and the
 * route, for anything that builds the instance elsewhere, answers 503
 * (`unit/auth-handler.test.ts`). The variables an option already overrides
 * are only warned about.
 */

const production = (env: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  STOKY_URLS: "https://stoky.example.com",
  ...env,
});

describe("assertAuthEnvironment", () => {
  it("accepts a production instance that names its address", () => {
    expect(() => assertAuthEnvironment(production())).not.toThrow();
  });

  it("refuses production with no STOKY_URLS, and allows development without one", () => {
    expect(() => assertAuthEnvironment(production({ STOKY_URLS: "" }))).toThrow(
      /STOKY_URLS is not set/,
    );
    expect(() =>
      assertAuthEnvironment({ NODE_ENV: "development" }),
    ).not.toThrow();
  });

  it("refuses a first entry that is not a URL, anywhere", () => {
    expect(() =>
      assertAuthEnvironment({
        NODE_ENV: "development",
        STOKY_URLS: "stoky.example.com",
      }),
    ).toThrow(/STOKY_URLS is not a URL/);
  });

  it("refuses an https first entry beside LAN http in production, and warns elsewhere", () => {
    const urls = {
      STOKY_URLS: "https://stoky.example.com, http://192.168.1.10:3000",
    };
    expect(() => assertAuthEnvironment(production(urls))).toThrow(
      /sign-in|login page/,
    );
    expect(authEnvironmentWarnings(production(urls))).toEqual([]);
    const development = { NODE_ENV: "development", ...urls };
    expect(() => assertAuthEnvironment(development)).not.toThrow();
    expect(authEnvironmentWarnings(development)).toEqual([
      expect.stringMatching(
        /^\[auth\] warning: STOKY_URLS starts with an https address/,
      ),
    ]);
  });

  it("refuses an entry that is not an origin in production, and warns elsewhere", () => {
    const urls = { STOKY_URLS: "https://stoky.example.com/api/auth" };
    expect(() => assertAuthEnvironment(production(urls))).toThrow(
      /path, query, fragment/,
    );
    expect(() =>
      assertAuthEnvironment({ NODE_ENV: "development", ...urls }),
    ).not.toThrow();
    expect(
      authEnvironmentWarnings({ NODE_ENV: "development", ...urls }),
    ).toHaveLength(1);
  });

  it("refuses origins Better Auth would trust behind the configuration's back", () => {
    expect(() =>
      assertAuthEnvironment(
        production({ BETTER_AUTH_TRUSTED_ORIGINS: "https://evil.example" }),
      ),
    ).toThrow(/BETTER_AUTH_TRUSTED_ORIGINS/);
  });

  it("refuses telemetry switched on, and only on", () => {
    for (const on of ["1", "true", "yes"]) {
      expect(() =>
        assertAuthEnvironment(production({ BETTER_AUTH_TELEMETRY: on })),
      ).toThrow(/BETTER_AUTH_TELEMETRY/);
    }
    for (const off of ["", "0", "false", "FALSE"]) {
      expect(() =>
        assertAuthEnvironment(production({ BETTER_AUTH_TELEMETRY: off })),
      ).not.toThrow();
    }
  });
});

describe("authEnvironmentProblems", () => {
  it("names every problem, not only the first, so one restart fixes them all", () => {
    expect(
      authEnvironmentProblems(
        production({
          STOKY_URLS: "",
          BETTER_AUTH_TRUSTED_ORIGINS: "https://evil.example",
          BETTER_AUTH_TELEMETRY: "1",
        }),
      ),
    ).toEqual([
      expect.stringMatching(/^STOKY_URLS is not set/),
      expect.stringMatching(/^BETTER_AUTH_TRUSTED_ORIGINS is set/),
      expect.stringMatching(/^BETTER_AUTH_TELEMETRY is on/),
    ]);
    expect(authEnvironmentProblems(production())).toEqual([]);
  });
});

describe("ignoredAuthVariableWarnings", () => {
  it("names each variable that is set and ignored, and what is read instead", () => {
    const warnings = ignoredAuthVariableWarnings(
      production({
        BETTER_AUTH_SECRET: "changeme",
        BETTER_AUTH_SECRETS: "1:changeme",
        AUTH_SECRET: "changeme",
        BETTER_AUTH_URL: "https://elsewhere.example",
        AUTH_URL: "https://elsewhere.example",
      }),
    );
    expect(warnings).toEqual([
      expect.stringMatching(
        /^\[auth\] warning: BETTER_AUTH_SECRET is set and ignored; .* STOKY_SECRET\b/,
      ),
      expect.stringMatching(
        /^\[auth\] warning: BETTER_AUTH_SECRETS is set and ignored; .* STOKY_SECRET\b/,
      ),
      expect.stringMatching(
        /^\[auth\] warning: AUTH_SECRET is set and ignored; .* STOKY_SECRET\b/,
      ),
      expect.stringMatching(
        /^\[auth\] warning: BETTER_AUTH_URL is set and ignored; .* STOKY_URLS\b/,
      ),
      expect.stringMatching(
        /^\[auth\] warning: AUTH_URL is set and ignored; .* STOKY_URLS\b/,
      ),
    ]);
    // Two of them are keys: the log outlives the file they came from.
    expect(warnings.join("\n")).not.toContain("changeme");
  });

  it("says nothing when none is set, or one is empty as Compose passes it", () => {
    expect(ignoredAuthVariableWarnings(production())).toEqual([]);
    expect(
      ignoredAuthVariableWarnings(
        production({ AUTH_SECRET: "", BETTER_AUTH_URL: " " }),
      ),
    ).toEqual([]);
  });
});

describe("at start-up", () => {
  /** `process.env` without the read-only `NODE_ENV` of the Next typings. */
  const env = process.env as Record<string, string | undefined>;
  const REAL = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";

  /**
   * Runs the instrumentation hook as a production Node server would, with a
   * usable secret and `overrides` on top, and reports whether it exited and
   * what it logged. `process.exit` is replaced so the suite survives it, and
   * the receipt sweep `register` starts afterwards so it never reaches a
   * database.
   */
  async function start(overrides: Record<string, string | undefined>) {
    // Cleared, so whatever the shell running the suite exports cannot decide
    // a case.
    const cleared = [
      "NEXT_PHASE",
      "STOKY_REGISTRATION",
      "BETTER_AUTH_TRUSTED_ORIGINS",
      "BETTER_AUTH_TELEMETRY",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_SECRETS",
      "AUTH_SECRET",
      "BETTER_AUTH_URL",
      "AUTH_URL",
    ];
    const keys = [
      "NODE_ENV",
      "NEXT_RUNTIME",
      "STOKY_SECRET",
      "NEXTAUTH_SECRET",
      "STOKY_URLS",
      "NEXTAUTH_URL",
      ...cleared,
      ...Object.keys(overrides),
    ];
    const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const warnings = spyOn(console, "warn").mockImplementation(() => {});
    const sweep = spyOn(
      receiptRecovery,
      "recoverInterruptedReceipts",
    ).mockResolvedValue();

    try {
      env.NODE_ENV = "production";
      env.NEXT_RUNTIME = "nodejs";
      env.STOKY_SECRET = REAL;
      delete env.NEXTAUTH_SECRET;
      env.STOKY_URLS = "https://stoky.example.com";
      delete env.NEXTAUTH_URL;
      for (const key of cleared) delete env[key];
      Object.assign(env, overrides);

      const { register } = await import("@/instrumentation");
      let exited: string | null = null;
      try {
        await register();
      } catch (error) {
        exited = error instanceof Error ? error.message : String(error);
      }
      // Only this module's lines: another file's pending work can reach the
      // console while the spies are installed.
      const ours = (calls: unknown[][]) =>
        calls
          .map((call) => String(call[0]))
          .filter(
            (line) => line.startsWith("[auth]") || line.startsWith("[config]"),
          );
      return {
        exited,
        errors: ours(errors.mock.calls),
        warnings: ours(warnings.mock.calls),
      };
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
      exit.mockRestore();
      errors.mockRestore();
      warnings.mockRestore();
      sweep.mockRestore();
    }
  }

  it("starts when production names its address and nothing overrides the options", async () => {
    // The baseline the refusals below differ from by one variable each.
    expect(await start({})).toEqual({ exited: null, errors: [], warnings: [] });
  });

  it("stops production with neither STOKY_URLS nor NEXTAUTH_URL, naming STOKY_URLS", async () => {
    // Before D136, `/api/health` said such an instance was healthy while
    // every sign-in failed.
    const { exited, errors } = await start({
      STOKY_URLS: "",
      NEXTAUTH_URL: "",
    });
    expect(exited).toBe("exit 1");
    expect(errors).toEqual([
      expect.stringMatching(
        /^\[auth\] refusing to start: STOKY_URLS is not set/,
      ),
    ]);
  });

  it("stops production on an https first entry beside plain HTTP to a LAN address", async () => {
    // The cookie would be Secure, and dropped at the second address: a
    // sign-in loop there, found by whoever tries it first.
    const { exited, errors } = await start({
      STOKY_URLS: "https://stoky.example.com,http://192.168.1.10:3000",
    });
    expect(exited).toBe("exit 1");
    expect(errors).toEqual([
      expect.stringMatching(
        /^\[auth\] refusing to start: STOKY_URLS starts with an https address but also lists http:\/\/192\.168\.1\.10:3000/,
      ),
    ]);
  });

  it("starts with loopback http beside an https first entry", async () => {
    expect(
      await start({
        STOKY_URLS: "https://stoky.example.com, http://localhost:3000",
      }),
    ).toEqual({ exited: null, errors: [], warnings: [] });
  });

  it("starts on NEXTAUTH_URL alone, and says to rename it exactly once", async () => {
    const { exited, errors, warnings } = await start({
      STOKY_URLS: "",
      NEXTAUTH_URL: "https://stoky.example.com",
    });
    expect(exited).toBeNull();
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "[config] NEXTAUTH_URL is deprecated; rename it to STOKY_URLS. It is still read for now.",
    ]);
  });

  it("stops when BETTER_AUTH_TRUSTED_ORIGINS is set", async () => {
    const { exited, errors } = await start({
      BETTER_AUTH_TRUSTED_ORIGINS: "https://evil.example",
    });
    expect(exited).toBe("exit 1");
    expect(errors).toEqual([
      expect.stringMatching(
        /^\[auth\] refusing to start: BETTER_AUTH_TRUSTED_ORIGINS is set/,
      ),
    ]);
  });

  it("stops when BETTER_AUTH_TELEMETRY is on", async () => {
    const { exited, errors } = await start({ BETTER_AUTH_TELEMETRY: "1" });
    expect(exited).toBe("exit 1");
    expect(errors).toEqual([
      expect.stringMatching(
        /^\[auth\] refusing to start: BETTER_AUTH_TELEMETRY is on/,
      ),
    ]);
  });

  it("warns that BETTER_AUTH_SECRET is ignored, and starts", async () => {
    // Ignored rather than refused: the instance names `secret` and `secrets`,
    // so it cannot win (`unit/auth-secret.test.ts`). Saying so is for the
    // operator who believes it is the key.
    const { exited, errors, warnings } = await start({
      BETTER_AUTH_SECRET: "changeme",
    });
    expect(exited).toBeNull();
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      expect.stringMatching(
        /^\[auth\] warning: BETTER_AUTH_SECRET is set and ignored/,
      ),
    ]);
  });
});

describe("the signing key's old name, at start-up", () => {
  // D137: NEXTAUTH_SECRET is now STOKY_SECRET. An installation that has not
  // renamed the line keeps its key — a new one would sign everybody out — and
  // is told so once, by the hook that runs once.
  const env = process.env as Record<string, string | undefined>;
  const REAL = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";

  async function startWith(secrets: {
    STOKY_SECRET?: string;
    NEXTAUTH_SECRET?: string;
  }) {
    const keys = [
      "NODE_ENV",
      "NEXT_RUNTIME",
      "NEXT_PHASE",
      "STOKY_URLS",
      "NEXTAUTH_URL",
      "STOKY_REGISTRATION",
      "STOKY_SECRET",
      "NEXTAUTH_SECRET",
    ];
    const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const warnings = spyOn(console, "warn").mockImplementation(() => {});
    const sweep = spyOn(
      receiptRecovery,
      "recoverInterruptedReceipts",
    ).mockResolvedValue();
    try {
      env.NODE_ENV = "production";
      env.NEXT_RUNTIME = "nodejs";
      env.STOKY_URLS = "https://stoky.example.com";
      for (const key of [
        "NEXT_PHASE",
        "NEXTAUTH_URL",
        "STOKY_REGISTRATION",
        "STOKY_SECRET",
        "NEXTAUTH_SECRET",
      ])
        delete env[key];
      Object.assign(env, secrets);
      const { register } = await import("@/instrumentation");
      let exited: string | null = null;
      try {
        await register();
      } catch (error) {
        exited = error instanceof Error ? error.message : String(error);
      }
      const lines = (calls: unknown[][]) =>
        calls
          .map((call) => String(call[0]))
          .filter(
            (line) => line.startsWith("[auth]") || line.startsWith("[config]"),
          );
      return {
        exited,
        errors: lines(errors.mock.calls),
        warnings: lines(warnings.mock.calls),
      };
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
      exit.mockRestore();
      errors.mockRestore();
      warnings.mockRestore();
      sweep.mockRestore();
    }
  }

  it("starts on a valid NEXTAUTH_SECRET alone, and says to rename it exactly once", async () => {
    const { exited, errors, warnings } = await startWith({
      NEXTAUTH_SECRET: REAL,
    });
    expect(exited).toBeNull();
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "[config] NEXTAUTH_SECRET is deprecated; rename it to STOKY_SECRET. It is still read for now.",
    ]);
  });

  it("refuses the example value in STOKY_SECRET, naming STOKY_SECRET", async () => {
    const { exited, errors } = await startWith({
      STOKY_SECRET: PLACEHOLDER_SECRET,
      // A good key under the old name does not rescue it: the new name wins.
      NEXTAUTH_SECRET: REAL,
    });
    expect(exited).toBe("exit 1");
    expect(errors).toEqual([
      expect.stringMatching(
        /^\[auth\] refusing to start: STOKY_SECRET is still the example value/,
      ),
    ]);
  });

  it("refuses the example value left under the old name, naming the old name", async () => {
    // The operator edits the line that is there, so the message names it.
    const { exited, errors } = await startWith({
      STOKY_SECRET: "",
      NEXTAUTH_SECRET: PLACEHOLDER_SECRET,
    });
    expect(exited).toBe("exit 1");
    expect(errors).toEqual([
      expect.stringMatching(
        /^\[auth\] refusing to start: NEXTAUTH_SECRET is still the example value/,
      ),
    ]);
  });

  it("refuses with neither set, naming the new name", async () => {
    const { exited, errors } = await startWith({});
    expect(exited).toBe("exit 1");
    expect(errors).toEqual([
      expect.stringMatching(
        /^\[auth\] refusing to start: STOKY_SECRET is not set/,
      ),
    ]);
  });

  it("says the old name is ignored when both are set", async () => {
    const { exited, warnings } = await startWith({
      STOKY_SECRET: REAL,
      NEXTAUTH_SECRET: "an-older-key",
    });
    expect(exited).toBeNull();
    expect(warnings).toEqual([
      "[config] STOKY_SECRET and NEXTAUTH_SECRET are both set; STOKY_SECRET is used and NEXTAUTH_SECRET is ignored. Remove it.",
    ]);
  });
});
