/**
 * Identifiers minted on the device.
 *
 * Every change composed without a signal carries one, and it becomes half the
 * primary key of the server's replay record — so it has to be unique, and it
 * has to be mintable *wherever this application actually runs*.
 *
 * That second requirement is the whole reason this file exists rather than a
 * bare `crypto.randomUUID()` call at each site. `randomUUID` is
 * **secure-context only**: it is absent over plain HTTP. And plain HTTP is not
 * a hypothetical here — `next.config.ts` explicitly invites
 * `192.168.8.*` and two Tailscale addresses through `allowedDevOrigins`,
 * because reaching a self-hosted box from a phone on the LAN is how this gets
 * tested on real hardware. On localhost it would work; on the phone it would
 * throw, and the queue would refuse every change with no obvious cause.
 *
 * `crypto.getRandomValues` has no such restriction, so the fallback is a v4
 * assembled by hand from it. Both paths produce the same shape, and the server
 * validates that shape with `z.string().uuid()`.
 */

const HEX = Array.from({ length: 256 }, (_, byte) =>
  byte.toString(16).padStart(2, "0"),
);

/** A v4 UUID from 16 random bytes, with the version and variant bits set. */
function uuidFromRandomBytes(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Version 4 in the high nibble of byte 6; variant 10xx in byte 8. Without
  // these the string is still 36 characters and still unique, and still fails
  // `z.string().uuid()` on the server.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => HEX[byte] as string);
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/**
 * A fresh identifier for one composed change.
 *
 * Uses the platform's own generator where it exists, because it is the one
 * likeliest to be seeded well, and falls back where it does not.
 */
export function newOpId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return uuidFromRandomBytes();
}
