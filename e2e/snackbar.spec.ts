import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { SESSION_FILE } from "./session";

/**
 * The snackbar, measured rather than declared.
 *
 * `target-size.test.tsx` knows what an element *declares*; it cannot know that
 * a fixed navigation bar is drawn on top of it. That is ISSUES UI-6, a defect
 * this project has already shipped once, and a snackbar pinned to the bottom
 * of the viewport is the exact shape that causes it again: the phone's bar is
 * `fixed inset-x-0 bottom-0` and carries five 56px targets.
 *
 * So the offset is a measurement here, against the bar's own
 * `data-fixed-bottom` contract, at the tier where the bar exists.
 */
test.use({ storageState: SESSION_FILE });

/**
 * Provokes a real snackbar through the only path that shows one today: an
 * upload that fails. The request is refused at the wire rather than mocked in
 * the page, so what is measured is the component the application renders.
 */
async function showSnackbar(page: Page): Promise<void> {
  await page.route("**/api/trpc/**", async (route) => {
    if (route.request().url().includes("receipt.upload")) {
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });

  await page.goto("/receipts/upload");
  await page
    .getByRole("heading", { name: /ticket/i })
    .first()
    .waitFor();

  await page.setInputFiles('input[type="file"]', {
    name: "ticket.png",
    mimeType: "image/png",
    // A 1x1 PNG. The upload never reaches the server, so its contents only
    // have to satisfy the dropzone's own type check.
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });

  await expect(page.getByTestId("snackbar")).toBeVisible();
}

test.describe("the snackbar over the phone's navigation bar", () => {
  test("never covers the bar it is drawn above", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await showSnackbar(page);

    const verdict = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>("[data-fixed-bottom]");
      const toast = document.querySelector<HTMLElement>(
        '[data-testid="snackbar"]',
      );
      if (!bar || !toast) return { error: "missing element" };
      const barRect = bar.getBoundingClientRect();
      const toastRect = toast.getBoundingClientRect();
      return {
        barTop: Math.round(barRect.top),
        barHeight: Math.round(barRect.height),
        toastBottom: Math.round(toastRect.bottom),
        toastTop: Math.round(toastRect.top),
        viewport: window.innerHeight,
      };
    });

    expect(verdict.error).toBeUndefined();
    expect(verdict.barHeight).toBeGreaterThan(0);
    // The whole snackbar sits above the bar's top edge. Not "mostly above":
    // one pixel of overlap is a navigation target you cannot press.
    expect(verdict.toastBottom!).toBeLessThanOrEqual(verdict.barTop!);
    // And still on screen, which the naive fix for the above gets wrong.
    expect(verdict.toastTop!).toBeGreaterThan(0);
  });

  test("sits near the bottom on a tier with no bottom bar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await showSnackbar(page);

    const gap = await page.evaluate(() => {
      const toast = document.querySelector<HTMLElement>(
        '[data-testid="snackbar"]',
      );
      if (!toast) return -1;
      return Math.round(
        window.innerHeight - toast.getBoundingClientRect().bottom,
      );
    });

    // Clear of the edge, but not floating in the middle of the page because
    // it kept the phone's clearance on a tier with nothing to clear.
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(80);
  });
});
