import { describe, it, expect, afterAll, spyOn } from "bun:test";
import { GET } from "@/app/api/health/route";
import { closeRateLimiter } from "@/lib/rate-limit";
import { PLACEHOLDER_SECRET } from "@/lib/auth/secret";

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

  it("answers 503 when the session signing key is one the application refuses", async () => {
    // Before, the key was checked only when `@/lib/auth` was imported — never
    // by this route — so a production instance with the example secret was
    // "healthy" while every route that reads a session failed.
    // Without the read-only `NODE_ENV` of the Next typings.
    const env = process.env as Record<string, string | undefined>;
    const keys = ["NODE_ENV", "STOKY_SECRET", "NEXTAUTH_SECRET"];
    const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
    const logged = spyOn(console, "error").mockImplementation(() => {});
    /** The variable the logged refusal named, so a case cannot pass on another check. */
    const refusal = () =>
      logged.mock.calls.map((call) => String(call[1])).find((line) => line.includes("[auth]"));

    try {
      env.NODE_ENV = "production";
      env.STOKY_SECRET = PLACEHOLDER_SECRET;
      env.NEXTAUTH_SECRET = "";
      let response = await GET();
      expect(response.status).toBe(503);
      // Still nothing about which check failed, in the body.
      expect(await response.json()).toEqual({ status: "degraded" });
      expect(refusal()).toContain("STOKY_SECRET is still the example value");

      // An installation not yet renamed (D137) is judged by the same rule:
      // the deprecated name is the key it signs with, so it is the key
      // checked here.
      logged.mockClear();
      env.STOKY_SECRET = "";
      env.NEXTAUTH_SECRET = PLACEHOLDER_SECRET;
      response = await GET();
      expect(response.status).toBe(503);
      expect(refusal()).toContain("NEXTAUTH_SECRET is still the example value");

      // And the new name wins when both are set, as it does at start-up.
      logged.mockClear();
      env.STOKY_SECRET = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";
      response = await GET();
      expect(response.status).toBe(200);
    } finally {
      logged.mockRestore();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
    }
  });

  it("recovers on its own once it is back", async () => {
    // No latch and no cached failure: the point of a healthcheck is that
    // Docker can stop restarting the container when the problem was next door.
    expect((await GET()).status).toBe(200);
  });
});
