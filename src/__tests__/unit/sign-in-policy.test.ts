import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { DEVICE_ID_COOKIE, mintDeviceId } from "@/lib/device";
import {
  RateLimitUnavailableError,
  accountIdentifier,
  loginAccountRateLimit,
  loginDeviceRateLimit,
  loginRateLimit,
  type RateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit";
import {
  SignInRefusedError,
  chargeSignInAttempt,
  signInFailed,
  signInSucceeded,
  type SignInCharge,
  type SignInLimiter,
} from "@/lib/auth/sign-in-policy";

/**
 * The sign-in policy with the cache replaced by a script.
 *
 * What Valkey does with a counter — counting, expiring, refunding into the
 * right window — is proven against a real one in
 * `integration/rate-limit.test.ts`, through the auth route. What is
 * here is the policy's own arithmetic: which budget an attempt is charged to,
 * what a refusal carries, and what a settled charge gives back. A fake
 * limiter is the only way to make it answer "refused, 0 seconds left", which
 * a real window cannot be caught saying on demand.
 */

type Call = [string, ...unknown[]];

interface Script {
  /** What `consume` answers, keyed on the limit's prefix. */
  consume?: Record<string, Partial<RateLimitResult> | Error>;
  known?: boolean | Error;
}

function fakeLimiter(script: Script = {}): { limiter: SignInLimiter; calls: Call[] } {
  const calls: Call[] = [];
  const limiter: SignInLimiter = {
    consume: async (limit: RateLimit, identifier: string) => {
      calls.push(["consume", limit.prefix, identifier]);
      const answer = script.consume?.[limit.prefix];
      if (answer instanceof Error) throw answer;
      return { allowed: true, remaining: 1, retryAfterSeconds: 0, window: 1, ...answer };
    },
    refund: async (limit, identifier, window) => {
      calls.push(["refund", limit.prefix, identifier, window]);
    },
    reset: async (limit, identifier) => {
      calls.push(["reset", limit.prefix, identifier]);
    },
    isKnownDevice: async (account, deviceId) => {
      calls.push(["isKnownDevice", account, deviceId]);
      if (script.known instanceof Error) throw script.known;
      return script.known ?? false;
    },
    rememberDevice: async (account, deviceId) => {
      calls.push(["rememberDevice", account, deviceId]);
    },
  };
  return { limiter, calls };
}

const EMAIL = "Ana@Example.com ";
const headers = (extra: Record<string, string> = {}) =>
  new Headers({ "x-forwarded-for": "203.0.113.9", ...extra });

async function refusal(promise: Promise<unknown>): Promise<SignInRefusedError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SignInRefusedError) return error;
    throw error;
  }
  throw new Error("expected the sign-in to be refused");
}

async function charge(
  limiter: SignInLimiter,
  extra: Record<string, string> = {},
): Promise<SignInCharge> {
  const attempt = await chargeSignInAttempt(headers(extra), EMAIL, limiter);
  if (attempt.outcome !== "charged") throw new Error("expected a charge");
  return attempt;
}

