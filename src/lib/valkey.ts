import Redis from "ioredis";

/**
 * The one connection to Valkey.
 *
 * Extracted from `rate-limit.ts`, which opened and owned it because it was the
 * only thing that needed a cache. It is not any more — ISSUES.md DEBT-3 moves
 * the Open Food Facts cache here too — and two modules each calling
 * `new Redis()` would mean two sockets, two reconnect loops, and two places to
 * get the connection options wrong.
 *
 * **The options are the interesting part, and they are chosen for the
 * sign-in path.** A rate-limit check sits in front of a login form, so a cache
 * that is not coming back must fail fast rather than hang: `maxRetriesPerRequest`
 * rejects the command once the connection has been down that many attempts, and
 * `commandTimeout` covers the case where the socket is open but nothing answers.
 *
 * The offline queue is deliberately left on. Turning it off rejects any command
 * issued while the client is reconnecting, which is a normal transient state —
 * it failed a test here by refusing a sign-in that had nothing wrong with it.
 */

let client: Redis | null = null;

export function valkey(): Redis {
  if (!client) {
    const url = process.env.VALKEY_URL ?? "redis://localhost:6379";
    client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 2000,
    });
    // ioredis emits `error` on an unreachable server, and an unhandled 'error'
    // event on an EventEmitter takes the process down.
    client.on("error", () => {});
  }
  return client;
}

/**
 * Drops the cached connection so a suite can exit cleanly, and so a test can
 * point the next one at a different URL.
 */
export async function closeValkey(): Promise<void> {
  if (client) {
    const closing = client;
    client = null;
    await closing.quit().catch(() => {});
  }
}
