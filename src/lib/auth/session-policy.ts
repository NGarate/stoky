/**
 * How long a browser session lives, and how many an account may hold, as
 * arithmetic and nothing else.
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

/**
 * How many sessions one account may hold at once (PROGRESS D140, ASVS 5.0.0
 * 7.1.2). The sign-in that would make the eleventh ends the least recently
 * used one (`src/lib/auth/sign-in-tidy.ts`). Ten is above what a household's
 * phones, laptops and kitchen screen add up to, so the limit bounds a leak —
 * a session nobody signs out of, a cookie copied somewhere — rather than how
 * the account is used.
 */
export const MAX_SESSIONS_PER_ACCOUNT = 10;

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

/**
 * Which deadline a session's expiry is: `"idle"`, which activity can still
 * move, or `"cap"`, the limit from the sign-in, which nothing moves.
 *
 * WCAG 2.2.6 is about a warning that tells the truth. Fifteen minutes from the
 * end of the day, `nextExpiry` stops sliding and the expiry *is* the limit, so
 * "Seguir conectado" would answer with the same time and the countdown would
 * carry on as if the button had not been pressed. The keep-alive asks this to
 * say which deadline is coming and to offer the button only when pressing it
 * can do something (`src/components/session/SessionKeepAlive.tsx`).
 *
 * A second's slack, because the limit is computed as a sum and stored at
 * millisecond precision by a different process than the one reading it: an
 * expiry within a second of the limit is the limit. Past it counts too — a row
 * that would outlive its limit is not one activity can extend.
 */
export type DeadlineKind = "idle" | "cap";

export function deadlineKind({
  expiresAt,
  authenticatedAt,
  capS,
}: {
  expiresAt: Date;
  authenticatedAt: Date;
  capS: number;
}): DeadlineKind {
  const limit = authenticatedAt.getTime() + capS * 1000;
  return expiresAt.getTime() >= limit - 1000 ? "cap" : "idle";
}
