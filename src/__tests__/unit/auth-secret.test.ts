import { describe, it, expect, spyOn } from "bun:test";
import {
  MIN_SECRET_LENGTH,
  PLACEHOLDER_SECRET,
  assertUsableSecret,
  configuredSecret,
  secretProblem,
} from "@/lib/auth/secret";
import { accountTag } from "@/lib/account-tag";
import * as receiptRecovery from "@/server/services/receipt-recovery";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The signing key, and refusing to start without a real one.
 *
 * `STOKY_SECRET` (formerly `NEXTAUTH_SECRET`, still read when it is the only
 * one set; D137) signs the session cookie. Better Auth only warns about a
 * weak one, so until this nothing in the application had ever looked at what
 * it was — while
 * `.env.example` ships a placeholder that is published in this repository. An
 * instance deployed with that value signs sessions with a key anybody can
 * read, and nothing about it looks wrong from outside.
 */

const REAL = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";

describe("in production", () => {
  it("refuses the example value, which is in this repository", () => {
    // The assertion this file exists for.
    expect(secretProblem(PLACEHOLDER_SECRET, "production")).toMatch(
      /published in this repository/i,
    );
  });

  it("refuses a missing secret", () => {
    expect(secretProblem(undefined, "production")).toMatch(/not set/i);
    expect(secretProblem("", "production")).toMatch(/not set/i);
    expect(secretProblem("   ", "production")).toMatch(/not set/i);
  });

  it("refuses something short enough to guess", () => {
    expect(secretProblem("hunter2", "production")).toMatch(/at least/i);
  });

  it("accepts what the documented command produces", () => {
    // `.env.example` tells an operator to run `openssl rand -base64 32`, which
    // gives 44 characters. A rule that refused its own instructions would be
    // worse than no rule.
    expect(secretProblem(REAL, "production")).toBeNull();
    expect(REAL.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
  });

  it("judges the value as it will sign, with the whitespace around it gone", () => {
    // The signer trims; the guard compared the raw value with `===` and
    // counted its untrimmed length. The published placeholder with a space
    // or a newline after it was therefore not the placeholder, started, and
    // signed every session with the placeholder itself.
    for (const padded of [
      ` ${PLACEHOLDER_SECRET}`,
      `${PLACEHOLDER_SECRET}\n`,
      `\t${PLACEHOLDER_SECRET}  `,
    ]) {
      expect(secretProblem(padded, "production")).toMatch(
        /published in this repository/i,
      );
    }
    // Thirty-one characters padded past the floor are still thirty-one.
    const short = "a".repeat(MIN_SECRET_LENGTH - 1);
    expect(secretProblem(`    ${short}    `, "production")).toBe(
      `STOKY_SECRET is ${MIN_SECRET_LENGTH - 1} characters; it needs at least ${MIN_SECRET_LENGTH}. Generate one with \`openssl rand -base64 32\`.`,
    );
    expect(secretProblem(`  ${REAL}\n`, "production")).toBeNull();
  });

  it("says which file and which command, not just 'invalid'", () => {
    // The person reading this is looking at a container that will not start.
    for (const value of [undefined, PLACEHOLDER_SECRET, "short"]) {
      expect(secretProblem(value, "production")).toContain(
        "openssl rand -base64 32",
      );
    }
  });
});

describe("which variable it names", () => {
  it("names STOKY_SECRET by default, and the variable the value came from when told", () => {
    // An installation still on NEXTAUTH_SECRET (D137) must be told to edit
    // the line it has, not one it does not.
    for (const value of [undefined, PLACEHOLDER_SECRET, "short"]) {
      expect(secretProblem(value, "production")).toStartWith("STOKY_SECRET ");
      expect(secretProblem(value, "production", "NEXTAUTH_SECRET")).toStartWith(
        "NEXTAUTH_SECRET ",
      );
    }
  });
});

describe("the value every reader is given", () => {
  it("is trimmed once, whichever name it came from", () => {
    // The guard, `/api/health`, the account tag and the signer all take it
    // from here, so trimming here is what makes them judge one string.
    expect(configuredSecret({ STOKY_SECRET: `  ${REAL}\n` })).toEqual({
      value: REAL,
      name: "STOKY_SECRET",
      from: "current",
    });
    expect(
      configuredSecret({ STOKY_SECRET: "", NEXTAUTH_SECRET: `\t${REAL} ` }),
    ).toEqual({
      value: REAL,
      name: "NEXTAUTH_SECRET",
      from: "legacy",
    });
  });

  it("keys the account tag with the key the sessions are signed with", () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = {
      STOKY_SECRET: env.STOKY_SECRET,
      NEXTAUTH_SECRET: env.NEXTAUTH_SECRET,
    };
    try {
      delete env.NEXTAUTH_SECRET;
      env.STOKY_SECRET = `  ${REAL}\n`;
      expect(accountTag("ana@example.com")).toBe(
        accountTag("ana@example.com", REAL),
      );
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
    }
  });
});

