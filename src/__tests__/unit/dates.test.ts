import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { formatDate, formatDateTime, formatTime } from "@/lib/dates";

/**
 * One date helper, two styles, and calendar days that stay on their day.
 */
describe("formatDate", () => {
  it("writes the two styles in the reader's language", () => {
    const day = new Date("2026-10-06T12:00:00Z");
    expect(formatDate("es", day, "long")).toBe("6 de octubre de 2026");
    expect(formatDate("en", day, "long")).toBe("October 6, 2026");
    expect(formatDate("es", day, "short")).toBe("6 oct 2026");
  });

  it("keeps a stored calendar day on its day, wherever the reader is", () => {
    // An expiry date is stored as UTC midnight of the day it names. Read in
    // the reader's zone, anywhere west of UTC that is the evening before: a
    // carton good until the 6th said "5 de octubre".
    const expiry = new Date("2026-10-06T00:00:00Z");
    const reader = "America/New_York";
    // As an instant, read in New York, it is the 5th — the defect.
    expect(formatDate("es", expiry, "long", { timeZone: reader })).toBe(
      "5 de octubre de 2026",
    );
    // As the calendar day it is, it stays the 6th whatever the reader's zone.
    expect(
      formatDate("es", expiry, "long", { dateOnly: true, timeZone: reader }),
    ).toBe("6 de octubre de 2026");
  });

  it("formats a time and a moment without a hand-built formatter", () => {
    const at = new Date(2026, 9, 6, 9, 5);
    expect(formatTime("es", at)).toBe("09:05");
    expect(formatDateTime("es", at)).toContain("2026");
  });
});

/**
 * And nobody builds a date formatter of their own.
 *
 * Nine call sites in six shapes is what this replaces. `batches.ts` is the
 * one exception: it asks `Intl` for calendar *parts* in Madrid's zone to
 * compute "today", which is arithmetic, not display.
 */
const SRC = join(import.meta.dir, "..", "..");
const ALLOWED = new Set(["lib/dates.ts", "lib/inventory/batches.ts"]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("dates have one formatter", () => {
  it("is not rebuilt on a screen", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) =>
        /new Intl\.DateTimeFormat\(|\.toLocaleDateString\(|format\.dateTime\(/.test(
          readFileSync(join(SRC, path), "utf8"),
        ),
      );

    expect(offenders).toEqual([]);
  });
});
