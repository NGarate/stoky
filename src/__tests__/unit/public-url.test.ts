import { describe, it, expect, spyOn } from "bun:test";
import { join } from "node:path";
import { classifyPublicUrl, publicUrl, publicUrlWarning } from "@/lib/auth/public-url";
import { warnAboutRiskyConfiguration } from "@/lib/auth/startup";

/**
 * The public URL, and saying so at start-up when it is missing or plain HTTP.
 *
 * The session cookie is `Secure` exactly when `NEXTAUTH_URL` is https: Better
 * Auth is built with it (`src/lib/auth/instance.ts`) and never consults a
 * request's headers for it. An instance that sends every password and session
 * cookie in cleartext says so at start-up (security review, 2026-10-12), and
 * warns rather than refuses: D84 keeps plain-http LAN installs working on
 * purpose. A URL that is missing in production, or is not a URL, is not
 * warned about here: the server refuses to start on it (D136,
 * `unit/auth-environment.test.ts`).
 */

const production = (urls: Record<string, string | undefined>) => ({
  NODE_ENV: "production",
  ...urls,
});

describe("what the configured URL means", () => {
  it("is fine when it is https", () => {
    expect(classifyPublicUrl({ NEXTAUTH_URL: "https://stoky.example.com" })).toEqual({
      kind: "https",
      origin: "https://stoky.example.com",
    });
  });

  it("is fine over http to this machine, where CI and the browser suite serve", () => {
    // ci.yml and ci-in-image.sh use localhost, playwright.config.ts and the
    // RUNTIME-1 reproduction 127.0.0.1 (D86). Browsers treat all of these as
    // potentially trustworthy, so nothing leaves the machine.
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.1:3000",
      "http://[::1]:3000",
      "http://stoky.localhost",
    ]) {
      expect(classifyPublicUrl({ NEXTAUTH_URL: url }).kind).toBe("loopback-http");
    }
  });

  it("is cleartext over http to any other address", () => {
    // The assertion this file exists for: a LAN address, a LAN name, a public
    // name, and the address that is not loopback however it looks.
    for (const url of [
      "http://192.168.1.10:3000",
      "http://stoky.lan",
      "http://stoky.example.com",
      "http://0.0.0.0:3000",
      "http://localhost.example.com",
    ]) {
      expect(classifyPublicUrl({ NEXTAUTH_URL: url }).kind).toBe("insecure-http");
    }
  });

  it("is missing when NEXTAUTH_URL is unset or empty", () => {
    expect(classifyPublicUrl({})).toEqual({ kind: "missing" });
    expect(classifyPublicUrl({ NEXTAUTH_URL: "" })).toEqual({ kind: "missing" });
  });

  it("reads nothing but NEXTAUTH_URL", () => {
    // next-auth read `AUTH_URL ?? NEXTAUTH_URL`. Nothing reads AUTH_URL now,
    // and a stray one must not decide the cookie.
    expect(
      classifyPublicUrl({
        AUTH_URL: "http://192.168.1.10:3000",
        NEXTAUTH_URL: "https://stoky.example.com",
      }),
    ).toEqual({ kind: "https", origin: "https://stoky.example.com" });
  });

  it("tells an unparsable value and another scheme apart from https", () => {
    expect(classifyPublicUrl({ NEXTAUTH_URL: "stoky.example.com" }).kind).toBe("unparsable");
    expect(classifyPublicUrl({ NEXTAUTH_URL: "ftp://stoky.example.com" }).kind).toBe("other-scheme");
  });
});

describe("the warning", () => {
  it("is given for every URL that is neither https nor loopback, in production", () => {
    for (const urls of [
      { NEXTAUTH_URL: "http://192.168.1.10:3000" },
      { NEXTAUTH_URL: "ftp://stoky.example.com" },
    ]) {
      expect(publicUrlWarning(production(urls))).toStartWith("[auth] warning:");
    }
  });

  it("is not given for https or loopback", () => {
    expect(publicUrlWarning(production({ NEXTAUTH_URL: "https://stoky.example.com" }))).toBeNull();
    expect(publicUrlWarning(production({ NEXTAUTH_URL: "http://127.0.0.1:3000" }))).toBeNull();
  });

  it("is not given outside production", () => {
    // `bun run dev` and the suites run without a URL, or with any URL to hand.
    expect(publicUrlWarning({ NODE_ENV: "development" })).toBeNull();
    expect(publicUrlWarning({ NODE_ENV: "test", NEXTAUTH_URL: "http://192.168.1.10" })).toBeNull();
  });

  it("over plain http, names the consequences and the way out", () => {
    const warning = publicUrlWarning(production({ NEXTAUTH_URL: "http://192.168.1.10:3000" }))!;
    expect(warning).toContain("NEXTAUTH_URL is http://192.168.1.10:3000");
    expect(warning).toMatch(/not marked Secure/);
    expect(warning).toMatch(/password and session cookie across the network in cleartext/);
    expect(warning).toMatch(/barcode camera and offline support are unavailable/);
    expect(warning).toMatch(/X-Forwarded-For/);
  });

  it("is not given when the URL is missing or not a URL, which start-up refuses instead", () => {
    // The refusal names the variable on a line of its own; a warning beside
    // it, saying sign-in answers 503, would describe a server that never
    // starts.
    expect(publicUrlWarning(production({}))).toBeNull();
    expect(publicUrlWarning(production({ NEXTAUTH_URL: "stoky.example.com" }))).toBeNull();
  });

  it("never repeats credentials written into the URL", () => {
    // The log outlives the configuration file it came from, and a
    // `user:password@` in a URL is someone's password.
    const warning = publicUrlWarning(
      production({ NEXTAUTH_URL: "http://admin:s3cret@192.168.1.10:3000/path" }),
    )!;
    expect(warning).not.toContain("s3cret");
    expect(warning).not.toContain("admin");
    expect(warning).toContain("http://192.168.1.10:3000");
  });
});

