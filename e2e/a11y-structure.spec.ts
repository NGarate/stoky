import { type Page, expect, test } from "@playwright/test";

/**
 * The accessibility floor that axe does not measure — DESIGN_AUDIT A4.2–A4.4.
 *
 * **Why this is an E2E suite and not a component test.** All three checks are
 * about the *rendered* page:
 *
 * - A4.2 target size is a measurement in CSS pixels. The component suite runs
 *   against happy-dom, which has no layout engine: every `getBoundingClientRect`
 *   there returns 0×0, so a target-size test in that suite could only assert
 *   that a class name is present. `DashboardNav.test.tsx` already does exactly
 *   that, and it is a proxy for the property, not the property — it cannot see a
 *   44px minimum defeated by a parent's `overflow`, a `line-height`, or a
 *   sibling's `flex-shrink`.
 * - A4.3 is per route, and the heading order of a route is assembled from a
 *   layout, a page and whatever the page's data made it render. Only the real
 *   thing has all three.
 * - A4.4's second half — no state conveyed by colour alone — needs computed
 *   styles of an element *and its peers*, which again means a browser.
 *
 * **Why it is a separate file from `accessibility.spec.ts`.** That suite is the
 * axe gate at 90 checks and is quoted as such in `docs/PROGRESS.md`. These
 * checks come from different criteria, fail for different reasons and are read
 * by whoever is fixing layout rather than whoever is fixing markup, so mixing
 * them would make one number mean two things.
 *
 * Every check reports **the offending selector**, its classes and its measured
 * value. A failure that says "3 elements are too small" is a failure nobody
 * fixes.
 */

/**
 * The three tiers from DESIGN_AUDIT A3.5, with the target-size floor each one
 * has to clear.
 *
 * 44px is WCAG 2.5.5 (AAA). The phone gets 48 because that is the tier where a
 * thumb is expected, which is the distinction A4.2 draws in so many words. The
 * tablet is touched too, but rarely and deliberately — it is propped on a
 * worktop and read from a metre — and its own controls are far larger than the
 * floor anyway (the rail is 76px), so the floor there stays at the AAA minimum
 * rather than being invented upwards.
 */
const TIERS = [
  { name: "phone", width: 390, height: 844, minTarget: 48 },
  { name: "tablet", width: 820, height: 1180, minTarget: 44 },
  { name: "desktop", width: 1280, height: 900, minTarget: 44 },
] as const;

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
  // The applied summary's "not in your household" branch. The success branch
  // needs a receipt that has been through OCR, so it is driven by hand rather
  // than fixtured here; this is the state the route can reach unaided, and it
  // still has a heading, a landmark, controls and onward links to check.
  "/receipts/00000000-0000-0000-0000-000000000000/applied",
  "/shopping",
  "/prices",
  "/settings",
  "/settings/locations",
  "/settings/stores",
];

