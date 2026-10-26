import { describe, it, expect, afterEach, mock } from "bun:test";
import {
  logSecurityEvent,
  MAX_VALUE_LENGTH,
  securityLine,
  type SecurityDetails,
} from "@/lib/security-log";
import { accountTag } from "@/lib/account-tag";

/**
 * OWASP ASVS V7.1.3 — the events, and what must never be in one.
 *
 * The line is the product here: it is what an owner greps six months from now
 * to answer "has anybody been trying to get in?". So the tests are about its
 * shape and about the one mistake that would be silent and permanent — a
 * credential written into a log that is then rotated, shipped and kept.
 */

const AT = new Date("2026-08-11T14:30:00.000Z");

afterEach(() => {
  mock.restore();
});

describe("the line", () => {
  it("is one JSON object per event", () => {
    // `docker compose logs | jq` is the intended reader, and it needs one
    // object per line rather than pretty-printed prose.
    const line = securityLine("access.denied", { path: "receipt.get" }, AT);

    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      ts: "2026-08-11T14:30:00.000Z",
      event: "access.denied",
      path: "receipt.get",
    });
  });

  it("stamps a time that sorts", () => {
    // ISO-8601 in UTC, so `sort` and a string comparison both order it right.
    expect(JSON.parse(securityLine("auth.signin.failed", {}, AT)).ts).toBe(
      "2026-08-11T14:30:00.000Z",
    );
  });

  it("leaves out what it was not given", () => {
    // An event with `"userId": null` on it reads as though somebody looked and
    // found nothing, which is not what an anonymous request means.
    const parsed = JSON.parse(
      securityLine("access.denied", { path: "x", userId: undefined }, AT),
    );

    expect(parsed).not.toHaveProperty("userId");
    expect(Object.keys(parsed)).toEqual(["ts", "event", "path"]);
  });

  it("leaves out an empty string too", () => {
    expect(
      JSON.parse(securityLine("access.denied", { address: "" }, AT)),
    ).not.toHaveProperty("address");
  });
});

describe("what never reaches a line", () => {
  it("drops a credential even when one is handed to it", () => {
    // `SecurityDetails` has no field for these, so this is about the version of
    // this function that grows a context bag. The failure would be silent, and
    // every line written between the mistake and its discovery keeps the
    // secret — a log is copied, rotated and shipped.
    const smuggled = {
      path: "auth.register",
      password: "cocina despensa nevera",
      passwordHash: "$argon2id$v=19$...",
      token: "eyJhbGciOi",
      cookie: "next-auth.session-token=…",
    } as unknown as SecurityDetails;

    const line = securityLine("access.denied", smuggled, AT);

    expect(line).not.toContain("cocina");
    expect(line).not.toContain("argon2");
    expect(line).not.toContain("eyJhbGciOi");
    expect(line).not.toContain("next-auth");
    expect(JSON.parse(line).path).toBe("auth.register");
  });

  it("does not care how a credential key was capitalised", () => {
    const smuggled = { PassWord: "secreto" } as unknown as SecurityDetails;

    expect(securityLine("access.denied", smuggled, AT)).not.toContain(
      "secreto",
    );
  });
});

