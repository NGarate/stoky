import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";

test.use({ storageState: SESSION_FILE });

// Each test discovers its own id by following a link and audits what it lands
// on. Nothing is written and nothing is shared, so they can run anywhere.
test.describe.configure({ mode: "parallel" });

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
  await settle(page);

  // Waited for rather than sampled once. The list arrives over tRPC, so reading
  // the anchors the instant the page settles asks the question before the answer
  // exists — which under a loaded dev server is most of the time, and which
  // fails as "the index stopped linking to its detail pages" when the index is
  // merely slow. The assertion below is unchanged; only its patience is.
  const found = await page
    .waitForFunction(
      (source: string) => {
        const wanted = new RegExp(source);
        return (
          [...document.querySelectorAll("a[href]")]
            .map((a) => a.getAttribute("href") ?? "")
            .find((href) => wanted.test(href)) ?? null
        );
      },
      pattern.source,
      { timeout: 15_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);

  expect(
    found,
    `${index} linked to nothing matching ${pattern}. Either the seed created no rows, ` +
      "or the index stopped linking to its detail pages.",
  ).toBeTruthy();
  return found as string;
}

interface Destination {
  name: string;
  index: string;
  pattern: RegExp;
  /** Followed from the index first, when the target is two links deep. */
  via?: RegExp;
}

const DESTINATIONS: Destination[] = [
  {
    name: "receipt review",
    index: "/receipts",
    pattern: /^\/receipts\/[^/]+\/review$/,
  },
  {
    // `(?!new$|scan$)`: /products also links its two static children, and they
    // sit first in document order — without the exclusion, "product detail"
    // resolved to /products/scan and this file audited the scanner under a
    // product's name. Found when the edit hop below inherited the pattern and
    // asked /products/scan for an edit link it could never have.
    name: "product detail",
    index: "/products",
    pattern: /^\/products\/(?!new$|scan$)[^/]+$/,
  },
  {
    name: "product edit",
    index: "/products",
    via: /^\/products\/(?!new$|scan$)[^/]+$/,
    pattern: /^\/products\/[^/]+\/edit$/,
  },
  {
    name: "price detail",
    index: "/prices",
    pattern: /^\/prices\/[^/]+$/,
  },
];

/**
 * Resolves a destination's href, following the `via` hop when it has one —
 * the edit screen is linked from the product's page, not from the index, and
 * discovering it the way a person does is the point of this file.
 */
async function resolveHref(page: Page, destination: Destination): Promise<string> {
  const first = await firstDetailLink(
    page,
    destination.index,
    destination.via ?? destination.pattern,
  );
  if (!destination.via) return first;
  return firstDetailLink(page, first, destination.pattern);
}

test.describe("Routes reached by following a link", () => {
  for (const destination of DESTINATIONS) {
    test(`${destination.name} — fits every tier`, async ({ page }) => {
      const href = await resolveHref(page, destination);

      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(href);
      await settle(page);

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        // The reflow lands on the next frame, and anything that measures itself
        // reacts on the one after. Nothing is reloaded between tiers: a tier is a
        // width, the stylesheet resolves it in the browser, and the three
        // reloads this replaces asked the same question of the same page.
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(null)),
              );
            }),
        );

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
      const href = await resolveHref(page, destination);

      // One tier rather than three: the axe rules that vary by width are already
      // covered across all three in accessibility.spec.ts, and the phone is
      // where this application is primarily used.
      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(href);
      await settle(page);

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
