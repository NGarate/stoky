import { prisma } from "@/lib/prisma";
import { pingCache } from "@/lib/rate-limit";

/**
 * Is this instance able to serve? — for the container runtime, not for a person.
 *
 * `docker-compose.prod.yml` gives `db` and `cache` a healthcheck each and gives
 * the app none, so Docker had no way to tell a working instance from a wedged
 * one: a Next process that has stopped answering is still "running", and
 * `restart: unless-stopped` never fires. This project has already lost a
 * thirty-minute Playwright run to exactly that failure mode locally.
 *
 * **It checks the two dependencies rather than only itself.** An instance that
 * answers HTTP but cannot reach Postgres serves an error on every page, and
 * without Valkey nobody can sign in at all, because the rate limiter fails
 * closed. Reporting "healthy" in either state is reporting the wrong thing.
 *
 * **Not rate limited**, deliberately and unusually for this codebase. The
 * limiter lives in Valkey and fails closed, so metering this endpoint would
 * make it stop answering in precisely the situation it exists to report. The
 * exposure is one `SELECT 1` and one `PING` per request, which is the cheapest
 * pair of round trips in the application.
 *
 * **The body says nothing the status code does not.** This is reachable
 * through Traefik from the public internet, and "database: unreachable" tells
 * an attacker which half of a deployment to keep pushing on. The operator gets
 * the detail from the container log, which names the component.
 */

/** Never cached, never prerendered: a cached health check is not a health check. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Long enough for a slow answer, short enough to fail before Docker's timeout. */
const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} did not answer in ${CHECK_TIMEOUT_MS}ms`)),
        CHECK_TIMEOUT_MS,
      ),
    ),
  ]);
}

export async function GET(): Promise<Response> {
  const checks = await Promise.allSettled([
    // `SELECT 1` rather than a model query: it proves the connection without
    // depending on any table, so a half-applied migration still reports
    // honestly instead of failing as though the database were down.
    withTimeout(prisma.$queryRaw`SELECT 1`, "database"),
    withTimeout(pingCache(), "cache"),
  ]);

  const failures = checks.filter((check) => check.status === "rejected");

  for (const failure of failures) {
    console.error("[health] a dependency is not answering", failure.reason);
  }

  const healthy = failures.length === 0;

  return Response.json(
    { status: healthy ? "ok" : "degraded" },
    {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
