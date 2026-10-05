/**
 * Runs once as the server starts, before it serves a request — Next's
 * `instrumentation.ts` convention.
 *
 * **Here so that an unusable `NEXTAUTH_SECRET` stops the process**, which is
 * what `SECURITY.md` has always said happens and did not. The check used to
 * run only when `@/lib/auth` was first imported: by the first request that
 * needed a session, inside a route module Next loads lazily and whose load
 * failure it answers with a 500 rather than an exit. `/api/health` never
 * imports `@/lib/auth`, so the container reported healthy while every
 * sign-in, every page and every tRPC call failed.
 *
 * Only under the Node runtime, which is the one that serves this application;
 * the guarded dynamic import is Next's documented way to keep Node-only code
 * out of the Edge bundle. `assertUsableSecret` does nothing outside
 * production, and `next build` does not call `register`, so development, the
 * build and the test suites are unaffected. The call in `@/lib/auth` stays as
 * the second line, for anything that imports it outside a Next server.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refuseToStartWithUnusableSecret } = await import("@/lib/auth/startup");
    refuseToStartWithUnusableSecret();
  }
}
