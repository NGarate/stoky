/**
 * Runs once as the server starts, before it serves a request — Next's
 * `instrumentation.ts` convention.
 *
 * **Here so that an unusable `STOKY_SECRET` stops the process**, which is
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
 * production, and `next build` does not call `register`, so the check leaves
 * development, the build and the test suites alone. The call in `@/lib/auth`
 * stays as the second line, for anything that imports it outside a Next
 * server.
 *
 * An unknown `STOKY_REGISTRATION` stops it the same way, for the same reason:
 * a typo in a security setting is found in the first minute, not by the
 * stranger it was meant to keep out (`src/lib/auth/registration.ts`).
 *
 * So does an environment the auth API would refuse to be built in — no
 * `NEXTAUTH_URL` in production, one that is not a URL, a Better Auth variable
 * that would override its options (`src/lib/auth/environment.ts`, D136) —
 * which used to be found by the first sign-in, answered 503 while
 * `/api/health` said the instance was healthy.
 *
 * A public URL that is plain HTTP to another machine is warned about first
 * and does not stop it: plain-http LAN installs work on purpose (D84), but
 * nobody running one should learn from a packet capture that passwords cross
 * their network in cleartext (`src/lib/auth/public-url.ts`). Nor does a
 * variable that is set and ignored, which is named in a warning of its own,
 * nor one still set under its name from before the `STOKY_` rename — the
 * deprecated `NEXTAUTH_SECRET` is read, and said to be, once, here
 * (`src/lib/env-names.ts`, D137).
 *
 * It also fails the receipts a previous process left half-read, in
 * development as well as production; see
 * `src/server/services/receipt-recovery.ts`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Read before anything else: `register` completes before the server
    // takes a request, so every receipt this process creates is newer.
    const startedAt = new Date();

    const { refuseToStartMisconfigured, warnAboutRiskyConfiguration } = await import(
      "@/lib/auth/startup"
    );
    warnAboutRiskyConfiguration();
    refuseToStartMisconfigured();

    // Receipts a previous process was still reading when it stopped — a
    // restart, a deploy, an OOM kill — have no one left to finish them, and
    // the upload screen would poll them for ever. Not awaited, on purpose:
    // a database that is slow to come up must not hold the server back, and
    // the cutoff, not the timing, is what keeps this process's own receipts
    // out of it. It logs its own failure and never throws.
    const { recoverInterruptedReceipts } = await import(
      "@/server/services/receipt-recovery"
    );
    void recoverInterruptedReceipts(startedAt);
  }
}
