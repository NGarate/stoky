import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

/**
 * The production entry, started for real: `bun --preload entry.ts <server>`,
 * as the Dockerfile's `CMD` starts it, in front of a `node:http` server that
 * stands in for Next's and answers with the headers its listener saw.
 *
 * `trusted-proxies.test.ts` covers the decision. This covers the wiring: that
 * the decision runs before the server's own listener, on the socket's real
 * address.
 */

const root = join(import.meta.dir, "..", "..", "..");
const entry = join(root, "src/server/http/entry.ts");
const server = join(root, "src/__tests__/fixtures/echo-headers-server.js");

const FORGED = {
  "x-forwarded-for": "203.0.113.9",
  "x-real-ip": "203.0.113.9",
  "x-forwarded-proto": "https",
};

const running: Bun.Subprocess[] = [];
afterEach(() => {
  for (const child of running.splice(0)) child.kill();
});

function start(trustedProxies: string | undefined) {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.STOKY_TRUSTED_PROXIES;
  if (trustedProxies !== undefined) env.STOKY_TRUSTED_PROXIES = trustedProxies;
  const child = Bun.spawn(["bun", "--preload", entry, server], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  running.push(child);
  return child;
}

/** What the server's listener was given for a request forging `FORGED`. */
async function seenFromLoopback(trustedProxies: string | undefined) {
  const child = start(trustedProxies);
  let output = "";
  const decoder = new TextDecoder();
  for await (const chunk of child.stdout) {
    output += decoder.decode(chunk);
    const port = output.match(/listening on (\d+)/)?.[1];
    if (!port) continue;
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: FORGED,
    });
    return (await response.json()) as Record<string, string>;
  }
  throw new Error(`the server never listened: ${output}`);
}

describe("the production entry", () => {
  it("ignores forwarded headers from a peer nobody listed", async () => {
    const seen = await seenFromLoopback(undefined);
    expect(seen["x-forwarded-for"]).toBe("127.0.0.1");
    expect(seen["x-real-ip"]).toBeUndefined();
    expect(seen["x-forwarded-proto"]).toBeUndefined();
  });

  it("believes them from a peer in STOKY_TRUSTED_PROXIES", async () => {
    const seen = await seenFromLoopback("127.0.0.1");
    expect(seen["x-forwarded-for"]).toBe("203.0.113.9");
    expect(seen["x-real-ip"]).toBeUndefined();
    expect(seen["x-forwarded-proto"]).toBe("https");
  });

  it("refuses to start on an entry it cannot read, naming it", async () => {
    const child = start("127.0.0.1, 10.0.0.0/");
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain(
      '[proxy] refusing to start: STOKY_TRUSTED_PROXIES has an entry that is neither an address nor a CIDR range: "10.0.0.0/"',
    );
    expect(await new Response(child.stdout).text()).not.toContain("listening");
  });
});
