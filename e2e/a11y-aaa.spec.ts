import { type Page, expect, test } from "@playwright/test";

/**
 * The AAA criteria that no tool checks for you.
 *
 * `accessibility.spec.ts` runs axe, and `a11y-structure.spec.ts` measures target
 * size, heading order and landmarks. Between them they cover what a machine can
 * decide on its own. This file covers the three AAA criteria left over — the
 * ones where the rule is objective but the judgement of *what counts as text*,
 * or *what counts as a descriptive name*, has to be encoded by hand:
 *
 * - **1.4.8 visual presentation** — a block of text must be under 80 characters
 *   wide, be at least 1.5-spaced, and not be justified.
 * - **2.4.9 link purpose (link only)** — a link's accessible name must say where
 *   it goes without the reader consulting the sentence, row or card around it.
 *   "Ver" and "→" fail; "Ver detalles de Leche entera" passes.
 * - **3.3.5 help** — every field a person has to fill in must carry help beyond
 *   its label, and that help must be attached to the field rather than merely
 *   sitting next to it.
 * - **2.3.3 animation from interactions** — with `prefers-reduced-motion: reduce`
 *   set, nothing may still be moving.
 *
 * These are deliberately encoded as measurements rather than as a checklist a
 * human ticks, because the checklist version of this audit has been run three
 * times in this project and missed something each time.
 */

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
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', "demo@stoky.local");
  await page.fill('input[name="password"]', "Demo1234!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

async function settle(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
}

/* ------------------------------------------------------------------ 1.4.8 -- */

/**
 * A "block of text" in 1.4.8's sense is prose — more than one sentence. A label,
 * a table cell and a button are not blocks of text, and holding them to an 80
 * character measure would produce noise rather than findings, so the threshold
 * below is what separates the two. It is a judgement call, and it is written
 * down here rather than left implicit in a regex.
 */
const PROSE_MIN_CHARS = 120;

interface TextBlock {
  text: string;
  selector: string;
  charsPerLine: number;
  lineHeightRatio: number;
  align: string;
}

async function textBlocks(page: Page): Promise<TextBlock[]> {
  return page.evaluate((minChars) => {
    function cssPath(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && parts.length < 4) {
        const cls = (node.className || "").toString().trim().split(/\s+/)[0];
        parts.unshift(node.tagName.toLowerCase() + (cls ? `.${cls}` : ""));
        node = node.parentElement;
      }
      return parts.join(" > ");
    }

    const out: TextBlock[] = [];
    for (const el of document.querySelectorAll("p, li, dd, blockquote")) {
      // Own text only: a wrapper that happens to contain prose is not itself
      // the block, and counting it would report the same finding twice.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (own.length < minChars) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      const style = getComputedStyle(el);
      const fontSize = Number.parseFloat(style.fontSize);
      const lineHeight =
        style.lineHeight === "normal"
          ? fontSize * 1.2
          : Number.parseFloat(style.lineHeight);

      // 0.5em is the conventional stand-in for average character width, which
      // is what the "80 characters" in 1.4.8 has to be measured against when the
      // font is proportional.
      out.push({
        text: own.slice(0, 60),
        selector: cssPath(el),
        charsPerLine: Math.round(rect.width / (fontSize * 0.5)),
        lineHeightRatio: Number((lineHeight / fontSize).toFixed(2)),
        align: style.textAlign,
      });
    }
    return out;
  }, PROSE_MIN_CHARS);
}

/* ------------------------------------------------------------------ 2.4.9 -- */

/**
 * Names that describe the gesture rather than the destination. Matched whole,
 * case-insensitively, after stripping punctuation — "Ver" fails, "Ver ticket"
 * does not.
 */
const NON_DESCRIPTIVE = new Set([
  "ver",
  "view",
  "más",
  "mas",
  "more",
  "leer más",
  "read more",
  "aquí",
  "aqui",
  "here",
  "click",
  "clic",
  "abrir",
  "open",
  "detalles",
  "details",
  "ir",
  "go",
  "→",
  "->",
  "»",
  ">",
  "…",
  "...",
]);

interface LinkName {
  name: string;
  href: string;
  selector: string;
}