describe("the URL Better Auth is built with", () => {
  it("is NEXTAUTH_URL, or the dev server's own address outside production", () => {
    expect(publicUrl({ NEXTAUTH_URL: "https://stoky.example.com" })).toBe(
      "https://stoky.example.com",
    );
    expect(publicUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    // Never guessed in production: the auth API refuses instead.
    expect(publicUrl({ NODE_ENV: "production" })).toBeNull();
  });

  /**
   * The session cookie's name in a fresh process built with `url`. A fresh
   * process, because the instance is built once per process.
   */
  function sessionCookieName(url: string): string {
    const base: Record<string, string | undefined> = { ...process.env };
    delete base.NEXT_PHASE;
    const script = `const { getAuth } = await import("@/lib/auth/instance");
      const ctx = await getAuth().$context;
      console.log(JSON.stringify(ctx.authCookies.sessionToken));
      process.exit(0);`;
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: join(import.meta.dir, "../../.."),
      env: {
        ...base,
        NODE_ENV: "production",
        STOKY_SECRET: "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=",
        NEXTAUTH_URL: url,
      },
    });
    if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    const cookie = JSON.parse(child.stdout.toString().trim().split("\n").at(-1)!) as {
      name: string;
      attributes: { secure: boolean };
    };
    expect(cookie.attributes.secure).toBe(cookie.name.startsWith("__Secure-"));
    return cookie.name;
  }

  it("marks the session cookie Secure exactly when the URL is https", () => {
    expect(sessionCookieName("https://stoky.example.com")).toBe("__Secure-stoky.session_token");
    expect(sessionCookieName("http://192.168.1.10:3000")).toBe("stoky.session_token");
    expect(sessionCookieName("http://127.0.0.1:3100")).toBe("stoky.session_token");
  });
});

describe("at start-up", () => {
  it("logs the warning and nothing else", () => {
    // `process.exit` replaced, so a regression that made this fatal fails
    // here rather than ending the suite.
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
    const warned: string[] = [];

    try {
      warnAboutRiskyConfiguration(
        production({ NEXTAUTH_URL: "http://192.168.1.10:3000" }),
        (message) => warned.push(message),
      );
      expect(warned).toHaveLength(1);
      expect(warned[0]).toMatch(/cleartext/);

      warned.length = 0;
      warnAboutRiskyConfiguration(production({ NEXTAUTH_URL: "https://stoky.example.com" }), (m) =>
        warned.push(m),
      );
      expect(warned).toEqual([]);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it("is run by the instrumentation hook, and does not stop the server", async () => {
    // A warning, not a refusal (D84): with a usable secret and a plain-http
    // LAN URL, `register` warns and returns. `process.exit` is replaced so a
    // regression that made it fatal fails here instead of ending the suite.
    const env = process.env as Record<string, string | undefined>;
    const keys = [
      "NODE_ENV",
      "NEXT_RUNTIME",
      "NEXT_PHASE",
      "STOKY_SECRET",
      "NEXTAUTH_SECRET",
      "NEXTAUTH_URL",
      "AUTH_URL",
      "STOKY_REGISTRATION",
    ];
    const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    try {
      env.NODE_ENV = "production";
      env.NEXT_RUNTIME = "nodejs";
      env.STOKY_SECRET = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";
      delete env.NEXTAUTH_SECRET;
      env.NEXTAUTH_URL = "http://192.168.1.10:3000";
      delete env.NEXT_PHASE;
      delete env.AUTH_URL;
      delete env.STOKY_REGISTRATION;

      const { register } = await import("@/instrumentation");
      await register();

      expect(exit).not.toHaveBeenCalled();
      // Only this module's lines: in the full suite another file's pending
      // work reaches `console.warn` while the spy is installed (measured: an
      // `auth.signin.failed` event from the sign-in tests).
      const ours = warn.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith("[auth] warning:"));
      expect(ours).toHaveLength(1);
      expect(ours[0]).toMatch(/NEXTAUTH_URL is http:\/\/192\.168\.1\.10:3000/);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
      exit.mockRestore();
      warn.mockRestore();
    }
  });
});
