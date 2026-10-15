/**
 * How long a browser session lives, as arithmetic and nothing else.
 *
 * Every session is a row (`prisma/schema.prisma`, `Session`), and the row's
 * `expiresAt` is the only lifetime that counts: Better Auth refuses a row past
 * it on every path, and deletes it when it does. This module decides what that
 * value should be; `src/lib/auth/instance.ts` writes it when a session is
 * created and the `auth.session` query writes it when activity slides it.
 *
 * Two numbers, and they bound different things (PROGRESS D135, which replaces
 * D125's thirty days):
 *
 * - **Fifteen minutes idle.** A session nobody touches for that long ends. It
 *   slides only on real activity — the keep-alive asks `auth.session` when a
 *   pointer or a key moves — and never on a background read, so a dashboard
 *   left polling on a kitchen counter still ends.
 * - **Twenty-four hours in all**, from `authenticatedAt`: the moment the
 *   password was typed. Activity cannot carry a session past it, so a cookie
 *   lifted off a device in use is worth a day at most.
 *
 * Pure, so the arithmetic is tested without a clock or a database.
 */

/** Fifteen minutes without activity ends a browser session. */
export const BROWSER_IDLE_S = 15 * 60;

/** A day after the password was typed, a browser session ends however active. */
export const BROWSER_CAP_S = 24 * 60 * 60;

/**
 * How stale an expiry must be before activity is worth a write: a minute.
 * The keep-alive asks at most every four minutes, so this only stops two tabs
 * that both saw activity from writing the same row twice in a row.
 */
export const SLIDE_MARGIN_S = 60;

/**
 * The expiry a session should have at `now`: fifteen idle minutes from now,
 * but never past a day from `authenticatedAt`.
 */
export function nextExpiry({
  authenticatedAt,
  now,
}: {
  authenticatedAt: Date;
  now: Date;
}): Date {
  return new Date(
    Math.min(
      now.getTime() + BROWSER_IDLE_S * 1000,
      authenticatedAt.getTime() + BROWSER_CAP_S * 1000,
    ),
  );
}

/** Whether activity at `now` should move an expiry of `expiresAt` forward. */
export function shouldSlide(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() < (BROWSER_IDLE_S - SLIDE_MARGIN_S) * 1000;
}
