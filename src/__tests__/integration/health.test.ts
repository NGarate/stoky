import { describe, it, expect, afterAll } from "bun:test";
import { GET } from "@/app/api/health/route";
import { closeRateLimiter } from "@/lib/rate-limit";

/**
 * `/api/health`, against a real database and a real Valkey.
 *
 * A health check tested against mocks asserts that the mocks are up. The whole
 * value of this endpoint is that it fails when a dependency does, so it belongs
 * in the tier where a dependency can actually be taken away — and the "cache is
 * gone" case below does exactly that, by pointing the client at a port nothing
 * listens on.
 *
 * The production compose gave `db` and `cache` a healthcheck each and gave the
 * app none, so Docker could not tell a working instance from a wedged one.
 */

afterAll(async () => {
  await closeRateLimiter();
});

describe("when everything is reachable", () => {
  it("answers 200", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("is never cached", async () => {
    // A cached health check reports the past. Docker would keep restarting a
    // healthy container, or keep a dead one alive, depending on which way the
    // stale answer fell.
    const response = await GET();

    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("says nothing about what is behind it", async () => {
    // Reachable through Traefik from the public internet. "database:
    // unreachable" tells an attacker which half of a deployment to push on;
    // the operator gets that from the container log instead.
    const body = await (await GET()).text();

    expect(body).not.toContain("database");
    expect(body).not.toContain("cache");
    expect(body).not.toContain("postgres");
    expect(body).not.toContain("valkey");
  });
});

describe("when a dependency is gone", () => {
  it("answers 503 rather than 200", async () => {
    // The assertion the endpoint exists for. An instance that answers HTTP but
    // cannot reach Valkey cannot sign anybody in — the rate limiter fails
    // closed — so reporting "healthy" would be reporting the wrong thing.
    const original = process.env.VALKEY_URL;
    await closeRateLimiter();
    // Port 1 is reserved and nothing listens on it.
    process.env.VALKEY_URL = "redis://127.0.0.1:1";

    try {
      const response = await GET();

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "degraded" });
    } finally {
      await closeRateLimiter();
      if (original === undefined) delete process.env.VALKEY_URL;
      else process.env.VALKEY_URL = original;
    }
  });

  it("recovers on its own once it is back", async () => {
    // No latch and no cached failure: the point of a healthcheck is that
    // Docker can stop restarting the container when the problem was next door.
    expect((await GET()).status).toBe(200);
  });
});