/** One failed assertion, with enough detail to go and fix it. */
interface Violation {
  rule: string;
  selector: string;
  detail: string;
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  // Let the client hydrate: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', "demo@stoky.local");
  await page.fill('input[name="password"]', "Demo1234!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/**
 * Runs the three structural checks inside the page and returns what failed.
 *
 * It is one `evaluate` rather than three because all three walk the same tree
 * and share the same notions of "visible" and "how do I name this element".
 */
async function collectViolations(
  page: Page,
  minTarget: number,
): Promise<Violation[]> {
  return page.evaluate((minSize: number) => {
    const violations: Array<{
      rule: string;
      selector: string;
      detail: string;
    }> = [];

    /** A path a developer can paste into the console, shortened at the top. */
    function selectorFor(element: Element): string {
      const parts: string[] = [];
      let node: Element | null = element;

      while (node && node !== document.body && parts.length < 4) {
        let part = node.tagName.toLowerCase();
        if (node.id) part += `#${node.id}`;
        const parent: Element | null = node.parentElement;
        if (parent) {
          const index = [...parent.children].indexOf(node) + 1;
          part += `:nth-child(${index})`;
        }
        parts.unshift(part);
        node = parent;
      }

      return (node === document.body ? "body > " : "… ") + parts.join(" > ");
    }

    /** Class list and trimmed text, which is what the selector alone lacks. */
    function describe(element: Element): string {
      const classes = element.getAttribute("class") ?? "";
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      return (
        `class="${classes.length > 160 ? `${classes.slice(0, 160)}…` : classes}"` +
        ` text="${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`
      );
    }

    /**
     * Rendered and in the accessibility tree.
     *
     * `getClientRects().length` rather than `offsetParent`, so `position:fixed`
     * elements — the bottom bar, the rail — are not mistaken for hidden.
     */
    function isVisible(element: Element): boolean {
      if (element.closest('[aria-hidden="true"]')) return false;
      if (element.getClientRects().length === 0) return false;

      const style = getComputedStyle(element);
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        style.opacity !== "0"
      );
    }

    /** Text a screen reader would announce for this element, approximately. */
    function accessibleName(element: Element): string {
      const label = element.getAttribute("aria-label");
      if (label?.trim()) return label.trim();

      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const named = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (named) return named;
      }

      if (element instanceof HTMLInputElement) {
        if (element.type === "submit" || element.type === "button") {
          if (element.value.trim()) return element.value.trim();
        }
        if (element.labels && element.labels.length > 0) {
          const fromLabel = [...element.labels]
            .map((node) => node.textContent ?? "")
            .join(" ")
            .trim();
          if (fromLabel) return fromLabel;
        }
        if (element.placeholder?.trim()) return element.placeholder.trim();
      }

      if (
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) {
        if (element.labels && element.labels.length > 0) {
          const fromLabel = [...element.labels]
            .map((node) => node.textContent ?? "")
            .join(" ")
            .trim();
          if (fromLabel) return fromLabel;
        }
      }

      const text = (element.textContent ?? "").trim();
      if (text) return text;

      const image = element.querySelector("img[alt]");
      const alt = image?.getAttribute("alt")?.trim();
      if (alt) return alt;

      const title = element.getAttribute("title");
      return title?.trim() ?? "";
    }

    const INTERACTIVE = [
      "a[href]",
      "button",
      'input:not([type="hidden"])',
      "select",
      "textarea",
      "summary",
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(", ");

    const controls = [...document.querySelectorAll(INTERACTIVE)].filter(
      (element) => isVisible(element),
    );

    // ---------------------------------------------------------------------
    // A4.2 — target size (WCAG 2.5.5, AAA)
    // ---------------------------------------------------------------------

    /**
     * The "Inline" exception in 2.5.5: a target inside a sentence is sized by
     * the text around it, and stretching it would break the line it lives in.
     *
     * Deliberately narrow — prose only, meaning a paragraph or a heading that
     * also carries text of its own. A link alone in a table cell or a list row
     * is that row's action, not a word in a sentence, and gets no exception
     * however small it happens to be drawn. Widening this to `li` and `td` was
     * tried first and quietly excused most of the product links in the app,
     * which is the failure mode an exception list has.
     */
    function isInlineInText(element: Element): boolean {
      const parent = element.parentElement;
      if (!parent) return false;
      if (!/^(p|h[1-6])$/i.test(parent.tagName)) return false;

      const own = (element.textContent ?? "").trim();
      const around = (parent.textContent ?? "").trim();
      return around.length > own.length;
    }

    /**
     * The "Equivalent" exception in 2.5.5: a control that is not the thing the
     * user aims at, sitting inside one that is.
     *
     * The case in this app is the file input react-dropzone renders at 1×1
     * inside the drop area — the area is focusable, is the size of a card and is
     * measured here like any other target, so the input is not a second one.
     * The ancestor has to actually pass, or hiding a control inside a small box
     * would excuse both.
     */
    function hasEquivalentTarget(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const invisible =
        rect.width < 2 ||
        rect.height < 2 ||
        getComputedStyle(element).opacity === "0";
      if (!invisible) return false;

      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        if (ancestor.matches(INTERACTIVE)) {
          const box = ancestor.getBoundingClientRect();
          return box.width >= minSize && box.height >= minSize;
        }
        ancestor = ancestor.parentElement;
      }

      return false;
    }

    for (const element of controls) {
      if (element.hasAttribute("disabled")) continue;
      if (isInlineInText(element)) continue;
      if (hasEquivalentTarget(element)) continue;

      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);

      if (width < minSize || height < minSize) {
        violations.push({
          rule: `A4.2 target-size (min ${minSize}×${minSize})`,
          selector: selectorFor(element),
          detail: `measured ${width}×${height} — ${describe(element)}`,
        });
      }
    }

    // ---------------------------------------------------------------------
    // A4.3 — headings and landmarks
    // ---------------------------------------------------------------------

    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .filter((element) => isVisible(element))
      .filter((element) => (element.textContent ?? "").trim() !== "");

    const h1s = headings.filter((element) => element.tagName === "H1");

    if (h1s.length !== 1) {
      violations.push({
        rule: "A4.3 exactly one h1",
        selector:
          h1s.length === 0
            ? "(document)"
            : h1s.map((element) => selectorFor(element)).join(" | "),
        detail: `found ${h1s.length} visible h1 element(s)`,
      });
    }

    let previousLevel = 0;
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1));

      if (previousLevel === 0 && level !== 1) {
        violations.push({
          rule: "A4.3 first heading is not h1",
          selector: selectorFor(heading),
          detail: `document starts at h${level} — ${describe(heading)}`,
        });
      } else if (level > previousLevel + 1 && previousLevel !== 0) {
        violations.push({
          rule: "A4.3 skipped heading level",
          selector: selectorFor(heading),
          detail: `h${previousLevel} is followed by h${level} — ${describe(heading)}`,
        });
      }

      previousLevel = level;
    }

    const mains = [...document.querySelectorAll('main, [role="main"]')].filter(
      (element) => isVisible(element),
    );

    if (mains.length !== 1) {
      violations.push({
        rule: "A4.3 exactly one main landmark",
        selector:
          mains.length === 0
            ? "(document)"
            : mains.map((element) => selectorFor(element)).join(" | "),
        detail: `found ${mains.length} visible main landmark(s)`,
      });
    } else if ((mains[0]?.textContent ?? "").trim() === "") {
      violations.push({
        rule: "A4.3 main landmark is empty",
        selector: selectorFor(mains[0] as Element),
        detail: "the main landmark renders no text",
      });
    }

    for (const nav of [...document.querySelectorAll("nav")].filter(isVisible)) {
      if (accessibleName(nav) === "" && !nav.getAttribute("aria-label")) {
        violations.push({
          rule: "A4.3 nav landmark has no accessible name",
          selector: selectorFor(nav),
          detail: describe(nav),
        });
      }
    }

    // ---------------------------------------------------------------------
    // A4.4 — programmatic labels, and no state by colour alone
    // ---------------------------------------------------------------------

    for (const element of controls) {
      if (accessibleName(element) === "") {
        violations.push({
          rule: "A4.4 control has no accessible name",
          selector: selectorFor(element),
          detail: describe(element),
        });
      }
    }

    /**
     * State shown by more than a fill.
     *
     * Any element carrying a state attribute is compared with a peer in the same
     * list or landmark that does not carry it. The two must differ in something
     * other than colour — weight, border width, decoration, outline — because a
     * fill change on its own is invisible to someone who cannot separate the two
     * fills (WCAG 1.4.1).
     */
    const STATEFUL = '[aria-current], [aria-selected="true"], [aria-pressed="true"]';
    const NON_COLOUR: Array<keyof CSSStyleDeclaration & string> = [
      "fontWeight",
      "fontStyle",
      "textDecorationLine",
      "borderTopWidth",
      "borderLeftWidth",
      "borderBottomWidth",
      "borderRightWidth",
      "outlineWidth",
    ];

    for (const element of [...document.querySelectorAll(STATEFUL)].filter(
      isVisible,
    )) {
      if (element.getAttribute("aria-current") === "false") continue;

      const group = element.closest("ul, ol, nav, [role='tablist'], fieldset");
      if (!group) continue;

      const peers = [...group.querySelectorAll(element.tagName)]
        .filter((peer) => peer !== element)
        .filter(isVisible)
        .filter((peer) => !peer.matches(STATEFUL));

      if (peers.length === 0) continue;

      const own = getComputedStyle(element);
      const differs = peers.some((peer) => {
        const other = getComputedStyle(peer);
        return NON_COLOUR.some((property) => own[property] !== other[property]);
      });

      if (!differs) {
        violations.push({
          rule: "A4.4 state conveyed by colour alone",
          selector: selectorFor(element),
          detail:
            "differs from its unselected peers only in colour — " +
            describe(element),
        });
      }
    }

    /**
     * A status colour always has words next to it.
     *
     * Everything painted with a semantic token — ok, warn, danger — has to carry
     * text or an accessible name, so the meaning survives the colour being
     * unavailable.
     *
     * Elements with no height are skipped, because nothing is painted: the empty
     * live regions on `/products/new` are styled in the danger colour and kept
     * mounted so the message is announced when it arrives rather than the whole
     * region arriving at once. An empty one conveys nothing at all, by colour or
     * otherwise.
     */
    const TONE = /\b(text|bg|border)-(ok|warn|danger)(-foreground)?\b/;

    for (const element of [...document.querySelectorAll("[class]")].filter(
      isVisible,
    )) {
      if (!TONE.test(element.getAttribute("class") ?? "")) continue;
      if (element.getBoundingClientRect().height === 0) continue;

      const hasWords =
        (element.textContent ?? "").trim() !== "" ||
        accessibleName(element) !== "";

      if (!hasWords) {
        violations.push({
          rule: "A4.4 status colour with no text",
          selector: selectorFor(element),
          detail: describe(element),
        });
      }
    }

    return violations;
  }, minTarget);
}

/** Runs every tier for one route and reports all of them at once. */
async function auditStructure(page: Page, route: string): Promise<void> {
  const failures: string[] = [];

  for (const tier of TIERS) {
    await page.setViewportSize({ width: tier.width, height: tier.height });
    await page.goto(route);
    await page.waitForLoadState("domcontentloaded");
    // Data-driven pages render their real content after the tRPC round trip,
    // and auditing the skeleton would pass while telling us nothing.
    await page.waitForTimeout(2500);

    const violations = await collectViolations(page, tier.minTarget);

    for (const violation of violations) {
      failures.push(
        `  [${tier.name} ${tier.width}px] ${violation.rule}\n` +
          `      ${violation.selector}\n` +
          `      ${violation.detail}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} structural accessibility violation(s) on ${route}:\n` +
        failures.join("\n"),
    );
  }

  expect(failures).toEqual([]);
}

test.describe("Structural accessibility (DESIGN_AUDIT A4.2–A4.4)", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route}`, async ({ page }) => {
      await auditStructure(page, route);
    });
  }

  test.describe("signed in", () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
    });

    for (const route of PRIVATE_ROUTES) {
      test(`${route}`, async ({ page }) => {
        await auditStructure(page, route);
      });
    }
  });
});
