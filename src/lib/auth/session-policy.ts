/**
 * How long a session lives, and how many an account may hold, as arithmetic
 * and nothing else.
 *
 * Every session is a row (`prisma/schema.prisma`, `Session`), and the row's
 * `expiresAt` is the only lifetime that counts: Better Auth refuses a row past
 * it on every path, and deletes it when it does. This module decides what that
 * value should be; `src/lib/auth/instance.ts` writes it when a session is
 * created and the `auth.session` query writes it when activity slides it.
 *
 * Two kinds of session, chosen at sign-in by the "Mantener la sesión
 * iniciada" box and recorded on the row (`Session.persistent`). Each has two
 * numbers, and they bound different things.
 *
 * A **browser session** — the box unticked, the default (PROGRESS D135, which
 * replaces D125's thirty days):
 *
 * - **Fifteen minutes idle.** A session nobody touches for that long ends. It
 *   slides only on real activity — the keep-alive asks `auth.session` when a
 *   pointer or a key moves — and never on a background read, so a dashboard
 *   left polling on a kitchen counter still ends.
 * - **Twenty-four hours in all**, from `authenticatedAt`: the moment the
 *   password was typed. Activity cannot carry a session past it, so a cookie
 *   lifted off a device in use is worth a day at most.
 *
 * A **remembered session** — the box ticked, for a home device used every day
 * such as the kitchen screen (PROGRESS D141):
 *
 * - **Ninety days idle.** Better Auth slides it, at most once a day, on a
 *   tRPC read (`readSession` in `src/lib/auth.ts`), so a device in daily use
 *   stays signed in and one left in a drawer for three months does not.
 * - **A year in all**, from `authenticatedAt`, after which the password is
 *   asked for again however often the device is used.
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

/** Ninety days without use ends a remembered session. */
export const REMEMBERED_IDLE_S = 90 * 24 * 60 * 60;

/** A year after the password was typed, a remembered session ends however used. */
export const REMEMBERED_CAP_S = 365 * 24 * 60 * 60;

/**
 * How often a remembered session's expiry is slid: once a day, which is also
 * how far its `updatedAt` — the ten-session cap's clock — can trail its use.
 * Better Auth's `updateAge`, stated here so the instance and the read that
 * decides when to ask for it use one number.
 */
export const REMEMBERED_REFRESH_S = 24 * 60 * 60;

/**
 * How long Better Auth gives a session it was told not to remember: a day.
 * A row created with more ahead of it than this, plus a minute's slack, was
 * created as a remembered one (`persistentAtCreate`).
 */
const LIBRARY_DONT_REMEMBER_S = 24 * 60 * 60;

/** The limit from the sign-in for a session of this kind. */
export function capFor(persistent: boolean): number {
  return persistent ? REMEMBERED_CAP_S : BROWSER_CAP_S;
}

/**
 * The expiry a session should be created with at `now`: a browser session's
 * `nextExpiry`, or ninety days for a remembered one — and either way never
 * past its limit from `authenticatedAt`.
 */
export function initialExpiry({
  persistent,
  authenticatedAt,
  now,
}: {
  persistent: boolean;
  authenticatedAt: Date;
  now: Date;
}): Date {
  if (!persistent) return nextExpiry({ authenticatedAt, now });
  return new Date(
    Math.min(
      now.getTime() + REMEMBERED_IDLE_S * 1000,
      authenticatedAt.getTime() + REMEMBERED_CAP_S * 1000,
    ),
  );
}

/**
 * A remembered session's slid expiry, held to a year from the sign-in.
 * Better Auth's refresh proposes ninety days from now and knows nothing of
 * the year; this is what the update hook writes instead
 * (`src/lib/auth/instance.ts`).
 */
export function clampRemembered({
  proposed,
  authenticatedAt,
}: {
  proposed: Date;
  authenticatedAt: Date;
}): Date {
  return new Date(
    Math.min(
      proposed.getTime(),
      authenticatedAt.getTime() + REMEMBERED_CAP_S * 1000,
    ),
  );
}

/**
 * The header the auth route sets on a sign-in to say which box state it
 * carried: `"1"` ticked, `"0"` not. Internal — the route deletes any copy a
 * client sends on every request it forwards — and read only by the create
 * hook, through `persistentAtCreate`.
 */
export const REMEMBER_HEADER = "x-stoky-remember";

/**
 * Whether a session being created now is a remembered one.
 *
 * - **The route said so.** `remember` is the `x-stoky-remember` header the
 *   auth route sets on a sign-in from the box (`"1"` or `"0"`), after
 *   deleting any copy the client sent (`src/server/http/auth-handler.ts`).
 * - **Otherwise, what Better Auth was told.** A sign-in step the route does
 *   not rebuild — the second step of a two-step sign-in — creates its session
 *   from the `dont_remember` cookie the first step left: none, and Better
 *   Auth's ninety-day expiry, means remembered. Both are required, so a
 *   session Better Auth itself made short is never made long here.
 */
export function persistentAtCreate({
  remember,
  dontRememberCookie,
  proposedExpiresAt,
  now,
}: {
  remember: string | null;
  dontRememberCookie: boolean;
  proposedExpiresAt: Date;
  now: Date;
}): boolean {
  if (remember) return remember === "1";
  return (
    !dontRememberCookie &&
    proposedExpiresAt.getTime() - now.getTime() >
      (LIBRARY_DONT_REMEMBER_S + 60) * 1000
  );
}

/**
 * Whether a read at `now` should let Better Auth slide a remembered session:
 * once its row was last written a day or more ago.
 *
 * Asked of `updatedAt` rather than left to Better Auth, which decides from the
 * expiry alone — "ninety days less a day ahead" — and so, once the year's
 * limit holds an expiry still, would decide yes on every read for the
 * session's last three months: a write per request, which is what D135
 * removed.
 */
export function rememberedRefreshDue(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() >= REMEMBERED_REFRESH_S * 1000;
}

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
  return (
    expiresAt.getTime() - now.getTime() <
    (BROWSER_IDLE_S - SLIDE_MARGIN_S) * 1000
  );
}

/**
 * Which deadline a session's expiry is: `"idle"`, which activity can still
 * move, or `"cap"`, the limit from the sign-in, which nothing moves. `capS` is
 * that limit for the session's kind (`capFor`).
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
