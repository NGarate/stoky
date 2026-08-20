import { describe, it, expect } from "bun:test";
import { Window } from "happy-dom";
import { tabbableWithin } from "@/lib/focus";

/**
 * The rule a focus trap gets wrong by default.
 *
 * `NavSheet` computed its first and last stop from one `querySelectorAll` of
 * the focusable selectors, which counts every radio in a group. The browser
 * counts one. When the last element in the panel is a radio that is not the
 * selected one, the trap's `last` is an element Tab never reaches, the wrap
 * never fires, and focus leaves the sheet into the page it is covering.
 *
 * Whether that happened was luck about ordering. These fix the rule.
 */
function panel(html: string): HTMLElement {
  const window = new Window();
  const document = window.document as unknown as Document;
  document.body.innerHTML = `<div id="panel">${html}</div>`;
  const node = document.getElementById("panel");
  if (!node) throw new Error("no panel");
  // happy-dom's classes are structurally the DOM's; the helper's
  // `instanceof HTMLInputElement` resolves against this window's globals.
  globalThis.HTMLInputElement =
    window.HTMLInputElement as unknown as typeof HTMLInputElement;
  return node as unknown as HTMLElement;
}

const names = (elements: HTMLElement[]): string[] =>
  elements.map(
    (element) =>
      element.getAttribute("data-id") ?? element.tagName.toLowerCase(),
  );

describe("tabbableWithin", () => {
  it("counts a radio group as one stop, which is the checked one", () => {
    const node = panel(`
      <a href="/inventory" data-id="link"></a>
      <input type="radio" name="theme" value="a" data-id="a" />
      <input type="radio" name="theme" value="b" data-id="b" checked />
      <input type="radio" name="theme" value="c" data-id="c" />
    `);

    // The naive version answers link, a, b, c — and calls "c" the last stop,
    // which Tab never visits.
    expect(names(tabbableWithin(node))).toEqual(["link", "b"]);
  });

  it("falls back to the first when a group has no selection", () => {
    const node = panel(`
      <input type="radio" name="g" value="a" data-id="a" />
      <input type="radio" name="g" value="b" data-id="b" />
    `);

    expect(names(tabbableWithin(node))).toEqual(["a"]);
  });

  it("keeps two groups apart, because a name is what makes a group", () => {
    const node = panel(`
      <input type="radio" name="one" value="a" data-id="1a" checked />
      <input type="radio" name="one" value="b" data-id="1b" />
      <input type="radio" name="two" value="a" data-id="2a" />
      <input type="radio" name="two" value="b" data-id="2b" checked />
    `);

    expect(names(tabbableWithin(node))).toEqual(["1a", "2b"]);
  });

  it("leaves every other control exactly where it was", () => {
    const node = panel(`
      <a href="/inventory" data-id="link"></a>
      <button data-id="button"></button>
      <select data-id="select"></select>
      <input type="checkbox" data-id="checkbox" />
      <input type="text" data-id="text" />
      <div tabindex="0" data-id="div"></div>
    `);

    expect(names(tabbableWithin(node))).toEqual([
      "link",
      "button",
      "select",
      "checkbox",
      "text",
      "div",
    ]);
  });

  it("skips what is disabled, and what opts out with tabindex -1", () => {
    const node = panel(`
      <button data-id="ok"></button>
      <button disabled data-id="off"></button>
      <div tabindex="-1" data-id="programmatic"></div>
    `);

    expect(names(tabbableWithin(node))).toEqual(["ok"]);
  });

  it("preserves DOM order, which is the order Tab uses", () => {
    const node = panel(`
      <input type="radio" name="g" value="a" data-id="radio" checked />
      <a href="/inventory" data-id="link"></a>
      <button data-id="button"></button>
    `);

    expect(names(tabbableWithin(node))).toEqual(["radio", "link", "button"]);
  });
});
