import { Decimal } from "@prisma/client-runtime-utils";

/** A product's stock: the sum of its movements. */
export function netStock(entries: readonly { quantity: Decimal }[]): Decimal {
  return Decimal.sum(0, ...entries.map((entry) => entry.quantity));
}

/**
 * Expiry is a calendar date, not an instant.
 *
 * The date picker's "2026-10-06" reaches the server as `new Date(…)` of that
 * string, which is UTC midnight, and was compared with `new Date()`: milk good
 * until the 6th was listed as expired from 02:00 on the 6th in Madrid. So an
 * expiry date is read as the day its UTC date parts name, and "today" is the
 * date on the household's calendar. There is no per-household or per-user
 * time zone in the schema; the application is Spanish-first, so Madrid's
 * calendar is the one used.
 */
export const EXPIRY_TIME_ZONE = "Europe/Madrid";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day an expiry date names, as UTC midnight. */
function dayOf(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Today on the household's calendar, as UTC midnight of that date — the same
 * representation an expiry date is stored in, so the two compare directly.
 */
export function startOfToday(
  now: Date = new Date(),
  timeZone: string = EXPIRY_TIME_ZONE,
): Date {
  // Parts, not a formatted string, so no locale is chosen for anyone; the
  // calendar and digits are pinned instead, which is what the arithmetic needs.
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

/**
 * Whole calendar days from `today` (from `startOfToday`) to the day `expiry`
 * names: 0 on the day itself, 1 tomorrow, negative once it has passed. Days
 * elapsed are this negated — one measurement, not a second one rounded the
 * other way.
 */
export function daysUntilExpiry(expiry: Date, today: Date): number {
  return Math.round((dayOf(expiry) - dayOf(today)) / DAY_MS);
}

/**
 * How close an expiry has to be before it needs attention: today and the next
 * three days. The server's `isExpiringSoon`, the kitchen's "Usar ya" and
 * `ExpiryStatus`'s warn tone are one threshold, so they read it from here.
 */
export const EXPIRING_SOON_DAYS = 3;

/** The first instant after the day `days` days after `today`. */
export function endOfDayAfter(today: Date, days: number): Date {
  return new Date(dayOf(today) + (days + 1) * DAY_MS);
}
