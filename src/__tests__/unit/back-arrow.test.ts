import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The back arrow is drawn once, by the component that owns it.
 *
 * `BackLink` renders an `aria-hidden` `<ArrowLeft/>`, and eight catalogue
 * entries used to open with a literal "← ". Commit 550fb10 stripped them and
 * `messages.test.ts` has guarded the catalogues ever since.
 *
 * It guarded the wrong half. The last typed arrow in this application was not
 * in a catalogue at all — it was in JSX, on `/settings/locations`:
 *
 *     <Link href="/settings"> ← Volver a configuración </Link>
 *
 * A hardcoded Spanish string in a file nothing scanned, so the catalogue sweep
 * could not reach it, the parity test could not see it, and `tsc` has no
 * opinion about the contents of a text node. It survived the fix by three
 * weeks and was found by looking at the screen.
 *
 * Two arrows side by side is the visible half of the defect. The half a
 * sighted reader never notices is that a typed arrow is part of the accessible
 * name: "flecha hacia la izquierda volver a configuración" is exactly the
 * noise `aria-hidden` exists to prevent (WCAG 2.4.9, DESIGN_AUDIT §4). A
 * right-to-left locale would also need the glyph flipped in every string
 * rather than once in a stylesheet.
 *
 * **Only `←`, and deliberately only `←`.** The wider set `messages.test.ts`
 * bans from the catalogue — `→ ✓ ✕` and friends — has legitimate uses in
 * markup that this project already relies on: `LocationPicker` joins ancestors
 * with " → " because a breadcrumb is a value rather than decoration, the shop
 * screen ticks a bought item, and the snackbar draws its own dismiss. A gate
 * that needs three exemptions on the day it is written is a gate nobody will
 * trust on the day it fires. The left arrow has no such use: it means "back",
 * and `BackLink` is the only thing that may say so.
 */

const SRC = join(import.meta.dir, "../..");

/** Every `.ts`/`.tsx` under `src`, excluding this suite. */
function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

/**
 * Source with its comments removed.
 *
 * Necessary, and `list-semantics.test.ts` found out the hard way why: the
 * docblock in `back-link.tsx` explains the defect by quoting `"← "`, so a scan
 * that reads prose as markup would report the explanation as the violation and
 * then be silenced — leaving nothing watching the real thing.
 */
function markupOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  markup: markupOnly(readFileSync(path, "utf8")),
}));

/** Every way of typing a left arrow that a text node would render as one. */
const TYPED_BACK_ARROW = /←|⟵|⬅|&larr;|&#8592;|\\u2190/;

