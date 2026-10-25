import { type Page, expect, test } from "@playwright/test";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";

test.use({ storageState: SESSION_FILE });

// Every test opens the same form and drives the same closed picker; none of them
// writes, so they are independent of each other and of their order.
test.describe.configure({ mode: "parallel" });

/**
 * The LocationPicker, driven the way a keyboard user drives it — UI-2 and UI-4.
 *
 * **Why this is E2E and not a component test.** Two of the three checks below
 * cannot be made honestly against happy-dom:
 *
 * - The target size of an option is a measurement in CSS pixels, and happy-dom
 *   has no layout engine — every rect there is 0×0 (`docs/PROGRESS.md` D16). A
 *   component test can assert `min-h-[48px]` is in the class list, which is a
 *   proxy for the property and cannot see the floor defeated by a parent's
 *   `overflow` or a sibling's `flex-shrink`.
 * - "The picker adds nothing to the tab order" is about what a real browser
 *   considers focusable, which is decided by layout and computed styles as much
 *   as by attributes.
 *
 * The keyboard behaviour itself is asserted in the component suite, where it is
 * fast and where every branch is reachable; it is repeated here only as far as
 * is needed to reach the state being measured.
 */

/** WCAG 2.5.5 AAA is 44; the project floor is 48 everywhere (D17). */
const MIN_TARGET = 48;

async function gotoAddStock(page: Page): Promise<void> {
  await page.goto("/inventory/add");
  // The locations arrive over tRPC; the picker is a loading box until they do.
  // `settle` waits for exactly that and no longer — the flat pause it replaces
  // was paid in full on every one of these tests whether or not it was needed,
  // and it could not be lengthened for a loaded server without lengthening it
  // for an idle one.
  await settle(page);
  await openAdvanced(page);
}

/**
 * Since Phase 8 item 3 the picker lives in the folded half of the form —
 * opened the way a person opens it, through the summary. Retried, because a
 * click that lands before hydration can be undone when React recreates the
 * subtree: open-if-closed is idempotent where a bare click is a coin toss.
 * Needed again after any reload, which folds the form shut.
 */
async function openAdvanced(page: Page): Promise<void> {
  await expect(async () => {
    if (!(await page.locator('[role="combobox"]').isVisible())) {
      await page.click("details > summary");
    }
    await expect(page.locator('[role="combobox"]')).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 15_000 });
}

/**
 * What is left here after the rest moved down a tier.
 *
 * The picker's *contract* — a combobox paired with a listbox, ArrowDown to
 * open, Up/Down/Home/End to move, Enter and Space to choose, Escape to dismiss
 * with focus returned, no second tab stop while open, a click outside that
 * chooses nothing — is a set of facts about the DOM, and
 * `src/__tests__/components/LocationPicker.test.tsx` answers all of them in
 * milliseconds against the real component. Asking the same questions of a real
 * browser cost five tests on five projects, twenty-five page loads, and told us
 * nothing the rendered tier had not already.
 *
 * These two stay because neither is answerable there. happy-dom has no layout
 * engine — every rectangle in it is 0×0 — so a target's composed size and
 * whether a fixed bar is painted on top of an option are questions only a real
 * viewport can settle. The second one is not hypothetical: it is UI-6, a picker
 * whose options opened underneath the bottom navigation bar.
 */
test.describe("LocationPicker on /inventory/add", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAddStock(page);
  });

  test("every option is at least a 48px target", async ({ page }) => {
    await page.locator('[role="combobox"]').focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[role="listbox"]')).toBeVisible();

    const boxes = await page
      .locator('[role="listbox"] [role="option"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            name: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }),
      );

    expect(boxes.length).toBeGreaterThan(0);

    const tooSmall = boxes.filter(
      (box) => box.width < MIN_TARGET || box.height < MIN_TARGET,
    );

    // Named, not counted: "2 options are too small" is a failure nobody fixes.
    expect(
      tooSmall.map((box) => `${box.name} measured ${box.width}×${box.height}`),
    ).toEqual([]);
  });

  test("every option is on screen, not behind the bottom bar", async ({
    page,
  }) => {
    // A phone, because that is the only tier with a fixed bottom bar and the
    // only one where the picker is the last field of a long form.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await settle(page);
    // The reload folded the form shut again.
    await openAdvanced(page);

    const trigger = page.locator('[role="combobox"]');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[role="listbox"]')).toBeVisible();

    const verdict = await page.evaluate(() => {
      const listbox = document.querySelector('[role="listbox"]');
      if (!listbox) return { error: "no listbox" };
      const bar = document.querySelector<HTMLElement>("[data-fixed-bottom]");
      const floor = bar?.getBoundingClientRect().top ?? window.innerHeight;

      const panel = listbox.getBoundingClientRect();
      return {
        placement: listbox.getAttribute("data-placement"),
        panelTop: Math.round(panel.top),
        panelBottom: Math.round(panel.bottom),
        floor: Math.round(floor),
        // A panel this short has to scroll, and that is fine: a row you can
        // reach by scrolling the list is reachable. A row drawn under the
        // navigation bar is not.
        scrollable: listbox.scrollHeight > listbox.clientHeight + 1,
        firstRowVisible: (() => {
          const first = document.querySelector('[role="option"]');
          if (!first) return false;
          const r = first.getBoundingClientRect();
          return r.height > 0 && r.bottom <= floor + 1 && r.top >= -1;
        })(),
      };
    });

    // Before this, the last option ended at 892px on an 844px viewport with the
    // bar starting at 780px, and the screenshot showed no option at all.
    const where = JSON.stringify(verdict);
    expect(verdict.panelBottom, where).toBeLessThanOrEqual(
      (verdict.floor ?? 0) + 1,
    );
    expect(verdict.panelTop, where).toBeGreaterThanOrEqual(-1);
    expect(verdict.firstRowVisible, where).toBe(true);
  });
});
