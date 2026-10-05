import { prisma } from "@/lib/prisma";
import { pingCache } from "@/lib/rate-limit";
import { secretProblem } from "@/lib/auth/secret";

/**
 * Is this instance able to serve? — for the container runtime, not for a person.
 *
 * The production compose gave `db` and `cache` a healthcheck each and gave
 * the app none, so Docker had no way to tell a working instance from a wedged
 * one: a Next process that has stopped answering is still "running", and
 * `restart: unless-stopped` never fires. This project has already lost a
 * thirty-minute Playwright run to exactly that failure mode locally.
 *
 * **It checks the two dependencies rather than only itself.** An instance that
 * answers HTTP but cannot reach Postgres serves an error on every page, and
 * without Valkey nobody can sign in at all, because the rate limiter fails
 * closed. Reporting "healthy" in either state is reporting the wrong thing.
 * The same goes for a session signing key the application refuses to use —
 * see `signingKey` below.
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

/**
 * Never cached, never prerendered: a cached health check is not a health check.
 *
 * That used to be stated as `dynamic = "force-dynamic"` and `revalidate = 0`.
 * Both are refused outright under `cacheComponents`, and both are now the
 * default — nothing is cached unless it asks to be with `use cache`, which this
 * handler does not and must not. The guarantee is unchanged; only the way of
 * spelling it is gone, so the sentence above stays as the record of the intent.
 */

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

/**
 * A signing key the application refuses to use is a dependency that is down.
 *
 * `src/instrumentation.ts` stops the server starting with one, and this is the
 * second line: were that ever bypassed — a runtime that skips the hook, a
 * secret changed under a running process — every route that reads a session
 * would fail while this endpoint, which never imports `@/lib/auth`, went on
 * answering 200. That is exactly how it was before the hook existed. Checked
 * per request, like the others, so it reports the environment as it is now.
 */
async function signingKey(): Promise<void> {
  // `next build` calls this handler while deciding whether it can be
  // prerendered, with no runtime secret by design — the same exemption
  // `assertUsableSecret` makes, for the same reason.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const problem = secretProblem(process.env.NEXTAUTH_SECRET, process.env.NODE_ENV);
  if (problem) throw new Error(`[auth] ${problem}`);
}

export async function GET(): Promise<Response> {
  const checks = await Promise.allSettled([
    // `SELECT 1` rather than a model query: it proves the connection without
    // depending on any table, so a half-applied migration still reports
    // honestly instead of failing as though the database were down.
    withTimeout(prisma.$queryRaw`SELECT 1`, "database"),
    withTimeout(pingCache(), "cache"),
    signingKey(),
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
