import { describe, it, expect, afterEach } from "bun:test";
import {
  accountIdentifier,
  loginAccountRateLimit,
  loginRateLimit,
  productLookupRateLimit,
  rateLimitIdentifier,
  registerRateLimit,
  uploadRateLimit,
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

/**
 * What this function cannot do, pinned so nobody has to rediscover it —
 * `docs/SECURITY_REVIEW.md` finding 9.
 *
 * The tests above establish that the *last* hop is taken, and describe it as
 * the entry a client cannot forge. That is true behind a proxy that appends,
 * and **false when the application is reachable directly**: then the whole
 * header is whatever the caller typed, the last hop is the only hop, and a
 * caller who varies it gets a fresh counter every request.
 *
 * This is not a defect in the function. HTTP gives it nothing to tell "the
 * proxy wrote this" from "the client wrote this" — the distinction lives in the
 * deployment, not in the header. What these tests do is stop the requirement
 * being invisible: they state the exposure as behaviour, so it cannot be
 * discovered later as a surprise, and they go red if somebody changes the trust
 * model without changing `SECURITY.md` with it.
 *
 * The remedy is an owner's decision and is not taken here: an allowlist of
 * trusted proxy addresses, refusing to start without one, or accepting the
 * exposure and documenting the deployment requirement — which is what is done
 * for now.
 */
describe("what the identifier cannot know", () => {
  it("honours a header the caller wrote, when nothing has appended to it", () => {
    // One entry means the last hop *is* the first hop. Nothing here can tell
    // that apart from a proxy's own single entry.
    expect(rateLimitIdentifier(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBe(
      "1.2.3.4",
    );
  });

  it("gives a caller who varies it a fresh bucket every time", () => {
    // The whole per-IP limit, defeated by a header, on any deployment that
    // exposes the app without a proxy in front of it.
    const first = rateLimitIdentifier(new Headers({ "x-forwarded-for": "1.2.3.4" }));
    const second = rateLimitIdentifier(new Headers({ "x-forwarded-for": "9.9.9.9" }));

    expect(first).not.toBe(second);
  });

  it("trusts X-Real-IP the same way, and for the same reason", () => {
    // The fallback is not safer than the header it falls back from; it is the
    // same trust placed in a different name.
    expect(rateLimitIdentifier(new Headers({ "x-real-ip": "5.5.5.5" }))).toBe(
      "5.5.5.5",
    );
  });

  it("is bounded by the per-account limit, which is what makes this survivable", () => {
    // Not a property of this function — a property of the pair. Sign-in also
    // counts per account on a hashed key (NIST SP 800-63B §5.2.2), so a caller
    // with unlimited addresses still buys only ten attempts per account per
    // window. That is the reason this exposure is a documented requirement
    // rather than an open door.
    expect(loginAccountRateLimit().attempts).toBe(10);
    expect(loginAccountRateLimit().prefix).not.toBe(loginRateLimit().prefix);
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

  it("meters sixty Open Food Facts lookups an hour per account", () => {
    // The browser suite raises this in playwright.config.ts; this is why that
    // cannot become what an operator gets.
    delete process.env.RATE_LIMIT_PRODUCT_LOOKUP_ATTEMPTS;
    delete process.env.RATE_LIMIT_PRODUCT_LOOKUP_WINDOW_SECONDS;

    expect(productLookupRateLimit()).toEqual({
      prefix: "rl:off-lookup",
      attempts: 60,
      windowSeconds: 3600,
    });
  });

  it("counts lookups apart from every other limit", () => {
    const lookup = productLookupRateLimit().prefix;
    for (const other of [
      loginRateLimit(),
      loginAccountRateLimit(),
      registerRateLimit(),
      uploadRateLimit(),
    ]) {
      expect(other.prefix).not.toBe(lookup);
    }
  });
});