describe("everywhere else", () => {
  it("allows anything in development", () => {
    // Refusing here would trade a risk nobody faces for an obstacle everybody
    // does. The suites and `bun run dev` use whatever is to hand.
    expect(secretProblem(PLACEHOLDER_SECRET, "development")).toBeNull();
    expect(secretProblem(undefined, "test")).toBeNull();
    expect(secretProblem("x", undefined)).toBeNull();
  });
});

describe("how it refuses", () => {
  it("throws, rather than warning", () => {
    // A container that will not start is fixed in the first minute. A running
    // instance signing sessions with a public key is found when it is used.
    expect(() => assertUsableSecret(PLACEHOLDER_SECRET, "production")).toThrow(
      /refusing to start/i,
    );
  });

  it("stays out of the way when the secret is real", () => {
    expect(() => assertUsableSecret(REAL, "production")).not.toThrow();
  });
});

describe("when it refuses", () => {
  /** `process.env` without the read-only `NODE_ENV` of the Next typings. */
  const env = process.env as Record<string, string | undefined>;

  /** Runs `body` with the environment of a production Node server. */
  async function asProductionServer(
    secret: string | undefined,
    body: () => Promise<void>,
  ) {
    const keys = [
      "NODE_ENV",
      "STOKY_SECRET",
      "NEXTAUTH_SECRET",
      "STOKY_URLS",
      "NEXTAUTH_URL",
      "NEXT_PHASE",
      "NEXT_RUNTIME",
    ];
    const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
    env.NODE_ENV = "production";
    env.NEXT_RUNTIME = "nodejs";
    // Production refuses to start without one (D136); set, so the secret is
    // the only thing these cases change.
    env.STOKY_URLS = "https://stoky.example.com";
    delete env.NEXTAUTH_URL;
    delete env.NEXT_PHASE;
    delete env.NEXTAUTH_SECRET;
    if (secret === undefined) delete env.STOKY_SECRET;
    else env.STOKY_SECRET = secret;
    try {
      await body();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
    }
  }

  it("stops the process at server start, from the instrumentation hook", async () => {
    // It used to be only when `@/lib/auth` was first imported — by the first
    // request that needed a session — and Next answers a route module that
    // fails to load with a 500, not an exit. The container stayed up and
    // `/api/health` (which never imports auth) said it was healthy.
    //
    // An exit and not a throw: Next's server catches a throw from `register`
    // and keeps listening. `process.exit` is replaced so the suite survives.
    const { register } = await import("@/instrumentation");
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
    const logged = spyOn(console, "error").mockImplementation(() => {});
    // `register` goes on to sweep interrupted receipts once the secret passes;
    // replaced, so this suite never touches whatever database `.env` names.
    const sweep = spyOn(
      receiptRecovery,
      "recoverInterruptedReceipts",
    ).mockResolvedValue();

    try {
      await asProductionServer(PLACEHOLDER_SECRET, async () => {
        await expect(register()).rejects.toThrow("exit 1");
      });
      expect(String(logged.mock.calls[0]?.[0])).toMatch(/refusing to start/i);

      await asProductionServer(undefined, async () => {
        await expect(register()).rejects.toThrow("exit 1");
      });

      // The placeholder with whitespace around it, which the signer would
      // have trimmed back into the placeholder, and a short key padded past
      // the floor.
      logged.mockClear();
      await asProductionServer(`  ${PLACEHOLDER_SECRET}\n`, async () => {
        await expect(register()).rejects.toThrow("exit 1");
      });
      expect(String(logged.mock.calls[0]?.[0])).toMatch(
        /published in this repository/i,
      );
      logged.mockClear();
      await asProductionServer(
        ` ${"k".repeat(MIN_SECRET_LENGTH - 1)}    `,
        async () => {
          await expect(register()).rejects.toThrow("exit 1");
        },
      );
      expect(String(logged.mock.calls[0]?.[0])).toMatch(/needs at least/i);

      exit.mockClear();
      await asProductionServer(REAL, async () => {
        await register();
      });
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      logged.mockRestore();
      sweep.mockRestore();
    }
  });
});

