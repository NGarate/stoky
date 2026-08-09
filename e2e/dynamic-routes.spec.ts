import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

/**
 * The routes with an id in them.
 *
 * Every other suite here works from a hardcoded list of paths, which is why
 * `/receipts/[id]/review` overflowed to 505px on a 390px phone for as long as it
 * did (ISSUES UI-5): three responsive sweeps ran, and not one of them could name
 * the route, because there was no id to put in it. The same blind spot hid a
 * dead `/products/[id]` from three link audits.
 *
 * So this suite does not take a list. It walks the application the way a person
 * does — open the index, follow the first row — and audits wherever that lands.
 * A route that can be reached by clicking is a route that gets checked.
 *
 * The seed guarantees the rows exist (`prisma/seed.ts` creates two receipts, one
 * needing review and one confirmed). Before it did, this file could not have
 * been written at all.
 */

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

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', "demo@stoky.local");
  await page.fill('input[name="password"]', "Demo1234!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/**
 * Discovers a real id by following a link, rather than reading one out of the
 * database. If the index stops linking to its own detail pages, this fails —
 * which is the other half of what is being checked.
 */
async function firstDetailLink(
  page: Page,
  index: string,
  pattern: RegExp,
): Promise<string> {
  await page.goto(index);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);

  const hrefs = await page.$$eval("a[href]", (anchors) =>
    anchors.map((a) => a.getAttribute("href") ?? ""),
  );
  const found = hrefs.find((href) => pattern.test(href));
  expect(
    found,
    `${index} linked to nothing matching ${pattern}. Either the seed created no rows, ` +
      "or the index stopped linking to its detail pages.",
  ).toBeTruthy();
  return found as string;
}

const DESTINATIONS = [
  {
    name: "receipt review",
    index: "/receipts",
    pattern: /^\/receipts\/[^/]+\/review$/,
  },
  {
    name: "product detail",
    index: "/products",
    pattern: /^\/products\/[^/]+$/,
  },
  {
    name: "price detail",
    index: "/prices",
    pattern: /^\/prices\/[^/]+$/,
  },
];

test.describe("Routes reached by following a link", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const destination of DESTINATIONS) {
    test(`${destination.name} — fits every tier`, async ({ page }) => {
      const href = await firstDetailLink(
        page,
        destination.index,
        destination.pattern,
      );

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(href);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(2500);

        const overflow = await page.evaluate(() => {
          const root = document.documentElement;
          return {
            horizontal: root.scrollWidth - root.clientWidth,
            width: root.scrollWidth,
          };
        });

        // Sideways scrolling is not a cosmetic complaint on a phone: whatever is
        // off the right-hand edge is, in practice, gone. On this route it was
        // the final step of the pipeline, which is what the reader is aiming at.
        expect(
          overflow.horizontal,
          `${href} is ${overflow.width}px wide at ${viewport.width}px (${viewport.name})`,
        ).toBe(0);
      }
    });

    test(`${destination.name} — passes axe at AAA`, async ({ page }) => {
      const href = await firstDetailLink(
        page,
        destination.index,
        destination.pattern,
      );

      // One tier rather than three: the axe rules that vary by width are already
      // covered across all three in accessibility.spec.ts, and the phone is
      // where this application is primarily used.
      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(href);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2500);

      const results = await new AxeBuilder({ page }).withTags(AAA_TAGS).analyze();
      const report = results.violations
        .map(
          (v) =>
            `  [${v.impact}] ${v.id} — ${v.help}\n    ${v.nodes
              .slice(0, 3)
              .map((n) => n.target.join(" "))
              .join("\n    ")}`,
        )
        .join("\n");
      expect(results.violations, `${href}:\n${report}`).toEqual([]);
    });
  }
});
