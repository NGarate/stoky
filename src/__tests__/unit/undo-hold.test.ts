import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  SNACKBAR_DURATIONS,
  UNDO_HOLD_MS,
  setSnackbarDuration,
  undoHoldMs,
} from "@/lib/snackbar-duration";

/**
 * How long a one-tap change can be taken back (WCAG 2.2.3).
 *
 * The undo is a time limit like any other, and it was ten seconds whatever
 * the person had asked for — so "Larga" gave longer to read a snackbar whose
 * button had already stopped working. And the ten seconds were written down
 * three times (`queue.ts`, `ShoppingItem.tsx`, `shopping/[id]/page.tsx`),
 * each promising "the same window the kitchen uses", which is a promise
 * nothing kept.
 */

afterEach(() => setSnackbarDuration("default"));

describe("the undo window", () => {
  it("follows the snackbar duration the person chose", () => {
    setSnackbarDuration("default");
    expect(undoHoldMs()).toBe(10_000);
    setSnackbarDuration("long");
    expect(undoHoldMs()).toBe(30_000);
    setSnackbarDuration("forever");
    expect(undoHoldMs()).toBe(60_000);
  });

  it("never holds a change longer than a minute, even for 'until dismissed'", () => {
    // A held change blocks every change queued behind it (`queue.ts`, the
    // drain stops at a held head), so an undo that never expired would be a
    // shop that never sent. A minute is the cap.
    for (const duration of SNACKBAR_DURATIONS) {
      expect(UNDO_HOLD_MS[duration]).toBeLessThanOrEqual(60_000);
    }
  });

  it("is never shorter than the ten seconds it has always been", () => {
    for (const duration of SNACKBAR_DURATIONS) {
      expect(UNDO_HOLD_MS[duration]).toBeGreaterThanOrEqual(10_000);
    }
  });
});

const SOURCE_ROOT = join(import.meta.dir, "../..");

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__") sources(path, found);
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

describe("one window, written once", () => {
  it("is not redefined, or written as a number, anywhere else", () => {
    const offenders = sources(SOURCE_ROOT)
      .filter((file) => !file.endsWith("lib/snackbar-duration.ts"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          /\bconst\s+UNDO_HOLD_MS\b/.test(source) ||
          /\bholdMs:\s*[\d_]+/.test(source)
        );
      })
      .map((file) => relative(SOURCE_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
