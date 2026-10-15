import { describe, it, expect, spyOn } from "bun:test";
import {
  MIN_SECRET_LENGTH,
  PLACEHOLDER_SECRET,
  assertUsableSecret,
  secretProblem,
} from "@/lib/auth/secret";
import * as receiptRecovery from "@/server/services/receipt-recovery";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The signing key, and refusing to start without a real one.
 *
 * `NEXTAUTH_SECRET` signs the session cookie. Better Auth only warns about a
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

  it("says which file and which command, not just 'invalid'", () => {
    // The person reading this is looking at a container that will not start.
    for (const value of [undefined, PLACEHOLDER_SECRET, "short"]) {
      expect(secretProblem(value, "production")).toContain("openssl rand -base64 32");
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
  async function asProductionServer(secret: string | undefined, body: () => Promise<void>) {
    const keys = ["NODE_ENV", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "NEXT_PHASE", "NEXT_RUNTIME"];
    const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
    env.NODE_ENV = "production";
    env.NEXT_RUNTIME = "nodejs";
    // Production refuses to start without one (D136); set, so the secret is
    // the only thing these cases change.
    env.NEXTAUTH_URL = "https://stoky.example.com";
    delete env.NEXT_PHASE;
    if (secret === undefined) delete env.NEXTAUTH_SECRET;
    else env.NEXTAUTH_SECRET = secret;
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
    const sweep = spyOn(receiptRecovery, "recoverInterruptedReceipts").mockResolvedValue();

    try {
      await asProductionServer(PLACEHOLDER_SECRET, async () => {
        await expect(register()).rejects.toThrow("exit 1");
      });
      expect(String(logged.mock.calls[0]?.[0])).toMatch(/refusing to start/i);

      await asProductionServer(undefined, async () => {
        await expect(register()).rejects.toThrow("exit 1");
      });

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
      if (/^(NEXTAUTH_SECRET|AUTH_SECRET|BETTER_AUTH_)/.test(key)) delete base[key];
    }
    delete base.NEXT_PHASE;
    const script = `const { getAuth } = await import("@/lib/auth/instance");
      const ctx = await getAuth().$context;
      console.log(JSON.stringify({ secret: ctx.secret }));
      process.exit(0);`;
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: join(import.meta.dir, "../../.."),
      env: { ...base, NEXT_RUNTIME: "nodejs", NEXTAUTH_URL: "https://stoky.example.com", ...env },
    });
    if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    const last = child.stdout.toString().trim().split("\n").at(-1)!;
    return { secret: (JSON.parse(last) as { secret: unknown }).secret, stderr: child.stderr.toString() };
  }

  it("is the NEXTAUTH_SECRET the guard checked, whatever Better Auth's own variables say", () => {
    // Better Auth prefers BETTER_AUTH_SECRETS, then BETTER_AUTH_SECRET, then
    // AUTH_SECRET, and the guard reads only NEXTAUTH_SECRET. Without an
    // explicit `secret` and `secrets` this started — the guard passed on
    // REAL — and signed every session with "changeme".
    expect(
      resolvedSecret({
        NODE_ENV: "production",
        NEXTAUTH_SECRET: REAL,
        BETTER_AUTH_SECRETS: "1:changeme-changeme-changeme-changeme",
        BETTER_AUTH_SECRET: "changeme",
        AUTH_SECRET: "changeme",
      }).secret,
    ).toBe(REAL);
  });

  it("is a key of this process's own outside production, when none is set", () => {
    // Empty rather than absent: Bun fills an absent variable from `.env`, and
    // an empty one is what Compose passes for an unset `${X:-}`.
    const first = resolvedSecret({ NODE_ENV: "development", NEXTAUTH_SECRET: "" });
    const second = resolvedSecret({ NODE_ENV: "development", NEXTAUTH_SECRET: "" });

    expect(typeof first.secret).toBe("string");
    expect(String(first.secret).length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    // A restart is a new key: it signs nobody in with yesterday's cookie.
    expect(first.secret).not.toBe(second.secret);
    expect(first.stderr).toContain("NEXTAUTH_SECRET is not set");
  });
});

describe("the placeholder it checks for", () => {
  it("is the one actually in .env.example", () => {
    // If somebody rewords the template, this guard silently stops matching and
    // the hole reopens with every test still green.
    const template = readFileSync(join(import.meta.dir, "../../../.env.example"), "utf8");

    expect(template).toContain(PLACEHOLDER_SECRET);
  });
});
