import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

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
 */

const AAA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag2aaa",
  "wcag21a",
  "wcag21aa",
  "wcag21aaa",
];

const PUBLIC_ROUTES = ["/login", "/register"];

const PRIVATE_ROUTES = [
  "/dashboard",
  "/inventory",
  "/inventory/add",
  "/inventory/consume",
  "/products",
  "/products/new",
  "/receipts",
  "/receipts/upload",
  "/shopping",
  "/prices",
  "/settings",
  "/settings/locations",
  "/settings/stores",
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  // Let the client hydrate: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', "demo@stoky.local");
  await page.fill('input[name="password"]', "Demo1234!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

async function audit(page: Page, route: string, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(route);
  await page.waitForLoadState("domcontentloaded");
  // Data-driven pages render their real content after the tRPC round trip, and
  // auditing the skeleton would pass while telling us nothing.
  await page.waitForTimeout(2500);

  const results = await new AxeBuilder({ page }).withTags(AAA_TAGS).analyze();

  if (results.violations.length > 0) {
    const report = results.violations
      .map((v) => {
        const where = v.nodes
          .slice(0, 3)
          .map((n) => `        ${n.target.join(" ")}`)
          .join("\n");
        return `  [${v.impact}] ${v.id} — ${v.help}\n    ${v.nodes.length} element(s)\n${where}`;
      })
      .join("\n");
    throw new Error(
      `${results.violations.length} accessibility violation(s) on ${route} (${theme}):\n${report}`,
    );
  }

  expect(results.violations).toEqual([]);
}

test.describe("Accessibility (WCAG 2.1 AAA)", () => {
  for (const route of PUBLIC_ROUTES) {
    for (const theme of ["light", "dark"] as const) {
      test(`${route} — ${theme}`, async ({ page }) => {
        await audit(page, route, theme);
      });
    }
  }

  test.describe("signed in", () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
    });

    for (const route of PRIVATE_ROUTES) {
      for (const theme of ["light", "dark"] as const) {
        test(`${route} — ${theme}`, async ({ page }) => {
          await audit(page, route, theme);
        });
      }
    }
  });
});
