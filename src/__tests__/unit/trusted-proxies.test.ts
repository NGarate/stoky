import { describe, expect, it } from "bun:test";
import {
  parseTrustedProxies,
  resolveClient,
} from "@/server/http/trusted-proxies";

/**
 * Who the client is, decided from the socket's address and the headers the
 * peer sent. Every limit counted per address and every address in the
 * security log is this function's answer.
 */

type Headers = Record<string, string | string[] | undefined>;

function resolved(peer: string | undefined, headers: Headers, list = "") {
  const copy = { ...headers };
  resolveClient(peer, copy, parseTrustedProxies(list));
  return copy;
}

const FORGED: Headers = {
  "x-forwarded-for": "203.0.113.9",
  "x-real-ip": "203.0.113.9",
  "x-forwarded-proto": "https",
  "x-forwarded-host": "evil.example",
  forwarded: "for=203.0.113.9;proto=https",
  host: "stoky.example",
};

describe("a peer that is not a trusted proxy", () => {
  it("is the client, whatever it says about itself", () => {
    expect(resolved("198.51.100.7", FORGED)).toEqual({
      "x-forwarded-for": "198.51.100.7",
      host: "stoky.example",
    });
  });

  it("is not trusted for being on a private network or loopback", () => {
    for (const peer of ["127.0.0.1", "192.168.1.20", "172.18.0.1", "::1"]) {
      expect(resolved(peer, FORGED)["x-forwarded-for"]).toBe(peer);
    }
  });

  it("is not trusted because some other address is", () => {
    expect(resolved("10.0.0.9", FORGED, "10.0.0.7")["x-forwarded-for"]).toBe(
      "10.0.0.9",
    );
  });

  it("is named as IPv4 when the socket names it as IPv4-mapped IPv6", () => {
    expect(resolved("::ffff:198.51.100.7", {})["x-forwarded-for"]).toBe(
      "198.51.100.7",
    );
  });

  it("has no address at all once its socket is gone", () => {
    expect(resolved(undefined, FORGED)).toEqual({ host: "stoky.example" });
  });
});

describe("a trusted proxy", () => {
  it("is believed about the client and the scheme, and X-Real-IP goes", () => {
    expect(resolved("10.0.0.7", FORGED, "10.0.0.7")).toEqual({
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "evil.example",
      forwarded: "for=203.0.113.9;proto=https",
      host: "stoky.example",
    });
  });

  it("names the client last: what is left of it is the client's own claim", () => {
    const headers = { "x-forwarded-for": "1.1.1.1, 203.0.113.9" };
    expect(resolved("10.0.0.7", headers, "10.0.0.7")["x-forwarded-for"]).toBe(
      "203.0.113.9",
    );
  });

  it("is skipped, with every trusted hop before it, to reach the client", () => {
    const headers = { "x-forwarded-for": "1.1.1.1, 203.0.113.9, 192.0.2.44" };
    expect(
      resolved("10.0.0.7", headers, "10.0.0.7, 192.0.2.0/24")[
        "x-forwarded-for"
      ],
    ).toBe("203.0.113.9");
  });

  it("is recognised when the socket names it as IPv4-mapped IPv6", () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    expect(
      resolved("::ffff:10.0.0.7", headers, "10.0.0.7")["x-forwarded-for"],
    ).toBe("203.0.113.9");
  });

  it("is the client itself when it forwards for nobody", () => {
    expect(resolved("10.0.0.7", {}, "10.0.0.7")["x-forwarded-for"]).toBe(
      "10.0.0.7",
    );
  });

  it("leaves the furthest address when every hop is trusted", () => {
    const headers = { "x-forwarded-for": "10.0.0.3, 10.0.0.4" };
    expect(resolved("10.0.0.7", headers, "10.0.0.0/8")["x-forwarded-for"]).toBe(
      "10.0.0.3",
    );
  });

  it("stops at an entry that is not an address: it cannot be a trusted hop", () => {
    const headers = { "x-forwarded-for": "203.0.113.9, unknown, 10.0.0.4" };
    expect(resolved("10.0.0.7", headers, "10.0.0.0/8")["x-forwarded-for"]).toBe(
      "unknown",
    );
  });
});

describe("the ranges of STOKY_TRUSTED_PROXIES", () => {
  const client = { "x-forwarded-for": "203.0.113.9" };
  const believes = (peer: string, list: string) =>
    resolved(peer, client, list)["x-forwarded-for"] === "203.0.113.9";

  it("cover a range from its first address to its last, and no further", () => {
    const range = "172.20.0.0/16";
    expect(believes("172.19.255.255", range)).toBe(false);
    expect(believes("172.20.0.0", range)).toBe(true);
    expect(believes("172.20.255.255", range)).toBe(true);
    expect(believes("172.21.0.0", range)).toBe(false);
  });

  it("take /32 as one address and /0 as every address", () => {
    expect(believes("10.0.0.7", "10.0.0.7/32")).toBe(true);
    expect(believes("10.0.0.8", "10.0.0.7/32")).toBe(false);
    expect(believes("198.51.100.7", "0.0.0.0/0")).toBe(true);
    // Every IPv4 address is not every address.
    expect(believes("2001:db8::1", "0.0.0.0/0")).toBe(false);
  });

  it("cover IPv6 addresses and ranges", () => {
    expect(believes("::1", "::1")).toBe(true);
    expect(believes("fd00:1::9", "fd00:1::/64")).toBe(true);
    expect(believes("fd00:1:0:0:ffff:ffff:ffff:ffff", "fd00:1::/64")).toBe(
      true,
    );
    expect(believes("fd00:2::9", "fd00:1::/64")).toBe(false);
  });

  it("are empty when the variable is unset, empty or only commas", () => {
    for (const list of [undefined, "", " ", ",, ,"]) {
      const headers = { ...client };
      resolveClient("127.0.0.1", headers, parseTrustedProxies(list));
      expect(headers["x-forwarded-for"]).toBe("127.0.0.1");
    }
  });

  it("refuse an entry that is neither an address nor a range, naming it", () => {
    for (const entry of [
      "proxy.internal",
      "10.0.0.0/",
      "10.0.0.0/33",
      "10.0.0.0/8/8",
      "10.0.0.0/-1",
      "fd00::/129",
      "10.0.0",
      "private",
    ]) {
      expect(() => parseTrustedProxies(`127.0.0.1, ${entry}`)).toThrow(
        `STOKY_TRUSTED_PROXIES has an entry that is neither an address nor a CIDR range: "${entry}"`,
      );
    }
  });
});
