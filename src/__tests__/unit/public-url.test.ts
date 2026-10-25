import { describe, it, expect, spyOn } from "bun:test";
import { join } from "node:path";
import {
  canonicalUrl,
  classifyPublicUrls,
  classifyUrl,
  parsePublicUrls,
  publicUrlProblems,
  publicUrlWarnings,
  trustedAuthOrigins,
} from "@/lib/auth/public-url";
import { warnAboutRiskyConfiguration } from "@/lib/auth/startup";
import { renamedVariableWarnings } from "@/lib/env-names";

/**
 * The addresses the instance is reached at (PROGRESS D138), and saying so at
 * start-up when they are missing, malformed or plain HTTP.
 *
 * `STOKY_URLS` is a comma-separated list. The first entry is canonical: Better
 * Auth's `baseURL`, and the only thing that decides whether the session cookie
 * is `Secure` (`src/lib/auth/instance.ts`, which never consults a request's
 * headers for it). Every entry's origin may send a cookie-bearing sign-in. An
 * instance that sends passwords and session cookies in cleartext says so at
 * start-up (security review, 2026-10-12), and warns rather than refuses: D84
 * keeps plain-http LAN installs working on purpose. What production refuses —
 * no list, an entry that is not an origin, https first beside LAN http — is
 * refused at start-up (D136, `unit/auth-environment.test.ts`).
 */

const production = (urls: Record<string, string | undefined>) => ({
  NODE_ENV: "production",
  ...urls,
});

describe("what one entry is", () => {
  it("is https", () => {
    expect(classifyUrl("https://stoky.example.com")).toEqual({
      kind: "https",
      origin: "https://stoky.example.com",
    });
    // A trailing slash is still the origin alone.
    expect(classifyUrl("https://stoky.example.com/").kind).toBe("https");
  });

  it("is fine over http to this machine, where CI and the browser suite serve", () => {
    // ci.yml and ci-in-image.sh use localhost, the RUNTIME-1 reproduction
    // 127.0.0.1 (D86), and playwright.config.ts both, localhost first. Browsers treat all of these as
    // potentially trustworthy, so nothing leaves the machine.
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.1:3000",
      "http://[::1]:3000",
      "http://stoky.localhost",
    ]) {
      expect(classifyUrl(url).kind).toBe("loopback-http");
    }
  });

  it("is cleartext over http to any other address", () => {
    // The assertion the warning exists for: a LAN address, a LAN name, a
    // public name, and the address that is not loopback however it looks.
    for (const url of [
      "http://192.168.1.10:3000",
      "http://stoky.lan",
      "http://stoky.example.com",
      "http://0.0.0.0:3000",
      "http://localhost.example.com",
    ]) {
      expect(classifyUrl(url).kind).toBe("insecure-http");
    }
  });

  it("is not an origin when it carries a path, a query, a fragment or credentials", () => {
    // Only the origin is compared, so anything more is a misunderstanding —
    // next-auth once documented a NEXTAUTH_URL ending in /api/auth.
    for (const url of [
      "https://a.example/path",
      "https://a.example/api/auth",
      "https://a.example/?next=/",
      "https://a.example/#top",
      "https://admin:s3cret@a.example",
    ]) {
      expect(classifyUrl(url)).toEqual({
        kind: "not-an-origin",
        origin: "https://a.example",
      });
    }
  });

  it("tells an empty entry, an unparsable value and another scheme apart", () => {
    expect(classifyUrl("").kind).toBe("empty");
    expect(classifyUrl("stoky.example.com").kind).toBe("unparsable");
    expect(classifyUrl("ftp://stoky.example.com")).toEqual({
      kind: "other-scheme",
      protocol: "ftp:",
    });
  });
});