describe("the address a sign-in tried", () => {
  // Security review, 2026-10-12: `auth.signin.failed` and
  // `auth.signin.throttled` carried the submitted address in plain text —
  // for every well-formed address, registered or not. The line names a keyed
  // tag instead, and the writer refuses the address outright.
  const SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const ADDRESS = "vecina.del.quinto@example.org";

  it("is dropped, however a caller hands it in", () => {
    const smuggled = {
      address: "203.0.113.7",
      email: ADDRESS,
      Email: ADDRESS,
    } as unknown as SecurityDetails;

    const line = securityLine("auth.signin.failed", smuggled, AT);

    expect(line).not.toContain("vecina");
    expect(JSON.parse(line)).toEqual({
      ts: "2026-08-11T14:30:00.000Z",
      event: "auth.signin.failed",
      address: "203.0.113.7",
    });
  });

  it("is logged as a tag that does not contain it", () => {
    const line = securityLine(
      "auth.signin.failed",
      { account: accountTag(ADDRESS, SECRET) },
      AT,
    );

    expect(line).not.toContain("vecina");
    expect(line).not.toContain("example.org");
    expect(JSON.parse(line).account).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is the value SECURITY.md's lookup command computes", () => {
    // Pinned to the output of the documented command, so the operator's way
    // of finding a person's lines cannot drift from what the code writes:
    //   printf 'stoky-log-account:%s' vecina.del.quinto@example.org \
    //     | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2 | cut -c1-16
    expect(accountTag(ADDRESS, SECRET)).toBe("2829b95a295aaf0a");
  });

  it("is the same however the address was typed", () => {
    // `loginSchema` trims and lowercases before the tag is taken; the tag does
    // too, so a caller that forgets cannot split one person into two.
    expect(accountTag(`  ${ADDRESS.toUpperCase()} `, SECRET)).toBe(
      accountTag(ADDRESS, SECRET),
    );
  });

  it("tells two addresses apart", () => {
    expect(accountTag("ana@example.org", SECRET)).not.toBe(
      accountTag("luis@example.org", SECRET),
    );
  });

  it("cannot be computed without the instance's secret", () => {
    // An unkeyed hash of a guessable address is reversed by guessing. Under
    // another key the same address is another tag.
    const other =
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    expect(accountTag(ADDRESS, other)).not.toBe(accountTag(ADDRESS, SECRET));
  });

  it("is keyed with STOKY_SECRET when no secret is passed", () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = env.STOKY_SECRET;
    try {
      env.STOKY_SECRET = SECRET;
      expect(accountTag(ADDRESS)).toBe(accountTag(ADDRESS, SECRET));
    } finally {
      if (saved === undefined) delete env.STOKY_SECRET;
      else env.STOKY_SECRET = saved;
    }
  });
});

describe("a sign-in that got in", () => {
  // ASVS 5.0.0 16.3.1: successes are logged with the factor used. The
  // success path is the one holding a live session token and the address
  // that was typed, so it is the one most tempted to pass them along.
  it("names the user, the factor, the tag and the client — and nothing else", () => {
    const smuggled = {
      userId: "user-1",
      method: "password",
      account: "2829b95a295aaf0a",
      address: "203.0.113.7",
      email: "vecina.del.quinto@example.org",
      token: "sesion-viva-abc123",
    } as unknown as SecurityDetails;

    const line = securityLine("auth.signin.succeeded", smuggled, AT);
    const parsed = JSON.parse(line);

    expect(parsed).not.toHaveProperty("email");
    expect(parsed).not.toHaveProperty("token");
    expect(line).not.toContain("vecina");
    expect(line).not.toContain("sesion-viva");
    expect(parsed).toMatchObject({
      event: "auth.signin.succeeded",
      userId: "user-1",
      method: "password",
      account: "2829b95a295aaf0a",
      address: "203.0.113.7",
    });
  });
});

describe("how long a value can be", () => {
  it("is bounded, so one request cannot write megabytes", () => {
    // A line is written for requests that were refused, from callers nobody
    // let in, and some values are theirs to choose.
    const long = "x".repeat(10 * 1024 * 1024);

    const parsed = JSON.parse(
      securityLine("access.denied", { path: long, code: "FORBIDDEN" }, AT),
    );

    expect(parsed.path).toBe("x".repeat(MAX_VALUE_LENGTH));
    expect(parsed.path).toHaveLength(200);
    expect(parsed.code).toBe("FORBIDDEN");
  });

  it("leaves a value at the bound whole", () => {
    const exact = "y".repeat(MAX_VALUE_LENGTH);

    expect(
      JSON.parse(securityLine("access.denied", { path: exact }, AT)).path,
    ).toBe(exact);
  });
});

describe("writing one", () => {
  it("goes to stderr, which a log level cannot quietly drop", () => {
    const written: string[] = [];
    const warn = mock((line: string) => {
      written.push(line);
    });
    console.warn = warn;

    logSecurityEvent("auth.signin.failed", { address: "10.0.0.7" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(written[0]).event).toBe("auth.signin.failed");
  });

  it("cannot take down the request it was describing", () => {
    // The caller is usually already in a `catch`. A logger that throws turns an
    // audit control into an availability bug.
    const hostile = {
      get path(): string {
        throw new Error("no");
      },
    } as unknown as SecurityDetails;

    expect(() => logSecurityEvent("access.denied", hostile)).not.toThrow();
  });
});