let warn: ReturnType<typeof spyOn>;
let error: ReturnType<typeof spyOn>;
beforeEach(() => {
  // The security log is stderr, and the refusals below are meant to write it.
  warn = spyOn(console, "warn").mockImplementation(() => {});
  error = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

const ADDRESS = loginRateLimit().prefix;
const ACCOUNT = loginAccountRateLimit().prefix;
const DEVICE = loginDeviceRateLimit().prefix;
const USER = "user-ana-0001";

describe("a refusal's Retry-After", () => {
  it("is the limiter's figure for a spent address", async () => {
    const { limiter } = fakeLimiter({
      consume: { [ADDRESS]: { allowed: false, retryAfterSeconds: 437 } },
    });
    const refused = await refusal(chargeSignInAttempt(headers(), EMAIL, limiter));
    expect(refused.code).toBe("rate_limited");
    expect(refused.retryAfterSeconds).toBe(437);
  });

  it("is the limiter's figure for a spent account", async () => {
    const { limiter } = fakeLimiter({
      consume: { [ACCOUNT]: { allowed: false, retryAfterSeconds: 812 } },
    });
    const refused = await refusal(chargeSignInAttempt(headers(), EMAIL, limiter));
    expect(refused.code).toBe("account_rate_limited");
    expect(refused.retryAfterSeconds).toBe(812);
  });

  it("is never below one second, even when the window is ending", async () => {
    // A `Retry-After: 0` tells a client to come straight back, into the same
    // refusal. The window's last second rounds to one, not to none.
    for (const prefix of [ADDRESS, ACCOUNT]) {
      const { limiter } = fakeLimiter({
        consume: { [prefix]: { allowed: false, retryAfterSeconds: 0 } },
      });
      const refused = await refusal(chargeSignInAttempt(headers(), EMAIL, limiter));
      expect(refused.retryAfterSeconds).toBe(1);
    }
  });

  it("is absent when the cache cannot be reached", async () => {
    // Nothing here can say when Valkey comes back; a number would be made up.
    const { limiter } = fakeLimiter({
      consume: { [ADDRESS]: new RateLimitUnavailableError(new Error("down")) },
    });
    const refused = await refusal(chargeSignInAttempt(headers(), EMAIL, limiter));
    expect(refused.code).toBe("auth_unavailable");
    expect(refused.retryAfterSeconds).toBeNull();
  });
});

describe("failing closed", () => {
  it("refuses when the account budget cannot be counted", async () => {
    const { limiter } = fakeLimiter({
      consume: { [ACCOUNT]: new RateLimitUnavailableError(new Error("down")) },
    });
    expect((await refusal(chargeSignInAttempt(headers(), EMAIL, limiter))).code).toBe(
      "auth_unavailable",
    );
  });

  it("refuses when a device's standing cannot be checked", async () => {
    const { limiter } = fakeLimiter({ known: new RateLimitUnavailableError(new Error("down")) });
    const withDevice = headers({ cookie: `${DEVICE_ID_COOKIE}=${mintDeviceId()}` });
    expect((await refusal(chargeSignInAttempt(withDevice, EMAIL, limiter))).code).toBe(
      "auth_unavailable",
    );
  });
});

describe("what an attempt is charged to", () => {
  it("counts a malformed address against the address, and nothing else", async () => {
    const { limiter, calls } = fakeLimiter();
    const attempt = await chargeSignInAttempt(headers(), "not an address", limiter);
    expect(attempt.outcome).toBe("malformed");
    expect(calls).toEqual([["consume", ADDRESS, "203.0.113.9"]]);
  });

  it("charges an unknown browser to the shared account budget", async () => {
    const { limiter, calls } = fakeLimiter({ known: false });
    const device = mintDeviceId();
    const charged = await charge(limiter, { cookie: `${DEVICE_ID_COOKIE}=${device}` });
    const account = accountIdentifier("ana@example.com");

    expect(charged.email).toBe("ana@example.com");
    expect(charged.charged).toMatchObject({ kind: "account", identifier: account });
    expect(calls.at(-1)).toEqual(["consume", ACCOUNT, account]);
  });

  it("charges a known browser to its own budget on the account", async () => {
    const { limiter, calls } = fakeLimiter({ known: true });
    const device = mintDeviceId();
    const charged = await charge(limiter, { cookie: `${DEVICE_ID_COOKIE}=${device}` });

    expect(charged.charged.kind).toBe("device");
    expect(calls.at(-1)?.[1]).toBe(DEVICE);
    // Keyed on the account and a hash of the device, never the cookie value.
    expect(charged.charged.identifier).not.toContain(device);
  });
});

describe("settling a charge", () => {
  it("refunds the address into the window it was charged in, and clears only the budget charged", async () => {
    const { limiter, calls } = fakeLimiter({ consume: { [ADDRESS]: { window: 1_234_567 } } });
    const charged = await charge(limiter);
    calls.length = 0;

    await signInSucceeded(charged, USER, "password", limiter);

    expect(calls).toEqual([
      ["refund", ADDRESS, "203.0.113.9", 1_234_567],
      ["reset", ACCOUNT, accountIdentifier("ana@example.com")],
    ]);
  });

  it("remembers the browser only on a success that came with one", async () => {
    const device = mintDeviceId();
    const withDevice = fakeLimiter();
    await signInSucceeded(
      await charge(withDevice.limiter, { cookie: `${DEVICE_ID_COOKIE}=${device}` }),
      USER,
      "password",
      withDevice.limiter,
    );
    expect(withDevice.calls.at(-1)).toEqual([
      "rememberDevice",
      accountIdentifier("ana@example.com"),
      device,
    ]);

    const without = fakeLimiter();
    await signInSucceeded(await charge(without.limiter), USER, "password", without.limiter);
    expect(without.calls.some(([name]) => name === "rememberDevice")).toBe(false);
  });

  it("records who got in, how, and from where — never the address typed", async () => {
    // ASVS 5.0.0 16.3.1: a successful authentication is logged with the
    // factor it used. The same tag and address a failure carries, so one
    // filter follows an account from its refusals to its way in.
    const { limiter } = fakeLimiter();
    const charged = await charge(limiter);
    warn.mockClear();

    await signInSucceeded(charged, USER, "password", limiter);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warn.mock.calls[0]?.[0]));
    const { ts: _ts, ...rest } = line;
    expect(rest).toEqual({
      event: "auth.signin.succeeded",
      userId: USER,
      method: "password",
      account: charged.accountTag,
      address: "203.0.113.9",
    });
    expect(JSON.stringify(line)).not.toContain("example.com");
  });

  it("names the factor it was given", async () => {
    const { limiter } = fakeLimiter();
    const charged = await charge(limiter);
    warn.mockClear();

    await signInSucceeded(charged, USER, "passkey", limiter);

    expect(JSON.parse(String(warn.mock.calls[0]?.[0])).method).toBe("passkey");
  });

  it("records nothing when settling the charge fails", async () => {
    // The sign-in does not complete when the cache does not answer, and a
    // success line for a session nobody received is a false audit entry.
    const { limiter } = fakeLimiter();
    const charged = await charge(limiter);
    limiter.refund = async () => {
      throw new RateLimitUnavailableError(new Error("valkey down"));
    };
    warn.mockClear();

    await expect(signInSucceeded(charged, USER, "password", limiter)).rejects.toThrow();

    expect(
      warn.mock.calls.some(([first]: unknown[]) => String(first).includes("auth.signin.succeeded")),
    ).toBe(false);
  });

  it("gives nothing back for a failure", async () => {
    const { limiter, calls } = fakeLimiter();
    const charged = await charge(limiter);
    calls.length = 0;

    signInFailed(charged);

    expect(calls).toEqual([]);
    const line = JSON.parse(String(warn.mock.calls.at(-1)?.[0]));
    expect(line.event).toBe("auth.signin.failed");
    // The tag, not the address someone typed.
    expect(JSON.stringify(line)).not.toContain("example.com");
  });
});
