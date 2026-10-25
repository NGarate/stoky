import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import type { Result } from "axe-core";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";

/**
 * Independent of each other: every test here opens a route, reads it and writes
 * nothing, so which worker runs which one cannot change the answer. Worth saying
 * because this is the longest file in the suite — left in one worker it is the
 * critical path on its own, and the run is only as short as it is.
 */
test.describe.configure({ mode: "parallel" });

/**
 * Automated accessibility audit.
 *
 * The target is **WCAG 2.1 AAA**, decided deliberately: Stoky's premise is that
 * anyone in a household can use it, including people with limited technical
 * confidence, so the accessibility bar is a product requirement rather than a
 * compliance exercise.
 *
 * Two honest caveats, stated here so a green run is not over-read:
 *
 * 1. Automated testing catches roughly a third of real accessibility problems.
 *    This is a floor that stops regressions, not a certificate. A screen-reader
 *    pass on each primary journey is still owed.
 * 2. Some AAA criteria cannot be machine-checked at all — 1.4.8 visual
 *    presentation, 2.4.9 link purpose from the link alone, 3.3.5 help. Those are
 *    tracked in `docs/DESIGN_AUDIT.md` and reviewed by hand.
 *
 * Every route is checked in both themes, because a contrast failure that only
 * exists in dark mode is still a contrast failure — and this project has
 * already shipped one.
 *
 * And at all three viewport tiers, because the navigation is a different
 * component at each: a bottom bar on a phone, a rail on a tablet, a top bar on
 * a desktop. Auditing only the desktop width left two of the three renderers
 * machine-unchecked, which is how this suite was written until the compact
 * tiers existed.
 *
 * Six combinations per route, and **one page load for all six**. Theme is a
 * media emulation and tier is a viewport size; neither is a navigation, and
 * neither needs one — the stylesheet resolves `prefers-color-scheme` and the
 * breakpoints in the browser. Reloading for each pair made this file 90 loads
 * instead of 16, which was most of its runtime and none of its coverage. The
 * route, the theme and the tier are still named in the failure, and all six are
 * collected before it throws so the first one does not hide the other five.
 */

/** The three tiers from docs/DESIGN_AUDIT.md A3.5, chosen by viewing distance. */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

const AAA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag2aaa",
  "wcag21a",
  "wcag21aa",
  "wcag21aaa",
];

const PUBLIC_ROUTES = ["/login", "/register", "/offline"];

const PRIVATE_ROUTES = [
  "/kitchen",
  "/settings/people",
  "/settings/security",
  "/settings/unsaved",
  "/dashboard",
  "/inventory",
  "/inventory/add",
  "/inventory/consume",
  "/products",
  "/products/new",
  "/receipts",
  "/receipts/upload",
  "/shopping",
  "/shopping/lists",
  "/prices",
  "/settings",
  "/settings/locations",
  "/settings/stores",
];

/**
 * Let the page finish reacting to a theme or viewport change.
 *
 * Two frames, because a resize lands in the next one and anything that measures
 * itself — the charts, the picker's placement — reacts in the one after. Then a
 * flat pause, because the tokens are animated: axe reads computed styles, and a
 * colour sampled mid-transition is neither the light value nor the dark one, so
 * a contrast result taken too early is a coin toss rather than a finding.
 */
async function reflow(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
      }),
  );
  await page.waitForTimeout(250);
}

function describeViolations(violations: Result[]): string {
  return violations
    .map((v) => {
      const where = v.nodes
        .slice(0, 3)
        .map((n) => `        ${n.target.join(" ")}`)
        .join("\n");
      return `  [${v.impact}] ${v.id} — ${v.help}\n    ${v.nodes.length} element(s)\n${where}`;
    })
    .join("\n");
}

/** Audits one route under every theme and tier, from a single page load. */
async function audit(page: Page, route: string): Promise<void> {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(route);
  // Data-driven pages render their real content after the tRPC round trip, and
  // auditing the skeleton would pass while telling us nothing.
  await settle(page);

  const failures: string[] = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await reflow(page);

      const results = await new AxeBuilder({ page })
        .withTags(AAA_TAGS)
        .analyze();
      if (results.violations.length === 0) continue;

      failures.push(
        `${results.violations.length} accessibility violation(s) on ${route} ` +
          `(${theme}, ${vp.name}, ${vp.width}px):\n` +
          describeViolations(results.violations),
      );
    }
  }

  if (failures.length > 0) throw new Error(failures.join("\n\n"));

  expect(failures).toEqual([]);
}

test.describe("Accessibility (WCAG 2.1 AAA)", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route}`, async ({ page }) => {
      await audit(page, route);
    });
  }

  test.describe("signed in", () => {
    test.use({ storageState: SESSION_FILE });

    for (const route of PRIVATE_ROUTES) {
      test(`${route}`, async ({ page }) => {
        await audit(page, route);
      });
    }
  });
});
