import { describe, it, expect, afterEach } from "bun:test";
import {
  accountIdentifier,
  loginAccountRateLimit,
  loginRateLimit,
  rateLimitIdentifier,
  registerRateLimit,
} from "@/lib/rate-limit";

/**
 * The parts of the limiter that need no cache: which address an attempt is
 * counted against, and what the limits are when nothing overrides them.
 *
 * The counting itself is in the integration suite, against a real Valkey —
 * a mock of INCR/EXPIRE would only assert that the mock was called.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("rateLimitIdentifier", () => {
  it("takes the last hop of X-Forwarded-For, not the first", () => {
    // This is the whole security property of the function. The leftmost entry
    // is whatever the client sent; a client that varies it per request gets a
    // fresh counter every time and the limit means nothing. The rightmost is
    // written by the proxy in front of this app.
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9, 198.51.100.4, 10.0.0.7",
    });

    expect(rateLimitIdentifier(headers)).toBe("10.0.0.7");
  });

  it("ignores a spoofed value when a proxy has appended the real one", () => {
    const spoofed = new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.7" });
    const alsoSpoofed = new Headers({ "x-forwarded-for": "2.2.2.2, 10.0.0.7" });

    // Two attackers trying to look like different clients land in one bucket.
    expect(rateLimitIdentifier(spoofed)).toBe(rateLimitIdentifier(alsoSpoofed));
  });

  it("tolerates the whitespace real proxies emit", () => {
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1,   10.0.0.7  ," });
    expect(rateLimitIdentifier(headers)).toBe("10.0.0.7");
  });

  it("falls back to X-Real-IP", () => {
    expect(rateLimitIdentifier(new Headers({ "x-real-ip": "10.0.0.8" }))).toBe("10.0.0.8");
  });

  it("puts an unidentifiable caller in a shared bucket rather than exempting it", () => {
    // Over-restricting is the safe direction. Returning something unique per
    // caller here would mean no limit at all when the app is reached directly.
    expect(rateLimitIdentifier(new Headers())).toBe("unknown");
  });
});

describe("accountIdentifier", () => {
  it("does not put the address in the key", () => {
    // The property worth having: a `KEYS rl:login:acct:*` on Valkey — which in
    // a self-hosted deployment is available to anything on the Docker network
    // — must not come back as a list of who has tried to sign in.
    const identifier = accountIdentifier("noel@example.com");

    expect(identifier).not.toContain("noel");
    expect(identifier).not.toContain("example.com");
    expect(identifier).not.toContain("@");
  });

  it("counts one account as one bucket however it was typed", () => {
    // Without normalisation, alternating the case gives an attacker a fresh
    // ten attempts per spelling — and there are a great many spellings.
    const canonical = accountIdentifier("noel@example.com");

    expect(accountIdentifier("Noel@Example.COM")).toBe(canonical);
    expect(accountIdentifier("  noel@example.com  ")).toBe(canonical);
  });

  it("keeps two accounts apart", () => {
    expect(accountIdentifier("a@example.com")).not.toBe(
      accountIdentifier("b@example.com"),
    );
  });

  it("is the same length whatever it was given", () => {
    // A key whose length tracked the address would leak the address's length.
    expect(accountIdentifier("a@b.co")).toHaveLength(
      accountIdentifier("a-very-long-address@a-very-long-domain.example").length,
    );
  });
});

describe("the configured limits", () => {
  it("defaults to the specification when nothing overrides it", () => {
    // CLAUDE.md, Security Constraints: 5 login attempts/15min per IP, 3
    // registrations/hour per IP. The limits are configurable so the browser
    // suite is not locked out by its own registrations; this assertion is why
    // that override cannot quietly become the product's behaviour.
    delete process.env.RATE_LIMIT_LOGIN_ATTEMPTS;
    delete process.env.RATE_LIMIT_LOGIN_WINDOW_SECONDS;
    delete process.env.RATE_LIMIT_REGISTER_ATTEMPTS;
    delete process.env.RATE_LIMIT_REGISTER_WINDOW_SECONDS;

    expect(loginRateLimit()).toEqual({
      prefix: "rl:login",
      attempts: 5,
      windowSeconds: 900,
    });
    expect(registerRateLimit()).toEqual({
      prefix: "rl:register",
      attempts: 3,
      windowSeconds: 3600,
    });
  });

  it("reads an override from the environment", () => {
    process.env.RATE_LIMIT_LOGIN_ATTEMPTS = "50";
    expect(loginRateLimit().attempts).toBe(50);
  });

  it("ignores a nonsensical override instead of disabling the limit", () => {
    // A typo in an env var must not turn into "unlimited attempts".
    for (const bad of ["0", "-1", "abc", "", "2.5"]) {
      process.env.RATE_LIMIT_LOGIN_ATTEMPTS = bad;
      expect(loginRateLimit().attempts).toBe(5);
    }
  });

  it("keeps the two limits on separate counters", () => {
    expect(loginRateLimit().prefix).not.toBe(registerRateLimit().prefix);
  });

  it("bounds a distributed guess at ten attempts per account", () => {
    // NIST SP 800-63B §5.2.2 asks for a limit on consecutive failed attempts
    // against *an account*. Ten rather than five because this counter cannot
    // tell a household's phone, tablet and laptop apart, and they are three
    // attempts before anybody has mistyped anything.
    delete process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
    delete process.env.RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS;

    expect(loginAccountRateLimit()).toEqual({
      prefix: "rl:login:acct",
      attempts: 10,
      windowSeconds: 900,
    });
  });

  it("counts the account separately from the address", () => {
    // Sharing a prefix would make five wrong passwords from one address spend
    // the account's budget too, and the two limits would stop being two.
    expect(loginAccountRateLimit().prefix).not.toBe(loginRateLimit().prefix);
    expect(loginAccountRateLimit().prefix).not.toBe(registerRateLimit().prefix);
  });
});
