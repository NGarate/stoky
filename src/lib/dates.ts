/**
 * Dates, written the way the reader's language writes them — in one place.
 *
 * Nine call sites built their own `Intl.DateTimeFormat` or called
 * `toLocaleDateString(locale)`, in six different shapes: "06 de octubre de
 * 2026" beside "6 de octubre de 2026" on the next screen, "06 oct 2026" in a
 * table and "6/10/2026" in a chart. Two styles cover every one of them:
 *
 * - `long` — prose and detail rows: "6 de octubre de 2026".
 * - `short` — tables, chart axes, compact meta: "6 oct 2026".
 *
 * **A date-only value is pinned to UTC.** An expiry date is a calendar day,
 * stored as that day's UTC midnight (`src/lib/inventory/batches.ts`).
 * Formatting it in the reader's own time zone moved it back a day anywhere
 * west of UTC — a carton good until the 6th read "5 de octubre" — so callers
 * showing a stored calendar day pass `{ dateOnly: true }` and get the day
 * that was stored. An instant (`createdAt`, `recordedAt`) is not pinned: it
 * happened at a moment, and the reader's day is the right one to name.
 */

export type DateStyle = "long" | "short";

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  long: { day: "numeric", month: "long", year: "numeric" },
  short: { day: "numeric", month: "short", year: "numeric" },
};

type DateInput = Date | string | number;

export function formatDate(
  locale: string,
  value: DateInput,
  style: DateStyle,
  {
    dateOnly = false,
    timeZone,
  }: {
    dateOnly?: boolean;
    /** The reader's zone for an instant; the runtime's when omitted. */
    timeZone?: string;
  } = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    ...STYLES[style],
    timeZone: dateOnly ? "UTC" : timeZone,
  }).format(new Date(value));
}

/** A moment, with its time: "6 oct 2026, 9:05". */
export function formatDateTime(locale: string, value: DateInput): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** The time of day alone: "09:05". */
export function formatTime(locale: string, value: DateInput): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