async function nonDescriptiveLinks(page: Page): Promise<LinkName[]> {
  const links = await page.evaluate(() => {
    function cssPath(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && parts.length < 4) {
        const cls = (node.className || "").toString().trim().split(/\s+/)[0];
        parts.unshift(node.tagName.toLowerCase() + (cls ? `.${cls}` : ""));
        node = node.parentElement;
      }
      return parts.join(" > ");
    }
    return [...document.querySelectorAll("a[href]")]
      .filter((a) => a.getBoundingClientRect().width > 0)
      .map((a) => ({
        // aria-label wins, exactly as it does for an assistive technology, so a
        // terse visible label with a full aria-label is a pass and not a
        // finding — that is the intended remedy, not a loophole.
        name: (a.getAttribute("aria-label") ?? a.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        href: a.getAttribute("href") ?? "",
        selector: cssPath(a),
      }));
  });

  return links.filter((l) => {
    const bare = l.name
      .toLowerCase()
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    return bare.length === 0 || NON_DESCRIPTIVE.has(bare);
  });
}

/* ------------------------------------------------------------------ 3.3.5 -- */

/**
 * 3.3.5 asks that help be *available*, and its wording stops short of requiring
 * that help to be programmatically attached. This check requires the attachment
 * anyway.
 *
 * The reason is the product's own premise: Stoky is meant to be usable by
 * someone with limited technical confidence, and a hint that exists only as text
 * positioned underneath an input is help for sighted mouse users and for nobody
 * else. A screen reader announces the label and moves on. `aria-describedby`
 * costs one attribute and makes the same help real for everyone.
 *
 * Scoped to fields inside a `<form>`, which is where the criterion's "requires
 * user input" actually lands. A language selector and a filter box are controls
 * that change the view rather than information a person is being asked to
 * supply, and demanding a sentence of help for "Buscar" would produce padding
 * dressed as accessibility. That boundary is a judgement, so it is written here
 * rather than left as an unexplained selector.
 *
 * A field with no name at all is reported by `unnamedFields` instead, so that
 * the two failures never arrive as one.
 */
interface FieldFindings {
  /** In a form, named, but with no help attached. */
  unhelped: string[];
  /**
   * No accessible name, or none beyond a placeholder.
   *
   * Reported separately so the two never arrive as one finding, and kept here
   * rather than left to axe because axe accepts a placeholder as a name. It is
   * still wrong: the placeholder disappears the moment someone types, taking
   * the name away from exactly the person who most needs it, and from anyone
   * returning to a half-filled form.
   */
  unnamed: string[];
}