describe("the list", () => {
  const TWO = "https://a.example, http://192.168.1.10:3000";

  it("takes the first entry as canonical and trusts every entry's origin", () => {
    const env = { NODE_ENV: "development", STOKY_URLS: TWO };
    expect(canonicalUrl(env)).toBe("https://a.example");
    expect(trustedAuthOrigins(env)).toEqual([
      "https://a.example",
      "http://192.168.1.10:3000",
    ]);
  });

  it("trims the whitespace around each entry", () => {
    expect(
      parsePublicUrls({
        STOKY_URLS: "  https://a.example ,http://b.lan:3000  ",
      }),
    ).toEqual({
      variable: "STOKY_URLS",
      entries: ["https://a.example", "http://b.lan:3000"],
    });
  });

  it("names the empty entry a trailing comma leaves", () => {
    const problems = publicUrlProblems(
      production({ STOKY_URLS: "https://a.example," }),
    );
    expect(problems.map((problem) => problem.message)).toEqual([
      "STOKY_URLS entry 2 is empty. Remove the extra comma.",
    ]);
  });

  it("reads NEXTAUTH_URL alone as a list of one, and says to rename it", () => {
    const env = { NEXTAUTH_URL: "https://legacy.example" };
    expect(parsePublicUrls(env)).toEqual({
      variable: "NEXTAUTH_URL",
      entries: ["https://legacy.example"],
    });
    expect(canonicalUrl(env)).toBe("https://legacy.example");
    expect(renamedVariableWarnings(env)).toEqual([
      "[config] NEXTAUTH_URL is deprecated; rename it to STOKY_URLS. It is still read for now.",
    ]);
  });

  it("prefers STOKY_URLS when both are set", () => {
    const env = {
      STOKY_URLS: "https://new.example",
      NEXTAUTH_URL: "https://old.example",
    };
    expect(canonicalUrl(env)).toBe("https://new.example");
    expect(trustedAuthOrigins(production(env))).toEqual([
      "https://new.example",
    ]);
    expect(renamedVariableWarnings(env)).toEqual([
      "[config] STOKY_URLS and NEXTAUTH_URL are both set; STOKY_URLS is used and NEXTAUTH_URL is ignored. Remove it.",
    ]);
  });

  it("reads nothing but its own two names", () => {
    // next-auth read `AUTH_URL ?? NEXTAUTH_URL`, Better Auth reads
    // BETTER_AUTH_URL. Neither may decide the cookie or the origins.
    const env = {
      AUTH_URL: "http://192.168.1.10:3000",
      BETTER_AUTH_URL: "http://192.168.1.11:3000",
      STOKY_URLS: "https://stoky.example.com",
    };
    expect(classifyPublicUrls(env)).toEqual([
      { kind: "https", origin: "https://stoky.example.com" },
    ]);
    expect(trustedAuthOrigins(production(env))).toEqual([
      "https://stoky.example.com",
    ]);
  });

  it("is the dev server's own address outside production, and nothing in production", () => {
    expect(canonicalUrl({ NODE_ENV: "development" })).toBe(
      "http://localhost:3000",
    );
    expect(canonicalUrl({ NODE_ENV: "development", STOKY_URLS: " " })).toBe(
      "http://localhost:3000",
    );
    // Never guessed in production: the server refuses to start instead.
    expect(canonicalUrl({ NODE_ENV: "production" })).toBeNull();
  });
});

describe("the origins the auth API trusts", () => {
  it("never include DEV_ALLOWED_ORIGIN in production", () => {
    expect(
      trustedAuthOrigins(
        production({
          STOKY_URLS: "https://stoky.example.com",
          DEV_ALLOWED_ORIGIN: "192.168.1.20",
        }),
      ),
    ).toEqual(["https://stoky.example.com"]);
  });

  it("add each development host over http at the dev port and over https, once each", () => {
    expect(
      trustedAuthOrigins({
        NODE_ENV: "development",
        PORT: "3100",
        STOKY_URLS: "http://localhost:3000, http://localhost:3000",
        DEV_ALLOWED_ORIGIN: " my-machine.ts.net , 100.64.0.1,",
      }),
    ).toEqual([
      "http://localhost:3000",
      "http://my-machine.ts.net:3100",
      "https://my-machine.ts.net",
      "http://100.64.0.1:3100",
      "https://100.64.0.1",
    ]);
  });

  it("are the dev server's own address outside production when none is listed", () => {
    expect(trustedAuthOrigins({ NODE_ENV: "development" })).toEqual([
      "http://localhost:3000",
    ]);
  });
});