describe("the back arrow belongs to BackLink", () => {
  test("no source file types one", () => {
    const offenders = files
      .filter((file) => TYPED_BACK_ARROW.test(file.markup))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  test("it scanned something, and something with markup in it", () => {
    // A scan that silently walks nothing is the failure mode this whole file
    // exists to prevent, so it is asserted rather than assumed.
    expect(files.length).toBeGreaterThan(100);
    expect(
      files.some((file) => file.path === "components/ui/back-link.tsx"),
    ).toBe(true);
  });

  test("would notice one", () => {
    // The exact line that shipped, and the line that replaced it.
    expect(
      TYPED_BACK_ARROW.test(
        '<Link href="/settings" > ← Volver a configuración </Link>',
      ),
    ).toBe(true);
    expect(
      TYPED_BACK_ARROW.test(
        '<BackLink href="/settings">{t("backToSettings")}</BackLink>',
      ),
    ).toBe(false);
  });

  test("does not read a comment as markup", () => {
    const explaining = [
      "/**",
      ' * Four catalogue entries still carry a literal "← " today.',
      " */",
      'export const x = "fine";',
    ].join("\n");

    expect(TYPED_BACK_ARROW.test(explaining)).toBe(true);
    expect(TYPED_BACK_ARROW.test(markupOnly(explaining))).toBe(false);
  });

  /**
   * The glyphs this gate deliberately does not ban, with the callers that use
   * them. If one of these stops being true the exemption should be revisited,
   * which is what this asserts.
   */
  test("leaves the glyphs that are values rather than decoration", () => {
    const breadcrumb = 'option.ancestors.join(" → ")';

    expect(TYPED_BACK_ARROW.test(breadcrumb)).toBe(false);
    expect(
      files.some((file) => file.path === "components/inventory/LocationPicker.tsx"),
    ).toBe(true);
  });
});

/**
 * And the way back itself belongs to `BackLink`, not to a hand-rolled link.
 *
 * The arrow scan above catches a *typed* arrow. It cannot catch the other half
 * of the same defect, which is what the four screens converted alongside it
 * actually had: a way back built out of `<Button asChild><Link>` with no arrow
 * at all. Twelve sub-pages drew one control and five drew three others, so
 * "Volver al producto" was an underlined link here, an outlined button there,
 * and on `/receipts/[id]/review` an icon with no words — named by `aria-label`
 * alone, which satisfies WCAG 2.4.4 and not 2.4.9, the level this project is
 * held to elsewhere.
 *
 * The scan is on the message key rather than on the words, so it keeps working
 * in both catalogues and through a rewording. It has no exemption list, and
 * that is deliberate: the moment one is needed, the rule has stopped being
 * true and should be argued with rather than annotated.
 *
 * Note what it does *not* claim. A link that happens to point at the same
 * place as the way back is not a way back — `/products/[id]/adjust` ends its
 * form with a "Cancelar" beside the submit, going to the same product — and
 * this passes it, because it asks about the phrase the screen uses to mean
 * "back", not about the href.
 */
const BACK_KEY = /\b(?:backTo[A-Z]\w*|common\.back)\b/;

/** `<Tag …>…</Tag>` pairs, non-greedy, for the two tags that matter here. */
const LINK_ELEMENT = /<(BackLink|Link)\b([^>]*)>([\s\S]*?)<\/\1>/g;

describe("the way back belongs to BackLink", () => {
  test("no hand-rolled link carries a back message", () => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const match of file.markup.matchAll(LINK_ELEMENT)) {
        const [, tag, attributes, body] = match;
        if (tag === "BackLink") continue;
        if (BACK_KEY.test(`${attributes} ${body}`)) {
          offenders.push(`${file.path}: <Link>${body.trim().slice(0, 40)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("would notice each shape that shipped", () => {
    const asButton =
      '<Button asChild variant="link"><Link href="/products" > {t("backToProduct")} </Link></Button>';
    const asIcon =
      '<Link aria-label={t("backToList")} href="/receipts"><ArrowLeft /></Link>';

    for (const source of [asButton, asIcon]) {
      const found = [...source.matchAll(LINK_ELEMENT)].filter(
        ([, tag, attributes, body]) =>
          tag !== "BackLink" && BACK_KEY.test(`${attributes} ${body}`),
      );
      expect(found.length, source).toBe(1);
    }
  });

  test("passes the component that is allowed to carry it", () => {
    const correct = '<BackLink href="/products">{t("backToProduct")}</BackLink>';
    const found = [...correct.matchAll(LINK_ELEMENT)].filter(
      ([, tag, attributes, body]) =>
        tag !== "BackLink" && BACK_KEY.test(`${attributes} ${body}`),
    );

    expect(found).toEqual([]);
  });

  test("does not mistake a same-destination action for a way back", () => {
    // The adjust form's escape, beside its submit. Same product, its own name.
    const cancel = '<Link href={`/products/${id}`}>{tCommon("cancel")}</Link>';
    const found = [...cancel.matchAll(LINK_ELEMENT)].filter(
      ([, tag, attributes, body]) =>
        tag !== "BackLink" && BACK_KEY.test(`${attributes} ${body}`),
    );

    expect(found).toEqual([]);
  });
});
