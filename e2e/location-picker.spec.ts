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
}

/** The text of the option `aria-activedescendant` currently points at. */
async function activeOptionText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const id = document
      .querySelector('[role="combobox"]')
      ?.getAttribute("aria-activedescendant");
    const option = id ? document.getElementById(id) : null;
    return option ? (option.textContent ?? "").replace(/\s+/g, " ").trim() : null;
  });
}

test.describe("LocationPicker on /inventory/add", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAddStock(page);
  });

  test("offers the seeded child locations, named after their parent", async ({
    page,
  }) => {
    await page.locator('[role="combobox"]').focus();
    await page.keyboard.press("ArrowDown");

    const options = page.locator('[role="listbox"] [role="option"]');
    await expect(options.first()).toBeVisible();

    const names = await options.evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()),
    );

    // The seed nests Despensa and Nevera under Cocina. Before UI-2 was fixed
    // the picker offered the two roots only.
    expect(names).toContain("Cocina → Despensa (5)");
    expect(names).toContain("Cocina → Nevera (3)");
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

  test("a nested location can be chosen with the keyboard alone", async ({
    page,
  }) => {
    const trigger = page.locator('[role="combobox"]');
    await trigger.focus();
    await page.keyboard.press("ArrowDown");

    let reached = false;
    for (let step = 0; step < 12; step++) {
      const active = await activeOptionText(page);
      if (active?.includes("Nevera")) {
        reached = true;
        break;
      }
      await page.keyboard.press("ArrowDown");
    }

    expect(reached).toBe(true);
    await page.keyboard.press("Enter");

    await expect(page.locator('[role="listbox"]')).toHaveCount(0);
    await expect(trigger).toHaveText(/Cocina → Nevera/);
  });

  test("Escape dismisses the panel and leaves focus on the trigger", async ({
    page,
  }) => {
    const trigger = page.locator('[role="combobox"]');
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[role="listbox"]')).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.locator('[role="listbox"]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("a click on the scrim closes it and hands focus back", async ({
    page,
  }) => {
    const trigger = page.locator('[role="combobox"]');
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[role="listbox"]')).toBeVisible();

    // Only a browser proves this one: pressing on a scrim that nothing can
    // focus takes focus off the trigger, so closing has to put it back or the
    // keyboard user is left at the top of the document. happy-dom does not
    // move focus on a click at all, so the component suite cannot see it.
    await page.mouse.click(10, 10);

    await expect(page.locator('[role="listbox"]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("opening the picker adds nothing to the tab order", async ({ page }) => {
    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
      ' select:not([disabled]), textarea:not([disabled]),' +
      ' [tabindex]:not([tabindex="-1"]), [role="button"]';

    const countFocusable = () =>
      page.evaluate((selector) => document.querySelectorAll(selector).length, FOCUSABLE);

    const closed = await countFocusable();

    const trigger = page.locator('[role="combobox"]');
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[role="listbox"]')).toBeVisible();

    // The scrim used to be a `div` with `role="button"` and `tabIndex={0}`,
    // which is an invisible "Close dropdown" control sitting right after the
    // trigger. Tab from the trigger has to leave the picker entirely.
    expect(await countFocusable()).toBe(closed);

    await page.keyboard.press("Tab");
    await expect(trigger).not.toBeFocused();
  });

  test("every option is on screen, not behind the bottom bar", async ({ page }) => {
    // A phone, because that is the only tier with a fixed bottom bar and the
    // only one where the picker is the last field of a long form.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await settle(page);

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
    expect(verdict.panelBottom, where).toBeLessThanOrEqual((verdict.floor ?? 0) + 1);
    expect(verdict.panelTop, where).toBeGreaterThanOrEqual(-1);
    expect(verdict.firstRowVisible, where).toBe(true);
  });
});