describe("what production refuses", () => {
  const messages = (env: Record<string, string | undefined>) =>
    publicUrlProblems(env).map((problem) => problem.message);

  it("refuses an https first entry beside plain HTTP to another machine", () => {
    // The cookie is Secure because of the first entry; a browser drops it
    // over plain HTTP, so sign-in at the second address would loop.
    expect(
      messages(
        production({
          STOKY_URLS: "https://a.example, http://192.168.1.10:3000",
        }),
      ),
    ).toEqual([
      expect.stringMatching(
        /^STOKY_URLS starts with an https address but also lists http:\/\/192\.168\.1\.10:3000, plain HTTP/,
      ),
    ]);
  });

  it("accepts loopback http beside an https first entry", () => {
    // Chromium and Firefox accept a Secure cookie on localhost.
    expect(
      messages(
        production({ STOKY_URLS: "https://a.example, http://localhost:3000" }),
      ),
    ).toEqual([]);
  });

  it("accepts a plain-HTTP LAN install reached by name and by address", () => {
    // The case the list exists for (D84, D138).
    expect(
      messages(
        production({
          STOKY_URLS: "http://stoky.lan:3000, http://192.168.1.10:3000",
        }),
      ),
    ).toEqual([]);
  });

  it("names the variable the list came from", () => {
    expect(messages(production({}))).toEqual([
      expect.stringMatching(/^STOKY_URLS is not set/),
    ]);
    expect(messages(production({ NEXTAUTH_URL: "stoky.example.com" }))).toEqual(
      [expect.stringMatching(/^NEXTAUTH_URL is not a URL/)],
    );
    expect(
      messages(production({ STOKY_URLS: "https://a.example/path" })),
    ).toEqual([
      "STOKY_URLS has a path, query, fragment or credentials. List the address alone: https://a.example.",
    ]);
  });

  it("refuses only a first entry Better Auth cannot be built from outside production", () => {
    const everywhere = (urls: string) =>
      publicUrlProblems({ NODE_ENV: "development", STOKY_URLS: urls })
        .filter((problem) => problem.everywhere)
        .map((problem) => problem.message);
    expect(everywhere("stoky.example.com, https://a.example")).toEqual([
      expect.stringMatching(/^STOKY_URLS entry 1 is not a URL/),
    ]);
    expect(everywhere("ftp://a.example")).toEqual([
      "STOKY_URLS uses the ftp scheme. Each address must be https, or http.",
    ]);
    expect(
      everywhere("https://a.example, stoky.example.com, https://a.example/x"),
    ).toEqual([]);
    expect(everywhere("https://a.example, http://192.168.1.10:3000")).toEqual(
      [],
    );
    // And nothing is missing outside production: the dev server's address is used.
    expect(publicUrlProblems({ NODE_ENV: "development" })).toEqual([]);
  });
});

