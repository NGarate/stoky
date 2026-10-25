/**
 * Registers the jest-dom assertions (toBeDisabled, toHaveClass, toBeVisible,
 * ...) on Bun's `expect`, and one of our own.
 *
 * Imported by each component test rather than by the preload: importing
 * `@testing-library/*` from inside the preload evaluates it too early, and its
 * `screen` helper permanently binds to a world without a `document.body`.
 */
import { expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";

// All but jest-dom's deprecated `toBeEmpty`, which would replace Bun's own:
// `expect([]).toBeEmpty()` would then ask whether an array is an empty DOM
// element. `toBeEmptyDOMElement` is the element check
// (src/types/bun-test-dom.d.ts).
const { toBeEmpty: _deprecated, ...domMatchers } = matchers;
expect.extend(domMatchers as Parameters<typeof expect.extend>[0]);

/**
 * `expect(element).toBeAbsent()` — the safe way to assert something is gone.
 *
 * **The idiom it replaces hangs rather than fails.** Writing
 * `expect(screen.queryByText("…")).toBeNull()` is the obvious thing, and it
 * works perfectly while it passes. When it *fails*, the received value is a
 * happy-dom element and the runner serialises it to build the message —
 * walking a node graph whose children point back at their parents. The cost
 * scales with the subtree, and it is pathological at every size: measured, a
 * failing `toBeNull` on an **empty** `<dl>` took ten seconds, and one on a
 * row of the kitchen screen never returned at all (killed at thirty seconds,
 * and twice at five minutes at 100% of a core). The same assertion written
 * so that no node reaches the message fails in five milliseconds.
 *
 * That is worse than a slow test. `CLAUDE.md` says an exit of 124 means a
 * step is stuck rather than slow, and this is a whole class of component
 * assertion that can never go red — it wedges the run at the ten-minute
 * budget instead, so the failure looks like infrastructure trouble rather
 * than like a bug in the code under test. A test that cannot report a
 * failure is not a test.
 *
 * **The same trap has a second door.** `expect(document.activeElement).toBe(el)`
 * puts *two* nodes in the message when it fails, and a stale one of those
 * spun a whole component run at 100% of a core — it took a bisection to find
 * that the wedge was one out-of-date assertion rather than anything it was
 * testing. Use jest-dom's `toHaveFocus()`, whose message prints a short
 * representation of the element instead of the tree it sits in.
 *
 * This matcher never puts a node in its message. It says what it found in a
 * sentence — tag, and the first of its text — which is what a person reading
 * a failure needs anyway.
 */
expect.extend({
  toBeAbsent(received: unknown) {
    if (received === null || received === undefined) {
      return {
        pass: true,
        message: () => "expected an element, but there was none",
      };
    }

    const element = received as { tagName?: string; textContent?: string };
    const tag = (element.tagName ?? "unknown").toLowerCase();
    const text = (element.textContent ?? "").trim().slice(0, 80);

    return {
      pass: false,
      // A string, deliberately, and never the node it describes.
      message: () =>
        `expected no element, but found <${tag}> containing "${text}"`,
    };
  },
});

declare module "bun:test" {
  interface Matchers {
    /** Asserts nothing matched, without serialising whatever did. */
    toBeAbsent(): void;
  }
}
