import { describe, it, expect, afterEach, mock } from "bun:test";
import {
  logSecurityEvent,
  securityLine,
  type SecurityDetails,
} from "@/lib/security-log";

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

    expect(securityLine("access.denied", smuggled, AT)).not.toContain("secreto");
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
