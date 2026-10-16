import { describe, expect, it } from "bun:test";
import {
  passkeyOfferedAt,
  passkeyRpHost,
  passkeyRpOrigin,
  passkeysAvailable,
} from "@/lib/auth/passkeys";

/**
 * Where passkeys can work (PROGRESS D151): the first `STOKY_URLS` entry, when
 * browsers allow WebAuthn there and a relying party id can name it. Pure, so
 * every case is an environment literal.
 */

const production = (urls: string) => ({ NODE_ENV: "production", STOKY_URLS: urls });

describe("passkeysAvailable", () => {
  it("is true for an https first entry with a domain name", () => {
    expect(passkeysAvailable(production("https://stoky.example"))).toBe(true);
    expect(passkeysAvailable(production("https://stoky.example:8443, http://192.168.1.10:3000"))).toBe(true);
  });

  it("is true for http at localhost, the one secure context plain HTTP has", () => {
    expect(passkeysAvailable(production("http://localhost:3000"))).toBe(true);
    // Development with nothing set is Better Auth's own default address.
    expect(passkeysAvailable({ NODE_ENV: "development" })).toBe(true);
  });

  it("is false for plain HTTP to another machine, which browsers give no WebAuthn", () => {
    expect(passkeysAvailable(production("http://stoky.lan:3000"))).toBe(false);
    // Loopback by address is a secure context, but an IP is never a relying party id.
    expect(passkeysAvailable(production("http://127.0.0.1:3000"))).toBe(false);
  });

  it("is false at an IP address, even over https", () => {
    expect(passkeysAvailable(production("https://192.168.1.10"))).toBe(false);
    expect(passkeysAvailable(production("https://[::1]:8443"))).toBe(false);
  });

  it("is decided by the first entry alone", () => {
    // An https name listed second does not make a LAN-first install a relying party.
    expect(passkeysAvailable(production("http://192.168.1.10:3000, https://stoky.example"))).toBe(false);
  });

  it("is false in production with nothing set", () => {
    expect(passkeysAvailable({ NODE_ENV: "production" })).toBe(false);
  });
});

describe("passkeyRpHost and passkeyRpOrigin", () => {
  it("name the canonical entry's hostname and origin", () => {
    const env = production("https://stoky.example:8443, https://other.example");
    expect(passkeyRpHost(env)).toBe("stoky.example");
    expect(passkeyRpOrigin(env)).toBe("https://stoky.example:8443");
  });

  it("are null where passkeys are unavailable", () => {
    const env = production("http://192.168.1.10:3000");
    expect(passkeyRpHost(env)).toBeNull();
    expect(passkeyRpOrigin(env)).toBeNull();
  });
});

describe("passkeyOfferedAt", () => {
  const env = production("https://stoky.example, https://stoky.lan, http://192.168.1.10:3000");

  it("is true at the canonical host", () => {
    expect(passkeyOfferedAt("stoky.example", env)).toBe(true);
    // The default port is the same origin, written or not.
    expect(passkeyOfferedAt("stoky.example:443", env)).toBe(true);
    expect(passkeyOfferedAt("STOKY.example", env)).toBe(true);
  });

  it("is false at every other listed address", () => {
    expect(passkeyOfferedAt("stoky.lan", env)).toBe(false);
    expect(passkeyOfferedAt("192.168.1.10:3000", env)).toBe(false);
  });

  it("is false at the canonical name on another port, which is another origin", () => {
    expect(passkeyOfferedAt("stoky.example:8443", env)).toBe(false);
  });

  it("is false with no host, a malformed one, or where passkeys are unavailable", () => {
    expect(passkeyOfferedAt(null, env)).toBe(false);
    expect(passkeyOfferedAt("", env)).toBe(false);
    expect(passkeyOfferedAt("a b", env)).toBe(false);
    expect(passkeyOfferedAt("192.168.1.10", production("https://192.168.1.10"))).toBe(false);
  });
});
