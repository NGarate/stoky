import { describe, expect, it } from "bun:test";
import { assertAuthEnvironment, trustedOrigins } from "@/lib/auth/instance";

/**
 * The environment the Better Auth instance refuses to be built in, and the
 * origins it trusts (PROGRESS D135).
 *
 * Better Auth obeys `BETTER_AUTH_TRUSTED_ORIGINS` and `BETTER_AUTH_TELEMETRY`
 * over whatever its options say, so those are refused rather than ignored; and
 * a production instance with no `NEXTAUTH_URL` would guess its address from
 * each request. The route turns the refusal into a 503
 * (`unit/auth-handler.test.ts`).
 */

const production = (env: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  NEXTAUTH_URL: "https://stoky.example.com",
  ...env,
});

describe("assertAuthEnvironment", () => {
  it("accepts a production instance that names its address", () => {
    expect(() => assertAuthEnvironment(production())).not.toThrow();
  });

  it("refuses production with no NEXTAUTH_URL, and allows development without one", () => {
    expect(() => assertAuthEnvironment(production({ NEXTAUTH_URL: "" }))).toThrow(/NEXTAUTH_URL/);
    expect(() => assertAuthEnvironment({ NODE_ENV: "development" })).not.toThrow();
  });

  it("refuses a NEXTAUTH_URL that is not a URL, anywhere", () => {
    expect(() =>
      assertAuthEnvironment({ NODE_ENV: "development", NEXTAUTH_URL: "stoky.example.com" }),
    ).toThrow(/not a URL/);
  });

  it("refuses origins Better Auth would trust behind the configuration's back", () => {
    expect(() =>
      assertAuthEnvironment(production({ BETTER_AUTH_TRUSTED_ORIGINS: "https://evil.example" })),
    ).toThrow(/BETTER_AUTH_TRUSTED_ORIGINS/);
  });

  it("refuses telemetry switched on, and only on", () => {
    for (const on of ["1", "true", "yes"]) {
      expect(() => assertAuthEnvironment(production({ BETTER_AUTH_TELEMETRY: on }))).toThrow(
        /BETTER_AUTH_TELEMETRY/,
      );
    }
    for (const off of ["", "0", "false", "FALSE"]) {
      expect(() => assertAuthEnvironment(production({ BETTER_AUTH_TELEMETRY: off }))).not.toThrow();
    }
  });
});

describe("trustedOrigins", () => {
  it("is the public URL's origin alone in production, whatever DEV_ALLOWED_ORIGIN says", () => {
    expect(
      trustedOrigins("https://stoky.example.com/some/path", {
        NODE_ENV: "production",
        DEV_ALLOWED_ORIGIN: "192.168.1.20",
      }),
    ).toEqual(["https://stoky.example.com"]);
  });

  it("adds each development host over http at the dev port and over https", () => {
    expect(
      trustedOrigins("http://localhost:3000", {
        NODE_ENV: "development",
        PORT: "3100",
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
});
