import { BlockList, isIP } from "node:net";

/**
 * Whose forwarded headers this application believes: the peers listed in
 * `STOKY_TRUSTED_PROXIES`, and nobody else.
 *
 * `X-Forwarded-For` is what every per-address limit and every security-log
 * line reads (`clientAddress`, `src/lib/rate-limit.ts`), and it is a request
 * header: whoever connects can write it. It means something only when the
 * peer that sent it is a proxy the operator put there, and only this
 * application can know which peers those are. The default is nobody — not
 * the "loopback and private ranges" preset other servers offer, because a LAN
 * client of the published port arrives from a private address, and that
 * preset would let anyone on the LAN choose their own.
 *
 * This module imports nothing from the application: `entry.ts` loads it
 * beside Next's `server.js`, outside the bundle, where `@/` resolves nowhere.
 */

export const TRUSTED_PROXIES_ENV = "STOKY_TRUSTED_PROXIES";

/**
 * The setting as a list: comma-separated addresses and CIDR ranges, IPv4 or
 * IPv6. Throws on an entry that is neither, naming it — a typo that silently
 * trusted nobody would look like a rate limit gone mad, and one that silently
 * trusted everybody (`10.0.0.0/` read as `/0`) would look like nothing at all.
 */
export function parseTrustedProxies(raw: string | undefined): BlockList {
  const trusted = new BlockList();
  for (const entry of (raw ?? "").split(",").map((part) => part.trim())) {
    if (!entry) continue;
    const [address, prefix, ...rest] = entry.split("/");
    const family = isIP(address) === 6 ? "ipv6" : "ipv4";
    try {
      if (isIP(address) === 0 || rest.length > 0) throw new Error();
      if (prefix === undefined) trusted.addAddress(address, family);
      else if (!/^\d+$/.test(prefix)) throw new Error();
      // Throws on a prefix longer than the family has bits.
      else trusted.addSubnet(address, Number(prefix), family);
    } catch {
      throw new Error(
        `${TRUSTED_PROXIES_ENV} has an entry that is neither an address nor a CIDR range: "${entry}"`,
      );
    }
  }
  return trusted;
}

/** `::ffff:192.0.2.1`, how a dual-stack socket names an IPv4 peer, as IPv4. */
function plain(address: string): string {
  return address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
}

function trusts(trusted: BlockList, address: string): boolean {
  const family = isIP(address);
  return family !== 0 && trusted.check(address, family === 6 ? "ipv6" : "ipv4");
}

/** What a client can send to pass for somebody else, or for HTTPS. */
const FORWARDED = [
  "x-forwarded-for",
  "x-real-ip",
  "x-forwarded-proto",
  "x-forwarded-host",
  "forwarded",
];

/**
 * Rewrites a request's headers, in place, so that they say only what a
 * trusted proxy said. Afterwards `X-Forwarded-For` holds exactly one address,
 * the client's, and it is the only place anything reads one from.
 *
 * - **`peer` is not trusted:** every forwarded header is the caller's own
 *   claim and is dropped; the client is the peer.
 * - **`peer` is trusted:** the client is the first address, from the right of
 *   `X-Forwarded-For`, that is not itself a trusted proxy. From the right,
 *   because each proxy appends: everything left of the first untrusted entry
 *   is whatever that client sent. A CDN in front of the proxy is skipped the
 *   same way once its ranges are listed. `X-Forwarded-Proto` and
 *   `X-Forwarded-Host` are the proxy's and stay; `X-Real-IP` goes, so there
 *   is no second answer to disagree with the first.
 *
 * `peer` is `socket.remoteAddress`, which a closed socket no longer has: the
 * request then has no address at all and shares the `unknown` bucket.
 */
export function resolveClient(
  peer: string | undefined,
  headers: Record<string, string | string[] | undefined>,
  trusted: BlockList,
): void {
  let client = peer === undefined ? undefined : plain(peer);

  if (client !== undefined && trusts(trusted, client)) {
    const hops = String(headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((hop) => plain(hop.trim()))
      .filter((hop) => hop.length > 0);
    for (let i = hops.length - 1; i >= 0; i--) {
      client = hops[i];
      if (!trusts(trusted, client)) break;
    }
    delete headers["x-real-ip"];
  } else {
    for (const name of FORWARDED) delete headers[name];
  }

  // Written here even for a direct client, rather than left for Next to fill
  // in: Next would write the socket's own spelling, `::ffff:` included.
  if (client !== undefined) headers["x-forwarded-for"] = client;
}