async function fieldFindings(page: Page): Promise<FieldFindings> {
  return page.evaluate(() => {
    const FIELDS =
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select";

    /** The name an assistive technology would speak, in precedence order. */
    function accessibleName(el: Element): string {
      const labelledBy = (el.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
      if (labelledBy) return labelledBy;

      const ariaLabel = (el.getAttribute("aria-label") ?? "").trim();
      if (ariaLabel) return ariaLabel;

      const forLabel = el.id
        ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent
        : null;
      if (forLabel?.trim()) return forLabel.trim();

      return el.closest("label")?.textContent?.trim() ?? "";
    }

    function describe(el: Element): string {
      return `${el.tagName.toLowerCase()}[name=${el.getAttribute("name") ?? "?"}]`;
    }

    /** "auth.emailHint" — dotted, no spaces, camelCase segments. */
    function isKey(text: string): boolean {
      return /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(text);
    }

    const unhelped: string[] = [];
    const unnamed: string[] = [];

    for (const el of document.querySelectorAll<HTMLElement>(FIELDS)) {
      if (el.getBoundingClientRect().width === 0) continue;

      const name = accessibleName(el);
      if (name === "") {
        const placeholder = el.getAttribute("placeholder") ?? "";
        unnamed.push(
          `${describe(el)} — ${
            placeholder
              ? `named only by its placeholder, "${placeholder}"`
              : "no accessible name at all"
          }`,
        );
        continue;
      }

      // A string like "auth.emailHint" is a translation key that reached the
      // page instead of its translation. next-intl renders the key rather than
      // throwing, so nothing else notices, and what a screen reader reads out
      // is source code. Applied to names and to help text alike: adding five
      // hints that all rendered as their own keys is what put this here.
      if (isKey(name)) {
        unnamed.push(`${describe(el)} — untranslated key as its name, "${name}"`);
        continue;
      }

      if (!el.closest("form")) continue;
      if (el.getAttribute("type") === "search") continue;

      const describedBy = (el.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      if (isKey(describedBy)) {
        unnamed.push(
          `${describe(el)} — untranslated key as its help, "${describedBy}"`,
        );
        continue;
      }
      if (describedBy.length > 0) continue;

      unhelped.push(`${describe(el)} — "${name}"`);
    }

    return { unhelped, unnamed };
  });
}

/* ------------------------------------------------------------------- test -- */

function report(route: string, criterion: string, lines: string[]): string {
  return `${lines.length} ${criterion} finding(s) on ${route}:\n${lines.join("\n")}`;
}

test.describe("WCAG AAA criteria that axe does not cover", () => {
  test.describe("public", () => {
    for (const route of PUBLIC_ROUTES) {
      test(`${route} — 1.4.8, 2.4.9, 3.3.5`, async ({ page }) => {
        await settle(page, route);
        await assertPresentationAndLinks(page, route);
      });
    }
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
    });

    for (const route of PRIVATE_ROUTES) {
      test(`${route} — 1.4.8, 2.4.9, 3.3.5`, async ({ page }) => {
        await settle(page, route);
        await assertPresentationAndLinks(page, route);
      });
    }

    test("2.3.3 — nothing moves when reduced motion is requested", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });

      // The routes that actually animate: the two with pulsing skeletons and the
      // one with a spinner. A route with no animation cannot fail this, so the
      // sweep is scoped to where the risk is rather than padded out to look
      // thorough.
      for (const route of ["/inventory", "/products", "/products/scan"]) {
        await settle(page, route);
        const moving = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of document.querySelectorAll("*")) {
            const s = getComputedStyle(el);
            const durations = [s.animationDuration, s.transitionDuration]
              .join(",")
              .split(",")
              .map((d) => Number.parseFloat(d) * (d.includes("ms") ? 1 : 1000))
              .filter((n) => Number.isFinite(n));
            if (durations.some((d) => d > 1)) {
              out.push(
                `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(/\s+/)[0]} — ${s.animationDuration} / ${s.transitionDuration}`,
              );
            }
          }
          return [...new Set(out)];
        });
        expect(
          moving,
          `${route} still animates under prefers-reduced-motion: reduce`,
        ).toEqual([]);
      }
    });
  });
});

async function assertPresentationAndLinks(page: Page, route: string) {
  // 1.4.8 is about reading a block of text, so it is measured at the width where
  // a line is longest. The phone tier cannot fail the 80-character half of it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);

  const blocks = await textBlocks(page);
  const tooWide = blocks.filter((b) => b.charsPerLine > 80);
  const tooTight = blocks.filter((b) => b.lineHeightRatio < 1.5);
  const justified = blocks.filter((b) => b.align === "justify");

  const presentation = [
    ...tooWide.map(
      (b) => `  [width] ${b.charsPerLine} chars — ${b.selector}\n      "${b.text}…"`,
    ),
    ...tooTight.map(
      (b) => `  [leading] ${b.lineHeightRatio} — ${b.selector}\n      "${b.text}…"`,
    ),
    ...justified.map((b) => `  [justified] ${b.selector}`),
  ];
  expect(presentation, report(route, "1.4.8", presentation)).toEqual([]);

  const vague = await nonDescriptiveLinks(page);
  const linkFindings = vague.map(
    (l) => `  "${l.name || "(no accessible name)"}" → ${l.href}\n      ${l.selector}`,
  );
  expect(linkFindings, report(route, "2.4.9", linkFindings)).toEqual([]);

  const fields = await fieldFindings(page);
  const unnamed = fields.unnamed.map((f) => `  ${f}`);
  expect(unnamed, report(route, "field naming", unnamed)).toEqual([]);

  const unhelped = fields.unhelped.map((f) => `  ${f}`);
  expect(unhelped, report(route, "3.3.5", unhelped)).toEqual([]);
}