describe("the warnings", () => {
  it("are one per entry that is plain HTTP to another machine, in production", () => {
    const warnings = publicUrlWarnings(
      production({
        STOKY_URLS:
          "http://stoky.lan:3000, http://localhost:3000, http://192.168.1.10:3000",
      }),
    );
    expect(warnings).toEqual([
      expect.stringMatching(
        /^\[auth\] warning: STOKY_URLS entry 1 is http:\/\/stoky\.lan:3000, plain HTTP/,
      ),
      expect.stringMatching(
        /^\[auth\] warning: STOKY_URLS entry 3 is http:\/\/192\.168\.1\.10:3000, plain HTTP/,
      ),
    ]);
  });

  it("are not given for https or loopback", () => {
    expect(
      publicUrlWarnings(
        production({ STOKY_URLS: "https://stoky.example.com" }),
      ),
    ).toEqual([]);
    expect(
      publicUrlWarnings(production({ STOKY_URLS: "http://127.0.0.1:3000" })),
    ).toEqual([]);
  });

  it("are not given outside production", () => {
    // `bun run dev` and the suites run without a URL, or with any URL to hand.
    expect(publicUrlWarnings({ NODE_ENV: "development" })).toEqual([]);
    expect(
      publicUrlWarnings({
        NODE_ENV: "test",
        STOKY_URLS: "http://192.168.1.10",
      }),
    ).toEqual([]);
  });

  it("over plain http, name the consequences and the way out", () => {
    const [warning] = publicUrlWarnings(
      production({ STOKY_URLS: "http://192.168.1.10:3000" }),
    );
    expect(warning).toContain("STOKY_URLS is http://192.168.1.10:3000");
    expect(warning).toMatch(/not marked Secure/);
    expect(warning).toMatch(
      /password and session cookie across the network in cleartext/,
    );
    expect(warning).toMatch(
      /barcode camera and offline support are unavailable/,
    );
    expect(warning).toMatch(/X-Forwarded-For/);
  });

  it("say an https address after an http first entry gets no Secure cookie either", () => {
    // Only the first entry decides Secure, so listing the public https
    // address second would quietly downgrade its cookie.
    const warnings = publicUrlWarnings(
      production({
        STOKY_URLS: "http://localhost:3000, https://stoky.example.com",
      }),
    );
    expect(warnings).toEqual([
      expect.stringMatching(
        /^\[auth\] warning: STOKY_URLS lists https:\/\/stoky\.example\.com, but its first entry is not https/,
      ),
    ]);
  });

  it("are not given when the list is missing or malformed, which start-up refuses instead", () => {
    // The refusal names the variable on a line of its own.
    expect(publicUrlWarnings(production({}))).toEqual([]);
    expect(
      publicUrlWarnings(production({ STOKY_URLS: "stoky.example.com" })),
    ).toEqual([]);
  });

  it("never repeat credentials written into an entry", () => {
    // The log outlives the configuration file it came from, and a
    // `user:password@` in a URL is someone's password. Such an entry is
    // refused, and the refusal prints only its origin too.
    const env = production({
      STOKY_URLS: "http://admin:s3cret@192.168.1.10:3000/path",
    });
    const lines = [
      ...publicUrlWarnings(env),
      ...publicUrlProblems(env).map((p) => p.message),
    ];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain("s3cret");
      expect(line).not.toContain("admin");
    }
    expect(lines.join("\n")).toContain("http://192.168.1.10:3000");
  });
});

describe("the session cookie", () => {
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
        STOKY_URLS: url,
        // Empty rather than absent: Bun loads `.env` for a key that is absent.
        NEXTAUTH_URL: "",
      },
    });
    if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    const cookie = JSON.parse(
      child.stdout.toString().trim().split("\n").at(-1)!,
    ) as {
      name: string;
      attributes: { secure: boolean };
    };
    expect(cookie.attributes.secure).toBe(cookie.name.startsWith("__Secure-"));
    return cookie.name;
  }

  it("is marked Secure exactly when the first entry is https", () => {
    expect(sessionCookieName("https://stoky.example.com")).toBe(
      "__Secure-stoky.session_token",
    );
    expect(sessionCookieName("http://192.168.1.10:3000")).toBe(
      "stoky.session_token",
    );
    expect(sessionCookieName("http://127.0.0.1:3100")).toBe(
      "stoky.session_token",
    );
    // The first decides, whatever follows it.
    expect(
      sessionCookieName("https://stoky.example.com, http://localhost:3000"),
    ).toBe("__Secure-stoky.session_token");
    expect(
      sessionCookieName("http://localhost:3000, https://stoky.example.com"),
    ).toBe("stoky.session_token");
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
        production({ STOKY_URLS: "http://192.168.1.10:3000" }),
        (message) => warned.push(message),
      );
      expect(warned).toHaveLength(1);
      expect(warned[0]).toMatch(/cleartext/);

      warned.length = 0;
      warnAboutRiskyConfiguration(
        production({ STOKY_URLS: "https://stoky.example.com" }),
        (m) => warned.push(m),
      );
      expect(warned).toEqual([]);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it("outside production, warns about what production would refuse, and does not stop", () => {
    // A developer's list is often half-edited; the dev server still works at
    // its first address, so it says what a production build would refuse.
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
    const warned: string[] = [];

    try {
      warnAboutRiskyConfiguration(
        {
          NODE_ENV: "development",
          STOKY_URLS: "https://a.example, http://192.168.1.10:3000",
        },
        (message) => warned.push(message),
      );
      expect(warned).toEqual([
        expect.stringMatching(
          /^\[auth\] warning: STOKY_URLS starts with an https address/,
        ),
      ]);
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
      "STOKY_URLS",
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
      env.STOKY_URLS = "http://192.168.1.10:3000";
      delete env.NEXTAUTH_URL;
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
      expect(ours[0]).toMatch(/STOKY_URLS is http:\/\/192\.168\.1\.10:3000/);
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