describe("the key that actually signs sessions", () => {
  /**
   * Builds the Better Auth instance in a fresh process with `env` and reports
   * the secret it ended up signing with — `$context.secret`, what signs the
   * cookie, not what the file wrote.
   *
   * A fresh process because the instance is built once per process, and
   * every other file in this suite shares one.
   */
  function resolvedSecret(env: Record<string, string>) {
    const base: Record<string, string | undefined> = { ...process.env };
    for (const key of Object.keys(base)) {
      if (/^(STOKY_SECRET|NEXTAUTH_SECRET|AUTH_SECRET|BETTER_AUTH_)/.test(key))
        delete base[key];
    }
    delete base.NEXT_PHASE;
    const script = `const { getAuth } = await import("@/lib/auth/instance");
      const ctx = await getAuth().$context;
      console.log(JSON.stringify({ secret: ctx.secret }));
      process.exit(0);`;
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: join(import.meta.dir, "../../.."),
      env: {
        ...base,
        NEXT_RUNTIME: "nodejs",
        STOKY_URLS: "https://stoky.example.com",
        // Empty rather than absent: Bun loads `.env` for a key that is absent.
        NEXTAUTH_URL: "",
        ...env,
      },
    });
    if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    const last = child.stdout.toString().trim().split("\n").at(-1)!;
    return {
      secret: (JSON.parse(last) as { secret: unknown }).secret,
      stderr: child.stderr.toString(),
    };
  }

  it("is the STOKY_SECRET the guard checked, whatever Better Auth's own variables say", () => {
    // Better Auth prefers BETTER_AUTH_SECRETS, then BETTER_AUTH_SECRET, then
    // AUTH_SECRET, and the guard reads only ours. Without an explicit
    // `secret` and `secrets` this started — the guard passed on REAL — and
    // signed every session with "changeme".
    expect(
      resolvedSecret({
        NODE_ENV: "production",
        STOKY_SECRET: REAL,
        NEXTAUTH_SECRET: "",
        BETTER_AUTH_SECRETS: "1:changeme-changeme-changeme-changeme",
        BETTER_AUTH_SECRET: "changeme",
        AUTH_SECRET: "changeme",
      }).secret,
    ).toBe(REAL);
  });

  it("is the trimmed value the guard judged, not the line as written", () => {
    expect(
      resolvedSecret({ NODE_ENV: "production", STOKY_SECRET: `  ${REAL}\n` })
        .secret,
    ).toBe(REAL);
  });

  it("is STOKY_SECRET when the old name is set beside it, and the old name when it is alone", () => {
    // D137: the new name wins. An installation not yet renamed signs with the
    // key it always had, so nobody is signed out by the upgrade.
    const OTHER = "an-older-key-0123456789abcdef0123456789ab";
    expect(
      resolvedSecret({
        NODE_ENV: "production",
        STOKY_SECRET: REAL,
        NEXTAUTH_SECRET: OTHER,
      }).secret,
    ).toBe(REAL);
    // Empty, as Compose passes an unset `${STOKY_SECRET:-}`.
    expect(
      resolvedSecret({
        NODE_ENV: "production",
        STOKY_SECRET: "",
        NEXTAUTH_SECRET: OTHER,
      }).secret,
    ).toBe(OTHER);
  });

  it("is a key of this process's own outside production, when none is set", () => {
    // Empty rather than absent: Bun fills an absent variable from `.env`, and
    // an empty one is what Compose passes for an unset `${X:-}`.
    const none = {
      NODE_ENV: "development",
      STOKY_SECRET: "",
      NEXTAUTH_SECRET: "",
    };
    const first = resolvedSecret(none);
    const second = resolvedSecret(none);

    expect(typeof first.secret).toBe("string");
    expect(String(first.secret).length).toBeGreaterThanOrEqual(
      MIN_SECRET_LENGTH,
    );
    // A restart is a new key: it signs nobody in with yesterday's cookie.
    expect(first.secret).not.toBe(second.secret);
    expect(first.stderr).toContain("STOKY_SECRET is not set");
  });
});

describe("the placeholder it checks for", () => {
  it("is the one actually in .env.example", () => {
    // If somebody rewords the template, this guard silently stops matching and
    // the hole reopens with every test still green.
    const template = readFileSync(
      join(import.meta.dir, "../../../.env.example"),
      "utf8",
    );

    expect(template).toContain(PLACEHOLDER_SECRET);
  });
});
